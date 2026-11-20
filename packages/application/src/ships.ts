import {
  DomainError,
  MAX_TOTAL_XP,
  createXpAward,
  dockIdFor,
  parseCurrencyDefinitionId,
  parseItemDefinitionId,
  runSeaBattle,
  shipIdFor,
  type CurrencyDefinition,
  type EconomyMutation,
  type EconomyReferenceId,
  type InventoryItem,
  type PlayerId,
  type ProgressionDefinition,
  type SeaBattleInput,
  type SeaBattleResult,
  type SeaBattleSetup,
  type SeaBattleShipSpec,
  type ShipId,
  type XpAward
} from "@happy-farm/domain";
import type { EconomyService } from "./economy";
import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
import type {
  ActorContext,
  AmbushBountyWrite,
  Clock,
  CurrencyDefinitionRepository,
  DockTier,
  FarmRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  PayloadFingerprint,
  PlayerDockRecord,
  PlayerShipRecord,
  ProgressionRepository,
  ShipCatalogue,
  ShipClass,
  ShipPrice,
  ShipRepository,
  ShipRole,
  VoyageAmbush,
  VoyageRecord,
  WalletRepository,
  WarehouseRepository,
  WarehouseTierRepository
} from "./ports";
import { emptyProgression, progressionView, storedLevel, type ProgressionView } from "./progression";
import type { WorldPlacement } from "./world";

/**
 * Ships and voyages (docs/design/NAVAL.md, W5a; docs/design/FLEET.md, F1).
 *
 * A player keeps a fleet: each ship in a berth at their dock, the dock's tier setting how many there
 * are. A ship has a role - fishing, merchant, war - and climbs its role's ladder one rank at a time;
 * it never changes role. A player with no ship of their own has the dock's rowboat, lent, and their
 * first build takes its berth.
 *
 * The player sails one ship at a time. A voyage takes that ship from where it lies - home, or the place
 * it last reached - to a place on the player's own chart, and takes as long as the chart distance at
 * the ship's speed. Nothing ticks: whether a voyage has arrived is read from server time against its
 * stored arrival. "Home" ends the voyage and brings the ship back to its dock at once.
 *
 * The client names a role, a ship of its own, or a place; never a class, a price or a time.
 */

export const SHIP_BUILD_OPERATION = "SHIP_BUILD";
export const SHIP_REPAIR_OPERATION = "SHIP_REPAIR";
export const DOCK_UPGRADE_OPERATION = "DOCK_UPGRADE";
/** One receipt per route and day: what makes a bounty payable once (see `bountyRequest`). */
export const PIRATE_BOUNTY_OPERATION = "PIRATE_BOUNTY";
/** A player with no warehouse row is held to this by the database's own guard. */
const STARTER_WAREHOUSE_CAPACITY = 1000;
const WRITE_ATTEMPTS = 8;

export interface ShipDependencies {
  readonly farms: FarmRepository;
  readonly world: WorldPlacement;
  readonly ships: ShipRepository;
  readonly catalogue: ShipCatalogue;
  readonly progression: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  readonly inventory: InventoryRepository;
  readonly inventoryService: InventoryService;
  readonly wallets: WalletRepository;
  readonly currencies: CurrencyDefinitionRepository;
  readonly economyService: EconomyService;
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
  /** Where a bounty's materials land: only what the island's warehouse has room for. */
  readonly warehouse: WarehouseRepository;
  /** The starter capacity for a player with no warehouse row; the database holds such a player to 1000. */
  readonly warehouseTiers?: WarehouseTierRepository;
}

export interface PriceView {
  readonly currencyId: string;
  readonly gold: number;
  readonly materials: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
}

/** A class a ship can become: built new (rank 1) or upgraded to (the ranks after). */
export interface NextShipView {
  readonly classId: string;
  readonly role: ShipRole;
  readonly rank: number;
  readonly tier: number;
  readonly requiredPlayerLevel: number;
  readonly speedTilesPerMinute: number;
  readonly hull: number;
  readonly cannons: number;
  readonly hold: number;
  readonly cost: PriceView;
}

/** One ship of the fleet. */
export interface ShipView {
  readonly shipId: string;
  readonly berth: number;
  /** The dock's rowboat, lent to a player with no ship of their own; the first build takes its berth. */
  readonly lent: boolean;
  readonly classId: string;
  readonly role: ShipRole;
  readonly rank: number;
  readonly tier: number;
  readonly hull: number;
  readonly hullMax: number;
  readonly speedTilesPerMinute: number;
  readonly cannons: number;
  readonly hold: number;
  /** Sailing the player's voyage (at sea, or lying at the place it reached), not at its dock. */
  readonly away: boolean;
  /** The class it would be upgraded to; null at the top of its ladder. */
  readonly upgrade: NextShipView | null;
}

export interface DockView {
  readonly tier: number;
  readonly berths: number;
  /** Berths a new ship could take now. The lent rowboat holds none: a first build takes its place. */
  readonly freeBerths: number;
  /** The next tier and what raising the dock to it costs; null at the top. */
  readonly next: { readonly tier: number; readonly berths: number; readonly requiredPlayerLevel: number; readonly cost: PriceView } | null;
}

/** Pirates on a voyage, as the player's device needs them to play the fight the server will replay. */
export interface AmbushView {
  /** When they strike (server time). */
  readonly at: string;
  readonly status: VoyageAmbush["status"];
  /** The fight exactly as the server will replay it: seed, the player's ship, the pirates. */
  readonly setup: SeaBattleSetup;
  readonly pirates: readonly string[];
}

export interface VoyageView {
  /** The ship sailing it. */
  readonly shipId: string;
  readonly fromSlotId: string;
  readonly toSlotId: string;
  readonly departedAt: string;
  readonly arrivesAt: string;
  readonly arrived: boolean;
  readonly ambush: AmbushView | null;
}

