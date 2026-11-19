/**
 * Pirates and their ambushes (docs/design/NAVAL.md, W5c).
 *
 * Owner decision, 2026-11-19: pirates ambush voyages at random; losing damages the ship, which costs
 * gold and wood to repair. The numbers below are a first proposal for the owner to tune; they are
 * game data and are changed here, never in code.
 */

/** A ship's fighting numbers in the sea-battle simulation (packages/domain/src/sea-battle.ts). */
export interface BattleShipNumbers {
  /** Units a second at full sail. */
  readonly speed: number;
  /** Heading units (of 4096 a turn) a tick at full rudder. */
  readonly turn: number;
  readonly radius: number;
  /** How wide a broadside scatters, heading units either side. */
  readonly spread: number;
}

/** What sinking one pirate ship pays: gold, materials for the warehouse, and experience. */
export interface PirateBounty {
  readonly gold: number;
  readonly wood: number;
  readonly ore: number;
  readonly xp: number;
}

export interface PirateShipDefinition {
  /** Stable id, `pirate_<name>`. */
  readonly id: string;
  readonly hull: number;
  readonly cannons: number;
  readonly battle: BattleShipNumbers;
  /** Paid for this ship only when the whole fight is won (`ambushBounty`). */
  readonly bounty: PirateBounty;
}

/**
 * Bounties: the owner chose the generous scale (2026-11-19), twice the first proposal, so a won
 * fight clearly pays for the repairs it costs and then some.
 */
export const PIRATE_SHIPS: readonly PirateShipDefinition[] = [
  { id: "pirate_cutter", hull: 80, cannons: 2, battle: { speed: 8, turn: 12, radius: 4, spread: 90 }, bounty: { gold: 160, wood: 40, ore: 0, xp: 60 } },
  { id: "pirate_raider", hull: 220, cannons: 6, battle: { speed: 9, turn: 11, radius: 5.5, spread: 70 }, bounty: { gold: 500, wood: 120, ore: 40, xp: 180 } },
  { id: "pirate_corsair", hull: 450, cannons: 10, battle: { speed: 10, turn: 9, radius: 6.5, spread: 60 }, bounty: { gold: 1200, wood: 240, ore: 120, xp: 400 } }
];

/** The player's ship classes as fighters, by class id. The rowboat carries no guns and is never ambushed. */
export const SHIP_BATTLE_NUMBERS: Readonly<Record<string, BattleShipNumbers>> = {
  ship_class_rowboat: { speed: 6, turn: 16, radius: 3, spread: 60 },
  ship_class_sloop: { speed: 9, turn: 14, radius: 4.5, spread: 40 },
  ship_class_brig: { speed: 10, turn: 12, radius: 5.5, spread: 32 },
  ship_class_frigate: { speed: 11, turn: 10, radius: 6.5, spread: 26 }
};

/** The chance of an ambush grows with the voyage's length, to this cap. */
export const AMBUSH_CHANCE_PER_TILE = 1 / 2000;
export const AMBUSH_CHANCE_MAX = 0.5;
/** An ambush strikes between these shares of the voyage's time. */
export const AMBUSH_EARLIEST = 0.3;
export const AMBUSH_LATEST = 0.7;

/** Who attacks a ship of each tier, by a roll in [0, 1): the first band the roll falls under. */
export const AMBUSH_PARTIES: Readonly<Record<number, readonly { readonly under: number; readonly pirates: readonly string[] }[]>> = {
  2: [
    { under: 0.8, pirates: ["pirate_cutter"] },
    { under: 1, pirates: ["pirate_cutter", "pirate_cutter"] }
  ],
  3: [
    { under: 0.5, pirates: ["pirate_raider"] },
    { under: 1, pirates: ["pirate_cutter", "pirate_cutter"] }
  ],
  4: [
    { under: 0.5, pirates: ["pirate_corsair"] },
    { under: 1, pirates: ["pirate_raider", "pirate_cutter"] }
  ]
};

/** What mending a ship costs, per hull point it is missing. */
export const SHIP_REPAIR_GOLD_PER_HULL = 2;
export const SHIP_REPAIR_WOOD_PER_HULL = 0.25;

/** FNV-1a, 32 bits: a stable hash of a string, the same on every engine. */
export function stableHash(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

export interface AmbushPlan {
  /** Share of the voyage's time at which it strikes. */
  readonly atShare: number;
  readonly seed: number;
  readonly pirates: readonly string[];
}

/**
 * Whether pirates strike a voyage, and how. Decided by the route, the day and the player, so sailing
 * home and setting out again on the same route the same day meets the same fate: there is nothing to
 * gain by trying again. A ship with no guns is never worth ambushing.
 */
export function planAmbush(input: {
  readonly playerId: string;
  readonly fromSlotId: string;
  readonly toSlotId: string;
  readonly day: string;
  readonly distanceTiles: number;
  readonly shipTier: number;
}): AmbushPlan | null {
  const parties = AMBUSH_PARTIES[input.shipTier];
  if (parties === undefined) return null;
  const key = `${input.playerId}|${input.fromSlotId}|${input.toSlotId}|${input.day}`;
  const roll = (salt: string): number => stableHash(`${key}|${salt}`) / 4294967296;
  const chance = Math.min(AMBUSH_CHANCE_MAX, input.distanceTiles * AMBUSH_CHANCE_PER_TILE);
  if (roll("strike") >= chance) return null;
  const pick = roll("party");
  const party = parties.find((band) => pick < band.under) ?? parties[parties.length - 1];
  if (party === undefined) return null;
  return {
    atShare: AMBUSH_EARLIEST + roll("when") * (AMBUSH_LATEST - AMBUSH_EARLIEST),
    seed: stableHash(`${key}|seed`),
    pirates: party.pirates
  };
}

/**
 * What winning a fight against `pirates` pays: every ship's bounty, summed. Only a won fight pays;
 * a fight lost or fled pays nothing (the caller decides that, from the server's own replay).
 */
export function ambushBounty(pirates: readonly string[]): PirateBounty {
  return pirates.reduce<PirateBounty>(
    (total, id) => {
      const ship = pirateShip(id);
      if (ship === null) throw new Error(`Unknown pirate ship ${id}`);
      return {
        gold: total.gold + ship.bounty.gold,
        wood: total.wood + ship.bounty.wood,
        ore: total.ore + ship.bounty.ore,
        xp: total.xp + ship.bounty.xp
      };
    },
    { gold: 0, wood: 0, ore: 0, xp: 0 }
  );
}

export function pirateShip(id: string): PirateShipDefinition | null {
  return PIRATE_SHIPS.find((entry) => entry.id === id) ?? null;
}
