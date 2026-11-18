import type { FarmId } from "@happy-farm/domain";
import type { LandSaleLookup, TileTerrainLookup, WorkAreaGroundLookup } from "./ports";

/**
 * The geography of one farm's own island.
 *
 * Every placement, planting and work-area rule that knows its farm resolves the ground through
 * these, so a farm on a chosen Home Island is judged by *its* coast, rock and shallows and a farm on
 * the hand-composed island by that one. Resolve once per command and reuse the result for every
 * cell the command touches.
 */
export async function terrainForFarm(lookup: TileTerrainLookup, farmId: FarmId): Promise<TileTerrainLookup> {
  return lookup.forFarm === undefined ? lookup : lookup.forFarm(farmId);
}

export async function landSaleForFarm(lookup: LandSaleLookup, farmId: FarmId): Promise<LandSaleLookup> {
  return lookup.forFarm === undefined ? lookup : lookup.forFarm(farmId);
}

export async function workGroundForFarm(lookup: WorkAreaGroundLookup, farmId: FarmId): Promise<WorkAreaGroundLookup> {
  return lookup.forFarm === undefined ? lookup : lookup.forFarm(farmId);
}

/**
 * What one area group resolves once and every cell in it shares: the checks that cannot differ from
 * cell to cell within one request (the actor owns the farm and, for crops, controls their character), the farm's
 * ground, and the planter's level. Planting spends no experience, so the level cannot fall during
 * the group; a concurrent harvest can only raise it.
 *
 * It is bound to the actor and farm it was prepared for, and a cell planted with any other is refused.
 */
export interface PlantAreaContext {
  readonly actorPlayerId: string;
  readonly farmId: FarmId;
  readonly terrain: TileTerrainLookup;
  readonly level: number;
}

/** What an area harvest checked once for the whole group; bound to the actor and farm it checked. */
export interface HarvestAreaContext {
  readonly actorPlayerId: string;
  readonly farmId: FarmId;
}
