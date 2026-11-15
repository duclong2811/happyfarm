import {
  DomainError,
  MAX_TOTAL_XP,
  createXpAward,
  mineAfterDig,
  mineAfterUpgrade,
  mineAvailableMilli,
  mineCapacityMilli,
  mineIdFor,
  MILLI_PER_ORE,
  openMineSlots,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  type Farm,
  type FarmId,
  type InventoryItem,
  type MineRate,
  type ProgressionDefinition,
  type XpAward
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { EconomyService } from "./economy";
import type { InventoryService } from "./inventory";
import { emptyProgression, progressionView, storedLevel, type ProgressionView } from "./progression";
import type {
  ActorContext,
  Clock,
  CurrencyDefinitionRepository,
  FarmIslandRepository,
  FarmMemberRepository,
  FarmMineRecord,
  FarmRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  MineCatalogue,
  MineLevelDefinition,
  MineRepository,
  PayloadFingerprint,
  ProgressionRepository,
  WalletRepository,
  WarehouseRepository,
  WarehouseTierRepository
} from "./ports";

const DIG_OPERATION = "MINE_COLLECT";
const UPGRADE_OPERATION = "MINE_UPGRADE";
const WRITE_ATTEMPTS = 8;

export interface MineNextLevelView {
  readonly level: number;
  readonly orePerHour: number;
  readonly requiredPlayerLevel: number;
  readonly currencyId: string;
  readonly gold: number;
  readonly materials: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
}

export interface MineView {
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly level: number;
  readonly orePerHour: number;
  readonly capacityOre: number;
  /** What the mine held at `readAt`, in thousandths of an ore; the client extrapolates from here. */
  readonly availableMilli: number;
  readonly nextLevel: MineNextLevelView | null;
}

export interface LockedMineSlotView {
  readonly slot: number;
  readonly x: number;
  readonly y: number;
  readonly requiredPlayerLevel: number;
}

export interface FarmMinesView {
  /** The server time every `availableMilli` was computed at. */
  readonly readAt: string;
  readonly mines: readonly MineView[];
  readonly locked: readonly LockedMineSlotView[];
}

export interface MineDigView {
  readonly readAt: string;
  readonly mine: MineView;
  readonly collected: number;
  readonly xpAwarded: number;
  readonly leveledUp: boolean;
  readonly progression: ProgressionView;
}

export interface MineUpgradeView {
  readonly readAt: string;
  readonly mine: MineView;
}

export interface MineCommand {
  readonly requestId: string;
}

export interface MineDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly islands: FarmIslandRepository;
  readonly mines: MineRepository;
  readonly catalogue: MineCatalogue;
  readonly progression: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  readonly inventory: InventoryRepository;
  readonly inventoryService: InventoryService;
  readonly warehouse: WarehouseRepository;
  readonly warehouseTiers: WarehouseTierRepository;
  readonly wallets: WalletRepository;
  readonly currencies: CurrencyDefinitionRepository;
  readonly economyService: EconomyService;
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

function rateOf(catalogue: MineCatalogue, level: MineLevelDefinition): MineRate {
  return { orePerHour: level.orePerHour, accumulationHours: catalogue.accumulationHours };
}

function levelOf(catalogue: MineCatalogue, level: number): MineLevelDefinition {
  const definition = catalogue.levels().find((entry) => entry.level === level);
  if (definition === undefined) throw new ApplicationError("INTERNAL_ERROR", "Mine level is not in the catalogue");
  return definition;
}

function nextLevelView(catalogue: MineCatalogue, level: number): MineNextLevelView | null {
  const next = catalogue.levels().find((entry) => entry.level === level + 1);
  if (next?.upgradeCost == null) return null;
  return {
    level: next.level,
    orePerHour: next.orePerHour,
    requiredPlayerLevel: next.requiredPlayerLevel,
    currencyId: next.upgradeCost.currencyDefinitionId,
    gold: next.upgradeCost.gold,
    materials: Object.entries(next.upgradeCost.materials).map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity }))
  };
}

