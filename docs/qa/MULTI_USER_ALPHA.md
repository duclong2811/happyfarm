# Multi-user alpha

Status (V13.6.2): the code is a **public guest alpha**. A tester opens the link and plays - no email,
no OTP, no Cloudflare Access login, no account creation. Two facts remain, and both are operator
actions rather than code:

1. The **custom domain** `https://happyfarm-staging.longfx.trade/` is live but still behind a
   Cloudflare Access application, so it answers a 302 to the Access login instead of the game. See
   "Making the canonical URL public" below.
2. Until that is done, the working public URL is
   `https://happy-farm-staging.duclong-reg.workers.dev` (no Access application covers it, so guest
   play works there today).

## Purpose

Two to five real people, on their own phones and computers, each with their own player and their own
farm, playing the same staging build at the same time - without any of them being able to see or touch
anyone else's world.

This is **not** real-time multiplayer: no other players, no shared editing, no chat, no trading, no
WebSockets, no Durable Objects. It is alpha access for several people, sharing one backend safely.

```text
Tester A -> Guest identity A -> Player A -> Farm A
Tester B -> Guest identity B -> Player B -> Farm B
Tester C -> Guest identity C -> Player C -> Farm C     all on one staging deployment
```

## Setting up testers

1. Give them the URL. That is the whole setup.
2. They open it, the server establishes a guest identity, creates their player and starter farm, and
   the game starts. Nothing is installed, no password is shared, no invite code exists.
3. If a second tester uses the same phone or the same browser profile, they share the guest
   credential - and therefore the farm. Use a different browser profile, a different browser, or a
   private window for a genuinely separate guest.

## Making the canonical URL public

Repository code cannot remove a Cloudflare Access application: the deployment credentials carry
Workers scopes, not Access scopes. An operator with dashboard access must do it.

Goal: `https://happyfarm-staging.longfx.trade/` reaches the Worker without an Access challenge, while
the existing Access configuration stays recoverable.

In the Cloudflare dashboard:

1. **Zero Trust -> Access -> Applications.**
2. Find the application whose domain is `happyfarm-staging.longfx.trade`.
3. The safest reversible move is a **Bypass** policy for `Everyone` on that application:
   **Policies -> Add a policy**, name it `Public guest alpha`, action **Bypass**, include
   **Everyone**; leave any existing `Allow` policy in place so it can be restored by deleting the
   bypass. Removing the application entirely also works - note its **AUD** tag first
   (`ff946e88...e1ad`, committed in `workers/api/wrangler.staging.toml`).
4. Save, then verify from an ordinary browser or with curl:

   ```bash
   curl -s -o /dev/null -w '%{http_code}\n' https://happyfarm-staging.longfx.trade/
   ```

   Expected: `200`. A `302` to `https://dawn-field-0231.cloudflareaccess.com/...` means Access is
   still in front of the hostname.

5. Sanity-check the API too: `.../api/health` answers `200`, and `.../api/session` answers `200` and
   sets an `hf_guest` cookie.

Nothing about the deployment changes when this is done: the Worker already serves guest sessions on
every hostname when `GUEST_AUTH_ENABLED = "true"`.

## Identity model

```text
guest cookie (HttpOnly, 180 days)          Cloudflare Access sign-in (if it is ever used)
        |                                            |
   SHA-256 of the credential                   verified JWT: signature, issuer, audience, expiry
        |                                            |
        +-----------------> Player <-----------------+
                             |
                   farm, wallet, inventory, progression, world
```

* A **guest is a real player**, not a throwaway farm. It is an authentication state: the player row
  is durable, and a future Google or email sign-in will attach a *second* identity to the same
  player, keeping the same farm and progress.
* The credential is 32 random bytes from `crypto.getRandomValues`; only its hash is stored. The
  browser cannot read it (HttpOnly) and cannot choose it.
* The browser never sends an identity of its own: no `?player=`, no `X-Player-Id`, no stored player id
  the server would trust, no shared token in the bundle. Every command is authorized from the actor
  the Worker derived from the verified guest cookie or the verified Access JWT.
* The development bridge (`dev-auth.ts`, `dev-index.ts`) is not in the deployed import graph and
  cannot exist in a staging or production build.

Full detail: `docs/design/IDENTITY.md`.

## First visit, and why it is safe to retry

```text
GET /api/session                        -> guest credential minted, cookie set (first visit only)
        |
player row (INSERT ... ON CONFLICT DO NOTHING, then read back)
        |
one-time starter package (a receipt keyed by player, so it cannot be granted twice)
        |
"give me my farm" -> the farm they own, or a new one
```

A phone that loses the response to *any* of those steps asks again and gets the same answer:

* the player row is idempotent (the guest player id is derived from the credential hash, and both
  inserts are `ON CONFLICT DO NOTHING`);
* the starter package is idempotent by its receipt;
* **the farm is idempotent per player** (V13.6.1): the first request creates it, and every later one
  resolves to the same farm. It is enforced twice - the use case looks for the player's farm before
  creating anything, and a unique index on the owner (`0014`) means two requests racing each other
  cannot both create one. The loser re-reads the winner's farm instead of inventing an empty world.

So a tester can never end up with their gold and crops on a farm they cannot see.

## Isolation, and how it is proven

Every read and mutation is authorized from the authenticated actor, and the test suite holds it there:

