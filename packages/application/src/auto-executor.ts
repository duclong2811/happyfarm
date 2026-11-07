import {
  MARKET_ANCHOR,
  WAREHOUSE_ANCHOR,
  anchorsMatch,
  cellAnchor,
  isExecutableFamily,
  parseCropDefinitionId,
  parseJobId,
  workAreaCellKey,
  travelHasArrived,
  travelSeconds,
  type Actor,
  type ActorJob,
  type AutoAnchor,
  type AutoAnchorTiles,
  type AutoTravelState,
  type ControlMode,
  type CropInstance,
  type FarmId,
  type TileCoordinate,
  type WaitReason
} from "@happy-farm/domain";
import { emptyCells, matchingCrops } from "./auto-targets";
import { CropStateProjector } from "./crops";
import type { AutoAssignmentPlanView, AutoPassReuse, AutoPlanObservation, AutoPlanView, ResolveAutoPlan } from "./auto";
import { ApplicationError } from "./errors";
import { mainCharacterFor, requireOwnedFarm, targetNameKey, type MainCharacterDependencies } from "./jobs";
import type {
  ActorContext,
  ActorJobRepository,
  AutoTravelRepository,
  CargoRepository,
  ConstructionRepository,
  CropInstanceRepository,
  FarmMemberRepository,
  FarmTileRepository,
  ShopEntryRepository,
  TreeInstanceRepository,
  WorkAreaRepository
} from "./ports";
import type { JobTargetCatalogue } from "./jobs";
import {
  MAIN_CHARACTER_AUTO_LEASE_SECONDS,
  MAIN_CHARACTER_AUTO_LEASE_RENEW_INTERVAL_SECONDS,
  normalizeMainCharacterAutoLease,
  shouldRenewMainCharacterAutoLease
} from "./auto";

/**
 * The Auto executor: one bounded transition per call, and never a loop of its own.
 *
 * The browser owns frames, so the browser *asks* - "advance one step" - and the server answers with
 * what just happened, or where the actor is walking, or why it is waiting. There is no `while`, no
 * tick, no cron and no per-actor timer: a step is one request, one bounded read set, and at most one
 * authoritative settlement.
 *
 * Two rules make that safe:
 *
 * 1. **A plan is never authority.** Every step re-resolves from the world as it is now, so a plan the
 *    client saw a second ago - or one another tab invalidated - cannot settle anything stale.
 * 2. **The server knows where the actor is.** A walk is recorded as "left this anchor, arrives at this
 *    time", and no field, warehouse or market action settles before the server's own clock says the
 *    actor has had time to get there. A client that claims to have arrived changes nothing.
 */

/** What the actor just did, is doing, or is waiting to do. */
export type AutoStepPhase = "STOPPED" | "TRAVELLING" | "WORKED" | "WAITING" | "RETRY";

/** One step request: an id, and nothing else the client could use to name a target. */
export interface AdvanceAutoCommand {
  readonly requestId: string;
}

/**
 * What one reconciliation pass shares between its bounded steps.
 *
 * Optional and mutable on purpose: the first step of a pass fills `reuse` with the rows that cannot
 * change during the pass, and every later step of the same pass reads them from here instead of the
 * database. The object lives for one pass only - it is never stored, cached across requests, or shared
 * between actors.
 */
export interface AutoPassContext {
  reuse?: AutoPassReuse;
  /** Offline reconciliation must respect the lease it started with; it may not extend it per event. */
  suppressLeaseRenewal?: boolean;
}

/** The executable steps. Every one of them is performed by an existing authoritative settlement. */
export type AutoStepToken =
  | "LOAD_INPUT"
  | "PURCHASE_INPUT"
  | "FUND_AND_PURCHASE_INPUT"
  | "TRAVEL_TO_STORAGE"
  | "UNLOAD"
  | "PLANT"
  | "HARVEST"
  | "MINE";

export interface AutoStepView {
  readonly controlMode: ControlMode;
  readonly phase: AutoStepPhase;
  /** What the actor is doing, or just did. A stable token; the panel owns the words. */
  readonly step: AutoStepToken | null;
  readonly waitReason: WaitReason | null;
  readonly jobId: string | null;
  readonly skillId: string | null;
  readonly targetDefinitionId: string | null;
  /** The skill's display key, resolved server-side so the panel needs no catalogue of its own. */
  readonly targetDisplayNameKey: string | null;
  readonly itemDefinitionId: string | null;
  readonly quantity: number | null;
  readonly cell: TileCoordinate | null;
  readonly from: AutoAnchor | null;
  readonly to: AutoAnchor | null;
  readonly arrivesAt: string | null;
  /** How long the client should wait before asking again. 0 means "wait for a state change". */
  readonly retryAfterMs: number;
  /** The winning assignment's field, for the panel's progress line. */
  readonly progress: { readonly planted: number; readonly empty: number; readonly mature: number } | null;
  readonly cargo: { readonly used: number; readonly capacity: number };
}

/**
 * The five authoritative settlements the executor performs, as the narrow interface it needs.
 *
 * Structural rather than the concrete classes so the executor can be tested against a scripted world,
 * and so the wiring stays in one place. Each of these is the *existing* use case, with its own
 * authorization, idempotency and atomicity - the executor adds none of that and bypasses none of it.
 */
