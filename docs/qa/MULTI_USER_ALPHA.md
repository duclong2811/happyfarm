# Multi-user alpha

Status: the code and the database are ready for a handful of testers; **the testers cannot sign in
yet**, because the Cloudflare Access application for the staging hostname has not been created. That
step is a dashboard action and is written out in full below.

## Purpose

Two to five real people, on their own phones and computers, each with their own player and their own
farm, playing the same staging build at the same time - without any of them being able to see or touch
anyone else's world.

This is **not** real-time multiplayer: no other players, no shared editing, no chat, no trading, no
WebSockets, no Durable Objects. It is alpha access for several people, sharing one backend safely.

```text
Tester A → Player A → Farm A
Tester B → Player B → Farm B
Tester C → Player C → Farm C      all on one staging deployment
```

## Setting up testers

1. Collect the email addresses of the testers (2-5 people; the account owner is one of them).
2. Give them the staging URL: `https://happy-farm-staging.duclong-reg.workers.dev`.
3. Each tester opens it once, signs in at the Cloudflare Access prompt with that email, and lands in
   their own farm. Nothing is installed; there are no passwords to share and no invite codes.

If the tester's phone has a SIM but no keyboard, they can complete the Access email code on the same
device - it is the standard Zero Trust login screen.

## Access setup (the step that is still missing)

Identity on staging is Cloudflare Access, and the API authenticates **only** the
`Cf-Access-Jwt-Assertion` header Access injects. The Zero Trust team exists
(`https://dawn-field-0231.cloudflareaccess.com`), the API fails closed without a JWT, and no
application currently covers the staging hostname - so today every API call answers 401.

In the Cloudflare dashboard:

1. **Zero Trust → Access → Applications → Add an application → Self-hosted.**
2. Application name: `Happy Farm Alpha`.
3. Application domain: `happy-farm-staging.duclong-reg.workers.dev`.
4. Session duration: whatever the testers can tolerate (24 hours is comfortable for a playtest).
5. **Policies → Add a policy**: name it `Alpha testers`, action **Allow**, and in *Include* add one
   rule per tester: **Emails** → the tester's address. Do not use "Allow everyone" for the first test.
6. If the identity provider offers one-time PIN, enable it, so a tester without Google/GitHub can
   still sign in.
7. Save. The application's **Overview** page shows the **Audience (AUD)** tag.

Then check the two values the Worker knows about, in `workers/api/wrangler.staging.toml`:

| Field | Committed value | What to do |
| --- | --- | --- |
| `ACCESS_TEAM_DOMAIN` | `https://dawn-field-0231.cloudflareaccess.com` | Keep, unless the team was recreated |
| `ACCESS_AUD` | `ff946e...e1ad` (64 hex characters) | Replace if the new application's AUD differs, then redeploy |

```bash
npm run check:staging-config                       # no placeholders
npm run build && npm run build:worker:staging      # rebuild the app inside the worker
npx wrangler deploy --config workers/api/wrangler.staging.toml
```

Verify from a private browser window: the URL now asks for a sign-in **before** the game loads, and
after signing in the HUD appears with 100 gold and 10 carrot seeds.

The Cloudflare credentials available to the deployment environment cannot read or create Access
applications (the Wrangler session carries Workers scopes, not Access scopes), which is why this step
is the operator's.

## Identity model

```text
Access sign-in (email)
        ↓  verified JWT: signature, issuer, audience, expiry
stable subject  = (iss, sub)
        ↓  SHA-256
player_<uuid>            ← the only identity the game uses
        ↓
player row (created once) + one-time starter package
        ↓
their farm (created once, on first request)
```

* The **subject**, not the email, is the identity: emails can change, and the id is derived so that
  no personal data is stored in it. The unique `(auth_issuer, auth_subject)` index means one person is
  always one player, whoever they sign in as and however many devices they use.
* The browser never sends an identity of its own: no `?player=`, no `X-Player-Id`, no stored player id
  the server would trust, no shared token in the bundle. Every command is authorized from the actor
  the Worker derived from the verified JWT.
