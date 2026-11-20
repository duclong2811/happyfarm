import barnModelUrl from "../assets/models/buildings/building_barn.glb?url";
import farmerModelUrl from "../assets/models/characters/character_farmer.glb?url";
import monsterThuongLuongModelUrl from "../assets/models/ships/monster_thuong_luong.glb?url";
import monsterBachTuocModelUrl from "../assets/models/ships/monster_bach_tuoc.glb?url";
import monsterCuaDaModelUrl from "../assets/models/ships/monster_cua_da.glb?url";
import monsterKinhNguModelUrl from "../assets/models/ships/monster_kinh_ngu.glb?url";
import monsterSuaLuaModelUrl from "../assets/models/ships/monster_sua_lua.glb?url";
import pirateCorsairModelUrl from "../assets/models/ships/pirate_corsair.glb?url";
import pirateCutterModelUrl from "../assets/models/ships/pirate_cutter.glb?url";
import pirateRaiderModelUrl from "../assets/models/ships/pirate_raider.glb?url";
import shipBrigModelUrl from "../assets/models/ships/ship_brig.glb?url";
import shipFrigateModelUrl from "../assets/models/ships/ship_frigate.glb?url";
import shipRowboatModelUrl from "../assets/models/ships/ship_rowboat.glb?url";
import shipSloopModelUrl from "../assets/models/ships/ship_sloop.glb?url";
import shipLineBoatModelUrl from "../assets/models/ships/ship_line_boat.glb?url";
import shipNetBoatModelUrl from "../assets/models/ships/ship_net_boat.glb?url";
import shipTrawlerModelUrl from "../assets/models/ships/ship_trawler.glb?url";
import shipCoasterModelUrl from "../assets/models/ships/ship_coaster.glb?url";
import shipJunkModelUrl from "../assets/models/ships/ship_junk.glb?url";
import shipCargoJunkModelUrl from "../assets/models/ships/ship_cargo_junk.glb?url";
import shipGreatJunkModelUrl from "../assets/models/ships/ship_great_junk.glb?url";
import shipDragonModelUrl from "../assets/models/ships/ship_dragon.glb?url";

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
  ship_line_boat: shipLineBoatModelUrl,
  ship_net_boat: shipNetBoatModelUrl,
  ship_trawler: shipTrawlerModelUrl,
  ship_coaster: shipCoasterModelUrl,
  ship_junk: shipJunkModelUrl,
  ship_cargo_junk: shipCargoJunkModelUrl,
  ship_great_junk: shipGreatJunkModelUrl,
  ship_dragon: shipDragonModelUrl,
  pirate_cutter: pirateCutterModelUrl,
  pirate_raider: pirateRaiderModelUrl,
  pirate_corsair: pirateCorsairModelUrl,
  monster_thuong_luong: monsterThuongLuongModelUrl,
  monster_bach_tuoc: monsterBachTuocModelUrl,
  monster_cua_da: monsterCuaDaModelUrl,
  monster_kinh_ngu: monsterKinhNguModelUrl,
  monster_sua_lua: monsterSuaLuaModelUrl
} as const;

export type GeneratedModelId = keyof typeof GENERATED_MODEL_URLS;
