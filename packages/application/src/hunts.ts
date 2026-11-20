import {
  DomainError,
  parseItemDefinitionId,
  runSeaBattle,
  type InventoryItem,
  type SeaBattleInput,
  type SeaBattleResult,
  type SeaBattleSetup,
  type SeaBattleShipSpec
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, HuntCatalogue, HuntRepository, IdempotencyRecord, MonsterHuntRecord } from "./ports";
import { fleetShips, ownShip, playerLevel, playerSpec, prepareReward, readFleet, shipAway, type AmbushBountyView, type ShipDependencies } from "./ships";

/**
 * Sea-monster hunts (docs/design/FLEET.md, F3; the owner's design, 2026-11-20).
 *
 * Every four hours three monsters surface in a player's home waters, their kinds and levels the game
 * data's choice for the player and the window. A ship with guns, at its dock and afloat, sets out
 * against one: the server plans the fight (a fresh seed, the ship as it stands, the monster at its
 * level) and hands the device the setup. The device plays it and sends only its orders; the server
 * replays them, and its result is the result. A won fight strikes the monster from the window and pays
 * its bounty - gold, wood, ore, experience and the monster's own material - in the same batch.
 *
 * Materials merge ten to one up a level. The client names a slot, a ship, or a material; never a
 * monster, a level, a seed or a reward.
 */

export const MONSTER_BOUNTY_OPERATION = "MONSTER_BOUNTY";
export const MATERIAL_MERGE_OPERATION = "MATERIAL_MERGE";
const WRITE_ATTEMPTS = 8;

export interface HuntDependencies extends ShipDependencies {
  readonly hunts: HuntRepository;
  readonly huntCatalogue: HuntCatalogue;
}

export interface HuntMonsterView {
  readonly slot: number;
  readonly kind: string;
  readonly level: number;
  readonly monsterId: string;
  readonly defeated: boolean;
  readonly reward: {
    readonly gold: number;
    readonly xp: number;
    readonly materials: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
  };
}

export interface OpenHuntView {
  readonly slot: number;
  readonly kind: string;
  readonly level: number;
  readonly monsterId: string;
  readonly shipId: string;
  /** The fight exactly as the server will replay it. */
  readonly setup: SeaBattleSetup;
}

export interface HuntsView {
  readonly readAt: string;
  /** When this roster sinks and the next surfaces (server time). */
  readonly endsAt: string;
  readonly monsters: readonly HuntMonsterView[];
  /** A fight planned and not yet fought; null when there is none. */
  readonly hunt: OpenHuntView | null;
}

export interface HuntOutcomeView {
  readonly hunts: HuntsView;
  /** The fight this request decided; null when it had already been decided. */
  readonly battle: SeaBattleResult | null;
  /** A won fight's bounty; null otherwise. */
  readonly bounty: AmbushBountyView | null;
}

function parseSetup(json: string): SeaBattleSetup {
  try {
    return JSON.parse(json) as SeaBattleSetup;
  } catch {
    throw new ApplicationError("INTERNAL_ERROR", "A stored fight is unreadable");
  }
}

async function huntsView(dependencies: HuntDependencies, playerId: ActorContext["playerId"], now: string, hunt: MonsterHuntRecord | null): Promise<HuntsView> {
  const { huntCatalogue } = dependencies;
  const window = huntCatalogue.window(Date.parse(now));
  const level = await playerLevel(dependencies, playerId);
  const kills = new Set(await dependencies.hunts.listKills(playerId, window));
  const open = hunt !== null && hunt.status === "OPEN" ? hunt : null;
  return {
    readAt: now,
    endsAt: new Date(huntCatalogue.windowEndsAt(window)).toISOString(),
    monsters: huntCatalogue.roster(playerId, window, level).map((monster) => {
      const bounty = huntCatalogue.bounty(monster.kind, monster.level);
      return {
        slot: monster.slot,
        kind: monster.kind,
        level: monster.level,
        monsterId: huntCatalogue.monsterId(monster.kind) ?? monster.kind,
        defeated: kills.has(monster.slot),
        reward: {
          gold: bounty.gold,
          xp: bounty.xp,
          materials: Object.entries(bounty.materials)
            .filter(([, quantity]) => quantity > 0)
            .map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity }))
        }
      };
    }),
    hunt:
      open === null
        ? null
        : {
            slot: open.slot,
            kind: open.kind,
            level: open.level,
            monsterId: huntCatalogue.monsterId(open.kind) ?? open.kind,
            shipId: open.shipId,
            setup: parseSetup(open.setupJson)
          }
  };
}

/** The monsters in the player's home waters this window, which are beaten, and any fight still open. */
export class GetHunts {
  constructor(private readonly dependencies: HuntDependencies) {}

