# V16.2.2A.1 - Work Area selection UX hotfix

Date: 2026-10-04. Verdict: **V16_2_2A_1_WORK_AREA_SELECTION_UX_COMPLETE**.

A presentation hotfix for the work-area editor. No model, migration, contract or authority change -
with one exception, a real bug the required remote smoke found in the delete path (section 21).

## 1. Input model before / after

```text
before: edit mode was implicit (a session existed or not); selection was cells only, with no hover,
        no lattice, no rectangle preview until the second tap, and no validity feedback.
after:  an explicit editor state drives one overlay; the lattice, hover, live rectangle preview,
        refused-ground marks, the armed corner and the draft are all visible while editing, and all of
        it is gone the moment the editor closes.
```

The editor is still *local* state in `main.ts` (`workAreaEditor`), not a global mode: entering is
opening the panel's editor, leaving is save, cancel or closing the panel.

## 2. Desktop selection behaviour

Click a cell to add it and arm it as the first corner; move the pointer to preview the rectangle; click
again to fill it. A click on an already-selected cell removes it. The pointer's own hover is already
coalesced to one render per frame and reported only when the cell changes, so the preview costs the
frame a redraw was already costing.

**Why not drag-to-select:** the estate camera already owns left-drag on the ground (rotate/pan in
`pointer-gesture.ts`), and the brief's own fallback is explicit - keep the two-click gesture and make
the live preview strong. That is what shipped.

## 3. Mobile selection behaviour