export interface FleetView {
  /** The server time the view was read at; arrival is decided against it, never the client's clock. */
  readonly readAt: string;
  /** The ship in hand: the one on the voyage, else the ship in berth 1. */
  readonly ship: ShipView;
  /** What `ship` would be upgraded to (the same as `ship.upgrade`). */
  readonly next: NextShipView | null;
  /** Every ship of the fleet, in berth order. */
  readonly ships: readonly ShipView[];
  /** The first rank of each role: what a free berth could take. */
  readonly builds: readonly NextShipView[];
  readonly dock: DockView;
  /** Where the voyage leaves its ship: at its dock, out at sea, or at the place it reached. */
  readonly location: "HOME" | "AT_SEA" | "AT_PLACE";
  /** The voyage under way or just completed; null at home. */
  readonly voyage: VoyageView | null;
}

/** Where a voyage leaves its ship at `now`. */
export function voyageLocation(voyage: VoyageRecord | null, now: string): FleetView["location"] {
  if (voyage === null || voyage.status === "ENDED") return "HOME";
  return Date.parse(voyage.arrivesAt) <= Date.parse(now) ? "AT_PLACE" : "AT_SEA";
}

/** The ship a voyage is sailed by: named on the voyage, or berth 1's for a voyage from before the fleet. */
function voyageShipId(playerId: PlayerId, voyage: VoyageRecord): ShipId {
  return voyage.shipId ?? shipIdFor(playerId, 1);
}

/** The dock's own rowboat: the first class in the catalogue. */
function rowboatClass(catalogue: ShipCatalogue): ShipClass {
  const rowboat = catalogue.classes()[0];
  if (rowboat === undefined) throw new ApplicationError("INTERNAL_ERROR", "The ship catalogue is empty");
  return rowboat;
}

function classById(catalogue: ShipCatalogue, classId: string): ShipClass {
  const found = catalogue.classes().find((entry) => entry.id === classId);
  if (found === undefined) throw new ApplicationError("INTERNAL_ERROR", "A stored ship's class is not in the catalogue");
  return found;
}

function nextClass(catalogue: ShipCatalogue, current: ShipClass): ShipClass | null {
  return catalogue.classes().find((entry) => entry.role === current.role && entry.rank === current.rank + 1) ?? null;
}

function firstClass(catalogue: ShipCatalogue, role: ShipRole): ShipClass | null {
  return catalogue.classes().find((entry) => entry.role === role && entry.rank === 1) ?? null;
}

/**
 * A player's ships as the rules see them: the stored ones in berth order, or the dock's rowboat (lent,
 * in berth 1) when none is stored.
 */
interface FleetShip {
  readonly shipId: ShipId;
  readonly berth: number;
  readonly shipClass: ShipClass;
  readonly hull: number;
  /** Null for the lent rowboat. */
  readonly record: PlayerShipRecord | null;
}

function fleetShips(catalogue: ShipCatalogue, playerId: PlayerId, stored: readonly PlayerShipRecord[]): readonly FleetShip[] {
  if (stored.length === 0) {
    const rowboat = rowboatClass(catalogue);
    return [{ shipId: shipIdFor(playerId, 1), berth: 1, shipClass: rowboat, hull: rowboat.hull, record: null }];
  }
  return [...stored]
    .sort((a, b) => a.berth - b.berth)
    .map((record) => {
      const shipClass = classById(catalogue, record.classId);
      return { shipId: record.shipId, berth: record.berth, shipClass, hull: Math.min(shipClass.hull, record.hull), record };
    });
}

/** The ship a command names, which must be one of the player's own; an id from anyone else's fleet is not found. */
function ownShip(ships: readonly FleetShip[], shipId: string): FleetShip {
  const found = ships.find((ship) => ship.shipId === shipId);
  if (found === undefined) throw new ApplicationError("RESOURCE_NOT_FOUND", "That ship is not in your fleet");
  return found;
}

function dockTierOf(catalogue: ShipCatalogue, dock: PlayerDockRecord | null): DockTier {
  const tiers = catalogue.docks();
  const found = dock === null ? tiers[0] : tiers.find((entry) => entry.tier === dock.tier);
  if (found === undefined) throw new ApplicationError("INTERNAL_ERROR", "A stored dock's tier is not in the catalogue");
  return found;
}

function priceView(price: ShipPrice): PriceView {
  return {
    currencyId: price.currencyDefinitionId,
    gold: price.gold,
    materials: Object.entries(price.materials)
      .filter(([, quantity]) => quantity > 0)
      .map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity }))
  };
}

function nextShipView(shipClass: ShipClass): NextShipView {
  return {
    classId: shipClass.id,
    role: shipClass.role,
    rank: shipClass.rank,
    tier: shipClass.tier,
    requiredPlayerLevel: shipClass.requiredPlayerLevel,
    speedTilesPerMinute: shipClass.speedTilesPerMinute,
    hull: shipClass.hull,
    cannons: shipClass.cannons,
    hold: shipClass.hold,
    cost: priceView(shipClass.buildCost)
  };
}

/** The ship as it fights: its class's numbers and its hull as it stands. Null for a class that does not fight. */
function playerSpec(catalogue: ShipCatalogue, ship: FleetShip): SeaBattleShipSpec | null {
  const battle = catalogue.battle(ship.shipClass.id);
  if (battle === null || ship.shipClass.cannons <= 0) return null;
  return {
    hull: ship.hull,
    hullMax: ship.shipClass.hull,
    cannons: ship.shipClass.cannons,
    speed: battle.speed,
    turn: battle.turn,
    radius: battle.radius,
    spread: battle.spread
  };
}

/** The fight an ambush is: built from game data and the ship's own hull, never from anything a client sent. */
function ambushSetup(catalogue: ShipCatalogue, ship: FleetShip, ambush: VoyageAmbush): SeaBattleSetup | null {
  const player = playerSpec(catalogue, ship);
  if (player === null) return null;
  const pirates: SeaBattleShipSpec[] = [];
  for (const id of ambush.pirates) {
    const pirate = catalogue.pirate(id);
    if (pirate === null) return null;
    pirates.push({ hull: pirate.hull, hullMax: pirate.hull, cannons: pirate.cannons, ...pirate.battle });
  }
  return { seed: ambush.seed, player, pirates };
}

interface FleetState {
  readonly playerId: PlayerId;
  readonly stored: readonly PlayerShipRecord[];
  readonly dock: PlayerDockRecord | null;
  readonly voyage: VoyageRecord | null;
}

