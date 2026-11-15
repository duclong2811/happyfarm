import type { FarmId } from "./ids";

/**
 * A farm's chosen Home Island, as stored.
 *
 * The domain only carries it: what the cells mean and how they were generated belongs to game data,
 * which the host hands to the application as a port. Element, outline and site kinds are stable ids
 * (`KIM`, `ATOLL`, `ORE`), never display names.
 */
export interface FarmIslandSite {
  readonly kind: string;
  readonly x: number;
  readonly y: number;
}

/** What a player picks when the farm is created. Nothing else about the island is theirs to send. */
export interface IslandChoice {
  readonly element: string;
  readonly outline: string;
  readonly seed: number;
}

export interface FarmIslandGround extends IslandChoice {
  readonly generatorVersion: number;
  readonly size: number;
  readonly originX: number;
  readonly originY: number;
  /** Row-major cell codes, `size * size` long. */
  readonly cells: string;
  readonly sites: readonly FarmIslandSite[];
  readonly revision: number;
}

export interface FarmIsland extends FarmIslandGround {
  readonly farmId: FarmId;
  readonly createdAt: string;
}