The same three rules, no drag precision required: tap A (first corner, status says "tap the opposite
corner"), tap B (the rectangle fills), tap a selected cell to remove it. Touch input never reaches the
terrain under a panel: the panel is a sibling element above the canvas, and the canvas only receives
pointer events that land on it.

## 4. Grid implementation

`scene.setWorkAreaEdit(state)` owns a `workAreaGridGroup`. On entering edit mode it builds **one**
instanced mesh (`buildCellOutlines`) over the island's land cells - `terrain !== "WATER"`, so the open
sea is not a grid - with `cellWorkAreaGrid` (opacity 0.14). It is rebuilt only when the world changes,
and disposed on exit, so normal play still draws no grid at all.

## 5. Hover implementation

The renderer already raycaster-hovers one cell per frame, coalesced by `requestAnimationFrame` and
skipped when the cell is unchanged. `FarmSceneOptions.onCellHovered` now forwards that coordinate; the
host stores it on the session and redraws the overlay. **No request, no database, no scene rebuild.**

## 6. Rectangle preview

`rectanglePreview(corner, hover, fits)` expands the rectangle in memory and splits it into cells that
fit the kind and cells that do not. The scan is bounded (`MAX_WORK_AREA_PREVIEW_SCAN = 4096`) and the
valid list stops at the cap, so one stray gesture cannot build a huge request or a huge overlay. The
preview is a layer, never membership.

## 7. Manual add / remove

`applyDraftClick` is the whole rule, and it is pure:

1. a cell already in the draft is **removed**, and any armed corner is dropped;
2. otherwise, with no corner armed, the cell is **added and armed** - unless the ground refuses the
   kind or the cap is full, in which case the click is refused and nothing changes;
3. otherwise the click **fills the rectangle** between the corner and this cell, adding only cells
   that fit, stopping at the cap, and disarming.

That is deterministic, identical on mouse and touch, and lets a player punch a hole in a field
(`…██·██…`) with a single tap.

## 8. Invalid-cell behaviour

The client's own `CellCapability` answer decides: `cellFitsKind(kind, capabilities)` maps FARM/ORCHARD
to `FARM`, FORESTRY/MINING/LIVESTOCK/AQUACULTURE to their own words. Refused ground is drawn in
`cellWorkAreaInvalid` (muted red, opacity 0.22), is never added to the draft, and a fresh click on it
says so instead of doing nothing. Coordinates are never reinterpreted or snapped. The server's
`groundCapabilities` remains the authority: a client that is wrong shows a cell as selectable and has
the save refused.

## 9. Cap behaviour

The counter updates from local state on every click. At 256 cells a fresh click is refused with a
message, and a rectangle is clipped to the remaining room (with the same message), so the editor can
never construct a request the server would refuse.

## 10. Camera / input isolation

While the editor is open, `selectCell` hands the click to the draft and returns **before** the normal
selection, walking control, planting, object picking or placement handling - one gesture, one owner.
Nothing about the camera changed: left-drag still rotates, right-drag/middle-drag and wheel still pan
and zoom, and pinch still works on touch.

## 11. Performance characteristics

```text
pointer move      -> 0 API, 0 D1; one coalesced hover callback, and a redraw only when the cell changes
rectangle preview -> 0 API, 0 D1; bounded in-memory expansion, overlay rebuilt only when it changes
cell toggle       -> 0 API, 0 D1; local draft only
camera movement   -> no work-area traffic at all
Save              -> the only call the work-area API sees
```

The overlay is rebuilt only when a content signature changes (`setWorkAreaEdit`), never per frame, and
the lattice is one instanced draw call built once per editing session.

## 12. API / D1 behaviour

No route, payload, DTO or table changed. The only backend edit is the delete fix in section 21; it
changes no request shape and no authority rule.

## 13. Tests

`tests/web/work-area-editor.test.ts` grew from 10 to 26 tests: the pure click rule (add/arm, remove,
refuse on invalid ground, refuse at the cap, fill a rectangle, exclude refused cells, clip at the cap),
the scene state (nothing while renaming, committed cells drawn on open, preview split, hover invalid
mark, no rectangle in the state), the preview/cap helpers, and source guards that the estate click
reaches the draft before the ordinary selection and returns, that hover touches no API, and that the
lattice is switched on and off with the editor. `tests/api/work-area-loop.test.ts` adds the
cascade-count regression from section 21.

## 14. Gates

```text
typecheck                     pass
lint                          pass, 0 warnings
tests                         159 files, 1564 tests passed
production web build          pass
Worker dry-run (dev/staging)  pass
asset validation              27/27
git diff --check              clean
```

## 15. Files changed

```text
apps/web/src/work-areas/model.ts     click rule, preview split, scene state, cap guard
apps/web/src/main.ts                 editor state (hover), sync, status, hover wiring
apps/web/src/render/scene.ts         setWorkAreaEdit, lattice, marks, onCellHovered
apps/web/src/render/materials.ts     grid / preview / invalid / hover / corner materials
apps/web/src/i18n.ts                 pickFirst, pickSecond, capReached, invalidCell (en + vi)
workers/api/src/d1-repositories.ts   delete decisions: guard UPDATE, not the cascading DELETE
tests/web/work-area-editor.test.ts   +16 tests
tests/api/work-area-loop.test.ts     +1 regression test (cascade-inflated change count)
docs/qa/V16_2_2A_1_WORK_AREA_SELECTION_UX.md  this file
```

No migration, no new table, no contract change, no economic mutation, no Warehouse change, no
authority change.

## 16. Staging deployment

```text
Worker:      happy-farm-staging
Version ID:  e4dcb788-490d-478d-8e5f-ed2b511e8a15
Built:       2026-10-04T04:09:17Z
Bundle:      assets/index-B_bzChxQ.js
```

## 17. Rollback ID

`e2722690-be94-46ab-b999-860389ec6381` (the same UX bundle before the delete fix), and before that
`b4c415d8-47e9-45ea-b842-8a27707d86de` (V16.2.2A).

## 18. Remote smoke

```text
GET  /                     200   serves assets/index-B_bzChxQ.js
GET  /api/health           200
GET  /api/shop (no cookie) 401
GET  /api/session          200   guest cookie
GET  /api/wallet           200
GET  /api/warehouse        200
POST /api/farms            201   new farm
POST /farms/:id/work-areas 201   "East Field" on (9,26), (10,26)
GET  /farms/:id/work-areas 200   1 area, cellCount 2
POST .../cells             200   3 cells, version 2
POST .../delete (3 cells)  200   fixed; was 409 while deleting
POST .../delete (stale)    409   the version guard still refuses a stale delete
POST .../delete (current)  200
POST /api/shop/buy         200   Market unaffected
POST /farms/:id/crops      201   planting unaffected
```

## 19. Manual QA remaining (not performed)

Desktop: open Work Areas → New area → the lattice appears → hover a cell (obvious) → first corner →
rectangle preview → complete it → remove one cell → Save → reopen and confirm the exact shape →
cancel an edit and confirm nothing changed → close the panel and confirm the lattice is gone.

Mobile: open Work Areas → tap a corner → the status says "chọn góc thứ hai" → tap the second corner →
the rectangle appears → toggle one cell → Save → reopen → confirm pan and pinch still work.

## 20. Git status

The mixed working tree is preserved: nothing reset, stashed, restored or force-pushed, and no
historical WIP was touched. The hotfix files are listed in section 15.

## 21. Bug found and fixed (the one backend change)

The required remote smoke caught it: **deleting a work area answered `409 CONFLICT_STALE_STATE`
while the area was in fact deleted.** `D1WorkAreaRepository.deleteAtomically` decided "did my delete
apply?" from `meta.changes === 1` on
`DELETE FROM work_areas WHERE id = ? AND version = ?` - but D1 counts the rows an
`ON DELETE CASCADE` removed as part of that statement's count, so an area with one cell reports 2 and
one with three reports 4. The row was gone and the client was told the edit had failed.

The fix makes the guard its own statement: `UPDATE work_areas SET version = version + 1 WHERE id = ?
AND version = ?` (which cascades to nothing, so its count is exactly 0 or 1), then
`DELETE ... WHERE id = ? AND version = expected + 1`, and the decision is taken from the guard. A
racing editor whose guard failed deletes nothing. The local test double (`node:sqlite`) does not
inflate cascade counts, which is why the original tests passed; `tests/api/work-area-loop.test.ts`
now wraps the database so a delete reports the count D1 would, and that test fails against the old
implementation.

This is a bug fix inside the feature's own persistence, not a semantic change: no migration, no new
table, no route, no DTO, no authority rule.

## Explicit answers

| Question | Answer |
| --- | --- |
| Does pointer movement call API? | NO |
| Does rectangle preview call API? | NO |
| Does selecting cells write D1 before Save? | NO |
| Is the durable model still explicit cells? | YES |
| Is rectangle only a UI convenience? | YES |
| Does the grid disappear outside Work Area editor? | YES |
| Can selected cells be individually removed? | YES |
| Does mobile require drag precision? | NO |
| Were Work Area backend semantics changed? | NO |
| Were Jobs implemented? | NO |
| Were Actors implemented? | NO |
| Was Cargo implemented? | NO |
| Was Automation implemented? | NO |
| Was production deployed? | NO |

Final verdict: **V16_2_2A_1_WORK_AREA_SELECTION_UX_COMPLETE**.