async function readFleet(dependencies: ShipDependencies, playerId: PlayerId): Promise<FleetState> {
  const [stored, dock, voyage] = await Promise.all([dependencies.ships.listShips(playerId), dependencies.ships.findDock(playerId), dependencies.ships.findVoyage(playerId)]);
  return { playerId, stored, dock, voyage };
}

function fleetView(catalogue: ShipCatalogue, state: FleetState, now: string): FleetView {
  const ships = fleetShips(catalogue, state.playerId, state.stored);
  const location = voyageLocation(state.voyage, now);
  const sailing = state.voyage !== null && location !== "HOME" ? voyageShipId(state.playerId, state.voyage) : null;
  const views = ships.map(
    (ship): ShipView => {
      const upgrade = nextClass(catalogue, ship.shipClass);
      return {
        shipId: ship.shipId,
        berth: ship.berth,
        lent: ship.record === null,
        classId: ship.shipClass.id,
        role: ship.shipClass.role,
        rank: ship.shipClass.rank,
        tier: ship.shipClass.tier,
        hull: ship.hull,
        hullMax: ship.shipClass.hull,
        speedTilesPerMinute: ship.shipClass.speedTilesPerMinute,
        cannons: ship.shipClass.cannons,
        hold: ship.shipClass.hold,
        away: ship.shipId === sailing,
        upgrade: upgrade === null ? null : nextShipView(upgrade)
      };
    }
  );
  const inHand = views.find((view) => view.away) ?? views[0];
  if (inHand === undefined) throw new ApplicationError("INTERNAL_ERROR", "A fleet has no ship");
  const dockTier = dockTierOf(catalogue, state.dock);
  const nextDock = catalogue.docks().find((entry) => entry.tier === dockTier.tier + 1) ?? null;
  const voyageShip = state.voyage === null ? null : ships.find((ship) => ship.shipId === voyageShipId(state.playerId, state.voyage as VoyageRecord)) ?? null;
  return {
    readAt: now,
    ship: inHand,
    next: inHand.upgrade,
    ships: views,
    builds: (["FISHING", "MERCHANT", "WAR"] as const).flatMap((role) => {
      const first = firstClass(catalogue, role);
      return first === null ? [] : [nextShipView(first)];
    }),
    dock: {
      tier: dockTier.tier,
      berths: dockTier.berths,
      freeBerths: Math.max(0, dockTier.berths - state.stored.length),
      next:
        nextDock === null || nextDock.upgradeCost === null
          ? null
          : { tier: nextDock.tier, berths: nextDock.berths, requiredPlayerLevel: nextDock.requiredPlayerLevel, cost: priceView(nextDock.upgradeCost) }
    },
    location,
    voyage:
      state.voyage === null || location === "HOME"
        ? null
        : {
            shipId: voyageShipId(state.playerId, state.voyage),
            fromSlotId: state.voyage.fromSlotId,
            toSlotId: state.voyage.toSlotId,
            departedAt: state.voyage.departedAt,
            arrivesAt: state.voyage.arrivesAt,
            arrived: location === "AT_PLACE",
            ambush: voyageShip === null ? null : ambushView(catalogue, voyageShip, state.voyage.ambush ?? null)
          }
  };
}

function ambushView(catalogue: ShipCatalogue, ship: FleetShip, ambush: VoyageAmbush | null): AmbushView | null {
  if (ambush === null) return null;
  const setup = ambushSetup(catalogue, ship, ambush);
  return setup === null ? null : { at: ambush.at, status: ambush.status, setup, pirates: ambush.pirates };
}

/** Whether an ambush has struck and is still waiting to be fought. */
function ambushDue(voyage: VoyageRecord | null, now: string): boolean {
  const ambush = voyage?.ambush ?? null;
  return voyage !== null && voyage.status === "UNDERWAY" && ambush !== null && ambush.status === "PENDING" && Date.parse(ambush.at) <= Date.parse(now);
}

/** Whether `ship` is out on the player's voyage rather than at its dock. */
function shipAway(state: FleetState, shipId: ShipId, now: string): boolean {
  return state.voyage !== null && voyageLocation(state.voyage, now) !== "HOME" && voyageShipId(state.playerId, state.voyage) === shipId;
}

async function playerLevel(dependencies: ShipDependencies, playerId: PlayerId): Promise<number> {
  return storedLevel(dependencies.progressionDefinition, await dependencies.progression.find(playerId));
}

/**
 * What a purchase at the dock takes, checked against the player's state as it is now: the currency,
 * every material stack (which must hold enough), and the wallet. The batch re-checks every one.
 */
async function preparePayment(
  dependencies: ShipDependencies,
  playerId: PlayerId,
  price: ShipPrice,
  now: string,
  shortOfItems: string
): Promise<{ readonly currency: CurrencyDefinition; readonly materials: readonly (readonly [string, number])[]; readonly expectedInventory: readonly InventoryItem[]; readonly wallet: Parameters<EconomyService["prepareMutation"]>[1] }> {
  const currency = dependencies.currencies.findById(parseCurrencyDefinitionId(price.currencyDefinitionId));
  if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  const materials = Object.entries(price.materials).filter(([, quantity]) => quantity > 0);
  const expectedInventory: InventoryItem[] = [];
  for (const [itemDefinitionId, quantity] of materials) {
    const row = await dependencies.inventory.find(playerId, parseItemDefinitionId(itemDefinitionId));
    if (row === null || row.quantity < quantity) throw new ApplicationError("INSUFFICIENT_ITEMS", shortOfItems);
    expectedInventory.push(row);
  }
  const wallet = (await dependencies.wallets.find(playerId, currency.id)) ?? {
    playerId,
    currencyDefinitionId: currency.id,
    balance: 0,
    version: 1,
    updatedAt: now
  };
  return { currency, materials, expectedInventory, wallet };
}

