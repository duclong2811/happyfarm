import { stableHash } from "../pirates";

/**
 * Sea monsters (docs/design/FLEET.md, F3; the owner's design, 2026-11-20).
 *
 * Five kinds, each with its own material; three levels of each. Every four hours three monsters of
 * three different kinds surface in a player's home waters, their kinds and levels decided by the
 * player and the window, never by a client. A won fight pays like a pirate's bounty and drops the
 * monster's material at its level. Ten materials of one kind and level merge into one of the next
 * level, and every ship upgrade needs all five kinds.
 *
 * The numbers are Claude's balance at the owner's request; they are game data and are tuned here.
 */

export const MONSTER_KINDS = ["thuong_luong", "bach_tuoc", "cua_da", "kinh_ngu", "sua_lua"] as const;
export type MonsterKind = (typeof MONSTER_KINDS)[number];

export interface MonsterKindDefinition {
  readonly kind: MonsterKind;
  /** The model and the battle's name for it: `monster_<kind>`. */
  readonly id: string;
  /** Its material's stem: `item_monster_<material>_<level>`. */
  readonly material: string;
  /** Rams (`BEAST`), or keeps its distance and spits fire like a gun (`SHIP`). */
  readonly behaviour: "BEAST" | "SHIP";
  /** Level 1's numbers; the levels above scale them. */
  readonly hull: number;
  readonly cannons: number;
  readonly speed: number;
  readonly turn: number;
  readonly radius: number;
  readonly spread: number;
}

export const MONSTER_KIND_DEFINITIONS: readonly MonsterKindDefinition[] = [
  // Thuồng luồng: the water serpent - quick, nimble, rams.
  { kind: "thuong_luong", id: "monster_thuong_luong", material: "scale", behaviour: "BEAST", hull: 100, cannons: 0, speed: 8, turn: 15, radius: 6, spread: 0 },
  // Bạch tuộc khổng lồ: the giant octopus - slow, heavy, rams hard.
  { kind: "bach_tuoc", id: "monster_bach_tuoc", material: "tentacle", behaviour: "BEAST", hull: 110, cannons: 0, speed: 7.2, turn: 11, radius: 6.5, spread: 0 },
  // Cua đá khổng lồ: the giant rock crab - armoured, turns slowly.
  { kind: "cua_da", id: "monster_cua_da", material: "shell", behaviour: "BEAST", hull: 105, cannons: 0, speed: 5.6, turn: 12, radius: 5.5, spread: 0 },
  // Kình ngư: the leviathan fish - the fastest rammer of all.
  { kind: "kinh_ngu", id: "monster_kinh_ngu", material: "bone", behaviour: "BEAST", hull: 100, cannons: 0, speed: 9.5, turn: 12, radius: 6.5, spread: 0 },
  // Sứa lửa: the fire jellyfish - slow, keeps off and spits fire like a pair of guns.
  { kind: "sua_lua", id: "monster_sua_lua", material: "pearl", behaviour: "SHIP", hull: 80, cannons: 2, speed: 5, turn: 12, radius: 5, spread: 70 }
];

export interface MonsterLevelDefinition {
  readonly level: number;
  /** The player level from which monsters of this level surface. */
  readonly minPlayerLevel: number;
  readonly hullScale: number;
  readonly speedBonus: number;
  readonly radiusBonus: number;
  /** Fire-spitters get more "guns" as they grow. */
  readonly extraCannons: number;
  /** How many of its material a won fight drops, at this level. */
  readonly drop: number;
  readonly bounty: { readonly gold: number; readonly wood: number; readonly ore: number; readonly xp: number };
}

export const MONSTER_LEVELS: readonly MonsterLevelDefinition[] = [
  { level: 1, minPlayerLevel: 1, hullScale: 1, speedBonus: 0, radiusBonus: 0, extraCannons: 0, drop: 3, bounty: { gold: 80, wood: 20, ore: 10, xp: 40 } },
  { level: 2, minPlayerLevel: 25, hullScale: 2, speedBonus: 0.6, radiusBonus: 0.3, extraCannons: 1, drop: 2, bounty: { gold: 250, wood: 60, ore: 30, xp: 120 } },
  { level: 3, minPlayerLevel: 45, hullScale: 3.2, speedBonus: 1.2, radiusBonus: 0.6, extraCannons: 2, drop: 2, bounty: { gold: 700, wood: 150, ore: 90, xp: 300 } }
];

/** How long a roster lasts: a new one surfaces every four hours. */
export const HUNT_WINDOW_SECONDS = 4 * 60 * 60;
/** How many monsters a roster holds, each of a different kind. */
export const HUNT_ROSTER_SIZE = 3;
/** How many materials of one kind and level merge into one of the next level. */
export const MATERIAL_MERGE_COUNT = 10;
/** How many of each kind a ship upgrade takes, at the level its rank asks for. */
export const UPGRADE_MATERIAL_EACH = 2;

