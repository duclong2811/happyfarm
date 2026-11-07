import {
  familyForKind,
  isResourceAvailable,
  parseCropDefinitionId,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  parseTreeDefinitionId,
  resolvePass,
  skillIdFor,
  type Actor,
  type ActorCargoItem,
  type ActorJob,
  type AssignmentClaims,
  type AssignmentPlanInput,
  type AssignmentTargets,
  type AutoPlanContext,
  type AutoTravelState,
  type CellBounds,
  type ControlMode,
  type CropInstance,
  type Farm,
  type FarmId,
  type FundingCandidate,
  type ItemDefinitionId,
  type JobId,
  type LifecycleFamily,
  type PlayerId,
  type ResourceNodeState,
  type TileCoordinate,
  type TreeInstance,
  type WaitReason,
  type WorkAction,
  type WorkAreaKind,
  type WorkSkillDefinition
} from "@happy-farm/domain";
import { CropStateProjector } from "./crops";
import { cellIndex, cellKey, emptyCells as emptyCellsOf, matchingCrops, matchingTrees } from "./auto-targets";
import { MAX_AUTO_FUNDING_ITEMS } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import { TreeStateProjector } from "./trees";
import { jobView, mainCharacterFor, requireOwnedFarm, targetNameKey, type JobTargetCatalogue } from "./jobs";
import type {
  ActorContext,
  ActorIdGenerator,
  ActorJobRepository,
  ActorRepository,
  AutoTravelRepository,
  CargoCapacityLookup,
  CargoRepository,
  Clock,
  ConstructionRepository,
  CropInstanceRepository,
  FarmMemberRepository,
  FarmRepository,
  InventoryRepository,
  ResourceNodeStateRepository,
  ShopEntryRepository,
  TreeInstanceRepository,
  WalletRepository,
  WarehouseRepository,
  WarehouseTierRepository,
  WorkAreaRepository
} from "./ports";

/**
 * Auto: control, policy and the plan.
 *
 * D1 makes the engine **able to decide**. It switches the actor's control mode, keeps the one policy a
 * plan needs, builds a bounded snapshot of the world, and asks the pure resolver what the next step
 * would be. It performs none of it: no planting, no harvesting, no travelling to a field, no unload,
 * no purchase. Those are D2 and later, and the panel says so.
 *
 * The one currency Auto reasons about is Gold, named here rather than accepted from a client, exactly
 * as every other price in the game is resolved from data.
 */
const GOLD_CURRENCY_ID = parseCurrencyDefinitionId("currency_gold");
/** The Main Character may survive a short disconnect, but is not an offline worker. */
export const MAIN_CHARACTER_AUTO_LEASE_SECONDS = 180;
/** Online Auto requests may extend that lease at most once per minute. */
export const MAIN_CHARACTER_AUTO_LEASE_RENEW_INTERVAL_SECONDS = 60;
const MAIN_CHARACTER_AUTO_LEASE_RENEW_THRESHOLD_SECONDS =
  MAIN_CHARACTER_AUTO_LEASE_SECONDS - MAIN_CHARACTER_AUTO_LEASE_RENEW_INTERVAL_SECONDS;

export function autoLeaseUntil(now: string): string {
  return new Date(Date.parse(now) + MAIN_CHARACTER_AUTO_LEASE_SECONDS * 1000).toISOString();
}

/**
 * Converts a state written by the earlier 24-hour lease implementation to the current short lease.
 * The old value is never allowed to extend an Auto epoch: its valid ceiling is the timestamp at which
 * the current lease was issued plus the new 180-second lease. A null lease is treated the same way for
 * pre-lease rows.
 */