function prepareCharge(
  dependencies: ShipDependencies,
  actor: ActorContext,
  payment: Awaited<ReturnType<typeof preparePayment>>,
  input: { readonly gold: number; readonly reason: "SHIP_BUILD" | "SHIP_REPAIR" | "DOCK_UPGRADE"; readonly referenceId: EconomyReferenceId; readonly requestId: string }
): EconomyMutation {
  try {
    return dependencies.economyService.prepareMutation(actor, payment.wallet, payment.currency, {
      delta: -input.gold,
      reason: input.reason,
      referenceId: input.referenceId,
      requestId: input.requestId
    });
  } catch (error: unknown) {
    if (error instanceof ApplicationError) throw error;
    if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
    throw error;
  }
}

function replay(record: IdempotencyRecord, fingerprint: string): FleetView {
  if (record.payloadFingerprint !== fingerprint) {
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
  }
  try {
    return JSON.parse(record.responseJson) as FleetView;
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
  }
}

/** The player's fleet and dock, what they could build, and where the ship in hand is. */
export class GetFleet {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    return fleetView(this.dependencies.catalogue, await readFleet(this.dependencies, actor.playerId), this.dependencies.clock.now());
  }
}

/** One write of a ship at the dock, with the receipt that answers its replays. */
interface ShipWrite {
  readonly ship: FleetShip | null;
  readonly shipId: ShipId;
  readonly berth: number;
  readonly to: ShipClass;
  readonly hull: number;
  readonly price: ShipPrice;
  readonly reason: "SHIP_BUILD" | "SHIP_REPAIR";
  readonly operation: string;
}

/**
 * Pays for and writes one ship (new, upgraded or mended) in one batch with its receipt: gold through
 * the economy service and its ledger, materials through the inventory service. A batch that lost a
 * race writes nothing; the caller reads again. Returns the view, or null when the caller should retry.
 */
async function writeShip(
  dependencies: ShipDependencies,
  actor: ActorContext,
  state: FleetState,
  write: ShipWrite,
  command: { readonly requestId: string },
  fingerprint: string,
  now: string
): Promise<FleetView | null> {
  const payment = await preparePayment(dependencies, actor.playerId, write.price, now, write.reason === "SHIP_REPAIR" ? "The repair needs materials the island does not have" : "The ship needs materials the island does not have");
  const economy = prepareCharge(dependencies, actor, payment, { gold: write.price.gold, reason: write.reason, referenceId: write.shipId, requestId: command.requestId });
  const record = write.ship?.record ?? null;
  const written: PlayerShipRecord = {
    playerId: actor.playerId,
    shipId: write.shipId,
    berth: write.berth,
    classId: write.to.id,
    tier: write.to.tier,
    hull: write.hull,
    version: (record?.version ?? 0) + 1,
    lastChangeId: economy.transactionId,
    createdAt: record?.createdAt ?? economy.createdAt,
    updatedAt: economy.createdAt
  };
  // The fleet as it will stand: the lent rowboat (no row) is replaced by the first ship stored.
  const stored = state.stored.some((entry) => entry.shipId === write.shipId)
    ? state.stored.map((entry) => (entry.shipId === write.shipId ? written : entry))
    : [...state.stored, written];
  const result = fleetView(dependencies.catalogue, { ...state, stored }, economy.createdAt);
  const receipt: IdempotencyRecord = {
    actorPlayerId: actor.playerId,
    operation: write.operation,
    requestId: command.requestId,
    payloadFingerprint: fingerprint,
    resourceId: economy.transactionId,
    responseJson: JSON.stringify(result),
    status: "COMPLETED",
    createdAt: economy.createdAt
  };
  try {
    await dependencies.ships.buildAtomically(
      {
        playerId: actor.playerId,
        shipId: write.shipId,
        berth: write.berth,
        expectedClassId: record?.classId ?? null,
        expectedVersion: record?.version ?? 0,
        expectedShipCount: state.stored.length,
        classId: write.to.id,
        tier: write.to.tier,
        hull: write.hull,
        economy,
        removals: payment.materials.map(([itemDefinitionId, quantity]) => dependencies.inventoryService.prepareRemoval(actor.playerId, itemDefinitionId, quantity)),
        expectedInventory: payment.expectedInventory,
        createdAt: economy.createdAt
      },
      receipt
    );
    return result;
  } catch (error: unknown) {
    const raced = await dependencies.idempotency.find(actor.playerId, write.operation, command.requestId);
    if (raced !== null) return replay(raced, fingerprint);
    if (error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT") return null;
    throw error;
  }
}

/**
 * Builds a new ship of a role: the first rank of its ladder, in a free berth at the dock.
 *
 * The client names only the role. A player with no ship of their own has the dock's rowboat, lent; the
 * first build takes its berth, and the rowboat must be home for it. Otherwise the dock must have a
 * free berth. A replayed request answers from its receipt.
 */
export class BuildShip {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly role: ShipRole; readonly requestId: string }): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { catalogue } = this.dependencies;
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([SHIP_BUILD_OPERATION, "NEW", command.role]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, SHIP_BUILD_OPERATION, command.requestId);
    if (existing !== null) return replay(existing, fingerprint);
    const shipClass = firstClass(catalogue, command.role);
    if (shipClass === null) throw new ApplicationError("INVALID_INPUT", "There is no ship of that role");

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = this.dependencies.clock.now();
      const state = await readFleet(this.dependencies, actor.playerId);
      const dock = dockTierOf(catalogue, state.dock);
      if (state.stored.length === 0) {
        // The lent rowboat gives up its berth, and must be at the dock to do it.
        if (voyageLocation(state.voyage, now) !== "HOME") throw new ApplicationError("SHIP_AT_SEA", "The dock's rowboat must be home before a ship takes its berth");
      } else if (state.stored.length >= dock.berths) {
        throw new ApplicationError("DOCK_FULL", "Every berth at the dock is taken");
      }
      const taken = new Set(state.stored.map((entry) => entry.berth));
      let berth = 1;
      while (taken.has(berth)) berth += 1;
      if ((await playerLevel(this.dependencies, actor.playerId)) < shipClass.requiredPlayerLevel) {
        throw new ApplicationError("SHIP_LEVEL_REQUIRED", `That ship needs player level ${String(shipClass.requiredPlayerLevel)}`);
      }
      const written = await writeShip(
        this.dependencies,
        actor,
        state,
        { ship: null, shipId: shipIdFor(actor.playerId, berth), berth, to: shipClass, hull: shipClass.hull, price: shipClass.buildCost, reason: "SHIP_BUILD", operation: SHIP_BUILD_OPERATION },
        command,
        fingerprint,
        now
      );
      if (written !== null) return written;
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "The fleet or the economy changed while building");
  }
}

