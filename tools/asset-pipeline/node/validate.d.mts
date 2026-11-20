/** Types for `validate.mjs`, so a TypeScript test can run the same checks the CLI does. */

export interface AssetSpecEnvelope {
  /** The exact height, or with `fit: "unit"` the most it may be. */
  readonly height: number;
  readonly halfFootprint: number;
}

export interface AssetSpecBudget {
  readonly triangles: number;
  readonly materials: number;
  readonly bytes: number;
}

export interface AssetSpec {
  readonly id: string;
  readonly kind: "crop" | "character" | "building" | "ship" | "village";
  readonly directory: string;
  /** "unit": scaled so the largest side is one unit, rather than to the envelope's height. */
  readonly fit?: "unit";
  readonly envelope: AssetSpecEnvelope;
  readonly budget: AssetSpecBudget;
  readonly build: () => readonly unknown[];
}

export interface AssetMetric {
  readonly id: string;
  readonly bytes: number;
  readonly triangles: number;
  readonly materials: number;
  readonly textures: number;
  readonly size: readonly [number, number, number];
}

export interface AssetCheck {
  readonly problems: readonly string[];
  readonly metrics: readonly AssetMetric[];
}

export function checkGeneratedAssets(repoRoot?: string): AssetCheck;
