# HappyFarm V2 — Visual Acceptance Checklist

## Evidence setup

- Open actual local Vite app on Chrome/Edge (not a separate concept preview).
- Keep same real game state, same screen and viewport before vs after.
- Desktop 1440x900; mobile 390x844; include a high-DPI check where feasible.
- Capture one full-screen + one close crop of each modified panel. No real buy/sell/place mutations needed for UI review.
- Do not include DevTools covering the app viewport in comparison screenshots.

## Visual pass/fail

- [ ] **Large surfaces changed:** shell and card materials genuinely V2, not V1 under new ornamental corners.
- [ ] New silhouette has intentional depth: top light, darker side/bottom, proportional contact shadow.
- [ ] Saturation is vivid but text contrast remains strong over game world.
- [ ] Real item thumbnail (or identity-neutral fallback) occupies enough of the card.
- [ ] Header, categories, cards, details and primary action share the same material light direction and contour weight.
- [ ] Vietnamese body/heading fonts render correctly; prices and tabs remain readable.
- [ ] Selected and disabled states are differentiated beyond color alone.
- [ ] No decorated edges are stretched, no seams or opaque matte halos.
- [ ] Long translations, empty/no-data/error, scroll and all controls are usable.
- [ ] Mobile composition remains deliberate with accessible close/action controls.
- [ ] Asset bytes/loading do not cause a noticeable regression (measure in browser network/performance rather than guessing).

## Functional/regression checks

- [ ] Existing callbacks/handlers unchanged.
- [ ] Server-authoritative resources/prices/quantities unchanged.
- [ ] UI correctly displays current data and no invented game systems.
- [ ] No unintended interaction with the 3D world behind open modal.
- [ ] Tests/typecheck/lint/build/diff check pass.

**Acceptance requires user's real screenshot review.** Tests or a static asset board alone are never sufficient.