export interface AutoActions {
  readonly load: {
    executeAuto(
      actor: ActorContext | null,
      farmId: FarmId,
      command: { readonly requestId: string; readonly itemDefinitionId: string; readonly quantity: number; readonly expectedVersion: number; readonly actorId: string; readonly assignmentId: string; readonly eventTime: string; readonly expectedAutoVersion: number; readonly expectedSimulationAt: string | null }
    ): Promise<unknown>;
    execute(
      actor: ActorContext | null,
      farmId: FarmId,
      command: { readonly requestId: string; readonly itemDefinitionId: string; readonly quantity: number; readonly expectedVersion: number }
    ): Promise<unknown>;
  };
  readonly purchase: {
    executeAuto(
      actor: ActorContext | null,
      farmId: FarmId,
      command: { readonly requestId: string; readonly shopEntryId: string; readonly quantity: number; readonly expectedVersion: number; readonly actorId: string; readonly assignmentId: string; readonly eventTime: string; readonly expectedAutoVersion: number; readonly expectedSimulationAt: string | null }
    ): Promise<unknown>;
    execute(
      actor: ActorContext | null,
      farmId: FarmId,
      command: { readonly requestId: string; readonly shopEntryId: string; readonly quantity: number; readonly expectedVersion: number }
    ): Promise<unknown>;
  };
  /** Buy the input with Gold raised by selling the assignment's own funding whitelist. */
  readonly funding: {
    executeAuto(
      actor: ActorContext | null,
      farmId: FarmId,
      command: {
        readonly requestId: string;
        readonly itemDefinitionId: string;
        readonly quantity: number;
        readonly assignmentId: string;
        readonly actorId: string;
        readonly eventTime: string;
        readonly expectedAutoVersion: number;
        readonly expectedSimulationAt: string | null;
      }
    ): Promise<unknown>;
  };
  readonly unload: {
    execute(
      actor: ActorContext | null,
      farmId: FarmId,
      command: { readonly requestId: string; readonly expectedVersion: number }
    ): Promise<unknown>;
    executeAuto(
      actor: ActorContext | null,
      farmId: FarmId,
      command: {
        readonly requestId: string;
        readonly expectedVersion: number;
        readonly actorId: string;
        readonly eventTime: string;
        readonly expectedAutoVersion: number;
        readonly expectedSimulationAt: string | null;
      }
    ): Promise<unknown>;
  };
  readonly plant: {
    executeFromCargo(
      actor: ActorContext | null,
      farmId: FarmId,
      command: {
        readonly x: number;
        readonly y: number;
        readonly cropDefinitionId: string;
        readonly expectedTileVersion?: number;
        readonly requestId: string;
      }
    ): Promise<unknown>;
    executeFromCargoAuto(
      actor: ActorContext | null,
      farmId: FarmId,
      command: {
        readonly x: number;
        readonly y: number;
        readonly cropDefinitionId: string;
        readonly expectedTileVersion?: number;
        readonly requestId: string;
        readonly assignmentId: string;
        readonly actorId: string;
        readonly eventTime: string;
        readonly expectedAutoVersion: number;
        readonly expectedSimulationAt: string | null;
      }
    ): Promise<unknown>;
  };
  readonly harvest: {
    executeIntoCargo(
      actor: ActorContext | null,
      farmId: FarmId,
      command: { readonly cropInstanceId: string; readonly expectedCropVersion: number; readonly requestId: string }
    ): Promise<unknown>;
    executeIntoCargoAuto(
      actor: ActorContext | null,
      farmId: FarmId,
      command: {
        readonly cropInstanceId: string;
        readonly expectedCropVersion: number;
        readonly requestId: string;
        readonly assignmentId: string;
        readonly actorId: string;
        readonly eventTime: string;
        readonly expectedAutoVersion: number;
        readonly expectedSimulationAt: string | null;
      }
    ): Promise<unknown>;
  };
  readonly mine: {
    executeAuto(
      actor: ActorContext | null,
      farmId: FarmId,
      command: { readonly nodeId: string; readonly assignmentId: string; readonly actorId: string; readonly eventTime: string; readonly expectedAutoVersion: number; readonly expectedSimulationAt: string | null }
    ): Promise<{ readonly itemDefinitionId: string; readonly quantity: number }>;
  };
}

/**
 * Everything one Auto step reads or performs.
 *
 * `plan` is the same resolver the panel reads, so the executor and the status line can never disagree
 * about what the actor is doing. `anchorTiles` and `walk` are the island's own Warehouse and Market
 * stand tiles and its own pace, handed in as game data rather than invented here.
 */
export interface AdvanceAutoDependencies extends MainCharacterDependencies {
  readonly plan: ResolveAutoPlan;
  readonly jobs: ActorJobRepository;
  readonly members: FarmMemberRepository;
  readonly workAreas: WorkAreaRepository;
  readonly tiles: FarmTileRepository;
  readonly crops: CropInstanceRepository;
  readonly trees: TreeInstanceRepository;
  readonly constructions: ConstructionRepository;
  readonly cargo: CargoRepository;
  readonly travel: AutoTravelRepository;
  readonly shops: ShopEntryRepository;
  readonly targets: JobTargetCatalogue;
  readonly anchorTiles: AutoAnchorTiles;
  readonly walk: { readonly speedWorldPerSecond: number; readonly pitchWorld: number };
  readonly actions: AutoActions;
}