/**
 * Upgrades one of the player's ships to the next rank of its own ladder, in place: same ship, same
 * berth, a new class at full hull. Only a ship at its dock, and only for a player of the next class's
 * level. A request that lost a race to another upgrade is refused rather than charged twice.
 */
export class UpgradeShip {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly shipId: string; readonly requestId: string }): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { catalogue } = this.dependencies;
    // The request, not the target class: a replay arrives after the class has already moved on.
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([SHIP_BUILD_OPERATION, "UPGRADE", command.shipId]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, SHIP_BUILD_OPERATION, command.requestId);
    if (existing !== null) return replay(existing, fingerprint);

    const first = await readFleet(this.dependencies, actor.playerId);
    const startClass = ownShip(fleetShips(catalogue, actor.playerId, first.stored), command.shipId).shipClass.id;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const state = attempt === 0 ? first : await readFleet(this.dependencies, actor.playerId);
      const ship = ownShip(fleetShips(catalogue, actor.playerId, state.stored), command.shipId);
      // The step is decided once, from the class the caller saw; another upgrade moving it makes this
      // request stale rather than a second purchase.
      if (ship.shipClass.id !== startClass) throw new ApplicationError("CONFLICT_STALE_STATE", "The ship changed while upgrading");
      const next = nextClass(catalogue, ship.shipClass);
      if (next === null) throw new ApplicationError("SHIP_MAX_CLASS", "The ship is already the finest of its kind");
      const now = this.dependencies.clock.now();
      if (shipAway(state, ship.shipId, now)) throw new ApplicationError("SHIP_AT_SEA", "The ship must be at its dock to be upgraded");
      if ((await playerLevel(this.dependencies, actor.playerId)) < next.requiredPlayerLevel) {
        throw new ApplicationError("SHIP_LEVEL_REQUIRED", `The next ship needs player level ${String(next.requiredPlayerLevel)}`);
      }
      const written = await writeShip(
        this.dependencies,
        actor,
        state,
        { ship, shipId: ship.shipId, berth: ship.berth, to: next, hull: next.hull, price: next.buildCost, reason: "SHIP_BUILD", operation: SHIP_BUILD_OPERATION },
        command,
        fingerprint,
        now
      );
      if (written !== null) return written;
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "The ship or the economy changed while upgrading");
  }
}

/**
 * Raises the dock one tier: more berths. Gold through the ledger (`DOCK_UPGRADE`), wood and ore
 * through the inventory, the dock row and its receipt in one batch.
 */
export class UpgradeDock {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly requestId: string }): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { catalogue } = this.dependencies;
    const dockId = dockIdFor(actor.playerId);
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([dockId, DOCK_UPGRADE_OPERATION]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, DOCK_UPGRADE_OPERATION, command.requestId);
    if (existing !== null) return replay(existing, fingerprint);

    const first = await readFleet(this.dependencies, actor.playerId);
    const startTier = dockTierOf(catalogue, first.dock).tier;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const state = attempt === 0 ? first : await readFleet(this.dependencies, actor.playerId);
      const current = dockTierOf(catalogue, state.dock);
      if (current.tier !== startTier) throw new ApplicationError("CONFLICT_STALE_STATE", "The dock changed while upgrading");
      const next = catalogue.docks().find((entry) => entry.tier === current.tier + 1);
      const price = next?.upgradeCost ?? null;
      if (next === undefined || price === null) throw new ApplicationError("DOCK_MAX_TIER", "The dock is already the largest");
      if ((await playerLevel(this.dependencies, actor.playerId)) < next.requiredPlayerLevel) {
        throw new ApplicationError("DOCK_LEVEL_REQUIRED", `The next dock needs player level ${String(next.requiredPlayerLevel)}`);
      }
      const now = this.dependencies.clock.now();
      const payment = await preparePayment(this.dependencies, actor.playerId, price, now, "The dock needs materials the island does not have");
      const economy = prepareCharge(this.dependencies, actor, payment, { gold: price.gold, reason: "DOCK_UPGRADE", referenceId: dockId, requestId: command.requestId });
      const raised: PlayerDockRecord = {
        playerId: actor.playerId,
        dockId,
        tier: next.tier,
        version: (state.dock?.version ?? 0) + 1,
        lastChangeId: economy.transactionId,
        createdAt: state.dock?.createdAt ?? economy.createdAt,
        updatedAt: economy.createdAt
      };
      const result = fleetView(catalogue, { ...state, dock: raised }, economy.createdAt);
      const receipt: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: DOCK_UPGRADE_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: economy.transactionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: economy.createdAt
      };
      try {
        await this.dependencies.ships.upgradeDockAtomically(
          {
            playerId: actor.playerId,
            dockId,
            expectedTier: current.tier,
            expectedVersion: state.dock?.version ?? 0,
            toTier: next.tier,
            economy,
            removals: payment.materials.map(([itemDefinitionId, quantity]) => this.dependencies.inventoryService.prepareRemoval(actor.playerId, itemDefinitionId, quantity)),
            expectedInventory: payment.expectedInventory,
            createdAt: economy.createdAt
          },
          receipt
        );
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(actor.playerId, DOCK_UPGRADE_OPERATION, command.requestId);
        if (raced !== null) return replay(raced, fingerprint);
        if (error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT") continue;
        throw error;
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "The dock or the economy changed while upgrading");
  }
}

/**
 * Sets sail for a place on the player's own chart, in one of their ships.
 *
 * The ship leaves from where it lies: its dock, or the place the last voyage reached. A ship lying at a
 * place sails on from there, and while it does no other ship can set out; any ship at the dock can,
 * once the last voyage is over. The passage takes as long as the chart distance at the ship's speed,
 * decided here from game data; the client names only the ship and the place. A retried request with
 * the same id answers with the voyage it started rather than starting another.
 */
