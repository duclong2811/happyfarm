/**
 * How expensive the view is allowed to be, as a development switch.
 *
 * The previous V12 attempt ran the development machine at full load. Some of that was work that
 * should never have happened at all, and the fixes for it live where the work was - but a weaker
 * machine also needs a way to keep a *correct* scene running while somebody works on it. This is that
 * switch, and it is deliberately the smallest thing that can be one.
 *
 * Two rules keep it honest:
 *
 * * **It is presentation only.** Quality changes how many pixels are drawn and how they are lit. It
 *   never touches `WorldCell`, land ownership, walkability, navigation, crop maturity, or anything the
 *   server has an opinion about. A low-quality session and a normal one play an identical game.
 * * **It is not a setting.** There is no UI, no persistence, and no per-user state: a developer opens
 *   the page with `?quality=low`. A player never sees it, and nothing has to be kept in sync.
 */

/** The quality levels. `NORMAL` is what a player gets. */
export type RenderQualityName = "NORMAL" | "LOW";

/**
 * The numbers one quality level sets.
 *
 * `pixelRatioCap` is the real cost driver: a 2x device pixel ratio quadruples the fragments a
 * full-screen pass has to shade. `shadowMapSize` and `shadows` are next - a shadow map is a second
 * render of everything that casts, at whatever resolution is asked for. `detailScenery` drops the
 * flowers and grass tufts, which are the highest draw-call count for the least information.
 */
export interface RenderQualityPreset {
  readonly name: RenderQualityName;
  /** Upper bound on `devicePixelRatio`, whatever the display claims. */
  readonly pixelRatioCap: number;
  readonly antialias: boolean;
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  /** Whether the small scenery groups are drawn at all. */
  readonly detailScenery: boolean;
}

export const RENDER_QUALITY_PRESETS: Readonly<Record<RenderQualityName, RenderQualityPreset>> = {
  NORMAL: {
    name: "NORMAL",
    // A 2x cap was the shipped value and it is more than the scene can justify: the island is drawn
    // with flat colours and one shadow map, so the extra samples buy almost nothing a player sees.
    pixelRatioCap: 1.75,
    antialias: true,
    shadows: true,
    shadowMapSize: 2_048,
    detailScenery: true
  },
  LOW: {
    name: "LOW",
    pixelRatioCap: 1,
    antialias: false,
    shadows: false,
    shadowMapSize: 1_024,
    detailScenery: false
  }
};

/**
 * The quality a query-string value asks for.
 *
 * Anything that is not an explicit low-quality request means `NORMAL`, so a typo, a missing parameter,
 * and a player's ordinary session all behave the same way - and the expensive path is never entered by
 * accident.
 */
export function resolveRenderQuality(value: string | null | undefined): RenderQualityName {
  return typeof value === "string" && value.trim().toLowerCase() === "low" ? "LOW" : "NORMAL";
}

/** The preset for a quality name. */
export function renderQualityPreset(name: RenderQualityName): RenderQualityPreset {
  return RENDER_QUALITY_PRESETS[name];
}

/**
 * How much of the small-scenery budget survives a quality level.
 *
 * A multiplier rather than a hard zero, so a middle quality level is a later one-line change. LOW is
 * zero because a flower is a fraction of a pixel at any camera distance a development session uses.
 */
export function detailSceneryScale(name: RenderQualityName): number {
  return name === "LOW" ? 0 : 1;
}
