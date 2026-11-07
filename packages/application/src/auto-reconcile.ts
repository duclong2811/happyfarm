import type { FarmId } from "@happy-farm/domain";
import type { AdvanceAuto, AutoPassContext, AutoStepView } from "./auto-executor";
import { normalizeMainCharacterAutoLease } from "./auto";
import { ApplicationError } from "./errors";
import { requireOwnedFarm } from "./jobs";
import type {
  ActorContext,
  ActorRepository,
  AutoTravelRepository,
  Clock,
  FarmMemberRepository,
  FarmRepository
} from "./ports";

/** The most newly reconciled Auto time one absence may ever produce. */
export const MAX_OFFLINE_AUTO_SECONDS = 24 * 60 * 60;

/**
 * How much work one reconciliation call may do before it must stop and hand the rest to a later call.
 *
 * These are not magic numbers: B2.5 measured one Auto transition at ~26 statements / ~22 read calls on
 * a 121-cell field, so a pass of 24 transitions is a few hundred statements - bounded, small next to
 * any request-limit concern, and enough for a returning player to see progress. The point is not to
 * finish 24 hours in one call; it is that a call can never run unbounded.
 */
export interface ReconcileBudget {
  /** Economic transitions (plant, load, purchase, harvest, unload) one pass may settle. */
  readonly transitions: number;
  /** Bounded steps one pass may take in total, including walks that settle nothing. */
  readonly steps: number;
}

export const DEFAULT_RECONCILE_BUDGET: ReconcileBudget = { transitions: 24, steps: 32 };

export type ReconcileStopReason =
  /** The actor is not on Auto: nothing may be simulated. */
  | "NOT_AUTO_CONTROLLED"
  /** The effective target was reached (or there was nothing to do) and the timeline is current. */
  | "CAUGHT_UP"
  /** Auto cannot progress without the player: supply, funds, storage, growth, no assignment. */
  | "BLOCKED"
  /** The pass used its budget before the target; the watermark is the exact processed time. */
  | "BUDGET_EXHAUSTED"
  /** Another pass, tab or request advanced the actor first; this one stopped without duplicating. */
  | "CONFLICT";

export interface ReconcileAutoResult {
  /** The watermark this pass started from, or null when Auto had never been observed. */
  readonly startedAt: string | null;
  /** The effective target: `min(now, start + 24 h, current Main Character lease)`. */
  readonly targetAt: string;
  /** The authoritative time the timeline is now settled through. */
  readonly reconciledThrough: string;
  readonly elapsedConsumedSeconds: number;
  readonly transitionsProcessed: number;
  readonly economicSettlements: number;
  readonly steps: number;
  readonly stopReason: ReconcileStopReason;
  readonly budgetExhausted: boolean;
  readonly budget: ReconcileBudget;
}

export interface ReconcileAutoDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly actors: ActorRepository;
  readonly travel: AutoTravelRepository;
  /** The same executor the online loop uses: one bounded transition, through the same settlements. */
  readonly advance: AdvanceAuto;
  readonly clock: Clock;
  readonly budget?: ReconcileBudget;
}

/**
 * Lazy offline reconciliation for one actor.
 *
 * Time only advances while somebody asks. When a player returns, this service compares the durable
 * watermark (`actor_auto_state.simulation_at`) with the authoritative server clock and advances the
 * actor by **bounded transitions at their own simulated instants** - never by ticking seconds, and
 * never with a background loop. The economic work is not reimplemented: every transition goes through
 * `AdvanceAuto` and therefore through the B0.1/B1/B2 atomic settlements.
 *
 * Watermark rules, in full:
 *
 * * `start = simulation_at`, or the server clock when Auto has never been observed (no retroactive
 *   work: nothing is simulated before Auto was first looked at).
 * * `target = min(now, start + 24 h, lease_until)`. The Main Character lease is 180 seconds; the
 *   24-hour bound remains only a defensive upper bound for the reconciliation loop.
 * * When the pass reaches the target, or stops because Auto is blocked, the timeline jumps to `now`:
 *   the time beyond the cap (or beyond a block) is *paused*, not pending, and the next absence starts
 *   from the present.
 * * When the pass runs out of budget the watermark is left exactly where committed work ends - the
 *   settlements themselves wrote it - and `budgetExhausted` says so. A later call continues from
 *   there. Elapsed Auto time is never silently discarded.
 */
export class ReconcileActorAuto {
  constructor(private readonly dependencies: ReconcileAutoDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<ReconcileAutoResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const budget = this.dependencies.budget ?? DEFAULT_RECONCILE_BUDGET;
    const farm = await requireOwnedFarm(this.dependencies, farmId, actor);
    // A farm whose actor has never been created has no Auto timeline to reconcile. That is not an
    // error the returning client should see - it is the same "nothing is running" answer as an actor
    // the player is driving - and a reconciliation pass never bootstraps an actor (that would be a
    // write on a resume path).
    const main = await this.dependencies.actors.findMainCharacter(farm.ownerPlayerId);
    const now = this.dependencies.clock.now();
    if (main === null) {
      return this.result(null, now, now, 0, 0, 0, 0, "NOT_AUTO_CONTROLLED", false, budget);
    }
    const state = await this.dependencies.travel.find(main.id);

    if (main.controlMode !== "AUTO_CONTROLLED") {
      return this.result(state.simulationAt ?? null, now, state.simulationAt ?? now, 0, 0, 0, 0, "NOT_AUTO_CONTROLLED", false, budget);
    }

    const startedAt = state.simulationAt ?? null;
    const startMs = Date.parse(startedAt ?? now);
    const nowMs = Date.parse(now);
    if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) {
      throw new ApplicationError("INTERNAL_ERROR", "Invalid server time");
    }
    const leaseMs = Date.parse(normalizeMainCharacterAutoLease({ simulationAt: startedAt, leaseUntil: state.leaseUntil, leaseIssuedAt: state.leaseIssuedAt, now }).leaseUntil);
    // A late resume can never turn the request time into extra work: the lease is the hard ceiling.
    const targetMs = Math.min(nowMs, startMs + MAX_OFFLINE_AUTO_SECONDS * 1000, leaseMs);
    const leaseExpired = nowMs >= leaseMs;
    if (targetMs <= startMs) {
      return this.result(startedAt, new Date(targetMs).toISOString(), new Date(startMs).toISOString(), 0, 0, 0, 0, "CAUGHT_UP", false, budget);
    }

