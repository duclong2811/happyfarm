import bushLeafyUrl from "../assets/models/environment/bush_leafy.glb?url";
import bushFloweringUrl from "../assets/models/environment/bush_flowering.glb?url";
import flowerGroup1Url from "../assets/models/environment/flower_group_1.glb?url";
import flowerGroup2Url from "../assets/models/environment/flower_group_2.glb?url";
import plantCloverUrl from "../assets/models/environment/plant_clover.glb?url";
import plantFernUrl from "../assets/models/environment/plant_fern.glb?url";
import plantGrassTallUrl from "../assets/models/environment/plant_grass_tall.glb?url";
import plantGrassWispyUrl from "../assets/models/environment/plant_grass_wispy.glb?url";
import rockBoulder1Url from "../assets/models/environment/rock_boulder_1.glb?url";
import rockBoulder2Url from "../assets/models/environment/rock_boulder_2.glb?url";
import rockBoulder3Url from "../assets/models/environment/rock_boulder_3.glb?url";
import treeBroad1Url from "../assets/models/environment/tree_broad_1.glb?url";
import treeBroad2Url from "../assets/models/environment/tree_broad_2.glb?url";
import treeBroad3Url from "../assets/models/environment/tree_broad_3.glb?url";
import treeBroad4Url from "../assets/models/environment/tree_broad_4.glb?url";
import treePine1Url from "../assets/models/environment/tree_pine_1.glb?url";
import treePine2Url from "../assets/models/environment/tree_pine_2.glb?url";
import treePine3Url from "../assets/models/environment/tree_pine_3.glb?url";
import crateUrl from "../assets/models/props/prop_crate.glb?url";
import fenceRailLongUrl from "../assets/models/props/prop_fence_rail_long.glb?url";
import fenceRailUrl from "../assets/models/props/prop_fence_rail.glb?url";
import wagonUrl from "../assets/models/props/prop_wagon.glb?url";
import bushModelUrl from "../assets/models/kenney-nature/bush.glb?url";
import flowerModelUrl from "../assets/models/kenney-nature/flower.glb?url";
import pineModelUrl from "../assets/models/kenney-nature/pine.glb?url";
import rockModelUrl from "../assets/models/kenney-nature/rock.glb?url";
import treeModelUrl from "../assets/models/kenney-nature/tree.glb?url";
import type { SceneryKind, SceneryTier } from "./scenery";

/**
 * Which model draws which semantic scenery, and how far away it is meant to be used.
 *
 * The world model names a thing - a broadleaf tree, a boulder, a clover patch - and never a file.
 * This manifest is the only place a `.glb` is resolved to an id, and the renderer asks it for the
 * models a tier may use. Swapping an asset, or shipping a second variant, is an edit here.
 *
 * The tiers are the art-direction budget:
 *
 *  - `HERO` is the curated CC0 set. Its silhouettes carry the forest, the orchard, and the districts
 *    the player walks through, and it is capped by the world model so a big island cannot spend an
 *    unbounded number of triangles on detail nobody is close enough to see.
 *  - `FILLER` is the lighter Kenney set: the rim tree line, the far side of an island, and anything
 *    the estate camera sees as texture rather than as a plant. Its models are a tenth of the
 *    triangles, which is exactly what a distant tree should cost.
 *
 * Every array is ordered, and a placement picks inside one by a deterministic roll, so a forest is a
 * family of variants rather than one model repeated - and the same forest on every client.
 */
export interface EnvironmentModelEntry {
  /** The provenance id: it matches the file name, `docs/ASSET_LICENSES.md`, and the import report. */
  readonly id: string;
  readonly url: string;
  /**
   * Multiplier that turns "how tall do I want this, in world metres" into this file's own scale.
   *
   * The curated models are normalized to one world unit tall by the import pipeline, so they are 1.
   * The Kenney props are authored at their own sizes and are normalized here instead, once, rather
   * than by a magic number scattered through the renderer.
   */
  readonly unitScale: number;
}

/**
 * 1 / the largest authored extent of each Kenney model, so `instance.scale` means metres - the size
 * of the thing - for both tiers. Measured from the shipped files, not guessed.
 */
