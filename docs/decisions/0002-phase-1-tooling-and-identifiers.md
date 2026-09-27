# ADR 0002: Phase 1 tooling and identifiers

Status: Accepted

## Decision
- Use npm workspaces without an additional monorepo framework.
- Use strict TypeScript across packages, Worker, tests, and the minimal web shell.
- Use Zod as the single runtime-validation library for public contracts and externally loaded game data.
- Use Vitest for unit, application, API, and D1-compatible integration tests.
- Use opaque string IDs with an entity prefix and server-generated UUID, such as `player_<uuid>`, `farm_<uuid>`, and `cropinst_<uuid>`.

## Consequences
Clients cannot choose authoritative farm IDs. Domain IDs are branded to prevent accidental cross-entity use, contracts validate their wire format, and infrastructure persists them as text. Authentication adapters resolve the trusted `(issuer, subject)` pair to a server-owned player ID.
