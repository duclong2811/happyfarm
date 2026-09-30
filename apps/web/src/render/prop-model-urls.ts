import barrelUrl from "../assets/models/props/prop_barrel.glb?url";
import barrelApplesUrl from "../assets/models/props/prop_barrel_apples.glb?url";
import crateWoodenUrl from "../assets/models/props/prop_crate_wooden.glb?url";
import crateProduceUrl from "../assets/models/props/prop_crate_produce.glb?url";
import crateCarrotUrl from "../assets/models/props/prop_crate_carrot.glb?url";
import crateEmptyUrl from "../assets/models/props/prop_crate_empty.glb?url";
import sackUrl from "../assets/models/props/prop_sack.glb?url";
import bucketUrl from "../assets/models/props/prop_bucket.glb?url";
import benchUrl from "../assets/models/props/prop_bench.glb?url";
import stallUrl from "../assets/models/props/prop_stall.glb?url";
import stallCartUrl from "../assets/models/props/prop_stall_cart.glb?url";
import ropeUrl from "../assets/models/props/prop_rope.glb?url";
import lanternUrl from "../assets/models/props/prop_lantern.glb?url";
import planterUrl from "../assets/models/props/prop_planter.glb?url";
import axeUrl from "../assets/models/props/prop_axe.glb?url";
import anvilLogUrl from "../assets/models/props/prop_anvil_log.glb?url";
import workbenchUrl from "../assets/models/props/prop_workbench.glb?url";
import chestUrl from "../assets/models/props/prop_chest.glb?url";
import cageSmallUrl from "../assets/models/props/prop_cage_small.glb?url";
import whetstoneUrl from "../assets/models/props/prop_whetstone.glb?url";
import crateUrl from "../assets/models/props/prop_crate.glb?url";
import wagonUrl from "../assets/models/props/prop_wagon.glb?url";
import fenceRailUrl from "../assets/models/props/prop_fence_rail.glb?url";
import fenceRailLongUrl from "../assets/models/props/prop_fence_rail_long.glb?url";

/**
 * The set-dressing vocabulary: one entry per model the island may place as a *placed prop*.
 *
 * This is deliberately not the scenery manifest. Scenery is a scatter - a kind, a tier, and a roll
 * that picks one of a family - and a composition is the opposite: an authored object at an authored
 * spot, whose identity has to be exact, because "a barrel by the door" is a decision and "a prop of
 * kind prop" is not. Every id here is imported from a verified CC0 source, normalized by
 * `tools/asset-pipeline/node/import-cc0.mjs` to **one world unit across its largest dimension with
 * its base on y = 0**, so `sizeWorld` is a real measurement rather than a fudge factor.
 *
 * The world definition never names a `.glb`: it names one of these ids, and this file is the only
 * place the file behind it appears.
 */
export interface PropModelEntry {
  readonly id: string;
  readonly url: string;
  /** The prop's largest dimension in world metres. */
  readonly sizeWorld: number;
  /** Which composition roles this model is allowed to fill, so a prop cannot be used by accident. */
  readonly role: "FARM" | "CIVIC" | "FORESTRY" | "FISHERY" | "GENERIC";
}

export const PROP_MODELS: ReadonlyMap<string, PropModelEntry> = new Map(
  (
    [
      { id: "prop_barrel", url: barrelUrl, sizeWorld: 0.95, role: "GENERIC" },
      { id: "prop_barrel_apples", url: barrelApplesUrl, sizeWorld: 0.95, role: "FARM" },
      { id: "prop_crate_wooden", url: crateWoodenUrl, sizeWorld: 0.7, role: "GENERIC" },
      { id: "prop_crate_produce", url: crateProduceUrl, sizeWorld: 0.68, role: "FARM" },
      { id: "prop_crate_carrot", url: crateCarrotUrl, sizeWorld: 0.68, role: "FARM" },
      { id: "prop_crate_empty", url: crateEmptyUrl, sizeWorld: 0.62, role: "GENERIC" },
      { id: "prop_sack", url: sackUrl, sizeWorld: 0.8, role: "FARM" },
      { id: "prop_bucket", url: bucketUrl, sizeWorld: 0.42, role: "GENERIC" },
      { id: "prop_bench", url: benchUrl, sizeWorld: 1.5, role: "CIVIC" },
      { id: "prop_stall", url: stallUrl, sizeWorld: 2.6, role: "CIVIC" },
      { id: "prop_stall_cart", url: stallCartUrl, sizeWorld: 2.9, role: "CIVIC" },
      { id: "prop_rope", url: ropeUrl, sizeWorld: 0.5, role: "FISHERY" },
      { id: "prop_lantern", url: lanternUrl, sizeWorld: 0.55, role: "CIVIC" },
      { id: "prop_planter", url: planterUrl, sizeWorld: 0.75, role: "CIVIC" },
      { id: "prop_axe", url: axeUrl, sizeWorld: 0.8, role: "FORESTRY" },
      { id: "prop_anvil_log", url: anvilLogUrl, sizeWorld: 1.2, role: "FORESTRY" },
      { id: "prop_workbench", url: workbenchUrl, sizeWorld: 1.9, role: "FORESTRY" },
      { id: "prop_chest", url: chestUrl, sizeWorld: 0.9, role: "GENERIC" },
      { id: "prop_cage_small", url: cageSmallUrl, sizeWorld: 0.95, role: "FISHERY" },
      { id: "prop_whetstone", url: whetstoneUrl, sizeWorld: 0.65, role: "FORESTRY" },
      // The two props the medieval kit already contributed: kept in the same vocabulary so a preset
      // does not have to know which pack a barrel came from.
      { id: "prop_crate", url: crateUrl, sizeWorld: 0.75, role: "GENERIC" },
      { id: "prop_wagon", url: wagonUrl, sizeWorld: 2.2, role: "FARM" },
      { id: "prop_fence_rail", url: fenceRailUrl, sizeWorld: 1.3, role: "GENERIC" },
      { id: "prop_fence_rail_long", url: fenceRailLongUrl, sizeWorld: 2.1, role: "GENERIC" }
    ] as const
  ).map((entry) => [entry.id, entry])
);

/** Every prop model the client may load, in a stable order: what a test walks to prove they ship. */
export const PROP_MODEL_IDS: readonly string[] = [...PROP_MODELS.keys()].sort();

/** The file behind a prop id. The renderer asks by id and never by file name. */
export const PROP_MODEL_URL_BY_ID: ReadonlyMap<string, string> = new Map(
  [...PROP_MODELS.values()].map((entry) => [entry.id, entry.url])
);
