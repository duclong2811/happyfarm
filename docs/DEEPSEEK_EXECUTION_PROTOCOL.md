# DeepSeek Restricted Execution Protocol

## Purpose

This protocol applies to every task delegated to DeepSeek inside the HappyFarm repository.

DeepSeek is an implementation agent, not the architecture owner.

Existing architecture, contracts, migrations, domain invariants, security rules, ADRs, and GPT-5.6-approved interfaces are authoritative.

DeepSeek must implement only the explicitly assigned scope.

---

# 1. Required Reading

Before making changes, read:

- `AGENTS.md`
- `docs/CONTEXT_INDEX.md`
- this file
- only the task-specific files explicitly named in the task prompt

Do not scan the entire repository.

Do not inspect unrelated domains unless a concrete blocker requires it.

---

# 2. Architecture Freeze

DeepSeek MUST NOT independently change:

- dependency direction
- package boundaries
- authentication architecture
- authorization architecture
- server-authoritative rules
- database architecture
- idempotency design
- concurrency strategy
- economy architecture
- migration strategy
- public contracts
- stable error semantics
- source-of-truth ownership

unless the task explicitly authorizes that change.

If implementation appears to require an architecture change:

STOP.

Return:

`ARCHITECTURE_CHANGE_REQUIRED`

Include:

- why the current architecture prevents the task
- affected files/interfaces
- smallest proposed architectural decision

Do not implement the architecture change.

---

# 3. Migration Freeze

Existing committed migrations are immutable.

Never modify an existing migration unless the task explicitly says otherwise.

If an existing migration appears incorrect:

STOP.

Return:

`UPSTREAM_ISSUE_FOUND`

Include:

- migration
- observed issue
- reproduction
- potential impact

Do not silently rewrite migration history.

---

# 4. Allowed File Scope

Every DeepSeek task should define:

```text
ALLOWED_FILES:
...
```

DeepSeek may modify only those files/directories.

If implementation genuinely requires another file:

STOP.

Return:

`OUT_OF_SCOPE_FILE_REQUIRED`

Include:

- required file
- why it must change
- what minimum change would be required

Do not silently broaden scope.

---

# 5. Forbidden Actions

Never:

- introduce a generic wallet mutation endpoint
- introduce a generic inventory mutation endpoint
- trust client-provided player identity
- trust client-provided prices
- trust client-provided rewards
- trust client timestamps for authoritative progression
- bypass application/domain services
- bypass centralized InventoryService
- bypass centralized EconomyService
- mutate D1 directly from frontend code
- disable authentication or authorization
- introduce production debug authentication
- weaken runtime validation
- weaken database constraints
- remove tests to make a build pass
- alter existing migrations without authorization
- expose secrets
- expose raw SQL/database errors to clients
- perform unrelated refactors
- change architecture because another design seems preferable

---

# 6. Source-of-Truth Rule

Before implementing, identify the existing authoritative source for every state the task touches.

Examples:

```text
Inventory quantities -> centralized inventory service / persistence
Wallet balance       -> centralized economy service / wallet persistence
Crop occupancy       -> authoritative crop-instance model
Shop pricing         -> authoritative game-data shop registry
Player identity      -> authenticated server actor context
```

Do not introduce a second authoritative representation.

Derived DTOs, UI state, and cached presentation state are not authoritative sources.

---

# 7. Existing Service Reuse

If the repository already has a centralized service or port for the operation, use it.

Do not duplicate business rules inside:

- API handlers
- frontend code
- test helpers
- repositories
- unrelated domains

Repositories persist authoritative decisions; they should not become duplicate business-rule owners.

---

# 8. Pre-Implementation Check

Before editing, determine:

```text
Goal
Allowed files
Existing interfaces to reuse
Inputs controlled by clients
Persistent state affected
Security implications
Concurrency implications
Tests required
```

If the task conflicts with existing architecture or security rules, stop before coding.

---

# 9. Implementation Rule

Make the smallest coherent change that satisfies the assigned task.

Avoid:

- speculative abstractions
- premature future features
- broad renaming
- opportunistic cleanup
- unrelated formatting changes

Prefer small reviewable diffs.

---

# 10. Runtime Validation

All externally controlled inputs must continue to use the repository's established runtime-validation approach.

Do not rely solely on TypeScript types.

Do not introduce another validation framework without explicit authorization.

---

# 11. Authentication and Authorization

Authentication proves who the actor is.

Authorization decides what the actor may do.

Do not infer identity from:

- request body
- query parameters
- user-controlled headers
- local storage
- frontend state

Do not bypass current authorization checks for convenience.

---

# 12. Data Integrity

For every persistent mutation consider:

- uniqueness
- FK behavior
- bounds
- integer overflow
- negative values
- duplicate requests
- partial writes
- stale state
- concurrent requests
- rollback behavior

Do not silently clamp invalid authoritative values unless the product specification explicitly defines clamping.

---

# 13. Concurrency

If the assigned task mutates persistent state, determine whether concurrent execution can cause:

