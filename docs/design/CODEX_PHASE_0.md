# CODEX PHASE 0 — Safe Art Integration Infrastructure

Read DESIGN_SYSTEM.md and inspect current **local** HappyFarm source. This package is a handoff, **NOT actual art**. Do not implement new UI visuals from placeholder paths in the example manifest.

Goal: prepare a typed, backwards-compatible art-to-DOM integration route:

1. Inspect existing `apps/web/src/ui/components.ts`, `main.ts`, CSS, Build and Market view ownership. Record current selectors and dependencies.
2. Propose or implement minimal `ui-art-v2` registry/types with stable keys for panel/button/card icons, states and nine-slice caps. Use Vite static imports / asset mapping supported by the actual build; do not rely on runtime arbitrary filesystem URLs.
3. Add optional theme namespace and a safe fallback to the current theme for assets not yet supplied.
4. Make it possible for a screen to opt in explicitly, **without global overrides**, and preserve all existing DOM, events, i18n, keyboard/touch and game state.
5. Include a deterministic test that missing V2 art is not silently mistaken for production art.
6. Do NOT auto-apply V2 to any real screen until actual authored artwork is supplied and passes quality checks.
7. Run focused tests, typecheck, lint, build, git diff --check. No deploy, commit, push, reset, stash or clean.

Output: precise integration points, changed files (if any), test results and art dependencies needed for Phase 1. **No visual approval claim.**