| Concern | Where it is proven |
| --- | --- |
| New guest -> one player, one farm, one starter package | `guest-alpha.test.ts`: "opens a new guest session, creates one player, and grants the starter package once" |
| One browser returns to the same player and farm | `guest-alpha.test.ts`: "gives the same browser the same player and the same farm, however many times it asks" |
| Two browsers -> two players, two farms | `guest-alpha.test.ts`: "gives two browsers two players and two farms" |
| Edited / unknown / truncated credential never reaches another player | `guest-alpha.test.ts`: "never resolves an edited, unknown, or truncated credential to another guest" |
| Guest play off = nothing is established (production) | `guest-alpha.test.ts`: "establishes nothing when guest play is switched off" |
| A verified Access identity outranks a guest cookie | `guest-alpha.test.ts`: "prefers a verified Access identity over a guest cookie" |
| Cross-origin unsafe mutation is refused | `guest-alpha.test.ts` and `origin-guard.test.ts` |
| Two guests' gold, inventory and farms stay apart | `guest-alpha.test.ts`: "keeps two guests' gold, inventory, and farms apart" |
| Attaching a second identity keeps one player (future linking) | `tests/domain/identity.test.ts` |
| Distinct players, distinct farms, distinct islands | `handler.test.ts`: "gives two testers their own world, and lets neither touch the other's" |
| One farm per tester, however often they ask | `handler.test.ts`: "gives a player one farm, however many times they ask for one" |
| Another player's farm is refused | `handler.test.ts`: "rejects cross-player farm access", "refuses another player's farm, and an unauthenticated caller" |
| Wallets, inventory and ledger are per player | `handler.test.ts`: "isolates wallets, inventory, and stored results across players" |
| Nobody else may edit an object, not even a colleague | `handler.test.ts`: "lets nobody else edit it: not another farm's owner, and not a colleague who did not build it" |
| Client-supplied ownership is rejected outright | `handler.test.ts`: "rejects client-selected ownership fields", "returns only the authenticated actor's wallet and ignores client-selected owners" |

Cross-player requests answer **403** rather than 404 when the resource exists, and 404 when it does
not - which is the API's existing convention, and it is deliberate: the farm id a tester holds is one
they were given, so "not yours" is the honest answer.

## The test itself

Two testers, two devices. Fill this in as you go.

**Tester A**: `____________`  **Device/browser**: `____________`
**Tester B**: `____________`  **Device/browser**: `____________`
**Date**: `____________`

### Accounts and isolation

- [ ] A opens the link and lands in a farm immediately (no Access login, no email, no OTP)
- [ ] A has 100 gold and 10 carrot seeds
- [ ] B opens the same link in a *different browser profile* and lands in a *different* farm
- [ ] A moves the character; B sees no change
- [ ] A buys the cheapest shop item; B's gold is unchanged
- [ ] A places/moves/stores one object; B's island is unchanged
- [ ] A reloads: their farm, gold and edits are all still there
- [ ] B reloads: theirs are too
- [ ] A opens the link in the *same* browser profile on a second device: a new guest, because the
      credential lives in that device's cookie jar - confirm nobody loses their old farm on the
      original device

### Then the V13.5 mobile checks (per device)

- [ ] joystick: forward, back, left, right, diagonal
- [ ] release stops the character immediately
- [ ] Run works, and joystick + Run together
- [ ] camera drag with the other thumb, while moving
- [ ] pinch zoom
- [ ] rotate the camera 180 degrees and move forward: still camera-relative
- [ ] Estate view: tap a tree, a rock, a building, the ground
- [ ] Build Shop: open, scroll, pick an item, Place, Confirm, Cancel
- [ ] object editing: Move, Rotate, Store, Delete (with its confirmation)
- [ ] portrait and landscape: no reload, no duplicate joystick, no stuck movement
- [ ] 5 minutes of play: smooth / acceptable / poor `__________`

## Known limitations

* **Guest progress depends on keeping the guest credential.** It lives in this browser profile's
  cookie jar. Clearing site data, using a private window, or switching browsers creates a *new*
  guest and a new farm; the old farm is still in the database but has no way to be reached until an
  account-linking/recovery system exists. There is no such system yet (see `docs/design/IDENTITY.md`).
* **The custom domain is still Access-gated** until the operator action above is done. The
  `workers.dev` hostname is public and is the URL to hand out meanwhile.
* **A guest is scoped to one hostname.** The cookie has no `Domain` attribute, so a guest created on
  `happy-farm-staging.duclong-reg.workers.dev` is *not* the same guest on
  `happyfarm-staging.longfx.trade` - switching hosts starts a fresh farm. Pick one URL and use it for
  the whole playtest; when the custom domain goes public, start testers on it rather than moving them
  mid-test.
* There is no reset, logout, or admin tooling. A tester who wants a clean farm needs a clean browser
  profile (a new guest identity) or a deliberate operator action on the staging database.
* Guest creation is not rate-limited by the application. It is bounded only by Cloudflare's platform
  protections, so a public URL can be scripted to create players. Acceptable for an invited alpha,
  unacceptable for a launch - see `docs/deployment/STAGING.md`.
* One farm per player is enforced (V13.6.1). A future pass that wants several farms per tester drops
  the unique index in its own migration.
* Migrations are forward-only: a rollback of the Worker across a migrated schema is not supported.
* The starter package policy on staging is `ALL_UNRECEIPTED`, so an existing alpha tester who has no
  receipt is given it once. Production leaves that unset.