export function normalizeMainCharacterAutoLease(input: {
  readonly simulationAt?: string | null | undefined;
  readonly leaseUntil?: string | null | undefined;
  readonly leaseIssuedAt?: string | null | undefined;
  readonly now: string;
}): { readonly leaseUntil: string; readonly leaseIssuedAt: string; readonly legacy: boolean } {
  const nowMs = Date.parse(input.now);
  const anchorMs = input.simulationAt === null || input.simulationAt === undefined
    ? nowMs
    : Date.parse(input.simulationAt);
  const storedMs = input.leaseUntil === null || input.leaseUntil === undefined ? Number.NaN : Date.parse(input.leaseUntil);
  const issuedMs = input.leaseIssuedAt === null || input.leaseIssuedAt === undefined ? anchorMs : Date.parse(input.leaseIssuedAt);
  const maxLeaseMs = MAIN_CHARACTER_AUTO_LEASE_SECONDS * 1000;
  if (Number.isFinite(storedMs) && Number.isFinite(issuedMs) && storedMs - issuedMs <= maxLeaseMs) {
    return { leaseUntil: new Date(storedMs).toISOString(), leaseIssuedAt: new Date(issuedMs).toISOString(), legacy: false };
  }
  const legacyAnchorMs = Number.isFinite(issuedMs) ? issuedMs : (Number.isFinite(anchorMs) ? anchorMs : nowMs);
  return { leaseUntil: new Date(legacyAnchorMs + maxLeaseMs).toISOString(), leaseIssuedAt: new Date(legacyAnchorMs).toISOString(), legacy: true };
}

export function shouldRenewMainCharacterAutoLease(input: {
  readonly simulationAt?: string | null | undefined;
  readonly leaseUntil?: string | null | undefined;
  readonly leaseIssuedAt?: string | null | undefined;
  readonly now: string;
  readonly suppressRenewal?: boolean | undefined;
}): boolean {
  if (input.suppressRenewal) return false;
  const normalized = normalizeMainCharacterAutoLease(input);
  const remaining = Date.parse(normalized.leaseUntil) - Date.parse(input.now);
  return normalized.legacy || remaining <= MAIN_CHARACTER_AUTO_LEASE_RENEW_THRESHOLD_SECONDS * 1000;
}

export interface SetActorControlCommand {
  readonly requestId: string;
  readonly startAuto: boolean;
  readonly expectedVersion: number;
}

export interface ActorControlView {
  readonly actorId: string;
  readonly controlMode: ControlMode;
  readonly version: number;
}

export interface ActorControlDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly actors: ActorRepository;
  readonly ids: ActorIdGenerator;
  readonly cargoCapacities: CargoCapacityLookup;
  readonly clock: Clock;
  /**
   * The Auto timeline, when the host has one.
   *
   * Switching Auto *on* starts a new offline epoch at the current server time, so the period the
   * player drove by hand is never retroactively simulated. A host without a timeline (a test double)
   * simply has no watermark to move.
   */
  readonly travel?: AutoTravelRepository;
}

/**
 * START_AUTO / STOP_AUTO.
 *
 * Deliberately convergent rather than merely guarded: asking for the mode the actor is already in
 * succeeds without writing anything, and losing a race resolves by re-reading the actor and agreeing
 * when the winner asked for the same thing. A genuine *change* made against a stale version is still
 * refused. It changes control and nothing else - cargo, assignments, gold and experience are
 * untouched by construction, because there is no code path from here to any of them.
 */
