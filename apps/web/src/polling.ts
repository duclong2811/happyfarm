/**
 * When the page may re-read the farm on its own.
 *
 * Crops and trees mature on the server's clock, so a timer is the only way a ripe crop appears
 * without a reload. Everything else about a farm changes only when the player acts - and every
 * action already re-reads the whole farm - so the timer must not touch it.
 *
 * Two rules keep the read cost proportional to *visible* play rather than to "a tab is open": a
 * hidden tab reads nothing, and only the growth lists are read on the timer.
 *
 * The V14.3.2 D1 audit measured 5.83M rows read in 24h on the staging database, and 5.35M of it
 * (91.8%) was two full-list queries the poll repeated: every farm tile (twice) and every built
 * object. See `docs/performance/D1_READ_AUDIT.md`.
 */

/**
 * How often a visible tab re-reads the growth lists.
 *
 * Crops take minutes to mature (the fastest is 300s) and a tree regrows over 15 minutes, so a few
 * seconds is generous. Every real action refreshes immediately; this only makes a crop that ripens
 * while the player watches appear on its own.
 */
export const GROWTH_REFRESH_INTERVAL_MS = 5_000;

/** The conditions under which a timer tick is allowed to read the farm. */
export interface GrowthPollGate {
  /** A farm has been loaded; before that there is nothing to refresh. */
  readonly farmLoaded: boolean;
  /** The tab is in the foreground. A hidden tab must cost nothing. */
  readonly visible: boolean;
  /** The previous tick is still in flight, so this one is dropped rather than stacked. */
  readonly inFlight: boolean;
}

export function shouldRefreshGrowth(gate: GrowthPollGate): boolean {
  return gate.farmLoaded && gate.visible && !gate.inFlight;
}
