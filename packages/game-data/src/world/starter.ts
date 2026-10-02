/**
 * The starter arrangement: what the island already holds when a farm begins.
 *
 * **The starter map is a starting arrangement, not a permanent map.** These placements are the first
 * arrangement of the island; every one of them becomes an ordinary editable object the moment the
 * farm exists, and the player may move, turn, store or remove it. Nothing here is re-applied after
 * seeding - the rows are the truth from then on - which is what stops a removed tree from growing
 * back on the next reload.
 *
 * `key` is the placement's *identity*, not its position: `starter.tree.west.03` stays that tree
 * wherever the player moves it, which is why the key is a name and never a coordinate. The unique
 * `(farm, key)` pair is what makes seeding idempotent: run it twice and the second run inserts
 * nothing.
 */

import { HARBOUR, tileToWorld } from "./geography";
import type { TileCoordinate } from "./tiles";
import { STARTER_WORLD_PLACEMENTS_V2 } from "./starter-v2";

/**
 * The version of this arrangement.
 *
 * It is *additive*, and V13.3.1 is the first test of that: version 1 was the mill and a ring of
 * authored vegetation, version 2 is the procedural forest, the authored buildings and the set
 * dressing. A farm already stamped 1 is given only the version-2 placements; a farm at 0 gets both.
 * Nothing is ever replayed, so an object the player moved is never put back where it started.
 */
export const STARTER_WORLD_VERSION = 2;

export interface StarterPlacement {
  /** Stable identity of the placement, unique within a farm and unchanged by editing. */
  readonly key: string;
  readonly definitionId: string;
  /** The seed version this placement arrived in: what makes the arrangement additive. */
  readonly version: number;
  readonly tile: TileCoordinate;
  /** Quarter turns, the one rotation vocabulary the whole game uses. */
  readonly rotation: 0 | 1 | 2 | 3;
  /**
   * The facing the island drew this object at, on top of its quarter turns, in radians.
   *
   * The authored arrangement is not on a 90-degree lattice - a shed at 0.4 radians, a quay facing the
   * bay - and rounding it would visibly turn buildings after a migration that is supposed to be
   * invisible. The player's own rotation stays whole quarter turns; this is where the island's
   * original facing is written down.
   */
  readonly baseYaw?: number;
  /** The model this particular object draws, when its family has more than one. */
  readonly modelId?: string;
  /** How large that model is drawn, in world metres. */
  readonly sizeWorld?: number;
}

/** A placement as it is authored: everything but the version its table stamps on it. */
export type StarterPlacementInput = Omit<StarterPlacement, "version">;

/**
 * The mill the island starts with.
 *
 * Authored where the island has always put it - the upland north-west of the village - and handed to
 * the player as an ordinary object rather than a protected landmark, because there is no system
 * reason for the one building that makes flour to be permanent. Rotation is a quarter turn of the
 * model (0.35 radians rounds to 0), which is the vocabulary every other object is turned by.
 */
const STARTER_WINDMILL: StarterPlacementInput = {
  key: "starter.windmill.01",
  definitionId: "world.windmill",
  tile: { x: -16, y: -13 },
  rotation: 0
};

/**
 * The trees, rocks, bushes and flowers the island starts with, in bands around the starter field.
 *
 * Deliberately *outside* the plot reservation: the 36x36 square the catalogue sells is land the
 * player may buy later, and a starter tree standing in the middle of an unsold plot would be an
 * obstacle to the purchase rather than a thing to play with. They sit on open ground instead - west of
 * the fence, south of the gate, and on the north shoulder - which is also where the scenery pass is
 * told to keep clear of them, so nothing is drawn twice.
 */
