/**
 * Typed bridge between an authored V2 art package and the existing DOM UI.
 *
 * This module intentionally ships with no artwork and does not opt any screen into V2. A Phase 1
 * package must import every exported image through Vite, create an `UiV2ArtPackage`, pass the
 * metadata/visual QA gate, and explicitly opt the target panel in. Dynamic labels, values, focus,
 * and event ownership stay with the existing screen renderers.
 */

export const UI_V2_THEME_CLASS = "ui-v2";

/** Stable manifest keys. Phase 1 packages must use these rather than screen-local filenames. */
export const UI_V2_ART_ASSET_IDS = [
  "panel.shell.standard",
  "panel.shell.compact",
  "panel.header.standard",
  "button.primary.normal",
  "button.primary.hover",
  "button.primary.pressed",
  "button.primary.disabled",
  "button.secondary.normal",
  "button.secondary.hover",
  "button.secondary.pressed",
  "button.secondary.disabled",
  "button.nav.normal",
  "button.nav.active",
  "button.nav.disabled",
  "card.item.normal",
  "card.item.hover",
  "card.item.selected",
  "card.item.disabled",
  "badge.resource.gold",
  "badge.resource.level",
  "badge.resource.price"
] as const;

export type UiV2ArtAssetId = typeof UI_V2_ART_ASSET_IDS[number];
export type UiV2ThemeScope = "construction" | "market" | "inventory" | "hud";
export type UiV2ArtworkApproval = "not-supplied" | "candidate" | "approved";

/** A URL returned by a Vite static asset import, never a runtime filesystem path. */
export type UiV2BundledAssetUrl = string & { readonly __uiV2BundledAssetUrl: unique symbol };

/**
 * Marks the result of `import asset from "./asset.png"` as a registry URL.
 *
 * This is deliberately the only conversion point. Phase 1 must import art at build time instead
 * of accepting a manifest pathname, user-provided URL, or arbitrary browser filesystem URL.
 */
export function bundledUiV2AssetUrl(viteStaticImport: string): UiV2BundledAssetUrl {
  if (viteStaticImport.trim().length === 0) {
    throw new Error("A V2 artwork entry requires a Vite static asset URL.");
  }
  return viteStaticImport as UiV2BundledAssetUrl;
}

export interface UiV2CapInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export interface UiV2ArtworkProvenance {
  /** Editable scene/vector/layered-source path, recorded by the supplied artwork package. */
  readonly sourceFile: string;
  readonly license: string;
}

interface UiV2ArtworkBase {
  readonly id: UiV2ArtAssetId;
  readonly src: UiV2BundledAssetUrl;
  /** Export pixels per intended CSS pixel. V2 artwork is normally supplied at 2x. */
  readonly density: 1 | 2 | 3;
  readonly provenance: UiV2ArtworkProvenance;
}

export interface UiV2NineSliceArtwork extends UiV2ArtworkBase {
  readonly kind: "nine-slice";
  /** Source-image pixels, not CSS border widths. Decorations must remain outside these seams. */
  readonly capInsets: UiV2CapInsets;
  /** Live DOM content clearance at the intended CSS scale. */
  readonly contentInsetsCssPx?: UiV2CapInsets;
}

export interface UiV2IconArtwork extends UiV2ArtworkBase {
  readonly kind: "icon" | "decor";
}

export type UiV2Artwork = UiV2NineSliceArtwork | UiV2IconArtwork;

export interface UiV2ArtPackage {
  readonly id: string;
  /** Candidate art is never eligible to replace a live screen. */
  readonly approval: UiV2ArtworkApproval;
  readonly assets: Readonly<Partial<Record<UiV2ArtAssetId, UiV2Artwork>>>;
}

/** The safe default: V2 exists as an integration route, not a visual fallback disguised as art. */
export const NO_UI_V2_ART: UiV2ArtPackage = Object.freeze({
  id: "happyfarm-ui-v2-not-supplied",
  approval: "not-supplied",
  assets: Object.freeze({})
});

const COMMON_PANEL_REQUIREMENTS = [
  "panel.shell.standard",
  "panel.header.standard",
  "button.primary.normal",
  "button.primary.hover",
  "button.primary.pressed",
  "button.primary.disabled",
  "button.secondary.normal",
  "button.secondary.hover",
  "button.secondary.pressed",
  "button.secondary.disabled",
  "card.item.normal",
  "card.item.hover",
  "card.item.selected",
  "card.item.disabled"
] as const satisfies readonly UiV2ArtAssetId[];

