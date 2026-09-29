/** Types for `specs.mjs`, so the artifact test can read the specs the generator writes from. */

export type { AssetSpec, AssetSpecBudget, AssetSpecEnvelope } from "./validate.d.mts";

import type { AssetSpec } from "./validate.d.mts";

export const MODEL_SPECS: readonly AssetSpec[];
