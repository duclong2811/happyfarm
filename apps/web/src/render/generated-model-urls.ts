import barnModelUrl from "../assets/models/buildings/building_barn.glb?url";
import farmerModelUrl from "../assets/models/characters/character_farmer.glb?url";
import monsterThuongLuongModelUrl from "../assets/models/ships/monster_thuong_luong.glb?url";
import pirateCorsairModelUrl from "../assets/models/ships/pirate_corsair.glb?url";
import pirateCutterModelUrl from "../assets/models/ships/pirate_cutter.glb?url";
import pirateRaiderModelUrl from "../assets/models/ships/pirate_raider.glb?url";
import shipBrigModelUrl from "../assets/models/ships/ship_brig.glb?url";
import shipFrigateModelUrl from "../assets/models/ships/ship_frigate.glb?url";
import shipRowboatModelUrl from "../assets/models/ships/ship_rowboat.glb?url";
import shipSloopModelUrl from "../assets/models/ships/ship_sloop.glb?url";

/**
 * Models produced by `tools/asset-pipeline/node/generate-models.mjs`, keyed by the id they were
 * generated with.
 *
 * The `?url` imports are what make a missing or misspelled file a build error instead of a 404 at
 * runtime, and the `Record` makes the mapping exhaustive: adding an id to
 * `tools/asset-pipeline/node/specs.mjs` and shipping it means adding one line here.
 *
 * This is the only client module a unit test cannot load, because the query suffix is a bundler
 * feature plain Node cannot resolve; the artifact test therefore checks the files and their specs,
 * and the build checks this translation.
 */
export const GENERATED_MODEL_URLS = {
  building_barn: barnModelUrl,
  character_farmer: farmerModelUrl,
  ship_rowboat: shipRowboatModelUrl,
  ship_sloop: shipSloopModelUrl,
  ship_brig: shipBrigModelUrl,
  ship_frigate: shipFrigateModelUrl,
  pirate_cutter: pirateCutterModelUrl,
  pirate_raider: pirateRaiderModelUrl,
  pirate_corsair: pirateCorsairModelUrl,
  monster_thuong_luong: monsterThuongLuongModelUrl
} as const;

export type GeneratedModelId = keyof typeof GENERATED_MODEL_URLS;