const STARTER_PLANTING: readonly StarterPlacementInput[] = [
  // The western verge: a mixed line of broadleaf and pine down the field's west side. Everything west
  // of x = 0 is outside the plot reservation, so these stand on open ground the player already has
  // around their field rather than in the middle of land the catalogue has not sold yet.
  { key: "starter.tree.west.01", definitionId: "world.tree_broad", tile: { x: -4, y: -1 }, rotation: 0 },
  { key: "starter.tree.west.02", definitionId: "world.tree_pine", tile: { x: -6, y: 2 }, rotation: 1 },
  { key: "starter.tree.west.03", definitionId: "world.tree_broad", tile: { x: -4, y: 5 }, rotation: 2 },
  { key: "starter.tree.west.04", definitionId: "world.tree_pine", tile: { x: -7, y: 8 }, rotation: 3 },
  { key: "starter.tree.west.05", definitionId: "world.tree_broad", tile: { x: -5, y: 11 }, rotation: 0 },
  { key: "starter.bush.west.01", definitionId: "world.bush", tile: { x: -3, y: 1 }, rotation: 0 },
  { key: "starter.bush.west.02", definitionId: "world.bush", tile: { x: -3, y: 3 }, rotation: 1 },
  { key: "starter.bush.west.03", definitionId: "world.bush", tile: { x: -9, y: 5 }, rotation: 2 },
  { key: "starter.flowers.west.01", definitionId: "world.flowers", tile: { x: -2, y: 0 }, rotation: 0 },
  { key: "starter.flowers.west.02", definitionId: "world.flowers", tile: { x: -2, y: 4 }, rotation: 2 },
  { key: "starter.flowers.west.03", definitionId: "world.flowers", tile: { x: -6, y: 6 }, rotation: 1 },
  { key: "starter.grass.west.01", definitionId: "world.grass_clump", tile: { x: -8, y: 3 }, rotation: 0 },
  { key: "starter.grass.west.02", definitionId: "world.grass_clump", tile: { x: -8, y: 9 }, rotation: 2 },
  { key: "starter.rock.west.01", definitionId: "world.rock", tile: { x: -11, y: 7 }, rotation: 1 },
  { key: "starter.rock.west.02", definitionId: "world.rock", tile: { x: -3, y: 9 }, rotation: 3 },

  // The northern shoulder: the band between the field's north edge and the mountain's foot, which the
  // terrain map shows as a clean strip of ordinary land all the way across.
  { key: "starter.tree.north.01", definitionId: "world.tree_pine", tile: { x: -2, y: -3 }, rotation: 2 },
  { key: "starter.tree.north.02", definitionId: "world.tree_broad", tile: { x: 2, y: -2 }, rotation: 0 },
  { key: "starter.tree.north.03", definitionId: "world.tree_pine", tile: { x: 6, y: -3 }, rotation: 1 },
  { key: "starter.tree.north.04", definitionId: "world.tree_broad", tile: { x: 10, y: -2 }, rotation: 3 },
  { key: "starter.bush.north.01", definitionId: "world.bush", tile: { x: 0, y: -1 }, rotation: 1 },
  { key: "starter.bush.north.02", definitionId: "world.bush", tile: { x: 4, y: -1 }, rotation: 2 },
  { key: "starter.flowers.north.01", definitionId: "world.flowers", tile: { x: -1, y: -2 }, rotation: 0 },
  { key: "starter.flowers.north.02", definitionId: "world.flowers", tile: { x: 8, y: -1 }, rotation: 1 },
  { key: "starter.grass.north.01", definitionId: "world.grass_clump", tile: { x: 3, y: -3 }, rotation: 0 },
  { key: "starter.rock.north.01", definitionId: "world.rock", tile: { x: -4, y: -3 }, rotation: 2 },

  // Further west, so the open country reads as inhabited rather than as a ring drawn around the field.
  { key: "starter.tree.far.01", definitionId: "world.tree_broad", tile: { x: -13, y: -2 }, rotation: 1 },
  { key: "starter.tree.far.02", definitionId: "world.tree_pine", tile: { x: -16, y: 3 }, rotation: 0 },
  { key: "starter.tree.far.03", definitionId: "world.tree_broad", tile: { x: -14, y: 9 }, rotation: 2 },
  { key: "starter.tree.far.04", definitionId: "world.tree_pine", tile: { x: -20, y: 6 }, rotation: 3 },
  { key: "starter.tree.far.05", definitionId: "world.tree_broad", tile: { x: -18, y: -6 }, rotation: 0 },
  { key: "starter.tree.far.06", definitionId: "world.tree_pine", tile: { x: -12, y: -8 }, rotation: 1 },
  { key: "starter.bush.far.01", definitionId: "world.bush", tile: { x: -15, y: 0 }, rotation: 2 },
  { key: "starter.bush.far.02", definitionId: "world.bush", tile: { x: -21, y: 10 }, rotation: 0 },
  { key: "starter.flowers.far.01", definitionId: "world.flowers", tile: { x: -17, y: -3 }, rotation: 1 },
  { key: "starter.grass.far.01", definitionId: "world.grass_clump", tile: { x: -22, y: 3 }, rotation: 0 },
  { key: "starter.rock.far.01", definitionId: "world.rock", tile: { x: -19, y: 12 }, rotation: 3 }
];

/** Version 1: the arrangement V13.3 shipped. */
const STARTER_WORLD_PLACEMENTS_V1: readonly StarterPlacement[] = [STARTER_WINDMILL, ...STARTER_PLANTING].map(
  (placement) => ({ ...placement, version: 1 })
);

/**
 * Every placement the starter arrangement holds, in a stable order: version 1, then version 2.
 *
 * The order is what lets the seeder take a slice - everything with a version above the farm's own -
 * rather than replaying the whole map. See `starter-v2.ts` for the promoted island.
 */
export const STARTER_WORLD_PLACEMENTS: readonly StarterPlacement[] = [
  ...STARTER_WORLD_PLACEMENTS_V1,
  ...STARTER_WORLD_PLACEMENTS_V2
];

/** The world position of a placement, through the one tile mapping. */
export function starterWorldPosition(placement: StarterPlacement): { readonly worldX: number; readonly worldZ: number } {
  return tileToWorld(placement.tile);
}

/** The harbour's own tile, so a starter placement can be checked against it without re-deriving it. */
export const STARTER_HARBOUR_ROOT = HARBOUR.root;