function mineView(
  catalogue: MineCatalogue,
  mine: Pick<FarmMineRecord, "slot" | "level" | "bankedMilli" | "accruedSince">,
  tile: { readonly x: number; readonly y: number },
  now: string
): MineView {
  const level = levelOf(catalogue, mine.level);
  const rate = rateOf(catalogue, level);
  let availableMilli: number;
  try {
    availableMilli = mineAvailableMilli({ level: mine.level, bankedMilli: mine.bankedMilli, accruedSince: mine.accruedSince }, rate, now);
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored mine is invalid");
  }
  return {
    slot: mine.slot,
    x: tile.x,
    y: tile.y,
    level: mine.level,
    orePerHour: level.orePerHour,
    capacityOre: mineCapacityMilli(rate) / MILLI_PER_ORE,
    availableMilli,
    nextLevel: nextLevelView(catalogue, mine.level)
  };
}

interface MineLayout {
  readonly farm: Farm;
  readonly slotLevels: readonly number[];
  readonly tiles: readonly { readonly x: number; readonly y: number }[];
}

/** The farm, its slot ladder and where each slot stands. Membership is checked by the caller. */
async function layoutFor(dependencies: MineDependencies, farm: Farm): Promise<MineLayout> {
  const island = await dependencies.islands.findByFarm(farm.id);
  const ladder = dependencies.catalogue.slotLevels(island?.element ?? null);
  const tiles = dependencies.catalogue.slotTiles(island, ladder.length);
  // A slot with nowhere to stand is not offered at all.
  return { farm, slotLevels: ladder.slice(0, tiles.length), tiles };
}

async function requireMember(dependencies: MineDependencies, actor: ActorContext | null, farmId: FarmId): Promise<{ farm: Farm; owner: boolean }> {
  if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
  const farm = await dependencies.farms.findById(farmId);
  if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
  const membership = await dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
  if (membership === null) throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
  return { farm, owner: membership.role === "OWNER" && farm.ownerPlayerId === actor.playerId };
}

/** The owner's level, from their stored experience; what every mine ladder is gated on. */
async function ownerLevel(dependencies: MineDependencies, farm: Farm): Promise<number> {
  return storedLevel(dependencies.progressionDefinition, await dependencies.progression.find(farm.ownerPlayerId));
}

/**
 * The farm's mines: those the owner's level has opened, and the slots still locked.
 *
 * Any member may look - a visitor sees the same mines - but only the owner's look opens a newly
 * unlocked slot's row, so a read by someone else never writes. Opening is idempotent: a slot's row
 * is created once, empty, and fills from then.
 */
