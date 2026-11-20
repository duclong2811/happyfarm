/**
 * Where the roster's sea monsters lie in the home waters (docs/design/FLEET.md, F3), for the 3D view
 * and the helm. Presentation only: which monsters surface, their levels and every fight are the
 * server's (`/hunts`); this module only spreads them round the island so each can be sailed up to.
 */

/** How close to a lair, in tiles, the helm offers the fight. */
export const MONSTER_REACH = 14;

/** Where a monster lairs, in island tiles: in open water a little off the island, away from the pier. */
export interface MonsterLair {
  readonly x: number;
  readonly y: number;
  /** The way it faces, as a heading (angle from +x toward +y). */
  readonly heading: number;
}

/** How far past the island's grid the first lair lies, and how much farther out each next one. */
const LAIR_OFFSET = 12;
const LAIR_STEP = 4;

/**
 * The lairs of a roster of `count` monsters, slot by slot, from the island's own seed: spread evenly
 * round the island, a dozen tiles or more past the edge of its grid (open water on every island). With
 * a pier, the spread is turned so the pier falls between two lairs: a ship leaving it does not sail
 * straight into a monster. The same island always gives the same lairs.
 */
export function monsterLairs(island: { readonly size: number; readonly originX: number; readonly originY: number; readonly seed: number }, pier: { readonly x: number; readonly y: number } | null, count: number): MonsterLair[] {
  const half = (island.size - 1) / 2;
  const centre = { x: island.originX + half, y: island.originY + half };
  const spacing = (Math.PI * 2) / Math.max(1, count);
  const base = pier === null ? (((island.seed * 2654435761) >>> 0) / 4294967296) * Math.PI * 2 : Math.atan2(pier.y - centre.y, pier.x - centre.x) + spacing / 2;
  const lairs: MonsterLair[] = [];
  for (let slot = 0; slot < count; slot += 1) {
    const bearing = base + slot * spacing;
    const distance = half + LAIR_OFFSET + (slot % 3) * LAIR_STEP;
    lairs.push({
      x: centre.x + Math.cos(bearing) * distance,
      y: centre.y + Math.sin(bearing) * distance,
      // It lies across the bearing, coiled round the island.
      heading: bearing + Math.PI / 2
    });
  }
  return lairs;
}

/** Whether a ship at (x, y) is close enough to a lair to be offered the fight. */
export function nearMonster(at: { readonly x: number; readonly y: number }, lair: MonsterLair): boolean {
  return Math.hypot(at.x - lair.x, at.y - lair.y) <= MONSTER_REACH;
}

/** How long each kind is drawn at level 1, in world units; a level up draws it a sixth larger. */
const DRAWN_LENGTH: Readonly<Record<string, number>> = {
  monster_thuong_luong: 14,
  monster_bach_tuoc: 11,
  monster_cua_da: 10,
  monster_kinh_ngu: 15,
  monster_sua_lua: 8
};

export function monsterDrawnLength(monsterId: string, level: number): number {
  return (DRAWN_LENGTH[monsterId] ?? 12) * (1 + (Math.max(1, level) - 1) / 6);
}