  async execute(actor: ActorContext | null): Promise<HuntsView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const now = this.dependencies.clock.now();
    return huntsView(this.dependencies, actor.playerId, now, await this.dependencies.hunts.findHunt(actor.playerId));
  }
}

/**
 * Plans a fight against one monster of this window's roster, in one of the player's ships with guns,
 * at its dock and afloat. One fight at a time: an open fight must be fought first. A retried request
 * answers with the fight it planned.
 */
export class StartHunt {
  constructor(private readonly dependencies: HuntDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly slot: number; readonly shipId: string; readonly requestId: string }): Promise<HuntsView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { huntCatalogue, catalogue, clock, random } = this.dependencies;
    if (random === undefined) throw new ApplicationError("RESOURCE_NOT_FOUND", "Hunts are not available here");
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const current = await this.dependencies.hunts.findHunt(actor.playerId);
      if (current !== null && current.requestId === command.requestId) {
        if (current.slot !== command.slot || current.shipId !== command.shipId) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
        return huntsView(this.dependencies, actor.playerId, now, current);
      }
      if (current !== null && current.status === "OPEN") throw new ApplicationError("HUNT_OPEN", "A fight is waiting to be fought first");
      const window = huntCatalogue.window(Date.parse(now));
      const level = await playerLevel(this.dependencies, actor.playerId);
      const monster = huntCatalogue.roster(actor.playerId, window, level).find((entry) => entry.slot === command.slot);
      if (monster === undefined) throw new ApplicationError("RESOURCE_NOT_FOUND", "No monster is there");
      if ((await this.dependencies.hunts.listKills(actor.playerId, window)).includes(monster.slot)) throw new ApplicationError("HUNT_DEFEATED", "That monster is already beaten");
      const state = await readFleet(this.dependencies, actor.playerId);
      const ship = ownShip(fleetShips(catalogue, actor.playerId, state.stored), command.shipId);
      const player = playerSpec(catalogue, ship);
      if (player === null || ship.record === null) throw new ApplicationError("SHIP_UNARMED", "Only a ship with guns can fight a monster");
      if (shipAway(state, ship.shipId, now)) throw new ApplicationError("SHIP_AT_SEA", "The ship must be at its dock to fight");
      if (ship.hull <= 0) throw new ApplicationError("SHIP_DAMAGED", "The ship must be repaired before it fights");
      const battle = huntCatalogue.battle(monster.kind, monster.level);
      if (battle === null) throw new ApplicationError("INTERNAL_ERROR", "A monster is not in the catalogue");
      const beast: SeaBattleShipSpec = {
        hull: battle.hull,
        hullMax: battle.hull,
        cannons: battle.cannons,
        speed: battle.speed,
        turn: battle.turn,
        radius: battle.radius,
        spread: battle.spread,
        behaviour: battle.behaviour
      };
      const setup: SeaBattleSetup = { seed: Math.floor(random.roll() * 4_294_967_296) >>> 0, player, pirates: [beast] };
      const next: MonsterHuntRecord = {
        playerId: actor.playerId,
        shipId: ship.shipId,
        window,
        slot: monster.slot,
        kind: monster.kind,
        level: monster.level,
        setupJson: JSON.stringify(setup),
        shipVersion: ship.record.version,
        status: "OPEN",
        requestId: command.requestId,
        version: (current?.version ?? 0) + 1,
        createdAt: now,
        updatedAt: now
      };
      if (await this.dependencies.hunts.startHunt(next)) return huntsView(this.dependencies, actor.playerId, now, next);
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The hunt changed while setting out");
  }
}

/**
 * Fights the open hunt: the server replays the device's orders from the setup it planned, and writes
 * the outcome and the ship's hull together. A win strikes the monster from the window and pays its
 * bounty in the same batch (a slot pays once: the kill and the receipt are both keyed by it). A ship
 * changed since the fight was planned (repaired, upgraded) voids the fight: no hull, no reward.
 */