export class ListFarmMines {
  constructor(private readonly dependencies: MineDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<FarmMinesView> {
    const { farm, owner } = await requireMember(this.dependencies, actor, farmId);
    const layout = await layoutFor(this.dependencies, farm);
    const level = await ownerLevel(this.dependencies, farm);
    const open = openMineSlots(layout.slotLevels, level);
    let rows = await this.dependencies.mines.listByFarm(farm.id);
    const missing = layout.slotLevels
      .map((_, slot) => slot)
      .filter((slot) => slot < open && !rows.some((row) => row.slot === slot));
    if (owner && missing.length > 0) {
      await this.dependencies.mines.ensureSlots(
        farm.id,
        missing.map((slot) => ({ id: mineIdFor(farm.id, slot), slot })),
        this.dependencies.clock.now()
      );
      rows = await this.dependencies.mines.listByFarm(farm.id);
    }
    const now = this.dependencies.clock.now();
    const mines: MineView[] = [];
    const locked: LockedMineSlotView[] = [];
    layout.slotLevels.forEach((requiredPlayerLevel, slot) => {
      const tile = layout.tiles[slot];
      if (tile === undefined) return;
      const row = rows.find((entry) => entry.slot === slot);
      if (row !== undefined && slot < open) mines.push(mineView(this.dependencies.catalogue, row, tile, now));
      else if (slot >= open) locked.push({ slot, x: tile.x, y: tile.y, requiredPlayerLevel });
    });
    return { readAt: now, mines, locked };
  }
}

/** The owner's open mine at `slot`, with where it stands. Everything else is refused. */
async function requireOwnedMine(
  dependencies: MineDependencies,
  actor: ActorContext,
  farmId: FarmId,
  slot: number
): Promise<{ farm: Farm; mine: FarmMineRecord; tile: { readonly x: number; readonly y: number } }> {
  const { farm, owner } = await requireMember(dependencies, actor, farmId);
  if (!owner) throw new ApplicationError("NOT_AUTHORIZED", "Only the farm owner may work its mines");
  const layout = await layoutFor(dependencies, farm);
  const tile = layout.tiles[slot];
  const required = layout.slotLevels[slot];
  if (tile === undefined || required === undefined) throw new ApplicationError("MINE_NOT_FOUND", "There is no mine in this slot");
  const mine = (await dependencies.mines.listByFarm(farm.id)).find((row) => row.slot === slot);
  if (mine === undefined || openMineSlots(layout.slotLevels, await ownerLevel(dependencies, farm)) <= slot) {
    throw new ApplicationError("MINE_SLOT_LOCKED", "This mine has not been opened yet");
  }
  return { farm, mine, tile };
}

function parseSlot(slot: number): number {
  if (!Number.isSafeInteger(slot) || slot < 0 || slot > 15) throw new ApplicationError("INVALID_INPUT", "Mine slot is invalid");
  return slot;
}

function storedResult(record: IdempotencyRecord, fingerprint: string): unknown {
  if (record.payloadFingerprint !== fingerprint) {
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
  }
  try {
    return JSON.parse(record.responseJson);
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
  }
}

/** A stored dig answer, checked for the fields a client acts on before it is handed back. */
function replayDig(record: IdempotencyRecord, fingerprint: string): MineDigView {
  const value = storedResult(record, fingerprint) as Partial<MineDigView> | null;
  if (value === null || typeof value !== "object" || !Number.isSafeInteger(value.collected) || typeof value.mine !== "object") {
    throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
  }
  return value as MineDigView;
}

function replayUpgrade(record: IdempotencyRecord, fingerprint: string): MineUpgradeView {
  const value = storedResult(record, fingerprint) as Partial<MineUpgradeView> | null;
  if (value === null || typeof value !== "object" || typeof value.mine !== "object") {
    throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
  }
  return value as MineUpgradeView;
}

/**
 * Empties a mine into the warehouse: as much as the warehouse (and the item's stack) has room for.
 *
 * What does not fit stays in the mine, banked, rather than being lost; the mine's clock restarts at
 * the dig. Experience is one point per `orePerXp` ore over the mine's whole life, so many small digs
 * pay exactly what one big dig would. Owner only: the ore lands in the owner's warehouse.
 */
export class CollectMine {
  constructor(private readonly dependencies: MineDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, slotValue: number, command: MineCommand): Promise<MineDigView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const slot = parseSlot(slotValue);
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([farmId, slot, DIG_OPERATION]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, DIG_OPERATION, command.requestId);
    if (existing !== null) return replayDig(existing, fingerprint);
    const { catalogue } = this.dependencies;
    const oreItem = catalogue.oreItemDefinitionId;

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const { mine, tile } = await requireOwnedMine(this.dependencies, actor, farmId, slot);
      const now = this.dependencies.clock.now();
      const rate = rateOf(catalogue, levelOf(catalogue, mine.level));
      const accrual = { level: mine.level, bankedMilli: mine.bankedMilli, accruedSince: mine.accruedSince };
      const availableOre = Math.floor(mineAvailableMilli(accrual, rate, now) / MILLI_PER_ORE);
      if (availableOre <= 0) throw new ApplicationError("MINE_EMPTY", "The mine has no ore to dig yet");