export class StartVoyage {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly slotId: string; readonly requestId: string; readonly shipId?: string | undefined }): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { world, catalogue, clock } = this.dependencies;
    const target = world.chart.findSlot(command.slotId);
    if (target === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "That place is not on the chart");
    const farm = await this.dependencies.farms.findByOwner(actor.playerId);
    const home = farm === null ? null : await world.slots.findByFarm(farm.id);
    if (home === null) throw new ApplicationError("WORLD_PLACE_UNCHARTED", "Only an island with a place on the chart can sail");
    const visited = await world.visits.listVisited(actor.playerId);
    if (!world.chart.chartedArchipelagos(home.slotId, visited).some((archipelago) => archipelago.archipelagoId === target.archipelagoId)) {
      throw new ApplicationError("WORLD_PLACE_UNCHARTED", "That place is not on your chart");
    }

    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const state = await readFleet(this.dependencies, actor.playerId);
      const { voyage } = state;
      const ships = fleetShips(catalogue, actor.playerId, state.stored);
      // The same request again: the voyage it started, not a second one.
      if (voyage !== null && voyage.requestId === command.requestId) {
        if (voyage.toSlotId !== target.slotId || (command.shipId !== undefined && command.shipId !== voyageShipId(actor.playerId, voyage))) {
          throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
        }
        return fleetView(catalogue, state, now);
      }
      const location = voyageLocation(voyage, now);
      if (location === "AT_SEA") throw new ApplicationError("VOYAGE_UNDERWAY", "The ship is still at sea");
      if (ambushDue(voyage, now)) throw new ApplicationError("AMBUSH_PENDING", "Pirates are waiting: the fight comes first");
      // A ship lying at a place is the one that sails on; otherwise the one named, or the ship in berth 1.
      const lying = location === "AT_PLACE" && voyage !== null ? voyageShipId(actor.playerId, voyage) : null;
      const shipId = command.shipId ?? lying ?? ships[0]?.shipId;
      if (shipId === undefined) throw new ApplicationError("INTERNAL_ERROR", "A fleet has no ship");
      const ship = ownShip(ships, shipId);
      if (lying !== null && ship.shipId !== lying) throw new ApplicationError("VOYAGE_UNDERWAY", "Another ship is out on a voyage: call it home first");
      if (ship.hull <= 0) throw new ApplicationError("SHIP_DAMAGED", "The ship must be repaired before it sails");
      const fromSlotId = lying !== null && voyage !== null ? voyage.toSlotId : home.slotId;
      if (fromSlotId === target.slotId) throw new ApplicationError("INVALID_INPUT", "The ship is already there");
      const from = world.chart.findSlot(fromSlotId);
      if (from === null) throw new ApplicationError("INTERNAL_ERROR", "The ship's place is not on the chart");
      const shipClass = ship.shipClass;
      const distance = Math.hypot(target.x - from.x, target.z - from.z);
      const seconds = catalogue.voyageSeconds(distance, shipClass.speedTilesPerMinute);
      // Pirates are planned here, from the route, the day and the player: the same route on the same
      // day meets the same fate, so calling the ship home and setting out again gains nothing. A ship
      // with no guns is not worth a pirate's while, and could only run.
      const plan =
        shipClass.cannons <= 0
          ? null
          : catalogue.planAmbush({
              playerId: actor.playerId,
              fromSlotId,
              toSlotId: target.slotId,
              day: now.slice(0, 10),
              distanceTiles: distance,
              shipTier: shipClass.tier
            });
      const departed = Date.parse(now);
      const next: VoyageRecord = {
        playerId: actor.playerId,
        shipId: ship.shipId,
        fromSlotId,
        toSlotId: target.slotId,
        shipTier: shipClass.tier,
        departedAt: now,
        arrivesAt: new Date(departed + seconds * 1000).toISOString(),
        status: "UNDERWAY",
        requestId: command.requestId,
        version: (voyage?.version ?? 0) + 1,
        updatedAt: now,
        ambush:
          plan === null
            ? null
            : { at: new Date(departed + Math.round(seconds * plan.atShare) * 1000).toISOString(), seed: plan.seed, pirates: plan.pirates, status: "PENDING" }
      };
      if (await this.dependencies.ships.writeVoyage(next, voyage?.version ?? null)) return fleetView(catalogue, { ...state, voyage: next }, now);
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The voyage changed while setting sail");
  }
}

/**
 * Calls the ship home: ends the voyage (under way or arrived) and the ship is at its dock at once.
 * Idempotent: a ship already home stays home.
 */
export class EndVoyage {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { ships, catalogue, clock } = this.dependencies;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const state = await readFleet(this.dependencies, actor.playerId);
      const { voyage } = state;
      if (voyage === null || voyage.status === "ENDED") return fleetView(catalogue, state, now);
      // Pirates that have already struck are not escaped by calling the ship home: the fight is played
      // out with no orders from the captain, and its damage stands.
      if (ambushDue(voyage, now) && voyage.ambush != null) {
        const decided = await decideAmbush(this.dependencies, actor, state, voyage, [], now, true);
        if (decided !== null) return decided.view;
        continue;
      }
      const ended: VoyageRecord = { ...voyage, status: "ENDED", version: voyage.version + 1, updatedAt: now };
      if (await ships.writeVoyage(ended, voyage.version)) return fleetView(catalogue, { ...state, voyage: ended }, now);
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The voyage changed while coming home");
  }
}

/** What a won fight paid. Materials the warehouse had no room for are `lost`, never owed later. */
export interface AmbushBountyView {
  readonly currencyDefinitionId: string;
  readonly gold: number;
  readonly materials: readonly { readonly itemDefinitionId: string; readonly quantity: number; readonly lost: number }[];
  readonly xpAwarded: number;
  readonly leveledUp: boolean;
  readonly progression: ProgressionView;
}

export interface AmbushOutcomeView {
  readonly fleet: FleetView;
  /** The fight this request decided; null when it had already been decided (its outcome is on the voyage). */
  readonly battle: SeaBattleResult | null;
  /** A won fight's bounty (also on a retried request); null when the fight was not won. */
  readonly bounty: AmbushBountyView | null;
}

