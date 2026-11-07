# V16.2.2D3A — Offline Auto simulation spine

This slice adds the durable clock boundary only. It does not settle crops, spend Gold, award XP, move
Cargo, or write Warehouse output.

## Watermark

`actor_auto_state.simulation_at` means: “the authoritative Auto timeline has been reconciled through
this server timestamp.” Existing rows are NULL and initialize to the first server observation while
the actor is Auto-controlled, so no history before this feature is granted.

The reconciler clamps one observation to `MAX_OFFLINE_AUTO_SECONDS` (24 hours). The watermark advances
to the clamped server timestamp, so logging out and in cannot replay the same interval. Client clocks,
client elapsed values, and client timestamps are not accepted.

## Reconciliation boundary

`ReconcileActorAuto` is the single application boundary. D2.3A advances the watermark and completes a
persisted travel event only when its server arrival time has passed. A partial travel remains pending.
The transition budget is `MAX_RECONCILE_TRANSITIONS = 64`; D2.3B will use the same boundary for bounded
economic events.

The current `/auto/step` path remains a compatibility path for the online D2 executor. D2.3B should
wire one explicit observation trigger to `ReconcileActorAuto`, then converge online presentation on the
same server-time timeline. D2.3A does not scatter reconciliation across ordinary GETs.

## Concurrency and offline cost

The watermark is saved through the existing optimistic `actor_auto_state.version` guard. Two tabs may
read the same version, but only one can commit; the loser receives `CONFLICT_STALE_STATE` and cannot
advance the same timeline twice. No browser timer, Cron, Durable Object alarm, or periodic Worker/D1
operation is required while all tabs are closed.

## D2.3B remaining work

The next slice must add bounded event transitions for planting, growth, harvest, Cargo logistics, supply
purchase, Warehouse capacity, and conservation/idempotency tests. Travel time remains an authoritative
anchor-to-anchor event; visual online navigation is a separate client concern.
