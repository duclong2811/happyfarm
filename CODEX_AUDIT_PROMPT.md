# Codex Repository Audit Prompt

Audit this repository BEFORE implementing gameplay.

Read in this order:
1. `AGENTS.md`
2. `docs/CONTEXT_INDEX.md`
3. `docs/PROJECT_SPEC.md`
4. `docs/architecture.md`
5. `docs/DATA_MODEL.md`
6. `docs/protocols.md`
7. `.agents/skills/security-review/SKILL.md`
8. `docs/decisions/0001-cloudflare-native-stack.md`
9. `references/README.md`
10. `docs/templates/TASK_TEMPLATE.md`

Do not write gameplay code yet.

Check the repository for these questions:

1. Are the current files sufficient to keep AI agents from drifting across data, backend, frontend, multiplayer, and security boundaries?
2. Is there exactly one clear source of truth for:
   - architecture
   - product scope
   - data model
   - API/WebSocket contracts
   - security review
   - task/context-reading rules
3. Are there contradictory or duplicated rules that could make agents choose different implementations?
4. Is any critical security requirement missing for:
   - authentication
   - authorization
   - runtime validation
   - D1 access
   - migrations
   - economy/inventory integrity
   - idempotency/replay
   - race conditions
   - Durable Object multiplayer
   - secrets/logging/errors
5. Is any critical data-integrity rule missing?
6. Is the architecture sufficiently Cloudflare-native while keeping domain logic portable?
7. Can agents work on one module without reading the whole repository?
8. Are external/reference repositories sufficiently isolated from production code and license risk?
9. What files are genuinely missing BEFORE Phase 1 implementation? Do not recommend documentation merely for completeness.
10. What files should wait until code scaffolding exists (for example exact development commands, deployment runbooks, generated API docs)?

Then inspect the actual repository tree and compare it with the intended boundaries in `AGENTS.md`.

Output exactly these sections:

## Verdict
READY_FOR_PHASE_1 or NOT_READY_FOR_PHASE_1

## Missing Before Phase 1
Only critical missing files/rules. If none, say `None`.

## Contradictions / Duplicate Sources of Truth
List concrete conflicts with file paths. If none, say `None`.

## Security / Data Integrity Gaps
List concrete gaps. If none, say `None found in documentation baseline`.

## Context / Token Efficiency
State whether `docs/CONTEXT_INDEX.md` is sufficient to avoid broad repo scans and propose only necessary improvements.

## Files That Should Wait
List documents/configs that should be created only after the code scaffold exists.

## Phase 1 Scope
Confirm Phase 1 should contain only:
- Player
- Farm
- FarmMember / roles foundation
- logical Tile
- stable ID conventions
- game-data schema foundation
- minimal D1 migration/repository boundaries if scaffolding requires them

Explicitly exclude final renderer, economy implementation, multiplayer gameplay, trees/animals/fish, and UI polish.

## Recommended Changes
Provide a minimal ordered patch list. Do not implement changes unless they are required to reach READY_FOR_PHASE_1.

Finally run a diff/tree review and ensure no real secrets are present.