      const room = await this.warehouseRoom(actor.playerId);
      const stack = await this.dependencies.inventory.find(actor.playerId, parseItemDefinitionId(oreItem));
      const probe = this.dependencies.inventoryService.prepareAddition(actor.playerId, oreItem, 1);
      const stackRoom = probe.maxQuantity - (stack?.quantity ?? 0);
      const take = Math.min(availableOre, room, stackRoom);
      if (take <= 0) throw new ApplicationError("WAREHOUSE_FULL", "The warehouse has no room for ore");

      const after = mineAfterDig(accrual, rate, now, take);
      const dugAfter = mine.oreDugTotal + take;
      const stored = await this.dependencies.progression.find(actor.playerId);
      const current = stored ?? emptyProgression(actor.playerId, now);
      const earned = Math.floor(dugAfter / catalogue.orePerXp) - Math.floor(mine.oreDugTotal / catalogue.orePerXp);
      // At the very top of the curve a dig still pays ore; it simply has no experience left to give.
      const xp = Math.min(earned, MAX_TOTAL_XP - current.xp);
      let award: XpAward | null = null;
      if (xp > 0) {
        try {
          award = createXpAward(this.dependencies.progressionDefinition, current, xp, now);
        } catch (error: unknown) {
          if (error instanceof DomainError) throw new ApplicationError("INTERNAL_ERROR", "Stored player progression is invalid");
          throw error;
        }
      }
      const marker = `dig:${command.requestId}`;
      const result: MineDigView = {
        readAt: now,
        mine: mineView(catalogue, { slot, level: mine.level, bankedMilli: after.bankedMilli, accruedSince: now }, tile, now),
        collected: take,
        xpAwarded: award?.xpAwarded ?? 0,
        leveledUp: award?.leveledUp ?? false,
        progression: progressionView(this.dependencies.progressionDefinition, award?.xpAfter ?? current.xp)
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: DIG_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: mine.id,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: now
      };
      try {
        await this.dependencies.mines.digAtomically(
          {
            playerId: actor.playerId,
            mine,
            change: { level: mine.level, bankedMilli: after.bankedMilli, accruedSince: now, oreDugTotal: dugAfter, marker },
            addition: this.dependencies.inventoryService.prepareAddition(actor.playerId, oreItem, take),
            award,
            timestamp: now
          },
          record
        );
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(actor.playerId, DIG_OPERATION, command.requestId);
        if (raced !== null) return replayDig(raced, fingerprint);
        if (error instanceof ApplicationError && error.code === "MINE_CONFLICT") continue;
        throw error;
      }
    }
    throw new ApplicationError("MINE_CONFLICT", "The mine changed while digging");
  }

  private async warehouseRoom(playerId: ActorContext["playerId"]): Promise<number> {
    const stored = await this.dependencies.warehouse.find(playerId);
    // A player with no row is held to the starter capacity by the database guard.
    const capacity = stored?.capacity ?? this.dependencies.warehouseTiers.list()[0]?.capacity ?? 0;
    const used = await this.dependencies.warehouse.usedCapacity(playerId);
    return Math.max(0, capacity - used);
  }
}

/**
 * Raises a mine one level: never a level the client names.
 *
 * Gold goes through the centralized economy service and its ledger; wood and ore through the
 * centralized inventory service. The ore the mine had already made at its old rate is banked first,
 * so an upgrade never costs ore that was earned. Gated on the owner's level for the level reached.
 */
export class UpgradeMine {
  constructor(private readonly dependencies: MineDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, slotValue: number, command: MineCommand): Promise<MineUpgradeView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const slot = parseSlot(slotValue);
    // The request, not the target level: a replay arrives after the level moved.
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([farmId, slot, UPGRADE_OPERATION]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, UPGRADE_OPERATION, command.requestId);
    if (existing !== null) return replayUpgrade(existing, fingerprint);
    const { catalogue } = this.dependencies;

