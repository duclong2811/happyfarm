/**
 * Which model draws which crop.
 *
 * Pure by design, so the mapping can be asserted in a unit test and so the renderer never has to
 * guess. It is deliberately not derived from the contracts: `CropDefinitionId` is an open pattern
 * (`^crop_[a-z0-9]+...`), not a closed list, because the server can define crops this build has
 * never heard of. The answer here is therefore "the model I have, or none", and the caller falls
 * back to placeholder geometry for "none" rather than showing nothing.
 *
 * Adding a crop definition to the catalogue means adding its model here. Two checks keep that
 * honest: `tests/web/farm-assets.test.ts` fails when a plantable crop has no model, and
 * `tests/integration/crop-model-assets.test.ts` fails when a model is declared without a shipped
 * file, or ships a file the contract in `apps/web/tools/generate-placeholder-models.mjs` rejects.
 */

export const CROP_MODEL_IDS = ["crop_carrot", "crop_wheat", "crop_corn"] as const;

export type CropModelId = (typeof CROP_MODEL_IDS)[number];

const MODEL_IDS: ReadonlySet<string> = new Set<string>(CROP_MODEL_IDS);

/** The model for a crop definition, or null when this build ships no model for it. */
export function cropModelId(definitionId: string): CropModelId | null {
  return MODEL_IDS.has(definitionId) ? (definitionId as CropModelId) : null;
}