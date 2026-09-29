# ADR 0011: Playable development startup

Status: Accepted (independent audit completed 2026-09-29; pending commit)

## Problem

The development page exposed authentication plumbing as gameplay: a developer had to copy a bearer
token into the browser, bootstrap a player, and manually create or reload a farm. That made a working
game look broken and placed a local secret in browser storage.

## Decision

The Vite middleware attaches the server-held development bearer token only for requests whose Host
is `localhost`, `127.0.0.1`, or `[::1]`. A non-loopback Host receives no injected credential and the
development Worker continues to fail closed. The browser never receives, stores, or submits the
token, and production still uses the separate fail-closed entrypoint.

On page load the client calls the existing idempotent dev bootstrap. It then loads the farm ID kept
in local browser storage; if that farm no longer exists, it clears the stale reference and creates a
new `Starter Farm`. Farm creation remains the existing authenticated server command and still
creates the authoritative starter tiles atomically.

## Consequences

- `npm run dev` followed by opening the printed localhost URL goes directly into a playable farm.
- The Session/token controls are removed from the game UI.
- Clearing browser storage creates another development farm; it does not delete server data.
- Exposing Vite with a LAN Host does not grant automatic dev authority.