    const first = await requireOwnedMine(this.dependencies, actor, farmId, slot);
    const startLevel = first.mine.level;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const { farm, mine, tile } = attempt === 0 ? first : await requireOwnedMine(this.dependencies, actor, farmId, slot);
      // The step is decided once, from the level the caller saw. If another upgrade moved it, this
      // request's decision is stale and must not buy a second step.
      if (mine.level !== startLevel) throw new ApplicationError("CONFLICT_STALE_STATE", "The mine changed while upgrading");
      const next = catalogue.levels().find((entry) => entry.level === mine.level + 1);
      const cost = next?.upgradeCost ?? null;
      if (next === undefined || cost === null) throw new ApplicationError("MINE_MAX_LEVEL", "The mine is already at its highest level");
      if ((await ownerLevel(this.dependencies, farm)) < next.requiredPlayerLevel) {
        throw new ApplicationError("MINE_LEVEL_REQUIRED", `The next mine level needs player level ${String(next.requiredPlayerLevel)}`);
      }
      const currency = this.dependencies.currencies.findById(parseCurrencyDefinitionId(cost.currencyDefinitionId));
      if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");

      const materials = Object.entries(cost.materials).filter(([, quantity]) => quantity > 0);
      const expectedInventory: InventoryItem[] = [];
      for (const [itemDefinitionId, quantity] of materials) {
        const row = await this.dependencies.inventory.find(actor.playerId, parseItemDefinitionId(itemDefinitionId));
        if (row === null || row.quantity < quantity) {
          throw new ApplicationError("INSUFFICIENT_ITEMS", "The upgrade requires materials the island does not have");
        }
        expectedInventory.push(row);
      }
      const now = this.dependencies.clock.now();
      const wallet = (await this.dependencies.wallets.find(actor.playerId, currency.id)) ?? {
        playerId: actor.playerId,
        currencyDefinitionId: currency.id,
        balance: 0,
        version: 1,
        updatedAt: now
      };
      let economy;
      try {
        economy = this.dependencies.economyService.prepareMutation(actor, wallet, currency, {
          delta: -cost.gold,
          reason: "MINE_UPGRADE",
          referenceId: mine.id,
          requestId: command.requestId
        });
      } catch (error: unknown) {
        if (error instanceof ApplicationError) throw error;
        if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
        throw error;
      }
      const oldRate = rateOf(catalogue, levelOf(catalogue, mine.level));
      const after = mineAfterUpgrade({ level: mine.level, bankedMilli: mine.bankedMilli, accruedSince: mine.accruedSince }, oldRate, economy.createdAt);
      const result: MineUpgradeView = {
        readAt: economy.createdAt,
        mine: mineView(catalogue, { slot, level: after.level, bankedMilli: after.bankedMilli, accruedSince: after.accruedSince }, tile, economy.createdAt)
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: UPGRADE_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: economy.transactionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: economy.createdAt
      };
      try {
        await this.dependencies.mines.upgradeAtomically(
          {
            playerId: actor.playerId,
            mine,
            change: {
              level: after.level,
              bankedMilli: after.bankedMilli,
              accruedSince: after.accruedSince,
              oreDugTotal: mine.oreDugTotal,
              marker: economy.transactionId
            },
            economy,
            removals: materials.map(([itemDefinitionId, quantity]) =>
              this.dependencies.inventoryService.prepareRemoval(actor.playerId, itemDefinitionId, quantity)
            ),
            expectedInventory,
            timestamp: economy.createdAt
          },
          record
        );
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(actor.playerId, UPGRADE_OPERATION, command.requestId);
        if (raced !== null) return replayUpgrade(raced, fingerprint);
        if (error instanceof ApplicationError && (error.code === "MINE_CONFLICT" || error.code === "ECONOMY_CONFLICT")) continue;
        throw error;
      }
    }
    throw new ApplicationError("MINE_CONFLICT", "The mine changed while upgrading");
  }
}
