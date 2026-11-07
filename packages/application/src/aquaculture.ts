import { parseConstructionId, parseItemDefinitionId, type ConstructionId, type ConstructionInstance, type FarmId, type ItemDefinitionId } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
import type { ActorContext, AquaculturePondCohort, AquaculturePondRepository, AquaculturePondState, Clock, ConstructionRepository, FarmMemberRepository, FarmRepository, IdempotencyRecord, IdempotencyRepository, InventoryRepository, PayloadFingerprint, TileTerrainLookup, WorkAreaRepository } from "./ports";

export const AQUACULTURE_POND_ENTRY_ID = "place_fish_cage";
export const AQUACULTURE_STOCK_OPERATION = "STOCK_AQUACULTURE_POND";
export const AQUACULTURE_HARVEST_OPERATION = "HARVEST_AQUACULTURE_POND";
export const AQUACULTURE_WITHDRAW_OPERATION = "WITHDRAW_AQUACULTURE_POND";

export interface AquacultureDefinition { readonly stockingItemDefinitionId: string; readonly harvestItemDefinitionId: string; readonly growthDurationSeconds: number; readonly capacity: number; }
export type AquaculturePondStatus = "EMPTY" | "STOCKED" | "GROWING" | "READY";
export interface AquaculturePondView {
  readonly pondId: string; readonly farmId: string; readonly itemDefinitionId: string | null; readonly status: AquaculturePondStatus;
  readonly stockedAt: string | null; readonly readyAt: string | null; readonly capacity: number; readonly stockedCount: number;
  readonly growingCount: number; readonly readyCount: number; readonly availableCapacity: number;
  readonly cohorts: readonly AquaculturePondCohort[]; readonly version: number;
}
interface Dependencies {
  readonly farms: FarmRepository; readonly members: FarmMemberRepository; readonly constructions: ConstructionRepository;
  readonly workAreas: WorkAreaRepository; readonly ponds: AquaculturePondRepository; readonly inventory: InventoryRepository;
  readonly terrain: TileTerrainLookup;
  readonly idempotency: IdempotencyRepository; readonly fingerprints: PayloadFingerprint; readonly inventoryService: InventoryService;
  readonly clock: Clock; readonly definition: AquacultureDefinition;
}

