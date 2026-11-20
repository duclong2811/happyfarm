import vietHouseThatchUrl from "../assets/models/viet/viet_house_thatch.glb?url";
import vietHouseStiltUrl from "../assets/models/viet/viet_house_stilt.glb?url";
import vietHouseTiledUrl from "../assets/models/viet/viet_house_tiled.glb?url";
import vietVillageGateUrl from "../assets/models/viet/viet_village_gate.glb?url";
import vietShrineUrl from "../assets/models/viet/viet_shrine.glb?url";
import vietWellUrl from "../assets/models/viet/viet_well.glb?url";
import vietJarsUrl from "../assets/models/viet/viet_jars.glb?url";
import vietStrawStackUrl from "../assets/models/viet/viet_straw_stack.glb?url";
import vietRiceMortarUrl from "../assets/models/viet/viet_rice_mortar.glb?url";
import vietBambooDaybedUrl from "../assets/models/viet/viet_bamboo_daybed.glb?url";
import vietBonsaiUrl from "../assets/models/viet/viet_bonsai.glb?url";
import vietRockeryUrl from "../assets/models/viet/viet_rockery.glb?url";
import vietLotusPondUrl from "../assets/models/viet/viet_lotus_pond.glb?url";
import vietScreenWallUrl from "../assets/models/viet/viet_screen_wall.glb?url";
import vietLanternPostUrl from "../assets/models/viet/viet_lantern_post.glb?url";
import vietLanternStringUrl from "../assets/models/viet/viet_lantern_string.glb?url";
import vietFenceBambooUrl from "../assets/models/viet/viet_fence_bamboo.glb?url";
import vietFenceBreezeUrl from "../assets/models/viet/viet_fence_breeze.glb?url";
import vietTreeBanyanUrl from "../assets/models/viet/viet_tree_banyan.glb?url";
import vietBambooClumpUrl from "../assets/models/viet/viet_bamboo_clump.glb?url";
import vietTreeArecaUrl from "../assets/models/viet/viet_tree_areca.glb?url";
import vietTreeBananaUrl from "../assets/models/viet/viet_tree_banana.glb?url";
import vietTreeMaiUrl from "../assets/models/viet/viet_tree_mai.glb?url";
import vietTreeDaoUrl from "../assets/models/viet/viet_tree_dao.glb?url";

/**
 * Làng Việt: the Vietnamese village pack (`tools/asset-pipeline/node/viet.mjs`,
 * docs/design/LANG_VIET.md), keyed by model id.
 *
 * Each model is generated to one unit across its largest side, standing on y = 0, so `sizeWorld` is
 * that side in metres - the same convention as the prop and building manifests. The sizes keep the
 * pieces in proportion with each other and with the island (a 1.6 m player, a 4.6 m barn): a cottage
 * fills its 3 x 3 cells, a banyan towers over it, a jar stands knee-high.
 */
export interface VillageModelEntry {
  readonly id: string;
  readonly url: string;
  /** The model's largest side, in world metres. */
  readonly sizeWorld: number;
}

export const VILLAGE_MODELS: ReadonlyMap<string, VillageModelEntry> = new Map(
  (
    [
      { id: "viet_house_thatch", url: vietHouseThatchUrl, sizeWorld: 3.4 },
      { id: "viet_house_stilt", url: vietHouseStiltUrl, sizeWorld: 4.3 },
      { id: "viet_house_tiled", url: vietHouseTiledUrl, sizeWorld: 5.2 },
      { id: "viet_village_gate", url: vietVillageGateUrl, sizeWorld: 3.8 },
      { id: "viet_shrine", url: vietShrineUrl, sizeWorld: 2.4 },
      { id: "viet_well", url: vietWellUrl, sizeWorld: 2.0 },
      { id: "viet_jars", url: vietJarsUrl, sizeWorld: 1.0 },
      { id: "viet_straw_stack", url: vietStrawStackUrl, sizeWorld: 2.1 },
      { id: "viet_rice_mortar", url: vietRiceMortarUrl, sizeWorld: 1.1 },
      { id: "viet_bamboo_daybed", url: vietBambooDaybedUrl, sizeWorld: 1.8 },
      { id: "viet_bonsai", url: vietBonsaiUrl, sizeWorld: 1.0 },
      { id: "viet_rockery", url: vietRockeryUrl, sizeWorld: 2.0 },
      { id: "viet_lotus_pond", url: vietLotusPondUrl, sizeWorld: 3.2 },
      { id: "viet_screen_wall", url: vietScreenWallUrl, sizeWorld: 2.1 },
      { id: "viet_lantern_post", url: vietLanternPostUrl, sizeWorld: 2.3 },
      { id: "viet_lantern_string", url: vietLanternStringUrl, sizeWorld: 3.2 },
      { id: "viet_fence_bamboo", url: vietFenceBambooUrl, sizeWorld: 1.17 },
      { id: "viet_fence_breeze", url: vietFenceBreezeUrl, sizeWorld: 1.08 },
      { id: "viet_tree_banyan", url: vietTreeBanyanUrl, sizeWorld: 5.0 },
      { id: "viet_bamboo_clump", url: vietBambooClumpUrl, sizeWorld: 4.4 },
      { id: "viet_tree_areca", url: vietTreeArecaUrl, sizeWorld: 5.0 },
      { id: "viet_tree_banana", url: vietTreeBananaUrl, sizeWorld: 3.2 },
      { id: "viet_tree_mai", url: vietTreeMaiUrl, sizeWorld: 2.3 },
      { id: "viet_tree_dao", url: vietTreeDaoUrl, sizeWorld: 2.3 }
    ] as const
  ).map((entry) => [entry.id, entry])
);

/** Every Làng Việt model id, for the asset tests. */
export const VILLAGE_MODEL_IDS: readonly string[] = [...VILLAGE_MODELS.keys()];
