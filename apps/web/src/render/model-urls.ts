import carrotModelUrl from "../assets/models/crop_carrot.glb?url";
import cornModelUrl from "../assets/models/crop_corn.glb?url";
import wheatModelUrl from "../assets/models/crop_wheat.glb?url";
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
  crop_wheat: wheatModelUrl
};