/**
 * The floor on a client's next step, and the ceiling on a wait that ends by itself.
 *
 * Growth is the one wait the server can predict, so it gets a real wake-up time rather than a poll:
 * the client is told to come back when the soonest crop in the field is ripe, capped at five minutes
 * so a long crop is a handful of quiet requests rather than a loop. Every other wait is returned as
 * zero, which means "there is nothing to wake up for - ask again when the player does something".
 */
const MIN_WAKE_MS = 1_000;
const MAX_WAKE_MS = 300_000;

/** What one assignment's field looks like right now: the cells to plant, the crops to cut, and the count. */
interface FieldState {
  readonly open: readonly TileCoordinate[];
  readonly mature: readonly CropInstance[];
  readonly planted: number;
  readonly growing: number;
}

export class AdvanceAuto {
  constructor(private readonly dependencies: AdvanceAutoDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: AdvanceAutoCommand): Promise<AutoStepView> {
    return this.executeAt(actor, farmId, command, this.dependencies.clock.now());
  }

  /**
   * One bounded transition at an explicitly supplied authoritative instant.
   *
   * The online loop always calls `execute`, which uses the server's clock. A reconciliation pass
   * supplies the instant it has simulated up to, so an offline transition happens "at" the time it
   * would have happened rather than at the moment the player came back. Only server-side callers may
   * use this; no request may carry a simulated time.
   */
  async executeAt(
    actor: ActorContext | null,
    farmId: FarmId,
    command: AdvanceAutoCommand,
    now: string,
    pass?: AutoPassContext
  ): Promise<AutoStepView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    // One read of each row per step: the farm, the actor and the carried stack are read here and
    // handed to the planner, which used to read the same three rows again for itself.
    const farm = await requireOwnedFarm(this.dependencies, farmId, actor);
    const main = await mainCharacterFor(this.dependencies, farmId, farm);
    const carried = await this.dependencies.cargo.listByActor(main.id);
    const cargo = { used: carried.reduce((total, item) => total + item.quantity, 0), capacity: main.cargoCapacity };

    const state = await this.dependencies.travel.find(main.id);

    if (main.controlMode !== "AUTO_CONTROLLED") {
      // STOP abandons a walk in progress rather than fast-forwarding it: the actor stays where the last
      // walk finished, and the next START has to walk again from there.
      const settled = state.travelTo === null ? state : await this.abandon(main.id, state, now);
      return this.view(main, "STOPPED", { step: null, waitReason: "NOT_AUTO_CONTROLLED", state: settled, cargo });
    }

    const normalizedLease = normalizeMainCharacterAutoLease({ simulationAt: state.simulationAt, leaseUntil: state.leaseUntil, leaseIssuedAt: state.leaseIssuedAt, now });
    if (Date.parse(normalizedLease.leaseUntil) <= Date.parse(now)) {
      const released: Actor = {
        ...main,
        controlMode: "PLAYER_CONTROLLED",
        version: main.version + 1,
        updatedAt: now
      };
      const applied = await this.dependencies.actors.setControlModeAtomically(released, main.version);
      const stopAt = normalizedLease.leaseUntil;
      const cleared: AutoTravelState = {
        ...state,
        travelTo: null,
        arrivesAt: null,
        simulationAt: stopAt,
        leaseUntil: null,
        leaseIssuedAt: null,
        version: state.version + 1
      };
      const saved = await this.dependencies.travel.saveAtomically(main.id, state.version, cleared, now);
      return this.view(applied ? released : main, "STOPPED", { step: null, waitReason: "NOT_AUTO_CONTROLLED", state: saved ? cleared : state, cargo });
    }
    const shouldRenewLease = shouldRenewMainCharacterAutoLease({
      simulationAt: state.simulationAt,
      leaseUntil: state.leaseUntil,
      leaseIssuedAt: state.leaseIssuedAt,
      now,
      suppressRenewal: pass?.suppressLeaseRenewal
    });
    const renewedLease = shouldRenewLease
      ? new Date(Date.parse(now) + MAIN_CHARACTER_AUTO_LEASE_SECONDS * 1000).toISOString()
      : normalizedLease.leaseUntil;
    if (shouldRenewLease && this.dependencies.travel.renewLeaseAtomically !== undefined) {
      const renewed = await this.dependencies.travel.renewLeaseAtomically(main.id, now, renewedLease);
      if (!renewed) return this.view(main, "STOPPED", { step: null, waitReason: "NOT_AUTO_CONTROLLED", state, cargo });
    }
    const leasedState: AutoTravelState = {
      ...state,
      leaseUntil: renewedLease,
      leaseIssuedAt: shouldRenewLease ? now : normalizedLease.leaseIssuedAt
    };