export class SetActorControl {
  constructor(private readonly dependencies: ActorControlDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: SetActorControlCommand): Promise<ActorControlView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const main = await mainCharacterFor(this.dependencies, farmId);
    const target: ControlMode = command.startAuto ? "AUTO_CONTROLLED" : "PLAYER_CONTROLLED";
    if (main.controlMode === target) {
      if (target === "PLAYER_CONTROLLED" && this.dependencies.travel !== undefined) {
        await this.stopTimeline(main.id);
      }
      return { actorId: main.id, controlMode: main.controlMode, version: main.version };
    }
    if (!Number.isInteger(command.expectedVersion) || command.expectedVersion !== main.version) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "The actor changed since it was read");
    }
    const next: Actor = {
      ...main,
      controlMode: target,
      version: main.version + 1,
      updatedAt: this.dependencies.clock.now()
    };
    const applied = await this.dependencies.actors.setControlModeAtomically(next, command.expectedVersion);
    if (!applied) {
      // A second tab got there first. If it asked for the same mode the intent is already satisfied;
      // if it asked for the other one, this request is genuinely out of date.
      const latest = await this.dependencies.actors.findById(main.id);
      if (latest !== null && latest.controlMode === target) {
        return { actorId: latest.id, controlMode: latest.controlMode, version: latest.version };
      }
      throw new ApplicationError("CONFLICT_STALE_STATE", "The actor changed since it was read");
    }
    if (target === "AUTO_CONTROLLED") {
      // START is the beginning of an offline epoch: any earlier watermark described the previous Auto
      // period (or no period at all), and simulating from it would include the manual play in between.
      const timeline = await this.dependencies.travel?.find(main.id);
      if (timeline !== undefined && this.dependencies.travel !== undefined) {
        await this.dependencies.travel.saveAtomically(
          main.id,
          timeline.version,
          { ...timeline, simulationAt: next.updatedAt, leaseUntil: autoLeaseUntil(next.updatedAt), leaseIssuedAt: next.updatedAt },
          next.updatedAt
        );
      }
    }
    if (target === "PLAYER_CONTROLLED") {
      await this.stopTimeline(main.id, next.updatedAt);
    }
    return { actorId: next.id, controlMode: next.controlMode, version: next.version };
  }

  /** Freeze the authoritative watermark at Stop, bounded by the active lease, with a retryable CAS. */
  private async stopTimeline(actorId: Actor["id"], requestedAt = this.dependencies.clock.now()): Promise<void> {
    const travel = this.dependencies.travel;
    if (travel === undefined) return;
    let state = await travel.find(actorId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const normalized = normalizeMainCharacterAutoLease({
        simulationAt: state.simulationAt,
        leaseUntil: state.leaseUntil,
        leaseIssuedAt: state.leaseIssuedAt,
        now: requestedAt
      });
      const nowMs = Date.parse(requestedAt);
      const leaseMs = Date.parse(normalized.leaseUntil);
      const previousMs = state.simulationAt === null || state.simulationAt === undefined ? nowMs : Date.parse(state.simulationAt);
      const stopMs = Math.max(Number.isFinite(previousMs) ? previousMs : nowMs, Math.min(nowMs, leaseMs));
      const next: AutoTravelState = {
        ...state,
        travelTo: null,
        arrivesAt: null,
        simulationAt: new Date(stopMs).toISOString(),
        leaseUntil: null,
        leaseIssuedAt: null,
        version: state.version + 1
      };
      if (await travel.saveAtomically(actorId, state.version, next, requestedAt)) return;
      state = await travel.find(actorId);
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The Auto timeline changed while stopping");
  }
}

export interface SetAssignmentPolicyCommand {
  readonly requestId: string;
  readonly autoPurchaseSupplies: boolean;
  readonly expectedVersion: number;
  /**
   * The emergency-funding policy, when the caller is changing it.
   *
   * Absent means "leave funding alone", so a client that only flips Auto Purchase keeps working. The
   * items are ordered: the first is sold first, and the list is bounded by MAX_AUTO_FUNDING_ITEMS.
   */
  readonly funding?: { readonly enabled: boolean; readonly items: readonly string[] };
}

/**
 * What the assignment policy use case needs: the assignment, the farm it must be authorized on, and
 * the catalogue that resolves the target's name key.
 */
export interface AssignmentPolicyDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly jobs: ActorJobRepository;
  readonly targets: JobTargetCatalogue;
  readonly clock: Clock;
}

