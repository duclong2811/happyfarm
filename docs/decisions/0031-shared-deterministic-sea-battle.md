# 0031: One deterministic sea-battle simulation, shared by the browser and the server

Status: accepted (2026-11-19)

## Context

The owner wants realtime naval fights (docs/design/NAVAL.md), and Cloudflare requests kept low.
A realtime, server-stepped sea (a Durable Object per area, WebSockets) is the eventual home of fights
with several players: pirate lairs, sea monsters, and open-world PvP. A solo pirate ambush does not
need one.

## Decision

- The fight is one pure simulation: `packages/domain/src/sea-battle.ts`.
  - The player's device plays it live and records only the player's inputs.
  - One request submits the inputs, and the server replays the same simulation from the same setup
    to decide the result.
  - The client never reports a hit, a position or a winner.
- The simulation is deterministic to the bit on every JavaScript engine:
  - only `+ - * /` and `Math.sqrt` touch floating point;
  - sine and cosine are a fixed polynomial over whole heading units;
  - randomness is a seeded 32-bit integer generator;
  - the order of every update is fixed.
  A test fails the build if the module calls an engine-dependent `Math` function.
- **Deliberate dependency edge.** `apps/web` may import this pure module from `@happy-farm/domain`,
  and nothing else from the domain. It has no state, no I/O and no dependencies. The alternative, a
  new workspace package, would make every deployment re-run `npm install` for no other gain.
- The future Durable Object for many-player fights steps this same simulation. The solo version is
  not throwaway work.

## Consequences

- A player can play an ambush without any request while fighting: two requests per voyage at most
  (set sail, submit the fight).
- An input log could be crafted offline to play an optimal fight. For PvE with small rewards this is
  accepted. Open-world PvP will need the server-stepped version (the Durable Object) and is not built
  on input logs.
- Changing the simulation changes the outcome of fights replayed afterwards. A fight is replayed when
  it is submitted, so a deployment between playing and submitting can change one result. Accepted
  for now; a version field on the setup can pin it later.