    let cursorMs = startMs;
    let transitions = 0;
    let steps = 0;
    let stopReason: ReconcileStopReason = "CAUGHT_UP";
    // Cells and standing bounds cannot change during an Auto pass: no transition builds, moves or
    // repairs anything. Sharing them across the pass is what keeps a long reconciliation from
    // re-reading the two largest lists on every simulated transition.
    const pass: AutoPassContext = { suppressLeaseRenewal: true };

    while (cursorMs < targetMs) {
      if (transitions >= budget.transitions || steps >= budget.steps) {
        stopReason = "BUDGET_EXHAUSTED";
        break;
      }
      const cursor = new Date(cursorMs).toISOString();
      let step: AutoStepView;
      try {
        step = await this.dependencies.advance.executeAt(
          actor,
          farmId,
          { requestId: `reconcile_${String(steps).padStart(4, "0")}_${cursor.replaceAll(/\D/gu, "")}` },
          cursor,
          pass
        );
      } catch (error: unknown) {
        // A stale guard means another pass or an online tab moved the same actor first. Stopping is
        // the safe answer: the other writer owns the timeline from here.
        if (error instanceof ApplicationError && error.code === "CONFLICT_STALE_STATE") {
          stopReason = "CONFLICT";
          break;
        }
        throw error;
      }
      steps += 1;
      if (step.phase === "WORKED") {
        transitions += 1;
        // The settlement advanced the watermark to exactly this instant. Time does not move: the
        // actor's next action happens at the same simulated moment.
        continue;
      }
      if (step.phase === "TRAVELLING") {
        const waitMs = Math.max(0, step.retryAfterMs);
        if (waitMs === 0) {
          stopReason = "CONFLICT";
          break;
        }
        cursorMs = Math.min(targetMs, cursorMs + waitMs);
        continue;
      }
      if (step.phase === "WAITING") {
        if (step.retryAfterMs > 0) {
          cursorMs = Math.min(targetMs, cursorMs + step.retryAfterMs);
          continue;
        }
        // Nothing can change without the player: supply, funds, storage, assignments, or growth with
        // no wake-up. Stop here rather than spending the budget on a state that cannot progress.
        stopReason = "BLOCKED";
        break;
      }
      if (step.phase === "STOPPED") {
        stopReason = "NOT_AUTO_CONTROLLED";
        break;
      }
      // RETRY: the witness of a race the next step would only re-discover. Stop here and let the next
      // reconciliation - or the online loop - continue from whatever won.
      stopReason = "CONFLICT";
      break;
    }

    const latest = await this.dependencies.travel.find(main.id);
    if (stopReason === "BUDGET_EXHAUSTED") {
      // The settlements already wrote the exact instant they committed through; leave it alone.
      const through = latest.simulationAt ?? new Date(cursorMs).toISOString();
      return this.result(startedAt, new Date(targetMs).toISOString(), through, Math.max(0, (Date.parse(through) - startMs) / 1000), transitions, transitions, steps, stopReason, true, budget);
    }

    // Caught up or blocked: the timeline is current, and the elapsed time beyond it is paused rather
    // than pending. Caught-up writes the watermark to `now`; a conflict leaves whatever won.
    let through = stopReason === "CONFLICT"
      ? (latest.simulationAt ?? startedAt ?? now)
      : leaseExpired
        ? new Date(targetMs).toISOString()
        : now;
    if (stopReason !== "CONFLICT") {
      const saved = await this.dependencies.travel.saveAtomically(main.id, latest.version, { ...latest, simulationAt: through }, now);
      if (!saved) {
        stopReason = "CONFLICT";
        const after = await this.dependencies.travel.find(main.id);
        through = after.simulationAt ?? through;
      }
    }
    return this.result(startedAt, new Date(targetMs).toISOString(), through, Math.max(0, (Date.parse(through) - startMs) / 1000), transitions, transitions, steps, stopReason, false, budget);
  }

  private result(
    startedAt: string | null,
    targetAt: string,
    reconciledThrough: string,
    elapsedConsumedSeconds: number,
    transitionsProcessed: number,
    economicSettlements: number,
    steps: number,
    stopReason: ReconcileStopReason,
    budgetExhausted: boolean,
    budget: ReconcileBudget
  ): ReconcileAutoResult {
    return {
      startedAt,
      targetAt,
      reconciledThrough,
      elapsedConsumedSeconds,
      transitionsProcessed,
      economicSettlements,
      steps,
      stopReason,
      budgetExhausted,
      budget
    };
  }
}