/**
 * Decides a struck ambush by replaying the fight from its setup and `inputs`, and writes the outcome:
 * the voyage's ambush status, and the hull of the ship that fought. A lost fight, or `goHome`, ends the
 * voyage. A won fight pays its bounty in the same batch. Null when anything moved in between (the
 * caller looks again).
 */
async function decideAmbush(
  dependencies: ShipDependencies,
  actor: ActorContext,
  state: FleetState,
  voyage: VoyageRecord,
  inputs: readonly SeaBattleInput[],
  now: string,
  goHome: boolean
): Promise<{ readonly view: FleetView; readonly battle: SeaBattleResult; readonly bounty: AmbushBountyView | null } | null> {
  const ambush = voyage.ambush;
  const shipId = voyageShipId(actor.playerId, voyage);
  const ship = fleetShips(dependencies.catalogue, actor.playerId, state.stored).find((entry) => entry.shipId === shipId) ?? null;
  if (ambush == null || ship === null || ship.record === null) throw new ApplicationError("INTERNAL_ERROR", "An ambush needs a fighting ship");
  const setup = ambushSetup(dependencies.catalogue, ship, ambush);
  if (setup === null) throw new ApplicationError("INTERNAL_ERROR", "An ambush's ships are not in the catalogue");
  let battle: SeaBattleResult;
  try {
    battle = runSeaBattle(setup, inputs);
  } catch (error: unknown) {
    if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
    throw error;
  }
  const endVoyage = goHome || battle.outcome === "LOST";
  // A win pays once per route and day: a route already paid today is fought, and decided, for nothing.
  let prepared: { readonly write: AmbushBountyWrite; readonly view: AmbushBountyView } | null = null;
  if (battle.outcome === "WON") {
    const request = await bountyRequest(dependencies, actor.playerId, voyage);
    const paid = await dependencies.idempotency.find(actor.playerId, PIRATE_BOUNTY_OPERATION, request.requestId);
    if (paid === null) prepared = await prepareBounty(dependencies, actor, voyage, ambush.pirates, request, now);
  }
  const written = await dependencies.ships.resolveAmbush({
    playerId: actor.playerId,
    shipId,
    expectedVoyageVersion: voyage.version,
    expectedShipVersion: ship.record.version,
    outcome: battle.outcome,
    hull: battle.playerHull,
    endVoyage,
    at: now,
    bounty: prepared?.write ?? null
  });
  if (!written) return null;
  const fought: PlayerShipRecord = { ...ship.record, hull: battle.playerHull, version: ship.record.version + 1, updatedAt: now };
  const nextVoyage: VoyageRecord = {
    ...voyage,
    status: endVoyage ? "ENDED" : voyage.status,
    version: voyage.version + 1,
    updatedAt: now,
    ambush: { ...ambush, status: battle.outcome }
  };
  const nextState: FleetState = { ...state, stored: state.stored.map((entry) => (entry.shipId === shipId ? fought : entry)), voyage: nextVoyage };
  return { view: fleetView(dependencies.catalogue, nextState, now), battle, bounty: prepared?.view ?? null };
}

/**
 * The bounty's request id: one per route and day, the same key the ambush itself is planned by.
 *
 * Sailing the same route again the same day meets the same pirates with the same seed, so the same
 * recorded orders would win the same fight again. Keying the bounty by the voyage would let a player
 * replay a win for gold without end; keyed by the route and the day, the encounter pays once, and the
 * second payment collides with the first receipt.
 */
async function bountyRequest(dependencies: ShipDependencies, playerId: PlayerId, voyage: VoyageRecord): Promise<{ readonly requestId: string; readonly fingerprint: string }> {
  const fingerprint = await dependencies.fingerprints.hash(
    JSON.stringify([PIRATE_BOUNTY_OPERATION, playerId, voyage.fromSlotId, voyage.toSlotId, voyage.departedAt.slice(0, 10)])
  );
  return { requestId: `bounty_${fingerprint.slice(0, 48)}`, fingerprint };
}

/**
 * Sizes a won fight's bounty against the player's state as it is now: the gold through the economy
 * service, the materials through the inventory service up to the warehouse's free room (and each
 * stack's limit), and the experience up to the curve's top. The batch re-checks every one of these.
 */