export class FightHunt {
  constructor(private readonly dependencies: HuntDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly inputs: readonly SeaBattleInput[] }): Promise<HuntOutcomeView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { huntCatalogue, catalogue, clock } = this.dependencies;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const hunt = await this.dependencies.hunts.findHunt(actor.playerId);
      if (hunt === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "No fight is planned");
      if (hunt.status !== "OPEN") return { hunts: await huntsView(this.dependencies, actor.playerId, now, hunt), battle: null, bounty: null };
      const state = await readFleet(this.dependencies, actor.playerId);
      const ship = fleetShips(catalogue, actor.playerId, state.stored).find((entry) => entry.shipId === hunt.shipId) ?? null;
      if (ship === null || ship.record === null || ship.record.version !== hunt.shipVersion) {
        // The ship is not the one that set out: the fight is void, and nothing else moves.
        const written = await this.dependencies.hunts.resolveHunt({
          playerId: actor.playerId,
          shipId: hunt.shipId,
          expectedHuntVersion: hunt.version,
          expectedShipVersion: -1,
          outcome: "VOID",
          hull: null,
          at: now,
          kill: null,
          bounty: null
        });
        if (written) return { hunts: await huntsView(this.dependencies, actor.playerId, now, null), battle: null, bounty: null };
        continue;
      }
      let battle: SeaBattleResult;
      try {
        battle = runSeaBattle(parseSetup(hunt.setupJson), command.inputs);
      } catch (error: unknown) {
        if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
        throw error;
      }
      const won = battle.outcome === "WON";
      let prepared: Awaited<ReturnType<typeof prepareReward>> | null = null;
      if (won) {
        const requestId = `hunt_${String(hunt.window)}_${String(hunt.slot)}`;
        const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([MONSTER_BOUNTY_OPERATION, actor.playerId, hunt.window, hunt.slot]));
        prepared = await prepareReward(this.dependencies, actor, {
          reward: huntCatalogue.bounty(hunt.kind, hunt.level),
          reason: "MONSTER_BOUNTY",
          operation: MONSTER_BOUNTY_OPERATION,
          referenceId: ship.shipId,
          request: { requestId, fingerprint },
          receiptContext: { kind: hunt.kind, level: hunt.level },
          now
        });
      }
      const written = await this.dependencies.hunts.resolveHunt({
        playerId: actor.playerId,
        shipId: ship.shipId,
        expectedHuntVersion: hunt.version,
        expectedShipVersion: ship.record.version,
        outcome: battle.outcome,
        hull: battle.playerHull,
        at: now,
        kill: won ? { window: hunt.window, slot: hunt.slot, kind: hunt.kind, level: hunt.level } : null,
        bounty: prepared?.write ?? null
      });
      if (!written) continue;
      const decided: MonsterHuntRecord = { ...hunt, status: battle.outcome, version: hunt.version + 1, updatedAt: now };
      return { hunts: await huntsView(this.dependencies, actor.playerId, now, decided), battle, bounty: prepared?.view ?? null };
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The hunt changed while fighting");
  }
}

export interface MergeView {
  readonly from: { readonly itemDefinitionId: string; readonly quantity: number };
  readonly to: { readonly itemDefinitionId: string; readonly quantity: number };
}

/**
 * Merges ten of a monster material into one of the next level, through the inventory service, in one
 * batch with its receipt. A retried request answers from its receipt.
 */
export class MergeMaterials {
  constructor(private readonly dependencies: HuntDependencies) {}

  async execute(actor: ActorContext | null, command: { readonly itemDefinitionId: string; readonly requestId: string }): Promise<MergeView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const { huntCatalogue, inventory, inventoryService, idempotency, fingerprints, clock } = this.dependencies;
    const target = huntCatalogue.mergeInto(command.itemDefinitionId);
    if (target === null) throw new ApplicationError("INVALID_INPUT", "That material does not merge");
    const fingerprint = await fingerprints.hash(JSON.stringify([MATERIAL_MERGE_OPERATION, command.itemDefinitionId]));
    const existing = await idempotency.find(actor.playerId, MATERIAL_MERGE_OPERATION, command.requestId);
    if (existing !== null) {
      if (existing.payloadFingerprint !== fingerprint) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
      return JSON.parse(existing.responseJson) as MergeView;
    }
    const count = huntCatalogue.mergeCount;
    for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
      const now = clock.now();
      const from = await inventory.find(actor.playerId, parseItemDefinitionId(command.itemDefinitionId));
      if (from === null || from.quantity < count) throw new ApplicationError("INSUFFICIENT_ITEMS", `Merging takes ${String(count)}`);
      const to: InventoryItem | null = await inventory.find(actor.playerId, parseItemDefinitionId(target));
      const result: MergeView = {
        from: { itemDefinitionId: command.itemDefinitionId, quantity: from.quantity - count },
        to: { itemDefinitionId: target, quantity: (to?.quantity ?? 0) + 1 }
      };
      const receipt: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: MATERIAL_MERGE_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: command.itemDefinitionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: now
      };
      try {
        await this.dependencies.hunts.mergeAtomically(
          {
            playerId: actor.playerId,
            removal: inventoryService.prepareRemoval(actor.playerId, command.itemDefinitionId, count),
            addition: inventoryService.prepareAddition(actor.playerId, target, 1),
            expectedFrom: from,
            expectedTo: to
          },
          receipt
        );
        return result;
      } catch (error: unknown) {
        const raced = await idempotency.find(actor.playerId, MATERIAL_MERGE_OPERATION, command.requestId);
        if (raced !== null) return JSON.parse(raced.responseJson) as MergeView;
        if (error instanceof ApplicationError && error.code === "ECONOMY_CONFLICT") continue;
        throw error;
      }
    }
    throw new ApplicationError("CONFLICT_STALE_STATE", "The materials changed while merging");
  }
}