- lost updates
- duplicate rewards
- double spending
- duplicate items
- stale writes
- negative quantities
- inconsistent state

Do not fix concurrency-sensitive systems outside task scope.

If a required concurrency guarantee is missing upstream:

return:

`ARCHITECTURE_CHANGE_REQUIRED`

or:

`UPSTREAM_ISSUE_FOUND`

as appropriate.

---

# 14. Idempotency

Where an existing use case uses idempotency:

preserve existing semantics.

Never weaken:

- actor isolation
- operation isolation
- request payload fingerprinting
- replay authorization checks
- duplicate-mutation prevention

Do not invent a separate idempotency mechanism for one feature unless explicitly authorized.

---

# 15. Tests

Run tests directly relevant to the task.

Where practical also run the repository's standard verification command.

Never state that tests passed unless they were actually executed.

Do not delete, skip, weaken, or rewrite unrelated tests merely to obtain a green suite.

If an existing test exposes an upstream issue outside allowed scope:

do not modify production architecture automatically.

Return:

`UPSTREAM_ISSUE_FOUND`

---

# 16. Sandbox / Environment Failures

Distinguish product failures from environment failures.

Examples:

- process-spawn restrictions
- workerd Windows crash
- unavailable external binary

If verification requires escalation or an alternate approved command, report exactly what was used.

Do not claim an unavailable environment check succeeded.

---

# 17. Mandatory Final Diff Audit

Before reporting completion, inspect the complete task diff.

Audit the following areas.

## Scope

Confirm:

- only allowed files were changed
- no unrelated refactor occurred
- no generated junk was introduced

## Architecture

Confirm:

- no new source of truth was introduced
- dependency boundaries remain unchanged
- existing centralized services were reused
- no architecture-sensitive file was modified without permission

## Security

Confirm:

- no client-controlled authoritative values are trusted
- authentication is unchanged unless explicitly in scope
- authorization is unchanged unless explicitly in scope
- no secret/debug authentication was added
- errors do not leak internals

## Data Integrity

Confirm:

- no negative/overflow state can be introduced
- no obvious lost-update path was added
- no duplication path was added
- persistent updates use existing transaction semantics

## Tests

Confirm:

- relevant failure cases exist
- no assertions were weakened
- no tests were removed to make the task pass

---

# 18. Forbidden Automatic Fixes

DeepSeek must not automatically repair architecture-sensitive upstream code discovered during an isolated task.

Examples:

- auth bug
- economy race condition
- broken migration
- idempotency design flaw
- permission-model flaw
- cross-module contract defect

Report the problem and let GPT-5.6 review it.

---

# 19. Commit Policy

Default:

DO NOT COMMIT.

DeepSeek produces a reviewed working-tree diff.

GPT-5.6 performs the architecture/security audit before the change is committed.

A DeepSeek task may commit only when the prompt explicitly authorizes it.

---

# 20. Completion Verdict

Return exactly one primary verdict:

`TASK_COMPLETE`

`TASK_BLOCKED`

`ARCHITECTURE_CHANGE_REQUIRED`

`OUT_OF_SCOPE_FILE_REQUIRED`

`UPSTREAM_ISSUE_FOUND`

---

# 21. Required Final Report

Use this exact structure.

## Verdict

`<VERDICT>`

## Goal

Short statement of the assigned goal.

## Files changed

Exact files changed by this task.

Distinguish them from pre-existing dirty-worktree changes.

## What changed

Concise implementation summary.

## Existing code reused

List important existing services/interfaces/registries reused rather than duplicated.

## Tests run

For every command report:

```text
command
result
```

If escalation or an alternate execution environment was needed, state it.

## Scope audit

Confirm:

- allowed file scope respected
- no unrelated refactor
- no unauthorized migration/architecture changes

## Architecture audit

Confirm:

- no new authoritative source introduced
- dependency direction preserved
- centralized services reused
- public contracts unchanged unless task allowed them

## Security audit

State checks relevant to the task, including where applicable:

- authentication
- authorization
- client-controlled data
- runtime validation
- error leakage
- secret/debug exposure

## Data-integrity audit

State checks relevant to the task, including where applicable:

- uniqueness
- bounds
- overflow
- concurrency
- idempotency
- transaction behavior

## Migrations / contracts

State:

- migrations changed or unchanged
- public contracts changed or unchanged

## Pre-existing working-tree changes

Explicitly identify relevant dirty files that existed before this task and were not authored by DeepSeek.

## Remaining risks

List real remaining risks only.

If none:

`None identified within assigned scope.`

## GPT-5.6 review focus

List any parts of the diff that GPT-5.6 should inspect especially carefully before commit.

---

# 22. Final Principle

When uncertain between:

```text
making a broader change
```

and:

```text
stopping and requesting GPT-5.6 review
```

choose the second option.

HappyFarm prioritizes:

```text
SECURITY
DATA INTEGRITY
SERVER AUTHORITY
ARCHITECTURE CONSISTENCY
SMALL REVIEWABLE DIFFS
```

over implementation speed.