/** Sets one assignment's Auto Purchase policy. Convergent, like control: asking for what it is, is a no-op. */
export class SetAssignmentPolicy {
  constructor(private readonly dependencies: AssignmentPolicyDependencies) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    jobId: JobId,
    command: SetAssignmentPolicyCommand
  ): Promise<ReturnType<typeof jobView>> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    await requireOwnedFarm(this.dependencies, farmId, actor);
    const job = await this.dependencies.jobs.findById(jobId);
    if (job === null || job.farmId !== farmId) {
      throw new ApplicationError("JOB_NOT_FOUND", "Assignment was not found");
    }
    const view = async (row: ActorJob): Promise<ReturnType<typeof jobView>> =>
      jobView(
        row,
        targetNameKey(row.kind, row.targetDefinitionId, this.dependencies.targets),
        (await this.dependencies.jobs.listFundingItems(row.id)).map((item) => item.itemDefinitionId)
      );
    const funding = command.funding;
    if (funding !== undefined) {
      if (funding.items.length > MAX_AUTO_FUNDING_ITEMS) {
        throw new ApplicationError("INVALID_FUNDING", "Too many funding items");
      }
      if (new Set(funding.items).size !== funding.items.length) {
        throw new ApplicationError("INVALID_FUNDING", "Funding items must be distinct");
      }
    }
    const currentFunding = funding === undefined ? null : await this.dependencies.jobs.listFundingItems(job.id);
    const fundingUnchanged =
      funding === undefined ||
      (job.autoFundingEnabled === funding.enabled &&
        currentFunding !== null &&
        currentFunding.length === funding.items.length &&
        currentFunding.every((item, index) => item.itemDefinitionId === funding.items[index]));
    if (job.autoPurchaseSupplies === command.autoPurchaseSupplies && fundingUnchanged) return await view(job);
    if (!Number.isInteger(command.expectedVersion) || command.expectedVersion !== job.version) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "The assignment changed since it was read");
    }
    if (funding !== undefined) {
      const nextWithFunding: ActorJob = {
        ...job,
        autoPurchaseSupplies: command.autoPurchaseSupplies,
        autoFundingEnabled: funding.enabled,
        version: job.version + 1,
        updatedAt: this.dependencies.clock.now()
      };
      const applied = await this.dependencies.jobs.setFundingAtomically(nextWithFunding, funding.items, command.expectedVersion);
      if (!applied) {
        const latest = await this.dependencies.jobs.findById(jobId);
        if (latest !== null && latest.version === nextWithFunding.version) return await view(latest);
        throw new ApplicationError("CONFLICT_STALE_STATE", "The assignment changed since it was read");
      }
      return await view(nextWithFunding);
    }
    const next: ActorJob = {
      ...job,
      autoPurchaseSupplies: command.autoPurchaseSupplies,
      version: job.version + 1,
      updatedAt: this.dependencies.clock.now()
    };
    const applied = await this.dependencies.jobs.setAutoPurchaseAtomically(next, command.expectedVersion);
    if (!applied) {
      const latest = await this.dependencies.jobs.findById(jobId);
      if (latest !== null && latest.autoPurchaseSupplies === command.autoPurchaseSupplies) return view(latest);
      throw new ApplicationError("CONFLICT_STALE_STATE", "The assignment changed since it was read");
    }
    return view(next);
  }
}

/** One assignment, as the plan read explains it. */
export interface AutoAssignmentPlanView {
  readonly jobId: string;
  readonly priority: number;
  readonly enabled: boolean;
  readonly skillId: string;
  readonly skillFamily: LifecycleFamily;
  readonly action: WorkAction | null;
  readonly waitReason: WaitReason | null;
  /** True when a higher-priority assignment already claimed this one's targets in this pass. */
  readonly claimed: boolean;
}

/** The plan, as the wire and the panel carry it. */
export interface AutoPlanView {
  readonly actorId: string;
  readonly controlMode: ControlMode;
  readonly action: WorkAction | null;
  readonly jobId: string | null;
  readonly waitReason: WaitReason | null;
  readonly perAssignment: readonly AutoAssignmentPlanView[];
}

/**
 * The rows one resolver pass already read, handed back to the caller that will act on the plan.
 *
 * The executor needs the same work-area cells, crops, trees and standing bounds the resolver just
 * counted, and within one request they cannot have changed: nothing between the plan and the single
 * bounded transition writes any of them. Passing them on is what keeps a settlement step from
 * re-reading the two largest lists in the game.
 */
export interface AutoPlanObservation {
  readonly cellsByArea: ReadonlyMap<string, readonly TileCoordinate[]>;
  readonly crops: readonly CropInstance[];
  readonly trees: readonly TreeInstance[];
  readonly bounds: readonly CellBounds[];
}

/**
 * What one *reconciliation pass* may share between its bounded transitions.
 *
 * Work-area membership and standing building footprints cannot change during an Auto pass - no
 * transition builds, moves or repairs anything - so a pass reads them once and hands them back in.
 * Crops, trees, cargo and the actor do change between transitions and are never reused across them.
 * This is a per-pass cache only: it dies with the request and is never shared across requests.
 */
export interface AutoPassReuse {
  readonly cellsByArea: ReadonlyMap<string, readonly TileCoordinate[]>;
  readonly bounds: readonly CellBounds[];
}