function parsePondId(value: string): ConstructionId { try { return parseConstructionId(value); } catch { throw new ApplicationError("AQUACULTURE_POND_NOT_FOUND", "Aquaculture pond was not found"); } }
function parseDefinitionId(value: string): ItemDefinitionId { try { return parseItemDefinitionId(value); } catch { throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Aquaculture item definition was not found"); } }
function emptyState(construction: ConstructionInstance): AquaculturePondState { return { constructionId: construction.id, farmId: construction.farmId, itemDefinitionId: null, stockedAt: null, readyAt: null, version: 0, cohorts: [] }; }

function viewOf(state: AquaculturePondState | null, construction: ConstructionInstance, now: string, capacity: number): AquaculturePondView {
  const cohorts = state?.cohorts ?? [];
  const stockedCount = cohorts.reduce((sum, cohort) => sum + cohort.quantity, 0);
  const nowMs = Date.parse(now);
  const readyCount = cohorts.reduce((sum, cohort) => sum + (Date.parse(cohort.readyAt) <= nowMs ? cohort.quantity : 0), 0);
  const growingCount = stockedCount - readyCount;
  const first = cohorts.slice().sort((a, b) => Date.parse(a.stockedAt) - Date.parse(b.stockedAt))[0];
  const status: AquaculturePondStatus = stockedCount === 0 ? "EMPTY" : readyCount === stockedCount ? "READY" : first !== undefined && nowMs <= Date.parse(first.stockedAt) ? "STOCKED" : "GROWING";
  return { pondId: construction.id, farmId: construction.farmId, itemDefinitionId: stockedCount === 0 ? null : (cohorts[0]?.itemDefinitionId ?? state?.itemDefinitionId ?? null), status, stockedAt: first?.stockedAt ?? null, readyAt: first?.readyAt ?? null, capacity, stockedCount, growingCount, readyCount, availableCapacity: Math.max(0, capacity - stockedCount), cohorts, version: state?.version ?? 0 };
}

async function requireFarmEditor(dependencies: Dependencies, actor: ActorContext | null, farmId: FarmId): Promise<ActorContext> {
  if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
  if ((await dependencies.farms.findById(farmId)) === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
  const member = await dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
  if (member?.role !== "OWNER" && member?.role !== "EDITOR") throw new ApplicationError("NOT_AUTHORIZED", "Aquaculture is not allowed on this farm");
  return actor;
}
async function requireActiveWaterCage(dependencies: Dependencies, farmId: FarmId, constructionId: ConstructionId): Promise<ConstructionInstance> {
  const construction = await dependencies.constructions.findById(constructionId);
  if (construction === null || construction.farmId !== farmId || construction.state !== "ACTIVE" || construction.entryId !== AQUACULTURE_POND_ENTRY_ID) throw new ApplicationError("AQUACULTURE_POND_NOT_FOUND", "Aquaculture pond was not found on this farm");
  const ground = dependencies.terrain.classify({ x: Math.trunc(construction.anchorX), y: Math.trunc(construction.anchorY) });
  if (ground.terrain !== "WATER" || !ground.shallowWater || ground.protectedGround) throw new ApplicationError("AQUACULTURE_POND_NOT_FOUND", "Aquaculture pond is not on a valid shallow-water tile");
  return construction;
}

async function requireEligiblePond(dependencies: Dependencies, farmId: FarmId, constructionId: ConstructionId): Promise<ConstructionInstance> {
  const construction = await requireActiveWaterCage(dependencies, farmId, constructionId);
  for (const entry of await dependencies.workAreas.listByFarm(farmId)) {
    if (entry.area.kind !== "AQUACULTURE") continue;
    const cells = await dependencies.workAreas.listCells(entry.area.id);
    if (cells.some((cell) => cell.x === Math.trunc(construction.anchorX) && cell.y === Math.trunc(construction.anchorY))) return construction;
  }
  throw new ApplicationError("AQUACULTURE_AREA_REQUIRED", "The pond must stand in an aquaculture work area");
}
function idempotencyResponse(view: AquaculturePondView): string { return JSON.stringify(view); }
function replay(record: IdempotencyRecord, fingerprint: string): AquaculturePondView { if (record.payloadFingerprint !== fingerprint) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request id was already used for another payload"); return JSON.parse(record.responseJson) as AquaculturePondView; }
function allocate(cohorts: readonly AquaculturePondCohort[], quantity: number, ready: boolean, now: string): readonly { readonly cohortId: string; readonly quantity: number }[] {
  let remaining = quantity; const nowMs = Date.parse(now); const result: { cohortId: string; quantity: number }[] = [];
  for (const cohort of cohorts.slice().sort((a, b) => Date.parse(a.readyAt) - Date.parse(b.readyAt) || a.cohortId.localeCompare(b.cohortId))) {
    if ((ready ? Date.parse(cohort.readyAt) <= nowMs : Date.parse(cohort.readyAt) > nowMs) && remaining > 0) { const take = Math.min(remaining, cohort.quantity); result.push({ cohortId: cohort.cohortId, quantity: take }); remaining -= take; }
  }
  return result;
}
function afterAllocation(state: AquaculturePondState, allocations: readonly { readonly cohortId: string; readonly quantity: number }[]): AquaculturePondState {
  const amounts = new Map(allocations.map((allocation) => [allocation.cohortId, allocation.quantity]));
  const cohorts = state.cohorts.map((cohort) => ({ ...cohort, quantity: cohort.quantity - (amounts.get(cohort.cohortId) ?? 0) })).filter((cohort) => cohort.quantity > 0);
  const first = cohorts[0] ?? null;
  return { ...state, cohorts, itemDefinitionId: first?.itemDefinitionId ?? null, stockedAt: first?.stockedAt ?? null, readyAt: first?.readyAt ?? null, version: state.version + 1 };
}

export interface AquacultureCommand { readonly requestId: string; readonly expectedPondVersion: number; readonly quantity: number; }
export class ListAquaculturePonds {
  constructor(private readonly dependencies: Dependencies) {}
  async execute(actor: ActorContext | null, farmId: FarmId): Promise<readonly AquaculturePondView[]> {
    await requireFarmEditor(this.dependencies, actor, farmId); const constructions = await this.dependencies.constructions.listByFarm(farmId); const states = new Map((await this.dependencies.ponds.listByFarm(farmId)).map((state) => [state.constructionId, state])); const now = this.dependencies.clock.now(); const result: AquaculturePondView[] = [];
    // Reads remain useful for a legacy cage even when its old placement predates an AQUACULTURE
    // work area.  The action use cases still call requireEligiblePond, so this cannot bypass the
    // existing area authorization for Stock, Withdraw, or Harvest.
    for (const construction of constructions) { if (construction.entryId !== AQUACULTURE_POND_ENTRY_ID || construction.state !== "ACTIVE") continue; result.push(viewOf(states.get(construction.id) ?? null, construction, now, this.dependencies.definition.capacity)); }
    return result;
  }
}
export class StockAquaculturePond {
  constructor(private readonly dependencies: Dependencies) {}
  async execute(actor: ActorContext | null, farmId: FarmId, pondId: string, command: AquacultureCommand): Promise<AquaculturePondView> {
    return this.executeOnPath(actor, farmId, pondId, command, "MANUAL");
  }
  async executeForWorker(actor: ActorContext | null, farmId: FarmId, pondId: string, command: AquacultureCommand): Promise<AquaculturePondView> {
    return this.executeOnPath(actor, farmId, pondId, command, "WORKER");
  }
  private async executeOnPath(actor: ActorContext | null, farmId: FarmId, pondId: string, command: AquacultureCommand, path: "MANUAL" | "WORKER"): Promise<AquaculturePondView> {
    const authorizedActor = await requireFarmEditor(this.dependencies, actor, farmId); const construction = path === "WORKER" ? await requireEligiblePond(this.dependencies, farmId, parsePondId(pondId)) : await requireActiveWaterCage(this.dependencies, farmId, parsePondId(pondId)); const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([AQUACULTURE_STOCK_OPERATION, farmId, pondId, command.expectedPondVersion, command.quantity])); const existing = await this.dependencies.idempotency.find(authorizedActor.playerId, AQUACULTURE_STOCK_OPERATION, command.requestId); if (existing !== null) return replay(existing, fingerprint);
    const state = await this.dependencies.ponds.findByConstruction(farmId, construction.id); const current = state ?? emptyState(construction); if (command.expectedPondVersion !== current.version) throw new ApplicationError("CONFLICT_STALE_STATE", "The pond changed since you looked at it"); const currentCount = current.cohorts.reduce((sum, cohort) => sum + cohort.quantity, 0); if (currentCount + command.quantity > this.dependencies.definition.capacity) throw new ApplicationError("AQUACULTURE_CAPACITY_EXCEEDED", "The pond does not have enough capacity");
    const item = parseDefinitionId(this.dependencies.definition.stockingItemDefinitionId); const inventory = await this.dependencies.inventory.find(authorizedActor.playerId, item); if (inventory === null || inventory.quantity < command.quantity) throw new ApplicationError("INSUFFICIENT_ITEMS", "Not enough fingerlings are in the warehouse"); const stockedAt = this.dependencies.clock.now(); const readyAt = new Date(Date.parse(stockedAt) + this.dependencies.definition.growthDurationSeconds * 1000).toISOString(); const cohortId = `cohort_${command.requestId}`; const next = viewOf({ ...current, itemDefinitionId: item, stockedAt, readyAt, cohorts: [...current.cohorts, { cohortId, itemDefinitionId: item, quantity: command.quantity, stockedAt, readyAt }], version: current.version + 1 }, construction, stockedAt, this.dependencies.definition.capacity); const record: IdempotencyRecord = { actorPlayerId: authorizedActor.playerId, operation: AQUACULTURE_STOCK_OPERATION, requestId: command.requestId, payloadFingerprint: fingerprint, resourceId: construction.id, responseJson: idempotencyResponse(next), status: "COMPLETED", createdAt: stockedAt };
    try { await this.dependencies.ponds.stockAtomically({ state: state ?? null, farmId, itemDefinitionId: item, stockedAt, readyAt, cohortId, quantity: command.quantity, expectedInventory: inventory, removal: this.dependencies.inventoryService.prepareRemoval(authorizedActor.playerId, item, command.quantity), idempotency: record }); return next; } catch (error: unknown) { const raced = await this.dependencies.idempotency.find(authorizedActor.playerId, AQUACULTURE_STOCK_OPERATION, command.requestId); if (raced !== null) return replay(raced, fingerprint); if (error instanceof Error && error.message.includes("warehouse_full")) throw error; throw new ApplicationError("AQUACULTURE_CONFLICT", "The pond or stocking inventory changed concurrently"); }
  }
}
class SettleAquaculturePond {
  constructor(private readonly dependencies: Dependencies, private readonly operation: "HARVEST_AQUACULTURE_POND" | "WITHDRAW_AQUACULTURE_POND", private readonly ready: boolean) {}
  async execute(actor: ActorContext | null, farmId: FarmId, pondId: string, command: AquacultureCommand): Promise<AquaculturePondView> {
    return this.executeOnPath(actor, farmId, pondId, command, "MANUAL");
  }
  async executeForWorker(actor: ActorContext | null, farmId: FarmId, pondId: string, command: AquacultureCommand): Promise<AquaculturePondView> {
    return this.executeOnPath(actor, farmId, pondId, command, "WORKER");
  }
  private async executeOnPath(actor: ActorContext | null, farmId: FarmId, pondId: string, command: AquacultureCommand, path: "MANUAL" | "WORKER"): Promise<AquaculturePondView> {
    const authorizedActor = await requireFarmEditor(this.dependencies, actor, farmId); const construction = path === "WORKER" ? await requireEligiblePond(this.dependencies, farmId, parsePondId(pondId)) : await requireActiveWaterCage(this.dependencies, farmId, parsePondId(pondId)); const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([this.operation, farmId, pondId, command.expectedPondVersion, command.quantity])); const existing = await this.dependencies.idempotency.find(authorizedActor.playerId, this.operation, command.requestId); if (existing !== null) return replay(existing, fingerprint);
    const state = await this.dependencies.ponds.findByConstruction(farmId, construction.id); if (state === null || state.cohorts.length === 0) throw new ApplicationError("AQUACULTURE_POND_EMPTY", "The pond has no stocked fish"); if (state.version !== command.expectedPondVersion) throw new ApplicationError("CONFLICT_STALE_STATE", "The pond changed since you looked at it"); const settledAt = this.dependencies.clock.now(); const allocations = allocate(state.cohorts, command.quantity, this.ready, settledAt); const available = allocations.reduce((sum, allocation) => sum + allocation.quantity, 0); if (available < command.quantity) { if (this.ready && available === 0) throw new ApplicationError("AQUACULTURE_POND_NOT_READY", "The fish are still growing"); throw new ApplicationError(this.ready ? "AQUACULTURE_NOT_ENOUGH_READY" : "AQUACULTURE_NOT_ENOUGH_GROWING", "The requested fish are not available"); }
    // Withdraw returns the stocked input; only a completed growth cycle produces the distinct adult
    // item. Keeping this choice server-side prevents a client from turning a withdraw into a harvest.
    const item = parseDefinitionId(this.ready ? this.dependencies.definition.harvestItemDefinitionId : this.dependencies.definition.stockingItemDefinitionId); const currentInventory = await this.dependencies.inventory.find(authorizedActor.playerId, item); const next = viewOf(afterAllocation(state, allocations), construction, settledAt, this.dependencies.definition.capacity); const record: IdempotencyRecord = { actorPlayerId: authorizedActor.playerId, operation: this.operation, requestId: command.requestId, payloadFingerprint: fingerprint, resourceId: construction.id, responseJson: idempotencyResponse(next), status: "COMPLETED", createdAt: settledAt };
    try { await this.dependencies.ponds.settleAtomically({ state, addition: this.dependencies.inventoryService.prepareAddition(authorizedActor.playerId, item, command.quantity), expectedInventory: currentInventory, operation: this.operation, allocations, idempotency: record }); return next; } catch (error: unknown) { const raced = await this.dependencies.idempotency.find(authorizedActor.playerId, this.operation, command.requestId); if (raced !== null) return replay(raced, fingerprint); if (error instanceof Error && error.message.includes("warehouse_full")) throw error; throw new ApplicationError("AQUACULTURE_CONFLICT", "The pond changed while settling the request"); }
  }
}
export class HarvestAquaculturePond extends SettleAquaculturePond { constructor(dependencies: Dependencies) { super(dependencies, AQUACULTURE_HARVEST_OPERATION, true); } }
export class WithdrawAquaculturePond extends SettleAquaculturePond { constructor(dependencies: Dependencies) { super(dependencies, AQUACULTURE_WITHDRAW_OPERATION, false); } }
export function aquacultureDependencies(input: Dependencies): Dependencies { return input; }
