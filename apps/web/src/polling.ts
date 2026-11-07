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

/**
 * Growth-driven refresh schedule.
 *
 * A fixed five-second poll cost ~720 Worker requests per visible hour even when nothing on the farm
 * could change. The server already says how far each crop and tree has grown, so the client asks
 * again only when something is due: the soonest maturity, but never later than one visual-stage
 * interval while something is growing, and only a slow safety read when nothing is growing at all.
 * The server stays authoritative - this only decides *when to ask*, never what is ripe.
 */
export const GROWTH_REFRESH_MIN_MS = GROWTH_REFRESH_INTERVAL_MS;
/** While something grows, the visible stage is re-read at least this often. */
export const GROWTH_REFRESH_STAGE_MS = 30_000;
/** With nothing growing, a slow safety read still picks up changes made from another device. */
export const GROWTH_REFRESH_IDLE_MS = 300_000;
/** A read just after the due instant, so the server's clock has certainly passed it. */
const GROWTH_REFRESH_SLACK_MS = 750;

export interface GrowingCropTiming {
  readonly mature: boolean;
  readonly growthProgress: number;
  /** Null when this client has no definition for the crop; it is then refreshed on the stage cadence. */
  readonly growthDurationSeconds: number | null;
}

export interface GrowingTreeTiming {
  readonly ready: boolean;
  readonly secondsUntilReady: number;
  /** A stored tree is paused and never becomes ready on its own. */
  readonly stored: boolean;
}

/** Milliseconds from the snapshot until the next growth read is worth a request. */
export function nextGrowthRefreshDelayMs(input: {
  readonly crops: readonly GrowingCropTiming[];
  readonly trees: readonly GrowingTreeTiming[];
}): number {
  let soonest = Number.POSITIVE_INFINITY;
  let growing = false;
  for (const crop of input.crops) {
    if (crop.mature) continue;
    growing = true;
    if (crop.growthDurationSeconds === null) continue;
    const remaining = Math.max(0, 1 - crop.growthProgress) * crop.growthDurationSeconds * 1000;
    soonest = Math.min(soonest, remaining);
  }
  for (const tree of input.trees) {
    if (tree.ready || tree.stored) continue;
    growing = true;
    soonest = Math.min(soonest, tree.secondsUntilReady * 1000);
  }
  if (!growing) return GROWTH_REFRESH_IDLE_MS;
  const due = Number.isFinite(soonest) ? soonest + GROWTH_REFRESH_SLACK_MS : GROWTH_REFRESH_STAGE_MS;
  return Math.min(GROWTH_REFRESH_STAGE_MS, Math.max(GROWTH_REFRESH_MIN_MS, due));
}

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
