import barnModelUrl from "../assets/models/buildings/building_barn.glb?url";
import farmerModelUrl from "../assets/models/characters/character_farmer.glb?url";

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
  character_farmer: farmerModelUrl
} as const;

export type GeneratedModelId = keyof typeof GENERATED_MODEL_URLS;
