import cabbageModelUrl from "../assets/models/crop_cabbage.glb?url";
import carrotModelUrl from "../assets/models/crop_carrot.glb?url";
import cornModelUrl from "../assets/models/crop_corn.glb?url";
import potatoModelUrl from "../assets/models/crop_potato.glb?url";
import pumpkinModelUrl from "../assets/models/crop_pumpkin.glb?url";
import strawberryModelUrl from "../assets/models/crop_strawberry.glb?url";
import tomatoModelUrl from "../assets/models/crop_tomato.glb?url";
import wheatModelUrl from "../assets/models/crop_wheat.glb?url";
import fishCarpUrl from "../assets/models/fishing/fish_carp.glb?url";
import fishCatfishUrl from "../assets/models/fishing/fish_catfish.glb?url";
import fishMackerelUrl from "../assets/models/fishing/fish_mackerel.glb?url";
import fishSardineUrl from "../assets/models/fishing/fish_sardine.glb?url";
import fishSnapperUrl from "../assets/models/fishing/fish_snapper.glb?url";
import fishTilapiaUrl from "../assets/models/fishing/fish_tilapia.glb?url";
import fishTunaUrl from "../assets/models/fishing/fish_tuna.glb?url";
import resourceCoalUrl from "../assets/models/resources/resource_coal.glb?url";
import resourceCopperUrl from "../assets/models/resources/resource_copper.glb?url";
import resourceIronUrl from "../assets/models/resources/resource_iron.glb?url";
import resourceStoneUrl from "../assets/models/resources/resource_stone.glb?url";
import type { CropModelId } from "./assets";

/**
 * Model ids to the URLs Vite emits for them.
 *
 * The `?url` imports hand the file to the bundler, which copies it into the build with a content
 * hash and rewrites the URL. That keeps a model part of the module graph: a missing or misspelled
 * file is a build error rather than a 404 the player discovers. `Record<CropModelId, string>`
 * makes the mapping exhaustive, so adding an id to `assets.ts` breaks the build until its file is
 * imported here, which is exactly the reminder the pipeline wants.
 *
 * This is the only client module whose correctness a unit test cannot check, because the query
 * suffix is a bundler feature that plain Node cannot resolve. It is kept to this single mechanical
 * translation for that reason.
 */

export const CROP_MODEL_URLS: Readonly<Record<CropModelId, string>> = {
  crop_carrot: carrotModelUrl,
  crop_corn: cornModelUrl,
  crop_wheat: wheatModelUrl,
  crop_potato: potatoModelUrl,
  crop_tomato: tomatoModelUrl,
  crop_strawberry: strawberryModelUrl,
  crop_cabbage: cabbageModelUrl,
  crop_pumpkin: pumpkinModelUrl
};

/**
 * Fish models, keyed by the id the *server* sends with each species.
 *
 * A map rather than a closed union, and a lookup rather than an index: the fish catalogue is game data,
 * so a deployment may name a species this build has never heard of. The answer for one is `null` and
 * the inventory draws its produce fallback, exactly as an unknown crop does.
 */
export const FISH_MODEL_URLS: Readonly<Record<string, string>> = {
  fish_tilapia: fishTilapiaUrl,
  fish_carp: fishCarpUrl,
  fish_catfish: fishCatfishUrl,
  fish_sardine: fishSardineUrl,
  fish_mackerel: fishMackerelUrl,
  fish_snapper: fishSnapperUrl,
  fish_tuna: fishTunaUrl
};

export function fishModelUrl(modelId: string | null): string | null {
  if (modelId === null) return null;
  return FISH_MODEL_URLS[modelId] ?? null;
}

/**
 * Resource-node models, keyed by the id the server sends with each deposit.
 *
 * A map with a `null` answer for an unknown id, exactly like the fish one: a deployment may define a
 * deposit this build has never heard of, and the world then draws the fallback rather than nothing.
 */
export const RESOURCE_MODEL_URLS: Readonly<Record<string, string>> = {
  resource_stone: resourceStoneUrl,
  resource_copper: resourceCopperUrl,
  resource_iron: resourceIronUrl,
  resource_coal: resourceCoalUrl
};

export function resourceModelUrl(modelId: string | null): string | null {
  if (modelId === null) return null;
  return RESOURCE_MODEL_URLS[modelId] ?? null;
}