    // A walk in progress: either it is still under way, or the server's clock has passed its arrival.
    if (leasedState.travelTo !== null && leasedState.arrivesAt !== null && !travelHasArrived(leasedState.arrivesAt, now)) {
      return this.travelView(main, leasedState, cargo, now);
    }
    const current = leasedState.travelTo === null ? leasedState : await this.arrive(main.id, leasedState, now);

    // The plan is read *after* the arrival is recorded, so the action it names is one the actor is now
    // standing in the right place for - and never one a stale client promise asked for.
    const { plan, snapshot } = await this.dependencies.plan.executeWithSnapshot(actor, farmId, { farm, main, cargo: carried }, pass?.reuse, now);
    if (pass !== undefined && pass.reuse === undefined) {
      // The pass may share the rows that cannot change while it runs; everything else it re-reads.
      pass.reuse = { cellsByArea: snapshot.cellsByArea, bounds: snapshot.bounds };
    }
    const job = plan.jobId === null ? null : await this.dependencies.jobs.findById(parseJobId(plan.jobId));

    if (plan.action === null) {
      return this.view(main, "WAITING", {
        step: null,
        waitReason: plan.waitReason ?? "NO_ASSIGNMENT",
        state: current,
        cargo,
        retryAfterMs: this.leaseAwareWake(await this.growthWaitMs(job, plan.waitReason, now), current, now)
      });
    }
    try {
      // The delivery is the *actor's* next step, not an assignment's: a full pair of hands is a
      // physical fact about the character, and it is resolved before any field work is planned again.
      if (plan.action.kind === "TRAVEL_TO_STORAGE") {
        return await this.deliver(actor, farmId, main, current, command.requestId, now);
      }
      const winning = this.winningAssignment(plan);
      if (winning === null || job === null || job.farmId !== farmId) {
        return this.view(main, "WAITING", { step: null, waitReason: "NO_ASSIGNMENT", state: current, cargo });
      }
      // D2 executes the replanting crop family and nothing else. Orchard, mining, forestry and the rest
      // still resolve - the panel shows their plan - but they are explicitly not executed.
      if (!isExecutableFamily(winning.skillFamily)) {
        return this.view(main, "WAITING", { step: null, waitReason: "NOT_EXECUTABLE_YET", state: current, cargo });
      }
      return await this.perform(actor, farmId, main, current, job, winning, plan, snapshot, command.requestId, now);
    } catch (error: unknown) {
      // A stale read - another tab moved the same cargo, crop or tile - is not an error the player
      // should see mid-walk. Re-resolving is exactly what the next step does.
      if (error instanceof ApplicationError && error.code === "CONFLICT_STALE_STATE") {
        return this.view(main, "RETRY", { step: null, waitReason: null, state: current, cargo });
      }
      throw error;
    }
  }

  /** Walk home with a full load, and put it down. */
  private async deliver(
    actor: ActorContext,
    farmId: FarmId,
    main: Actor,
    current: AutoTravelState,
    stepRequestId: string,
    now: string
  ): Promise<AutoStepView> {
    const travel = await this.travelTo(main, current, WAREHOUSE_ANCHOR, now);
    if (travel !== null) return this.travelView(main, travel.state, travel.cargo, travel.startedAt);
    await this.settle(() =>
      this.dependencies.actions.unload.executeAuto(actor, farmId, {
        requestId: this.settlementId("unload", stepRequestId),
        expectedVersion: main.cargoVersion,
        actorId: main.id,
        eventTime: now,
        expectedAutoVersion: current.version,
        expectedSimulationAt: current.simulationAt ?? null
      })
    );
    return this.worked(main, current, "UNLOAD", null, null, {});
  }

  /** One planned action, turned into either a walk or a settlement. */
  private async perform(
    actor: ActorContext,
    farmId: FarmId,
    main: Actor,
    current: AutoTravelState,
    job: ActorJob,
    winning: AutoAssignmentPlanView,
    plan: AutoPlanView,
    snapshot: AutoPlanObservation,
    stepRequestId: string,
    now: string
  ): Promise<AutoStepView> {
    const action = plan.action;
    if (action === null) {
      return this.view(main, "WAITING", {
        step: null,
        waitReason: plan.waitReason,
        state: current,
        cargo: await this.cargoView(main)
      });
    }
    switch (action.kind) {
      case "LOAD_INPUT": {
        const travel = await this.travelTo(main, current, WAREHOUSE_ANCHOR, now);
        if (travel !== null) return this.travelView(main, travel.state, travel.cargo, travel.startedAt);
        await this.settle(() =>
          this.dependencies.actions.load.executeAuto(actor, farmId, {
            requestId: this.settlementId("load", stepRequestId),
            itemDefinitionId: action.itemDefinitionId,
            quantity: action.quantity,
            expectedVersion: main.cargoVersion,
            actorId: main.id,
            assignmentId: job.id,
            eventTime: now,
            expectedAutoVersion: current.version,
            expectedSimulationAt: current.simulationAt ?? null
          })
        );
        return this.worked(main, current, "LOAD_INPUT", job, winning, {
          itemDefinitionId: action.itemDefinitionId,
          quantity: action.quantity
        });
      }
      case "PURCHASE_INPUT": {
        const travel = await this.travelTo(main, current, MARKET_ANCHOR, now);
        if (travel !== null) return this.travelView(main, travel.state, travel.cargo, travel.startedAt);
        const entry = this.dependencies.shops
          .list()
          .find((candidate) => candidate.itemDefinitionId === action.itemDefinitionId && candidate.buyPrice !== null);
        if (entry === undefined) {
          return this.view(main, "WAITING", { step: null, waitReason: "WAITING_FOR_SUPPLY", state: current, cargo: await this.cargoView(main) });
        }
        await this.settle(() =>
          this.dependencies.actions.purchase.executeAuto(actor, farmId, {
            requestId: this.settlementId("buy", stepRequestId),
            shopEntryId: entry.id,
            quantity: action.quantity,
            expectedVersion: main.cargoVersion,
            actorId: main.id,
            assignmentId: job.id,
            eventTime: now,
            expectedAutoVersion: current.version,
            expectedSimulationAt: current.simulationAt ?? null
          })
        );
        return this.worked(main, current, "PURCHASE_INPUT", job, winning, {
          itemDefinitionId: action.itemDefinitionId,
          quantity: action.quantity
        });
      }
      case "FUND_AND_PURCHASE_INPUT": {
        const travel = await this.travelTo(main, current, MARKET_ANCHOR, now);
        if (travel !== null) return this.travelView(main, travel.state, travel.cargo, travel.startedAt);
        await this.settle(() =>
          this.dependencies.actions.funding.executeAuto(actor, farmId, {
            requestId: this.settlementId("fund", stepRequestId),
            itemDefinitionId: action.itemDefinitionId,
            quantity: action.quantity,
            assignmentId: job.id,
            actorId: main.id,
            eventTime: now,
            expectedAutoVersion: current.version,
            expectedSimulationAt: current.simulationAt ?? null
          })
        );
        return this.worked(main, current, "FUND_AND_PURCHASE_INPUT", job, winning, {
          itemDefinitionId: action.itemDefinitionId,
          quantity: action.quantity
        });
      }
      case "PLANT": {
        const field = await this.fieldState(job, snapshot, now);
        const cell = field.open[0];
        if (cell === undefined) {
          return this.view(main, "WAITING", { step: null, waitReason: "NO_ELIGIBLE_TARGETS", state: current, cargo: await this.cargoView(main) });
        }
        const travel = await this.travelTo(main, current, cellAnchor(cell.x, cell.y), now);
        if (travel !== null) return this.travelView(main, travel.state, travel.cargo, travel.startedAt);
        const tile = await this.dependencies.tiles.find(farmId, cell.x, cell.y);
        await this.settle(() =>
          this.dependencies.actions.plant.executeFromCargoAuto(actor, farmId, {
            x: cell.x,
            y: cell.y,
            cropDefinitionId: job.targetDefinitionId,
            ...(tile === null ? {} : { expectedTileVersion: tile.version }),
            requestId: this.settlementId("plant", stepRequestId),
            assignmentId: job.id,
            actorId: main.id,
            eventTime: now,
            expectedAutoVersion: current.version,
            expectedSimulationAt: current.simulationAt ?? null
          })
        );
        return this.worked(main, current, "PLANT", job, winning, {
          cell,
          progress: this.progressOf(field, "PLANT")
        });
      }
      case "HARVEST": {
        const field = await this.fieldState(job, snapshot, now);
        const crop = field.mature[0];
        if (crop === undefined) {
          return this.view(main, "WAITING", { step: null, waitReason: "NO_ELIGIBLE_TARGETS", state: current, cargo: await this.cargoView(main) });
        }
        const travel = await this.travelTo(main, current, cellAnchor(crop.tileX, crop.tileY), now);
        if (travel !== null) return this.travelView(main, travel.state, travel.cargo, travel.startedAt);
        await this.settle(() =>
          this.dependencies.actions.harvest.executeIntoCargoAuto(actor, farmId, {
            cropInstanceId: crop.id,
            expectedCropVersion: crop.version,
            requestId: this.settlementId("harvest", stepRequestId),
            assignmentId: job.id,
            actorId: main.id,
            eventTime: now,
            expectedAutoVersion: current.version,
            expectedSimulationAt: current.simulationAt ?? null
          })
        );
        return this.worked(main, current, "HARVEST", job, winning, {
          cell: { x: crop.tileX, y: crop.tileY },
          progress: this.progressOf(field, "HARVEST")
        });
      }
      case "MINE": {
        const target = await this.resourceTarget(job);
        if (target === null) {
          return this.view(main, "WAITING", { step: null, waitReason: "NO_ELIGIBLE_TARGETS", state: current, cargo: await this.cargoView(main) });
        }
        const travel = await this.travelTo(main, current, cellAnchor(target.x, target.y), now);
        if (travel !== null) return this.travelView(main, travel.state, travel.cargo, travel.startedAt);
        const result = await this.dependencies.actions.mine.executeAuto(actor, farmId, {
          nodeId: target.nodeId,
          assignmentId: job.id,
          actorId: main.id,
          eventTime: now,
          expectedAutoVersion: current.version,
          expectedSimulationAt: current.simulationAt ?? null
        });
        return this.worked(main, current, "MINE", job, winning, {
          itemDefinitionId: result.itemDefinitionId,
          quantity: result.quantity,
          cell: { x: target.x, y: target.y }
        });
      }
      default:
        // CHOP and TRAVEL_TO_AREA still plan but are not executed by this slice.
        return this.view(main, "WAITING", { step: null, waitReason: "NOT_EXECUTABLE_YET", state: current, cargo: await this.cargoView(main) });
    }
  }

  private winningAssignment(plan: AutoPlanView): AutoAssignmentPlanView | null {
    if (plan.jobId === null) return null;
    return plan.perAssignment.find((entry) => entry.jobId === plan.jobId) ?? null;
  }

  private settled(state: AutoTravelState): AutoAnchor | null {
    // An actor that has never run Auto has no recorded position. It is read as the Home Warehouse -
    // the one place every actor can certainly reach - rather than as "somewhere unknown", which would
    // make the first walk start from nowhere.
    return state.travelTo ?? state.anchor ?? WAREHOUSE_ANCHOR;
  }

  /**
   * One assignment's field: what could be planted, what is ripe, and how full it is.
   *
   * The eligibility rule is `auto-targets`, the same one the resolver counts with, so the cell the
   * actor walks to is always a cell the plan said existed. Maturity comes from `CropStateProjector`,
   * the authoritative server-time projection - never from a client's idea of the clock.
   */
  private async fieldState(job: ActorJob, snapshot: AutoPlanObservation | undefined, serverTime: string): Promise<FieldState> {
    // The plan read these same four lists in this same request, and nothing between the plan and this
    // transition writes any of them, so a snapshot is reused rather than re-read. A caller with no
    // snapshot (a direct test, a future entry point) still gets the read it needs.
    const cells: readonly TileCoordinate[] =
      snapshot?.cellsByArea.get(job.workAreaId) ??
      (await this.dependencies.workAreas.listCells(job.workAreaId)).map((cell) => ({ x: cell.x, y: cell.y }));
    const crops = snapshot?.crops ?? (await this.dependencies.crops.listByFarm(job.farmId));
    const trees = snapshot?.trees ?? (await this.dependencies.trees.listByFarm(job.farmId));
    const bounds = snapshot?.bounds ?? (await this.dependencies.constructions.listBounds(job.farmId));
    const mine = matchingCrops(cells, crops, job.targetDefinitionId);
    const states = new CropStateProjector(this.dependencies.targets.crops, this.dependencies.clock).projectMany(mine, serverTime);
    const matureIds = new Set(states.filter((state) => state.mature).map((state) => state.cropInstanceId));
    return {
      open: emptyCells(cells, crops, trees, bounds),
      mature: mine.filter((crop) => matureIds.has(crop.id)),
      planted: mine.length,
      growing: mine.length - matureIds.size
    };
  }

  private async resourceTarget(job: ActorJob): Promise<{ readonly nodeId: string; readonly x: number; readonly y: number } | null> {
    if (job.kind !== "MINING") return null;
    const cells = new Set((await this.dependencies.workAreas.listCells(job.workAreaId)).map(workAreaCellKey));
    const node = this.dependencies.targets.resources.listNodes().find((candidate) => {
      if (candidate.definitionId !== job.targetDefinitionId) return false;
      return cells.has(workAreaCellKey({ x: Math.round(candidate.position.x), y: Math.round(candidate.position.y) }));
    });
    return node === undefined ? null : { nodeId: node.id, x: Math.round(node.position.x), y: Math.round(node.position.y) };
  }

  /** The panel's progress line, adjusted for the action that just landed. */
  private progressOf(field: FieldState, action: "PLANT" | "HARVEST"): { readonly planted: number; readonly empty: number; readonly mature: number } {
    const planted = field.planted + (action === "PLANT" ? 1 : -1);
    const empty = field.open.length + (action === "PLANT" ? -1 : 1);
    const mature = field.mature.length + (action === "HARVEST" ? -1 : 0);
    return {
      planted: Math.max(0, planted),
      empty: Math.max(0, empty),
      mature: Math.max(0, mature)
    };
  }

  /**
   * How long until the field has something to do again, or 0 when no wake-up would help.
   *
   * Only growth ends by itself. Supply, funds, storage and a full pair of hands all change because the
   * *player* does something, and the panel re-asks on exactly those events - so those waits schedule
   * nothing at all rather than a poll that can only repeat the same answer.
   */
  private async growthWaitMs(job: ActorJob | null, reason: WaitReason | null, nowIso: string): Promise<number> {
    if (job === null || reason !== "WAITING_FOR_GROWTH" || job.kind !== "FARM") return 0;
    const definition = this.farmCropDefinition(job.targetDefinitionId);
    if (definition === null) return 0;
    const cellRows = await this.dependencies.workAreas.listCells(job.workAreaId);
    const cells: TileCoordinate[] = cellRows.map((cell) => ({ x: cell.x, y: cell.y }));
    const crops = matchingCrops(cells, await this.dependencies.crops.listByFarm(job.farmId), job.targetDefinitionId);
    if (crops.length === 0) return 0;
    const durationMs = definition.growthDurationSeconds * 1000;
    const now = Date.parse(nowIso);
    let soonest = Number.POSITIVE_INFINITY;
    for (const crop of crops) {
      const planted = Date.parse(crop.plantedAt);
      if (!Number.isFinite(planted)) continue;
      soonest = Math.min(soonest, planted + durationMs - now);
    }
    if (!Number.isFinite(soonest)) return 0;
    return Math.min(MAX_WAKE_MS, Math.max(MIN_WAKE_MS, soonest));
  }

  /** Keep an online Auto session alive by piggybacking the next lease renewal on its existing wake. */
  private leaseAwareWake(delayMs: number, state: AutoTravelState, nowIso: string): number {
    if (delayMs <= 0) return delayMs;
    const leaseMs = state.leaseUntil === null || state.leaseUntil === undefined ? Number.NaN : Date.parse(state.leaseUntil);
    const nowMs = Date.parse(nowIso);
    const renewalThresholdMs = (MAIN_CHARACTER_AUTO_LEASE_SECONDS - MAIN_CHARACTER_AUTO_LEASE_RENEW_INTERVAL_SECONDS) * 1000;
    const untilRenewalMs = leaseMs - nowMs - renewalThresholdMs;
    if (Number.isFinite(untilRenewalMs) && untilRenewalMs > 0) return Math.min(delayMs, untilRenewalMs);
    return Math.min(delayMs, MAIN_CHARACTER_AUTO_LEASE_RENEW_INTERVAL_SECONDS * 1000);
  }

  private farmCropDefinition(targetDefinitionId: string): { readonly growthDurationSeconds: number } | null {
    try {
      return this.dependencies.targets.crops.findById(parseCropDefinitionId(targetDefinitionId));
    } catch {
      return null;
    }
  }

  /**
   * Start the walk to an anchor, or report that the actor is already standing there.
   *
   * A walk is one guarded write: the anchor it leaves, the anchor it heads to, and the time the server
   * will consider it arrived. Losing the version guard means another step moved the actor first, which
   * is not an error - the next step simply re-reads where they are.
   */
  private async travelTo(
    main: Actor,
    state: AutoTravelState,
    target: AutoAnchor,
    nowIso: string
  ): Promise<{ readonly state: AutoTravelState; readonly startedAt: string; readonly cargo: { readonly used: number; readonly capacity: number } } | null> {
    if (anchorsMatch(this.settled(state), target)) return null;
    const startedAt = nowIso;
    const seconds = travelSeconds(
      this.settled(state),
      target,
      this.dependencies.anchorTiles,
      this.dependencies.walk.pitchWorld,
      this.dependencies.walk.speedWorldPerSecond
    );
    const next: AutoTravelState = {
      anchor: state.travelTo ?? state.anchor,
      travelTo: target,
      arrivesAt: new Date(Date.parse(startedAt) + Math.round(seconds * 1000)).toISOString(),
      // The reconciliation watermark is not this walk's business: a step that only moves the actor
      // must never erase how far Auto's timeline has already been settled.
      simulationAt: state.simulationAt ?? null,
      leaseUntil: state.leaseUntil ?? null,
      leaseIssuedAt: state.leaseIssuedAt ?? null,
      version: state.version + 1
    };
    const saved = await this.dependencies.travel.saveAtomically(main.id, state.version, next, startedAt);
    if (!saved) throw new ApplicationError("CONFLICT_STALE_STATE", "The actor moved while walking");
    return { state: next, startedAt, cargo: await this.cargoView(main) };
  }

  /** Record that a walk finished: the actor is now standing where they were heading. */
  private async arrive(actorId: Actor["id"], state: AutoTravelState, now: string): Promise<AutoTravelState> {
    const next: AutoTravelState = { anchor: state.travelTo, travelTo: null, arrivesAt: null, simulationAt: state.simulationAt ?? null, leaseUntil: state.leaseUntil ?? null, leaseIssuedAt: state.leaseIssuedAt ?? null, version: state.version + 1 };
    const saved = await this.dependencies.travel.saveAtomically(actorId, state.version, next, now);
    if (!saved) throw new ApplicationError("CONFLICT_STALE_STATE", "The actor moved while walking");
    return next;
  }

  /** Give up a walk without moving the actor: what STOP does to a pending journey. */
  private async abandon(actorId: Actor["id"], state: AutoTravelState, now: string): Promise<AutoTravelState> {
    const next: AutoTravelState = { anchor: state.anchor, travelTo: null, arrivesAt: null, simulationAt: state.simulationAt ?? null, leaseUntil: state.leaseUntil ?? null, leaseIssuedAt: state.leaseIssuedAt ?? null, version: state.version + 1 };
    const saved = await this.dependencies.travel.saveAtomically(actorId, state.version, next, now);
    // A lost race here is harmless: whoever won wrote a newer position, and the next step reads it.
    return saved ? next : state;
  }

  private async cargoView(main: Actor): Promise<{ readonly used: number; readonly capacity: number }> {
    const items = await this.dependencies.cargo.listByActor(main.id);
    return { used: items.reduce((total, item) => total + item.quantity, 0), capacity: main.cargoCapacity };
  }

  /** Runs one settlement, mapping a world that moved under the plan to the prompt retry it deserves. */
  private async settle(run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error: unknown) {
      if (error instanceof ApplicationError) {
        // The next step re-resolves and finds real work: none of these are the player's problem.
        if (
          error.code === "CONFLICT_STALE_STATE" ||
          error.code === "INSUFFICIENT_ITEMS" ||
          error.code === "CARGO_FULL" ||
          error.code === "TILE_OCCUPIED" ||
          error.code === "CROP_ALREADY_HARVESTED" ||
          error.code === "CROP_NOT_MATURE" ||
          error.code === "IDEMPOTENCY_CONFLICT"
        ) {
          throw new ApplicationError("CONFLICT_STALE_STATE", error.message);
        }
      }
      throw error;
    }
  }

  /**
   * A settlement request id that makes a repeated step a *replay*, not a second payout.
   *
   * The step's own request id names its settlements, so a network retry of one step replays the receipt
   * it already wrote instead of paying out twice - while a *new* step gets a new id and may plant the
   * same cell again (replanting a harvested cell is the whole point of the skill). The crop names its
   * own harvest, because a crop can only ever be harvested once.
   */
  private settlementId(kind: string, stepRequestId: string): string {
    return `auto-${kind}-${stepRequestId}`;
  }

  private view(
    main: Actor,
    phase: AutoStepPhase,
    parts: {
      readonly step: AutoStepToken | null;
      readonly waitReason: WaitReason | null;
      readonly state: AutoTravelState;
      readonly cargo: { readonly used: number; readonly capacity: number };
      readonly job?: ActorJob;
      readonly assignment?: AutoAssignmentPlanView;
      readonly itemDefinitionId?: string;
      readonly quantity?: number;
      readonly cell?: TileCoordinate | null;
      readonly arrivesAt?: string | null;
      readonly retryAfterMs?: number;
      readonly progress?: { readonly planted: number; readonly empty: number; readonly mature: number } | null;
    }
  ): AutoStepView {
    return {
      controlMode: main.controlMode,
      phase,
      step: parts.step,
      waitReason: parts.waitReason,
      jobId: parts.job?.id ?? null,
      skillId: parts.assignment?.skillId ?? null,
      targetDefinitionId: parts.job?.targetDefinitionId ?? null,
      targetDisplayNameKey: this.displayNameKey(parts.job),
      itemDefinitionId: parts.itemDefinitionId ?? null,
      quantity: parts.quantity ?? null,
      cell: parts.cell ?? null,
      // `from` is where the actor *is*, which is the anchor even while a walk is under way: `to` is
      // the walk's destination, and confusing the two would tell the client a walk had already landed.
      from: parts.state.anchor ?? WAREHOUSE_ANCHOR,
      to: parts.state.travelTo,
      arrivesAt: parts.arrivesAt ?? null,
      retryAfterMs: parts.retryAfterMs ?? 0,
      progress: parts.progress ?? null,
      cargo: parts.cargo
    };
  }

  private displayNameKey(job: ActorJob | undefined): string | null {
    if (job === undefined) return null;
    try {
      return targetNameKey(job.kind, job.targetDefinitionId, this.dependencies.targets);
    } catch {
      return null;
    }
  }

  private async worked(
    main: Actor,
    state: AutoTravelState,
    step: AutoStepToken,
    job: ActorJob | null,
    assignment: AutoAssignmentPlanView | null,
    extra: {
      readonly itemDefinitionId?: string;
      readonly quantity?: number;
      readonly cell?: TileCoordinate;
      readonly progress?: { readonly planted: number; readonly empty: number; readonly mature: number } | null;
    }
  ): Promise<AutoStepView> {
    // Read after the settlement, so the panel's cargo meter reflects what just moved.
    return this.view(main, "WORKED", {
      step,
      waitReason: null,
      state,
      cargo: await this.cargoView(main),
      ...(job === null ? {} : { job }),
      ...(assignment === null ? {} : { assignment }),
      ...(extra.itemDefinitionId === undefined ? {} : { itemDefinitionId: extra.itemDefinitionId }),
      ...(extra.quantity === undefined ? {} : { quantity: extra.quantity }),
      ...(extra.cell === undefined ? {} : { cell: extra.cell }),
      progress: extra.progress ?? null
    });
  }

  private travelView(
    main: Actor,
    state: AutoTravelState,
    cargo: { readonly used: number; readonly capacity: number },
    now: string
  ): AutoStepView {
    const remaining = state.arrivesAt === null ? MAX_WAKE_MS : Date.parse(state.arrivesAt) - Date.parse(now);
    return this.view(main, "TRAVELLING", {
      step: null,
      waitReason: null,
      state,
      cargo,
      cell: state.travelTo?.kind === "CELL" ? { x: state.travelTo.x ?? 0, y: state.travelTo.y ?? 0 } : null,
      arrivesAt: state.arrivesAt,
      retryAfterMs: this.leaseAwareWake(Math.min(MAX_WAKE_MS, Math.max(MIN_WAKE_MS, remaining)), state, now)
    });
  }
}