const KENNEY_UNIT_SCALE = {
  tree: 1 / 1.708,
  pine: 1 / 1.546,
  bush: 1 / 0.603,
  rock: 1 / 0.361,
  flower: 1 / 0.239
} as const;

export const ENVIRONMENT_MODELS: Readonly<
  Record<SceneryKind, Readonly<Record<SceneryTier, readonly EnvironmentModelEntry[]>>>
> = {
  tree: {
    HERO: [
      { id: "tree_broad_1", url: treeBroad1Url, unitScale: 1 },
      { id: "tree_broad_2", url: treeBroad2Url, unitScale: 1 },
      { id: "tree_broad_3", url: treeBroad3Url, unitScale: 1 },
      { id: "tree_broad_4", url: treeBroad4Url, unitScale: 1 }
    ],
    FILLER: [{ id: "kenney_tree", url: treeModelUrl, unitScale: KENNEY_UNIT_SCALE.tree }]
  },
  pine: {
    HERO: [
      { id: "tree_pine_1", url: treePine1Url, unitScale: 1 },
      { id: "tree_pine_2", url: treePine2Url, unitScale: 1 },
      { id: "tree_pine_3", url: treePine3Url, unitScale: 1 }
    ],
    FILLER: [{ id: "kenney_pine", url: pineModelUrl, unitScale: KENNEY_UNIT_SCALE.pine }]
  },
  bush: {
    HERO: [
      { id: "bush_leafy", url: bushLeafyUrl, unitScale: 1 },
      { id: "bush_flowering", url: bushFloweringUrl, unitScale: 1 }
    ],
    FILLER: [{ id: "kenney_bush", url: bushModelUrl, unitScale: KENNEY_UNIT_SCALE.bush }]
  },
  rock: {
    HERO: [
      { id: "rock_boulder_1", url: rockBoulder1Url, unitScale: 1 },
      { id: "rock_boulder_2", url: rockBoulder2Url, unitScale: 1 },
      { id: "rock_boulder_3", url: rockBoulder3Url, unitScale: 1 }
    ],
    FILLER: [{ id: "kenney_rock", url: rockModelUrl, unitScale: KENNEY_UNIT_SCALE.rock }]
  },
  flower: {
    HERO: [
      { id: "flower_group_1", url: flowerGroup1Url, unitScale: 1 },
      { id: "flower_group_2", url: flowerGroup2Url, unitScale: 1 }
    ],
    FILLER: [{ id: "kenney_flower", url: flowerModelUrl, unitScale: KENNEY_UNIT_SCALE.flower }]
  },
  plant: {
    HERO: [
      { id: "plant_fern", url: plantFernUrl, unitScale: 1 },
      { id: "plant_grass_tall", url: plantGrassTallUrl, unitScale: 1 },
      { id: "plant_grass_wispy", url: plantGrassWispyUrl, unitScale: 1 },
      { id: "plant_clover", url: plantCloverUrl, unitScale: 1 }
    ],
    // A plant is scenery detail; far away it is not worth a download at all.
    FILLER: []
  },
  prop: {
    HERO: [
      { id: "prop_crate", url: crateUrl, unitScale: 1 },
      { id: "prop_wagon", url: wagonUrl, unitScale: 1 },
      { id: "prop_fence_rail", url: fenceRailUrl, unitScale: 1 },
      { id: "prop_fence_rail_long", url: fenceRailLongUrl, unitScale: 1 }
    ],
    FILLER: []
  }
};

/** Every model the client may load, in a stable order: what a test walks to prove the files shipped. */
export const ENVIRONMENT_MODEL_IDS: readonly string[] = Object.values(ENVIRONMENT_MODELS).flatMap((byTier) =>
  Object.values(byTier).flatMap((entries) => entries.map((entry) => entry.id))
);

/** The file behind a provenance id. The renderer asks by id and never by kind or tier. */
export const ENVIRONMENT_MODEL_URL_BY_ID: ReadonlyMap<string, string> = new Map(
  Object.values(ENVIRONMENT_MODELS).flatMap((byTier) =>
    Object.values(byTier).flatMap((entries) => entries.map((entry) => [entry.id, entry.url] as const))
  )
);