/**
 * Everything one resolver pass reads.
 *
 * Named rather than assembled ad hoc so the D1 read set is auditable in one place: the actor and its
 * cargo, the assignments, the farm's crops, trees and standing bounds, the zone's resource-node
 * states, the wallet, the warehouse, each assignment's own cells, and the stock its input needs. The
 * catalogues (crops, trees, resources, shops) are game data held in memory, not D1.
 */
export interface AutoPlanDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly actors: ActorRepository;
  readonly ids: ActorIdGenerator;
  readonly cargoCapacities: CargoCapacityLookup;
  readonly jobs: ActorJobRepository;
  readonly workAreas: WorkAreaRepository;
  readonly crops: CropInstanceRepository;
  readonly trees: TreeInstanceRepository;
  readonly constructions: ConstructionRepository;
  readonly resourceStates: ResourceNodeStateRepository;
  readonly cargo: CargoRepository;
  readonly inventory: InventoryRepository;
  readonly warehouse: WarehouseRepository;
  readonly tiers: WarehouseTierRepository;
  readonly wallets: WalletRepository;
  readonly shops: ShopEntryRepository;
  readonly targets: JobTargetCatalogue;
  readonly clock: Clock;
}

/**
 * Builds the snapshot, asks the resolver, and explains the answer.
 *
 * Pure planning: the only write anywhere in this class is the actor bootstrap the rest of the spine
 * shares, and the resolver below cannot reach even that. It runs when the panel is opened and after
 * an explicit Auto action, never on a timer, a frame, a pointer event or a movement step.
 */
export class ResolveAutoPlan {
  constructor(private readonly dependencies: AutoPlanDependencies) {}

