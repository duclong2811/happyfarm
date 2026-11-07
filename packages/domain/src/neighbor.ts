export type NeighborNpcPhase = "GROWING" | "STOCKED" | "BUILT";
export interface NeighborNpcState {
  readonly phase: NeighborNpcPhase;
  readonly plantedAt: string;
  readonly readyAt: string;
  readonly stockQuantity: number;
  readonly constructionLevel: number;
  readonly nextMilestoneAt: string | null;
  readonly version: number;
  readonly lastReconciledAt: string;
}
export interface ReconciledNeighborNpc extends NeighborNpcState { readonly changed: boolean; }

export type NeighborWorkPhase = "PREPARING" | "WORKING" | "WAITING" | "STOCKED";
export interface RecurringNeighborNpcState {
  readonly phase: NeighborWorkPhase;
  readonly cycle: number;
  readonly stockQuantity: number;
  readonly nextActionAt: string;
  readonly lastSettledAt: string;
  readonly version: number;
}

/** Server-time-only, bounded catch-up for the small shared-world NPC loop. */
export function reconcileRecurringNeighborNpc(
  state: RecurringNeighborNpcState,
  now: string,
  maxCatchupSeconds = 24 * 60 * 60
): RecurringNeighborNpcState {
  const nowMs = Date.parse(now);
  const lastMs = Date.parse(state.lastSettledAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastMs)) return state;
  const effectiveMs = Math.min(nowMs, lastMs + maxCatchupSeconds * 1000);
  let phase = state.phase;
  let cycle = state.cycle;
  let stockQuantity = state.stockQuantity;
  let nextMs = Date.parse(state.nextActionAt);
  let changed = false;
  let guard = 0;
  while (Number.isFinite(nextMs) && effectiveMs >= nextMs && guard++ < 32) {
    if (phase === "PREPARING") phase = "WORKING";
    else if (phase === "WORKING") phase = "WAITING";
    else if (phase === "WAITING") { phase = "STOCKED"; stockQuantity += 3; }
    else { phase = "PREPARING"; cycle += 1; }
    const duration = phase === "PREPARING" ? 10_000 : phase === "WORKING" ? 20_000 : phase === "WAITING" ? 30_000 : 10_000;
    nextMs += duration;
    changed = true;
  }
  if (!changed) return state;
  return { phase, cycle, stockQuantity, nextActionAt: new Date(nextMs).toISOString(), lastSettledAt: new Date(Math.min(nowMs, effectiveMs)).toISOString(), version: state.version + 1 };
}
/** Advances from server timestamps with a bounded dormant catch-up. */
export function reconcileNeighborNpc(state: NeighborNpcState, now: string, maxCatchupSeconds = 24 * 60 * 60): ReconciledNeighborNpc {
  const nowMs = Date.parse(now);
  const lastMs = Date.parse(state.lastReconciledAt);
  if (!Number.isFinite(nowMs) || !Number.isFinite(lastMs)) return { ...state, changed: false };
  const effectiveMs = Math.min(nowMs, lastMs + maxCatchupSeconds * 1000);
  let phase = state.phase;
  let stockQuantity = state.stockQuantity;
  let constructionLevel = state.constructionLevel;
  let nextMilestoneAt = state.nextMilestoneAt;
  let changed = false;
  if (phase === "GROWING" && effectiveMs >= Date.parse(state.readyAt)) {
    phase = "STOCKED"; stockQuantity += 3;
    // The building milestone is anchored to the server-owned harvest time, so a
    // long-offline reconcile can advance both milestones without inventing a
    // new real-time delay.
    nextMilestoneAt = new Date(Date.parse(state.readyAt) + 30_000).toISOString(); changed = true;
  }
  if (phase === "STOCKED" && nextMilestoneAt !== null && effectiveMs >= Date.parse(nextMilestoneAt)) {
    phase = "BUILT"; constructionLevel = Math.max(1, constructionLevel);
    nextMilestoneAt = null; changed = true;
  }
  // The anchor only needs to move when the catch-up cap actually cut progress short (the time beyond it
  // is paused, so the next window starts from now). Otherwise an unchanged NPC is left untouched: a
  // read of the neighbour snapshot must not cost a D1 write, and BUILT is terminal.
  const capped = effectiveMs < nowMs && phase !== "BUILT";
  if (!changed && !capped) return { ...state, changed: false };
  return { phase, plantedAt: state.plantedAt, readyAt: state.readyAt, stockQuantity, constructionLevel, nextMilestoneAt,
    version: state.version + 1, lastReconciledAt: new Date(nowMs).toISOString(), changed: true };
}