export function monsterKind(kind: string): MonsterKindDefinition | null {
  return MONSTER_KIND_DEFINITIONS.find((entry) => entry.kind === kind) ?? null;
}

export function monsterLevel(level: number): MonsterLevelDefinition | null {
  return MONSTER_LEVELS.find((entry) => entry.level === level) ?? null;
}

export const MAX_MONSTER_LEVEL = MONSTER_LEVELS.length;

/** A material's item id: `item_monster_<material>_<level>`. */
export function monsterMaterialId(kind: MonsterKind, level: number): string {
  const definition = monsterKind(kind);
  if (definition === null || monsterLevel(level) === null) throw new Error(`No material for ${kind} at level ${String(level)}`);
  return `item_monster_${definition.material}_${String(level)}`;
}

/** Every material, kind by kind, level by level. */
export const MONSTER_MATERIAL_IDS: readonly string[] = MONSTER_KINDS.flatMap((kind) => MONSTER_LEVELS.map((entry) => monsterMaterialId(kind, entry.level)));

/** A material id back to its kind and level, or null for anything else. */
export function parseMonsterMaterial(itemDefinitionId: string): { readonly kind: MonsterKind; readonly level: number } | null {
  const match = /^item_monster_([a-z]+)_([0-9]+)$/.exec(itemDefinitionId);
  if (match === null) return null;
  const definition = MONSTER_KIND_DEFINITIONS.find((entry) => entry.material === match[1]);
  const level = Number(match[2]);
  if (definition === undefined || monsterLevel(level) === null) return null;
  return { kind: definition.kind, level };
}

/** A monster's fighting numbers at a level, as the sea-battle simulation takes them. */
export function monsterBattle(kind: MonsterKind, level: number): {
  readonly hull: number;
  readonly cannons: number;
  readonly speed: number;
  readonly turn: number;
  readonly radius: number;
  readonly spread: number;
  readonly behaviour: "BEAST" | "SHIP";
} {
  const definition = monsterKind(kind);
  const scale = monsterLevel(level);
  if (definition === null || scale === null) throw new Error(`No monster ${kind} at level ${String(level)}`);
  return {
    hull: Math.round(definition.hull * scale.hullScale),
    cannons: definition.cannons > 0 ? definition.cannons + scale.extraCannons : 0,
    speed: definition.speed + scale.speedBonus,
    turn: definition.turn,
    radius: definition.radius + scale.radiusBonus,
    spread: definition.spread,
    behaviour: definition.behaviour
  };
}

/** The four-hour window a moment falls in. */
export function huntWindow(nowMs: number): number {
  return Math.floor(nowMs / 1000 / HUNT_WINDOW_SECONDS);
}

/**
 * The monsters a player's home waters hold in a window: three of three different kinds, at levels the
 * player's level reaches and their fleet can fight - never above the rank of their strongest warship,
 * so a player with a sloop meets monsters a sloop can beat, and the materials its upgrade needs. The
 * top level open is twice as likely as each one below, so lower materials keep coming.
 *
 * Decided from the player, the window, their level and that rank alone, so every read agrees while
 * they stand. The kinds do not depend on the levels: an upgrade mid-window may lift a monster's
 * level, never change its kind, and a slot already won stays won.
 */
export function huntRoster(
  playerId: string,
  window: number,
  playerLevel: number,
  warshipRank: number
): readonly { readonly slot: number; readonly kind: MonsterKind; readonly level: number }[] {
  const roll = (salt: string): number => stableHash(`${playerId}|hunt|${String(window)}|${salt}`) / 4294967296;
  const cap = Math.max(1, warshipRank);
  const reached = MONSTER_LEVELS.filter((entry) => playerLevel >= entry.minPlayerLevel && entry.level <= cap).map((entry) => entry.level);
  const open = reached.length === 0 ? [1] : reached;
  const kinds = [...MONSTER_KINDS];
  const roster: { slot: number; kind: MonsterKind; level: number }[] = [];
  for (let slot = 0; slot < HUNT_ROSTER_SIZE; slot += 1) {
    const index = Math.floor(roll(`kind${String(slot)}`) * kinds.length);
    const kind = kinds.splice(index, 1)[0] ?? MONSTER_KINDS[0];
    const weights = open.map((_, position) => (position === open.length - 1 ? 2 : 1));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    let pick = roll(`level${String(slot)}`) * total;
    const levelIndex = weights.findIndex((weight) => (pick -= weight) < 0);
    roster.push({ slot, kind, level: open[levelIndex === -1 ? open.length - 1 : levelIndex] ?? 1 });
  }
  return roster;
}

/** What upgrading a ship to `rank` takes in materials: two of every kind, at the level the rank asks. */
export function upgradeMaterials(rank: number): Readonly<Record<string, number>> {
  if (rank < 2) return {};
  const level = Math.min(MAX_MONSTER_LEVEL, rank - 1);
  return Object.fromEntries(MONSTER_KINDS.map((kind) => [monsterMaterialId(kind, level), UPGRADE_MATERIAL_EACH]));
}