async function prepareBounty(
  dependencies: ShipDependencies,
  actor: ActorContext,
  voyage: VoyageRecord,
  pirates: readonly string[],
  request: { readonly requestId: string; readonly fingerprint: string },
  now: string
): Promise<{ readonly write: AmbushBountyWrite; readonly view: AmbushBountyView }> {
  const { catalogue } = dependencies;
  const playerId = actor.playerId;
  const bounty = catalogue.bounty(pirates);
  const currency = dependencies.currencies.findById(parseCurrencyDefinitionId(bounty.currencyDefinitionId));
  if (currency === null) throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  const wallet = (await dependencies.wallets.find(playerId, currency.id)) ?? {
    playerId,
    currencyDefinitionId: currency.id,
    balance: 0,
    version: 1,
    updatedAt: now
  };
  const { requestId, fingerprint } = request;
  let economy;
  try {
    economy = dependencies.economyService.prepareMutation(actor, wallet, currency, {
      delta: bounty.gold,
      reason: "PIRATE_BOUNTY",
      referenceId: voyageShipId(playerId, voyage),
      requestId
    });
  } catch (error: unknown) {
    if (error instanceof ApplicationError) throw error;
    if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
    throw error;
  }

  // Materials: the warehouse's free room is shared, so it is handed out in the bounty's own order.
  const stored = await dependencies.warehouse.find(playerId);
  const capacity = stored?.capacity ?? dependencies.warehouseTiers?.list()[0]?.capacity ?? STARTER_WAREHOUSE_CAPACITY;
  let room = Math.max(0, capacity - (await dependencies.warehouse.usedCapacity(playerId)));
  const additions: AmbushBountyWrite["additions"][number][] = [];
  const expectedInventory: (InventoryItem | null)[] = [];
  const materials: { itemDefinitionId: string; quantity: number; lost: number }[] = [];
  for (const [itemDefinitionId, wanted] of Object.entries(bounty.materials)) {
    if (wanted <= 0) continue;
    const stack = await dependencies.inventory.find(playerId, parseItemDefinitionId(itemDefinitionId));
    const probe = dependencies.inventoryService.prepareAddition(playerId, itemDefinitionId, 1);
    const quantity = Math.max(0, Math.min(wanted, room, probe.maxQuantity - (stack?.quantity ?? 0)));
    materials.push({ itemDefinitionId, quantity, lost: wanted - quantity });
    if (quantity <= 0) continue;
    room -= quantity;
    additions.push(dependencies.inventoryService.prepareAddition(playerId, itemDefinitionId, quantity));
    expectedInventory.push(stack);
  }

  const progression = (await dependencies.progression.find(playerId)) ?? emptyProgression(playerId, now);
  const xp = Math.min(bounty.xp, MAX_TOTAL_XP - progression.xp);
  let award: XpAward | null = null;
  if (xp > 0) {
    try {
      award = createXpAward(dependencies.progressionDefinition, progression, xp, now);
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new ApplicationError("INTERNAL_ERROR", "Stored player progression is invalid");
      throw error;
    }
  }
  const view: AmbushBountyView = {
    currencyDefinitionId: currency.id,
    gold: bounty.gold,
    materials,
    xpAwarded: award?.xpAwarded ?? 0,
    leveledUp: award?.leveledUp ?? false,
    progression: progressionView(dependencies.progressionDefinition, award?.xpAfter ?? progression.xp)
  };
  const receipt: IdempotencyRecord = {
    actorPlayerId: playerId,
    operation: PIRATE_BOUNTY_OPERATION,
    requestId,
    payloadFingerprint: fingerprint,
    resourceId: economy.transactionId,
    // The voyage it was paid on, so a retried request reports it only for that voyage.
    responseJson: JSON.stringify({ voyageRequestId: voyage.requestId, bounty: view }),
    status: "COMPLETED",
    createdAt: economy.createdAt
  };
  return { write: { economy, additions, expectedInventory, award, receipt }, view };
}

/** A won fight's bounty as its receipt stored it: what a retried request answers with. */
async function storedBounty(dependencies: ShipDependencies, playerId: PlayerId, voyage: VoyageRecord): Promise<AmbushBountyView | null> {
  if (voyage.ambush?.status !== "WON") return null;
  const { requestId } = await bountyRequest(dependencies, playerId, voyage);
  const receipt = await dependencies.idempotency.find(playerId, PIRATE_BOUNTY_OPERATION, requestId);
  if (receipt === null) return null;
  let stored: { readonly voyageRequestId?: unknown; readonly bounty?: AmbushBountyView };
  try {
    stored = JSON.parse(receipt.responseJson) as typeof stored;
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "Stored bounty is unavailable");
  }
  // The route's bounty may have been paid on an earlier voyage today; this voyage's win then paid nothing.
  return stored.voyageRequestId === voyage.requestId && stored.bounty !== undefined ? stored.bounty : null;
}

/**
 * Fights an ambush: the player's device played it and sends only the inputs it recorded; the server
 * replays the fight from the setup it planned and the ship's own hull, and the result is the server's.
 * A fight already decided answers with its outcome and takes no new inputs.
 */
export class FightAmbush {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly inputs: readonly SeaBattleInput[] }): Promise<AmbushOutcomeView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { catalogue, clock } = this.dependencies;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const state = await readFleet(this.dependencies, actor.playerId);
      const { voyage } = state;
      const ambush = voyage?.ambush ?? null;
      if (voyage === null || ambush === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "No pirates are on this voyage");
      // Already decided (a retried request, or the ship was called home): the outcome stands, and no
      // new inputs are taken.
      if (ambush.status !== "PENDING") {
        return { fleet: fleetView(catalogue, state, now), battle: null, bounty: await storedBounty(this.dependencies, actor.playerId, voyage) };
      }
      if (voyage.status !== "UNDERWAY") throw new ApplicationError("RESOURCE_NOT_FOUND", "No pirates are on this voyage");
      if (Date.parse(ambush.at) > Date.parse(now)) throw new ApplicationError("AMBUSH_NOT_READY", "The pirates have not struck yet");
      const decided = await decideAmbush(this.dependencies, actor, state, voyage, command.inputs, now, false);
      if (decided !== null) return { fleet: decided.view, battle: decided.battle, bounty: decided.bounty };
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The voyage changed while fighting");
  }
}

/**
 * Mends one of the player's ships at its dock: gold through the ledger (`SHIP_REPAIR`), wood through
 * the inventory, the hull back to its class's full, in one batch with its receipt, exactly as a build
 * is. Without a ship named, the ship in berth 1.
 */
export class RepairShip {
  constructor(private readonly dependencies: ShipDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly requestId: string; readonly shipId?: string | undefined }): Promise<FleetView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { catalogue } = this.dependencies;
    const named = command.shipId ?? shipIdFor(actor.playerId, 1);
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([named, SHIP_REPAIR_OPERATION]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, SHIP_REPAIR_OPERATION, command.requestId);
    if (existing !== null) return replay(existing, fingerprint);
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = this.dependencies.clock.now();
      const state = await readFleet(this.dependencies, actor.playerId);
      const ship = ownShip(fleetShips(catalogue, actor.playerId, state.stored), named);
      if (ship.record === null || ship.hull >= ship.shipClass.hull) throw new ApplicationError("SHIP_NOT_DAMAGED", "The ship needs no repair");
      if (shipAway(state, ship.shipId, now)) throw new ApplicationError("SHIP_AT_SEA", "The ship must be at its dock to be repaired");
      const written = await writeShip(
        this.dependencies,
        actor,
        state,
        {
          ship,
          shipId: ship.shipId,
          berth: ship.berth,
          to: ship.shipClass,
          hull: ship.shipClass.hull,
          price: catalogue.repairCost(ship.shipClass.hull - ship.hull),
          reason: "SHIP_REPAIR",
          operation: SHIP_REPAIR_OPERATION
        },
        command,
        fingerprint,
        now
      );
      if (written !== null) return written;
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "The ship or the economy changed while repairing");
  }
}
