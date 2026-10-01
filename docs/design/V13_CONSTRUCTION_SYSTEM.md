# V13: persistent construction

Status: design of record. Read before changing construction, the build catalogue's gameplay data, or
the `/constructions` routes.

V12.5 could preview a placement and nothing else. V13 is the other half: a player builds something, the
server charges the catalogue's price for it exactly once, the row survives a reload, and an invalid or
overlapping placement is refused without taking any gold.

## The shape

```text
shop -> select -> PLACE -> preview (advisory) -> confirm
  -> POST /farms/:farmId/constructions
       authenticate -> authorize (OWNER or EDITOR) -> load the catalogue entry
       -> level -> price -> footprint -> ownership -> capability -> collisions -> funds
       -> one transaction: ledger debit + construction row + idempotency receipt
  -> 201 { construction }   -> the world draws the server's own row
```

The client sends **which entry** and **where**. It never sends a price, a level, a footprint, an
effect, or a balance, and the request schema is `.strict()`, so a body that tries is rejected outright.

## One domain object, not one per asset

`ConstructionInstance` (`packages/domain/src/construction.ts`) is an anchor, a rotation, a footprint, a
bounds rectangle, a state, a cost, and a pointer at the catalogue entry. A barn, a bench, a silo and a
road differ in their *definitions*; nothing about how they occupy ground differs, so nothing about it
is duplicated. The domain reads a `ConstructionDefinition` - price, level, footprint, capability,
status - and never the catalogue's storage, effects or descriptions.

`constructionRefusal` is the whole placement rule and is pure: preview-only, level, funds, footprint
shape, ownership, terrain, capability, occupancy. It returns the first refusal rather than throwing, so
the API can answer with a stable code and a test can assert the *reason*.

## The database is the last line, not the first

`farm_constructions` stores the rectangle (`min_x`, `max_x`, `min_y`, `max_y`) beside the footprint, and
three kinds of trigger make the rules true even when two requests race:

* **owned ground** - the farm's own `farm_tiles` inside the rectangle must number exactly the cells the
  footprint claims;
* **one occupant per cell** - a new rectangle may not intersect any other on the same farm;
* **no crops or trees underneath** - checked in both directions of insertion.

The ledger is rebuilt in `0010_farm_constructions.sql` to admit the `CONSTRUCTION` reason and the
`construct_*` reference kind, so construction money travels the same validated path a shop purchase
does: `economy_ledger_validate_wallet` refuses a stale balance and `economy_ledger_apply_wallet` moves
it.

## Atomicity and replay

`D1ConstructionRepository.placeAtomically` writes four statements in one D1 batch: ensure the wallet,
append the ledger row (which moves the money), insert the construction, and write the idempotency
receipt - the receipt last, and only if the wallet and the construction it names both exist at the
balances the batch produced. A duplicate request id returns the first construction; the same id with a
different payload is an `IDEMPOTENCY_CONFLICT`; and the client disables its confirm button while a
command is in flight.

## What V13 deliberately does not do

* Roads cannot be built yet: their tiers are `PREVIEW_ONLY`, and the shop says so rather than selling
  a segment the world cannot store. The road *footprint* contract is fixed (see `V13_ROAD_V2.md`).
* Storage capacity, production cycles, movement bonuses and workers are declared as structured
  metadata and marked `FOUNDATION_ONLY`; nothing enforces or runs them, and the shop labels them as
  not running yet.
* Nothing is deployed, and no migration is applied to a remote database by this pass.