* The development bridge (`dev-auth.ts`, `dev-index.ts`) is not in the deployed import graph and cannot
  exist in a staging or production build.

## First login, and why it is safe to retry

```text
verified identity
        ↓
player row (INSERT … ON CONFLICT DO NOTHING, then read back)
        ↓
one-time starter package (a receipt keyed by player, so it cannot be granted twice)
        ↓
"give me my farm" → the farm they own, or a new one
```

A phone that loses the response to *any* of those steps asks again, and gets the same answer:

* the player row is idempotent by the unique `(issuer, subject)` index;
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
| Distinct players, distinct farms, distinct islands | `handler.test.ts`: "gives two testers their own world, and lets neither touch the other's" |
| One farm per tester, however often they ask | `handler.test.ts`: "gives a player one farm, however many times they ask for one" |
| Another player's farm is refused | `handler.test.ts`: "rejects cross-player farm access", "refuses another player's farm, and an unauthenticated caller" |
| Wallets, inventory and ledger are per player | `handler.test.ts`: "isolates wallets, inventory, and stored results across players" |
| One player's purchase moves only their gold | the same alpha test: A buys, A's balance falls 100 → 96, B's stays 100, and only A has a ledger row |
| One player's edit leaves the other island untouched | the same alpha test: A stores one of their own objects and B's construction rows are compared row for row |
| Nobody else may edit an object, not even a colleague | `handler.test.ts`: "lets nobody else edit it: not another farm's owner, and not a colleague who did not build it" |
| Client-supplied ownership is rejected outright | `handler.test.ts`: "rejects client-selected ownership fields", "returns only the authenticated actor's wallet and ignores client-selected owners" |
| Two farms' starter islands are separate | `handler.test.ts`: "keeps two farms' islands apart" |

Cross-player requests answer **403** rather than 404 when the resource exists, and 404 when it does
not - which is the API's existing convention, and it is deliberate: the farm id a tester holds is one
they were given, so "not yours" is the honest answer.

## The test itself

Two testers, two devices. Fill this in as you go.

**Tester A**: `____________`  **Device/browser**: `____________`
**Tester B**: `____________`  **Device/browser**: `____________`
**Date**: `____________`

### Accounts and isolation

- [ ] A signs in and lands in a farm (100 gold, 10 carrot seeds)
- [ ] B signs in and lands in a *different* farm
- [ ] A moves the character; B sees no change
- [ ] A buys the cheapest shop item; B's gold is unchanged
- [ ] A places/moves/stores one object; B's island is unchanged
- [ ] A reloads: their farm, gold and edits are all still there
- [ ] B reloads: theirs are too
- [ ] A signs in on a second device: the *same* farm, not a new one

### Then the V13.5 mobile checks (per device)

- [ ] joystick: forward, back, left, right, diagonal
- [ ] release stops the character immediately
- [ ] Run works, and joystick + Run together
- [ ] camera drag with the other thumb, while moving
- [ ] pinch zoom
- [ ] rotate the camera 180° and move forward: still camera-relative
- [ ] Estate view: tap a tree, a rock, a building, the ground
- [ ] Build Shop: open, scroll, pick an item, Place, Confirm, Cancel
- [ ] object editing: Move, Rotate, Store, Delete (with its confirmation)
- [ ] portrait ↔ landscape: no reload, no duplicate joystick, no stuck movement
- [ ] 5 minutes of play: smooth / acceptable / poor `__________`

## Known limitations

* **The Access application does not exist yet** (see above). Until it does, a phone will load the shell
  and then show "Not signed in" while every API call answers 401.
* Staging is reachable on a `workers.dev` hostname; a custom domain is optional and only easier to type.
* One farm per player is enforced (V13.6.1). A future pass that wants several farms per tester drops the
  unique index in its own migration.
* There is no reset or admin tooling. A tester who wants a clean farm needs a new identity - a second
  Access email - or a deliberate operator action on the staging database.
* Migrations are forward-only: a rollback of the Worker across a migrated schema is not supported.
* The starter package policy on staging is `ALL_UNRECEIPTED`, so an existing alpha tester who has no
  receipt is given it once. Production leaves that unset.
