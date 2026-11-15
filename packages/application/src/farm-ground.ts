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
