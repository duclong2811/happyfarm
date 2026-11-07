/**
 * Where usable land comes from, and the boundary a future sea-reclamation pass extends.
 *
 * V14.5.2 settled the Home Island's land model: the island's **natural landmass is already the
 * player's to develop**. Ownership rows are legacy bookkeeping and tile state, never a licence to
 * use ground that already exists. What a placement asks is whether the cell *is usable land*:
 *
 * ```text
 * usable land = natural Home Island land OR (later) reclaimed land
 * ```
 *
 * Sea reclamation is deliberately not implemented. When it is, the change lands here and in the one
 * place that classifies a cell (`landOriginFor` / the host's terrain lookup): a reclaimed cell
 * reports origin `RECLAIMED`, every placement rule keeps asking `isUsableLand`, and no ownership
 * rewrite is needed. Buying invisible ownership over grass that already exists is a different thing
 * and no longer exists.
 */

export const LAND_ORIGINS = ["NATURAL", "RECLAIMED"] as const;
export type LandOrigin = (typeof LAND_ORIGINS)[number];

/**
 * Whether a cell is land a farm may use at all, whatever its origin.
 *
 * `null` is "not usable land": open sea, the pond, the beach, the volcano, protected ground, or any
 * cell outside the island. A placement's own terrain rules are asked *after* this and can be
 * narrower - a crop needs dry land, a moored asset needs shallows - but nothing may be placed on a
 * cell this refuses.
 */
export function isUsableLand(origin: LandOrigin | null): boolean {
  return origin === "NATURAL" || origin === "RECLAIMED";
}

/** The terrain facts the land-origin rule reads. Structural, so any classifier can satisfy it. */
export interface LandClassificationInput {
  readonly terrain: "LAND" | "SHORE" | "WATER" | "VOLCANO" | "BLOCKED";
  readonly protectedGround: boolean;
}

/**
 * The origin of the land under a cell, or null when the cell is not usable land.
 *
 * Today only natural land exists, so a dry, unprotected cell is `NATURAL` and everything else is
 * `null`. This is the one function a reclamation pass changes: a reclaimed cell is dry land the
 * island remembers converting, so it answers `RECLAIMED` - and every caller of `isUsableLand`
 * accepts it without another edit.
 */
export function landOriginFor(ground: LandClassificationInput): LandOrigin | null {
  if (ground.terrain !== "LAND" || ground.protectedGround) return null;
  return "NATURAL";
}
