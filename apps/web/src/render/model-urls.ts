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
import resourceHardwoodStumpUrl from "../assets/models/resources/resource_hardwood_stump.glb?url";
import resourceHardwoodUrl from "../assets/models/resources/resource_hardwood.glb?url";
import resourcePineStumpUrl from "../assets/models/resources/resource_pine_stump.glb?url";
import resourcePineUrl from "../assets/models/resources/resource_pine.glb?url";
import resourceWildwoodStumpUrl from "../assets/models/resources/resource_wildwood_stump.glb?url";
import resourceWildwoodUrl from "../assets/models/resources/resource_wildwood.glb?url";
import CropCarrotStage1Url from "../assets/models/crops/crop_carrot.s1.glb?url";
import CropCarrotStage2Url from "../assets/models/crops/crop_carrot.s2.glb?url";
import CropCarrotStage3Url from "../assets/models/crops/crop_carrot.s3.glb?url";
import CropCarrotStage4Url from "../assets/models/crops/crop_carrot.s4.glb?url";
import CropCornStage1Url from "../assets/models/crops/crop_corn.s1.glb?url";
import CropCornStage2Url from "../assets/models/crops/crop_corn.s2.glb?url";
import CropCornStage3Url from "../assets/models/crops/crop_corn.s3.glb?url";
import CropCornStage4Url from "../assets/models/crops/crop_corn.s4.glb?url";
import CropWheatStage1Url from "../assets/models/crops/crop_wheat.s1.glb?url";
import CropWheatStage2Url from "../assets/models/crops/crop_wheat.s2.glb?url";
import CropWheatStage3Url from "../assets/models/crops/crop_wheat.s3.glb?url";
import CropWheatStage4Url from "../assets/models/crops/crop_wheat.s4.glb?url";
import CropTomatoStage1Url from "../assets/models/crops/crop_tomato.s1.glb?url";
import CropTomatoStage2Url from "../assets/models/crops/crop_tomato.s2.glb?url";
import CropTomatoStage3Url from "../assets/models/crops/crop_tomato.s3.glb?url";
import CropTomatoStage4Url from "../assets/models/crops/crop_tomato.s4.glb?url";
import CropPumpkinStage1Url from "../assets/models/crops/crop_pumpkin.s1.glb?url";
import CropPumpkinStage2Url from "../assets/models/crops/crop_pumpkin.s2.glb?url";
import CropPumpkinStage3Url from "../assets/models/crops/crop_pumpkin.s3.glb?url";
import CropPumpkinStage4Url from "../assets/models/crops/crop_pumpkin.s4.glb?url";
import CropCabbageStage1Url from "../assets/models/crops/crop_cabbage.s1.glb?url";
import CropCabbageStage2Url from "../assets/models/crops/crop_cabbage.s2.glb?url";
import CropCabbageStage3Url from "../assets/models/crops/crop_cabbage.s3.glb?url";
import CropCabbageStage4Url from "../assets/models/crops/crop_cabbage.s4.glb?url";
import CropStrawberryStage1Url from "../assets/models/crops/crop_strawberry.s1.glb?url";
import CropStrawberryStage2Url from "../assets/models/crops/crop_strawberry.s2.glb?url";
import CropStrawberryStage3Url from "../assets/models/crops/crop_strawberry.s3.glb?url";
import CropStrawberryStage4Url from "../assets/models/crops/crop_strawberry.s4.glb?url";
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
  resource_coal: resourceCoalUrl,
  resource_wildwood: resourceWildwoodUrl,
  resource_pine: resourcePineUrl,
  resource_hardwood: resourceHardwoodUrl,
  resource_wildwood_stump: resourceWildwoodStumpUrl,
  resource_pine_stump: resourcePineStumpUrl,
  resource_hardwood_stump: resourceHardwoodStumpUrl
};

export function resourceModelUrl(modelId: string | null): string | null {
  if (modelId === null) return null;
  return RESOURCE_MODEL_URLS[modelId] ?? null;
}

/**
 * Growth-stage models of the crops the Quaternius Nature Crops Pack covers (CC0): four per crop, from
 * sprout (`.s1`) to grown (`.s4`), every stage of a crop at its grown stage's scale. A crop with no
 * entry here keeps its single model above, drawn scaled by growth as before.
 */
export const CROP_STAGE_COUNT = 4;
export const CROP_STAGE_MODEL_URLS: Readonly<Record<string, string>> = {
  "crop_carrot.s1": CropCarrotStage1Url,
  "crop_carrot.s2": CropCarrotStage2Url,
  "crop_carrot.s3": CropCarrotStage3Url,
  "crop_carrot.s4": CropCarrotStage4Url,
  "crop_corn.s1": CropCornStage1Url,
  "crop_corn.s2": CropCornStage2Url,
  "crop_corn.s3": CropCornStage3Url,
  "crop_corn.s4": CropCornStage4Url,
  "crop_wheat.s1": CropWheatStage1Url,
  "crop_wheat.s2": CropWheatStage2Url,
  "crop_wheat.s3": CropWheatStage3Url,
  "crop_wheat.s4": CropWheatStage4Url,
  "crop_tomato.s1": CropTomatoStage1Url,
  "crop_tomato.s2": CropTomatoStage2Url,
  "crop_tomato.s3": CropTomatoStage3Url,
  "crop_tomato.s4": CropTomatoStage4Url,
  "crop_pumpkin.s1": CropPumpkinStage1Url,
  "crop_pumpkin.s2": CropPumpkinStage2Url,
  "crop_pumpkin.s3": CropPumpkinStage3Url,
  "crop_pumpkin.s4": CropPumpkinStage4Url,
  "crop_cabbage.s1": CropCabbageStage1Url,
  "crop_cabbage.s2": CropCabbageStage2Url,
  "crop_cabbage.s3": CropCabbageStage3Url,
  "crop_cabbage.s4": CropCabbageStage4Url,
  "crop_strawberry.s1": CropStrawberryStage1Url,
  "crop_strawberry.s2": CropStrawberryStage2Url,
  "crop_strawberry.s3": CropStrawberryStage3Url,
  "crop_strawberry.s4": CropStrawberryStage4Url
};

/** The stage model id for a crop at a stage, or null when the crop has no stage models. */
export function cropStageModelId(definitionId: string, stage: number): string | null {
  const id = `${definitionId}.s${String(stage)}`;
  return CROP_STAGE_MODEL_URLS[id] === undefined ? null : id;
}

/** Which of the four stages a crop shows: grown once the server says mature, else by its progress. */
export function cropStageFor(mature: boolean, heightFraction: number): number {
  if (mature) return CROP_STAGE_COUNT;
  const progress = Number.isFinite(heightFraction) ? Math.min(1, Math.max(0, heightFraction)) : 0;
  return Math.min(CROP_STAGE_COUNT - 1, 1 + Math.floor(progress * (CROP_STAGE_COUNT - 1)));
}