const UI_V2_SCOPE_REQUIREMENTS: Readonly<Record<UiV2ThemeScope, readonly UiV2ArtAssetId[]>> = {
  construction: [...COMMON_PANEL_REQUIREMENTS, "badge.resource.price"],
  market: [...COMMON_PANEL_REQUIREMENTS, "badge.resource.price"],
  inventory: [...COMMON_PANEL_REQUIREMENTS, "badge.resource.gold"],
  hud: [
    "button.nav.normal",
    "button.nav.active",
    "button.nav.disabled",
    "badge.resource.gold",
    "badge.resource.level"
  ]
};

export interface UiV2ThemeReadiness {
  readonly scope: UiV2ThemeScope;
  readonly ready: boolean;
  readonly missing: readonly UiV2ArtAssetId[];
  readonly invalid: readonly UiV2ArtAssetId[];
}

function hasPositiveInsets(insets: UiV2CapInsets): boolean {
  return [insets.top, insets.right, insets.bottom, insets.left].every(
    (value) => Number.isFinite(value) && value > 0
  );
}

function isUsableArtwork(artwork: UiV2Artwork): boolean {
  if (
    artwork.src.trim().length === 0 ||
    artwork.provenance.sourceFile.trim().length === 0 ||
    artwork.provenance.license.trim().length === 0
  ) return false;
  if (artwork.kind === "nine-slice") return hasPositiveInsets(artwork.capInsets);
  return true;
}

/**
 * Checks the minimum family a single screen needs before it can receive the `.ui-v2` namespace.
 * It is intentionally conservative: an incomplete V2 package leaves the existing skin untouched.
 */
export function uiV2ThemeReadiness(
  scope: UiV2ThemeScope,
  artPackage: UiV2ArtPackage = NO_UI_V2_ART
): UiV2ThemeReadiness {
  const missing: UiV2ArtAssetId[] = [];
  const invalid: UiV2ArtAssetId[] = [];
  for (const id of UI_V2_SCOPE_REQUIREMENTS[scope]) {
    const artwork = artPackage.assets[id];
    if (artwork === undefined) missing.push(id);
    else if (artwork.id !== id || !isUsableArtwork(artwork)) invalid.push(id);
  }
  return {
    scope,
    ready: artPackage.approval === "approved" && missing.length === 0 && invalid.length === 0,
    missing,
    invalid
  };
}

export interface UiV2ThemeActivation {
  readonly readiness: UiV2ThemeReadiness;
  /** Empty means keep the current, already-integrated skin exactly as it is. */
  readonly classNames: readonly string[];
}

/** Pure activation decision, suitable for tests and for a screen's explicit Phase 1 opt-in. */
export function uiV2ThemeActivationFor(
  scope: UiV2ThemeScope,
  artPackage: UiV2ArtPackage = NO_UI_V2_ART
): UiV2ThemeActivation {
  const readiness = uiV2ThemeReadiness(scope, artPackage);
  return {
    readiness,
    classNames: readiness.ready ? [UI_V2_THEME_CLASS, `${UI_V2_THEME_CLASS}--${scope}`] : []
  };
}

/**
 * Applies V2 only to the supplied screen host. Nothing calls this during Phase 0.
 *
 * A missing or candidate package removes only this screen's V2 namespace and leaves all existing
 * classes, handlers, accessibility attributes and live content intact.
 */
export function optIntoUiV2Theme(
  host: HTMLElement,
  scope: UiV2ThemeScope,
  artPackage: UiV2ArtPackage = NO_UI_V2_ART
): UiV2ThemeActivation {
  const activation = uiV2ThemeActivationFor(scope, artPackage);
  host.classList.remove(UI_V2_THEME_CLASS, `${UI_V2_THEME_CLASS}--${scope}`);
  host.classList.add(...activation.classNames);
  host.dataset.uiV2Theme = activation.readiness.ready ? artPackage.id : "fallback";
  return activation;
}

/** Exposed for a Phase 1 manifest test; callers receive a copy-free stable requirement list. */
export function uiV2RequiredAssets(scope: UiV2ThemeScope): readonly UiV2ArtAssetId[] {
  return UI_V2_SCOPE_REQUIREMENTS[scope];
}
