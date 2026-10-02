# Identity: player, identity, and how a guest becomes an account

Status: implemented in V13.6.2 (guest alpha) on top of the V13.6/V13.6.1 Access work.

## The one invariant

**A player is the durable owner; an identity is one way of proving who that player is.**

```text
Identity  -->  Player  -->  Farm  -->  Wallet, Inventory, Progression, World, Storage
```

Everything that belongs to somebody in Happy Farm hangs off `players(id)`. An identity only ever
answers "which player is this?". That is why a guest is *not* a throwaway farm: the guest identity
points at a real player with a real farm, and a later sign-in attaches a second identity to that same
player instead of founding a new one.

Do not build any of these, ever:

* `guest = farm`
* `google account = farm`
* `email = player primary key`
* a player id the browser chose (`?player=`, `X-Player-Id`, a trusted local-storage id)

## Model

| Concept | Where it lives | Notes |
| --- | --- | --- |
| Player | `players` (migration `0001`) | The durable owner. `auth_issuer`/`auth_subject` remain its **primary** identity, kept for compatibility. |
| Identity | `player_identities` (migration `0015`) | `(kind, issuer, subject)`, unique. Several rows may name one `player_id`. |
| Actor | `ActorContext { playerId }` in `packages/application` | What a use case authorizes against. It never carries an identity kind. |
| Pure rules | `packages/domain/src/identity.ts` | `identityKey`, `attachIdentity`, `resolveIdentity`. |

`kind` is one of `GUEST`, `CLOUDFLARE_ACCESS`, `GOOGLE`, `EMAIL`. The first two exist today; the
other two are names the schema already accepts, so a future linking pass needs no schema change.

### Why a second table

`players` is unique on `(auth_issuer, auth_subject)`: one player could hold exactly one identity. That
is enough for one provider and impossible for "sign in with Google, keep my farm". Migration `0015`
is additive - no table is rebuilt, no column is dropped, no row is rewritten - and it backfills every
existing player as a `CLOUDFLARE_ACCESS` identity whose `(issuer, subject)` is the pair already on
their `players` row. A player created later gets its identity row written at creation time, so the
two stay in step.

## Guest identity

A guest credential is 32 random bytes from `crypto.getRandomValues`, encoded base64url (43
characters). It travels in an opaque cookie, and **only its SHA-256 is stored** - for a guest, the
identity's `subject` *is* that hash - so a database leak does not hand out usable sessions. Nothing
derives a guest identity from the device: no fingerprinting, no IP, no user agent, no `Math.random()`.

```text
first visit
  GET /api/session                (no cookie, guest play allowed)
    -> mint a credential
    -> hash it, create the player + the GUEST identity (both ON CONFLICT DO NOTHING)
    -> apply the one-time starter package through the shared use case
    -> Set-Cookie: hf_guest=...; Path=/; Max-Age=15552000; HttpOnly; Secure; SameSite=Lax
  -> the client then asks for its farm, which is created once (the V13.6.1 rules)

return visit
  GET /api/session                (cookie present)
    -> hash it, look the identity up by hash
    -> the same player, the same farm; nothing to set
```

* **Lifetime**: 180 days. Long enough for a tester who comes back after a break, short enough not to
  be an immortal credential. Revocation, when it is wanted, is deleting the identity row.
* **Invalid credential**: an edited, unknown, truncated, or malformed cookie is "no session", and the
  request may mint a **new** identity - never adopt an existing player. There is no path by which an
  unprovable credential reaches somebody else's farm (tested).
* **New device / private window / cleared site data**: a new identity, therefore a new player and a
  new farm. Chrome and Edge on one phone are two guests. This is expected, and it is what the tester
  notes say.

### Where guest play is switched on

`GUEST_AUTH_ENABLED = "true"` in `workers/api/wrangler.staging.toml`, and nowhere else. Absent, blank,
or any other value means off, which is the production default. The decision is read once, at the
authentication boundary (`workers/api/src/index.ts`), so no route contains an `if (staging)`.

## Authentication boundary

```text
request
  |
  +-- verified Cloudflare Access JWT? -- yes --> Access player (onboarded + starter package)
  |
  +-- no, but a valid guest cookie and guest play is on? -- yes --> guest player
  |
  +-- otherwise --> NOT_AUTHENTICATED        (no player is ever created here)
```

`CompositeAuthenticator` tries Access first, so a browser holding both identities is always the
stronger one. Ordinary routes **resolve** an identity; only `GET /api/session` may **create** one, so
a refused request cannot leave a player behind as a side effect. Establishment is therefore one
explicit, safe GET at boot rather than something that happens inside every command.

### CSRF

Guest sessions are cookie-borne, so unsafe requests are guarded two ways: `SameSite=Lax` keeps the
cookie off cross-site requests, and `workers/api/src/origin-guard.ts` refuses any unsafe request whose
`Origin` header names a different origin than the request URL - answering 401 before authentication.
Safe methods are untouched, and a request with no `Origin` (curl, a smoke test, server-to-server) is
allowed; a browser always sends one for a cross-origin unsafe request, which is the case this check
exists for.

## Future: linking a Google or email account

Not implemented. The schema and the ports are shaped for it: attach the new identity to the **same**
player id and both identities resolve to one player, one farm, one wallet, one world.

The conflict case must not be auto-merged:

```text
Guest identity G --> Player P --> Farm F     (progress already made)
Google identity X --> Player Q --> Farm Q    (already exists)
```

`attachIdentity` refuses this (`IDENTITY_ALREADY_LINKED`), and the database's unique key enforces the
same rule. Merging two players' progress is a product decision with real consequences, so the future
linking pass owns an explicit merge/recovery policy; a plain link request must never move somebody
else's farm.

A future UI concept ("Save Progress" / "Continue with Google") would hang off the session endpoint's
`kind`: the page can already tell a guest from an Access player, so it can decide whether there is
anything to link. V13.6.2 ships no such control, and no fake one.

## Where the code lives

| Concern | File |
| --- | --- |
| Access JWT verification, id derivation | `workers/api/src/access-auth.ts` |
| The session port (`GET /session`) | `workers/api/src/session.ts` |
| Guest credential, cookie, directory, session service | `workers/api/src/guest-auth.ts` |
| Multi-identity repository | `workers/api/src/player-identities.ts` |
| Access onboarding (player row + starter package) | `workers/api/src/player-onboarding.ts` |
| Cross-origin mutation guard | `workers/api/src/origin-guard.ts` |
| Pure identity rules | `packages/domain/src/identity.ts` |
| Migration | `database/migrations/0015_player_identities.sql` |
| Client boot | `apps/web/src/main.ts` (`startSession`, `boot`), `apps/web/src/api.ts` (`getSession`) |

Tests: `tests/domain/identity.test.ts`, `tests/api/guest-alpha.test.ts`,
`tests/api/origin-guard.test.ts`, and the Access and onboarding suites
(`tests/api/access-auth.test.ts`, `tests/api/deployed-onboarding.test.ts`).