  /**
   * The plan for one farm.
   *
   * `observed` lets a caller that has *already* read the farm, the actor and the carried rows in this
   * same request hand them in, so one Auto step does not read the same rows four times over. It is a
   * read optimisation with no authority in it: authorization still runs here, from the authenticated
   * actor, against the farm.
   */
  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    observed?: { readonly farm: Farm; readonly main: Actor; readonly cargo: readonly ActorCargoItem[] }
  ): Promise<AutoPlanView> {
    return (await this.executeWithSnapshot(actor, farmId, observed)).plan;
  }

  /** The plan, plus the rows this pass read, for a caller that will act on it in the same request. */
  async executeWithSnapshot(
    actor: ActorContext | null,
    farmId: FarmId,
    observed?: { readonly farm: Farm; readonly main: Actor; readonly cargo: readonly ActorCargoItem[] },
    /** Rows an enclosing reconciliation pass already read and knows cannot have changed. */
    reuse?: AutoPassReuse,
    /**
     * The authoritative instant this plan is made for.
     *
     * Online it is the server clock. A reconciliation pass supplies the instant it has simulated up
     * to, so a crop that would have ripened during the absence is seen as ripe *at that instant*
     * rather than as it looks when the player came back.
     */
    serverTime?: string
  ): Promise<{ readonly plan: AutoPlanView; readonly snapshot: AutoPlanObservation }> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const farm = observed?.farm ?? (await this.dependencies.farms.findById(farmId));
    if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    await requireOwnedFarm(this.dependencies, farmId, actor, farm);
    const owner: PlayerId = farm.ownerPlayerId;
    const main = observed?.main ?? (await mainCharacterFor(this.dependencies, farmId, farm));

    const cargoRows = observed?.cargo ?? (await this.dependencies.cargo.listByActor(main.id));
    const carried: Record<string, number> = {};
    let cargoUsed = 0;
    for (const row of cargoRows) {
      carried[row.itemDefinitionId] = (carried[row.itemDefinitionId] ?? 0) + row.quantity;
      cargoUsed += row.quantity;
    }

    const wallet = await this.dependencies.wallets.find(owner, GOLD_CURRENCY_ID);
    const warehouse = await this.dependencies.warehouse.find(owner);
    const capacity = warehouse?.capacity ?? this.dependencies.tiers.list()[0]?.capacity ?? 0;

    const jobs = await this.dependencies.jobs.listByActor(main.id);

    // One cells read per distinct area, never per assignment.
    const cellsByArea = new Map<string, readonly TileCoordinate[]>();
    for (const job of jobs) {
      if (cellsByArea.has(job.workAreaId)) continue;
      const shared = reuse?.cellsByArea.get(job.workAreaId);
      if (shared !== undefined) {
        cellsByArea.set(job.workAreaId, shared);
        continue;
      }
      const area = await this.dependencies.workAreas.findById(job.workAreaId);
      const cells = area === null || area.farmId !== farmId ? [] : await this.dependencies.workAreas.listCells(area.id);
      cellsByArea.set(job.workAreaId, cells.map((cell) => ({ x: cell.x, y: cell.y })));
    }

    // The skills, so the stock read knows exactly which inputs to look for.
    const skills = new Map<string, WorkSkillDefinition>();
    for (const job of jobs) {
      const skill = this.skillFor(job);
      if (skill !== null) skills.set(job.id, skill);
    }
    const stored = await this.storedOf(owner, [...skills.values()]);

    const cropRows = await this.dependencies.crops.listByFarm(farmId);
    const treeRows = await this.dependencies.trees.listByFarm(farmId);
    const bounds = reuse?.bounds ?? (await this.dependencies.constructions.listBounds(farmId));
    const nodeStates = await this.dependencies.resourceStates.listByZone(main.zoneId);
    const now = serverTime ?? this.dependencies.clock.now();
    const matureCrops = this.maturityOf(cropRows, now);
    const readyTrees = this.readinessOf(treeRows, now);

    const assignments: AssignmentPlanInput[] = [];
    for (const job of jobs) {
      const skill = skills.get(job.id);
      if (skill === undefined) continue;
      const targets = this.targetsFor(
        job,
        cellsByArea.get(job.workAreaId) ?? [],
        cropRows,
        matureCrops,
        treeRows,
        readyTrees,
        bounds,
        nodeStates,
        main.zoneKind,
        now
      );
      assignments.push({
        jobId: job.id,
        priority: job.priority,
        enabled: job.enabled,
        skill,
        autoPurchaseSupplies: job.autoPurchaseSupplies,
        targets,
        inputPrice: skill.inputItemDefinitionId === null ? null : this.supplyPrice(skill.inputItemDefinitionId),
        // The whitelist is read only when the player enabled it for this assignment; the prices are
        // the catalogue's own NPC sell prices, never a client value, and an item this deployment does
        // not buy is left out entirely rather than being sold for a made-up number.
        funding: job.autoFundingEnabled
          ? { enabled: true, candidates: await this.fundingCandidates(owner, job.id) }
          : { enabled: false, candidates: [] }
      });
    }

    const context: AutoPlanContext = {
      controlMode: main.controlMode,
      cargo: { used: cargoUsed, capacity: main.cargoCapacity },
      warehouse: { full: capacity > 0 && (warehouse?.used ?? 0) >= capacity },
      carried,
      stored,
      gold: wallet?.balance ?? 0,
      assignments
    };
    const pass = resolvePass(context);
    const byJobId = new Map(pass.assignments.map((plan) => [plan.jobId as string, plan]));
    const perAssignment: AutoAssignmentPlanView[] = assignments.map((assignment) => {
      const plan = byJobId.get(assignment.jobId);
      return {
        jobId: assignment.jobId,
        priority: assignment.priority,
        enabled: assignment.enabled,
        skillId: assignment.skill.id,
        skillFamily: assignment.skill.family,
        action: plan?.action ?? null,
        waitReason: plan?.waitReason ?? "NO_ELIGIBLE_TARGETS",
        claimed: plan?.claimed ?? false
      };
    });
    return {
      plan: {
        actorId: main.id,
        controlMode: main.controlMode,
        action: pass.plan.action,
        jobId: pass.plan.jobId,
        waitReason: pass.plan.waitReason,
        perAssignment
      },
      snapshot: { cellsByArea, crops: cropRows, trees: treeRows, bounds }
    };
  }

  /** One skill definition per stored assignment: `(kind, target)` *is* the skill. */
  private skillFor(job: ActorJob): WorkSkillDefinition | null {
    const kind = job.kind;
    const prefix =
      kind === "FARM"
        ? "crop_"
        : kind === "ORCHARD"
          ? "tree_"
          : kind === "FORESTRY" || kind === "MINING"
            ? "resource_"
            : null;
    if (prefix === null || !job.targetDefinitionId.startsWith(prefix)) return null;
    const definition = this.definitionFor(kind, job.targetDefinitionId);
    if (definition === null) return null;
    return {
      id: skillIdFor(kind, job.targetDefinitionId),
      kind,
      family: familyForKind(kind),
      targetDefinitionId: job.targetDefinitionId,
      inputItemDefinitionId: definition.input,
      outputItemDefinitionId: definition.output,
      outputQuantity: definition.outputQuantity
    };
  }

  /** The definition behind a target: the crop, tree or resource the world ships. */
  private definitionFor(
    kind: WorkAreaKind,
    targetDefinitionId: string
  ): { readonly input: string | null; readonly output: string | null; readonly outputQuantity: number | null } | null {
    if (kind === "FARM") {
      const crop = this.cropDefinition(targetDefinitionId);
      return crop === null
        ? null
        : {
            input: crop.seedItemDefinitionId,
            output: crop.harvest.itemDefinitionId,
            outputQuantity: crop.harvest.baseQuantity
          };
    }
    if (kind === "ORCHARD") {
      const tree = this.treeDefinition(targetDefinitionId);
      return tree === null
        ? null
        : {
            input: tree.saplingItemDefinitionId,
            output: tree.harvest.itemDefinitionId,
            outputQuantity: tree.harvest.baseQuantity
          };
    }
    const resource = this.dependencies.targets.resources.findDefinition(targetDefinitionId);
    if (resource === null) return null;
    const table = this.dependencies.targets.resources.findDropTable(resource.dropTableId);
    const first = table?.entries[0];
    return {
      input: null,
      output: first?.itemDefinitionId ?? null,
      outputQuantity: first === undefined ? null : Math.max(first.minQuantity, 1)
    };
  }

  private cropDefinition(targetDefinitionId: string) {
    try {
      return this.dependencies.targets.crops.findById(parseCropDefinitionId(targetDefinitionId));
    } catch {
      return null;
    }
  }

  private treeDefinition(targetDefinitionId: string) {
    try {
      return this.dependencies.targets.trees.findById(parseTreeDefinitionId(targetDefinitionId));
    } catch {
      return null;
    }
  }

  /** The catalogue price of one unit of a supply, from the shop the world ships. */
  private supplyPrice(itemDefinitionId: string): number | null {
    const entry = this.dependencies.shops
      .list()
      .find((candidate) => candidate.itemDefinitionId === itemDefinitionId && candidate.buyPrice !== null);
    return entry?.buyPrice ?? null;
  }

  /** What the shop pays for one unit of an item, or null when this deployment does not buy it. */
  private sellPrice(itemDefinitionId: string): number | null {
    for (const entry of this.dependencies.shops.list()) {
      if (entry.itemDefinitionId === itemDefinitionId && entry.sellPrice !== null) return entry.sellPrice;
    }
    return null;
  }

  /**
   * The assignment's funding whitelist, priced and quantified.
   *
   * Bounded by MAX_AUTO_FUNDING_ITEMS, and read only when the player enabled funding for this
   * assignment. An item this deployment does not buy is dropped rather than being offered at a price
   * nobody set.
   */
  private async fundingCandidates(owner: PlayerId, jobId: JobId): Promise<readonly FundingCandidate[]> {
    const items = (await this.dependencies.jobs.listFundingItems(jobId)).slice(0, MAX_AUTO_FUNDING_ITEMS);
    const candidates: FundingCandidate[] = [];
    for (const item of items) {
      const unitPrice = this.sellPrice(item.itemDefinitionId);
      if (unitPrice === null) continue;
      const held = await this.dependencies.inventory.find(owner, item.itemDefinitionId as ItemDefinitionId);
      candidates.push({ itemDefinitionId: item.itemDefinitionId, unitPrice, available: held?.quantity ?? 0 });
    }
    return candidates;
  }

  /** Which crops are ripe, by instance id. A crop whose definition is gone simply has no state. */
  private maturityOf(crops: readonly CropInstance[], serverTime: string): ReadonlyMap<string, boolean> {
    const known = crops.filter((crop) => this.cropDefinition(crop.cropDefinitionId) !== null);
    const projected = new CropStateProjector(this.dependencies.targets.crops, this.dependencies.clock).projectMany(known, serverTime);
    return new Map(projected.map((state) => [state.cropInstanceId, state.mature]));
  }

  /** Which trees are ready, by instance id. */
  private readinessOf(trees: readonly TreeInstance[], serverTime: string): ReadonlyMap<string, boolean> {
    const known = trees.filter((tree) => this.treeDefinition(tree.treeDefinitionId) !== null);
    const projected = new TreeStateProjector(this.dependencies.targets.trees, this.dependencies.clock).projectMany(known, serverTime);
    return new Map(projected.map((state) => [state.treeInstanceId, state.ready]));
  }

  /** How many of each input the player's warehouse holds. One bounded read per distinct input. */
  private async storedOf(owner: PlayerId, skills: readonly WorkSkillDefinition[]): Promise<Record<string, number>> {
    const stored: Record<string, number> = {};
    for (const skill of skills) {
      const item = skill.inputItemDefinitionId;
      if (item === null || stored[item] !== undefined) continue;
      let parsed;
      try {
        parsed = parseItemDefinitionId(item);
      } catch {
        stored[item] = 0;
        continue;
      }
      const row = await this.dependencies.inventory.find(owner, parsed);
      stored[item] = row?.quantity ?? 0;
    }
    return stored;
  }

  /**
   * What one assignment's area holds, as counts and as the ids behind them.
   *
   * Only the assignment's *own* target is ever a candidate: another crop, a tree, a building or a
   * decoration occupies its cell and is skipped, so Auto never clears what it did not plant. The
   * claim ids are the overlap rule's input, and they stay bounded by the area's own cells.
   */
  private targetsFor(
    job: ActorJob,
    cells: readonly TileCoordinate[],
    crops: readonly CropInstance[],
    matureCrops: ReadonlyMap<string, boolean>,
    trees: readonly TreeInstance[],
    readyTrees: ReadonlyMap<string, boolean>,
    bounds: readonly CellBounds[],
    nodeStates: readonly ResourceNodeState[],
    zoneKind: string,
    now: string
  ): AssignmentTargets {
    const inside = cellIndex(cells);
    const inArea = (x: number, y: number): boolean => inside.has(cellKey(x, y));
    const areaCrops = matchingCrops(cells, crops, job.targetDefinitionId);
    const areaTrees = matchingTrees(cells, trees, job.targetDefinitionId);
    const areaEmptyCells = emptyCellsOf(cells, crops, trees, bounds);

    const availableNodes: string[] = [];
    let depletedNodes = 0;
    if (job.kind === "MINING" || job.kind === "FORESTRY") {
      const byNodeId = new Map(nodeStates.map((state) => [state.nodeId, state]));
      const definition = this.dependencies.targets.resources.findDefinition(job.targetDefinitionId);
      for (const node of this.dependencies.targets.resources.listNodes()) {
        if (node.definitionId !== job.targetDefinitionId || node.zoneKind !== zoneKind) continue;
        if (!inArea(Math.round(node.position.x), Math.round(node.position.y))) continue;
        if (definition?.settlementMode === "CONTINUOUS_LABOR") {
          availableNodes.push(node.id);
          continue;
        }
        const state = byNodeId.get(node.id);
        if (isResourceAvailable(state?.availableAt ?? null, now)) availableNodes.push(node.id);
        else depletedNodes += 1;
      }
    }

    const mature = areaCrops.filter((crop) => matureCrops.get(crop.id) === true);
    const ready = areaTrees.filter((tree) => readyTrees.get(tree.id) === true);
    const claims: AssignmentClaims = {
      mature: [...mature.map((crop) => crop.id), ...ready.map((tree) => tree.id)],
      empty: areaEmptyCells.map((cell) => cellKey(cell.x, cell.y)),
      available: availableNodes
    };
    return {
      emptyCells: areaEmptyCells.length,
      growingCells: areaCrops.length - mature.length + (areaTrees.length - ready.length),
      matureCells: mature.length + ready.length,
      standing: areaTrees.length,
      availableNodes: availableNodes.length,
      depletedNodes,
      claims
    };
  }
}
