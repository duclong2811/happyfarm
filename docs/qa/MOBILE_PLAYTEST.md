# Mobile playtest checklist

Status: **not yet performed on a real device.** This is the checklist for the pass that does it, and it
says so plainly rather than implying a result. Everything below the line has been verified only in
mobile *emulation* (viewport + coarse-pointer emulation) or not at all; see
`docs/design/MOBILE_INPUT.md` and `docs/design/MOBILE_UI.md` for what the code is meant to do.

## Before starting

- [ ] Build and serve the current commit (`npm run build`, or `npm run dev` for a hot session).
- [ ] Open the game on the device over the local network (`--host`) or from the deployed static build.
- [ ] Record the device, the OS version and the browser version here: `____________`.
- [ ] Confirm the character asset loads (console shows `[character] loading` then `[character] loaded`)
      or, if it does not, that the placeholder is drawn and the failure is stated.

## Load and orientation

- [ ] The page loads to a rendered island on the first attempt; "Preparing 3D world…" disappears.
- [ ] Portrait: the game is playable, the controls are reachable, nothing is under the home indicator.
- [ ] Rotate to landscape and back, three times: no reload, no duplicated controls, no stuck movement,
      no model re-download, no camera jump, the player does not move.

## Character view

- [ ] Switch to Character view (the HUD button, and `F` on a keyboard if one is attached).
- [ ] The joystick appears bottom-left and Run bottom-right; both clear of the safe areas.
- [ ] Push the stick forward, back, left, right, diagonally: the character walks the way the camera
      faces, and a diagonal is not faster than a straight push.
- [ ] Push the stick a little: the character walks slowly (analog), inside the dead zone: it stands
      still.
- [ ] Hold the stick and drag the world with the other thumb: both work at once, the camera orbits, the
      character keeps walking.
- [ ] Hold Run and push: the character sprints (speed and the sprint animation).
- [ ] Pinch with two fingers: the camera zooms in and out, and the *page* does not zoom.
- [ ] Rotate the camera 180°, then push forward: the character still walks away from the camera.
- [ ] Lift every finger: the character stops immediately. Lift Run only: it stops running.
- [ ] Blur the browser (switch apps) while holding the stick and Run: on return, nothing is stuck.
- [ ] Watch the clips: idle when still, walk when moving, sprint when running; no foot sliding at a
      walk, no animation restart flicker when changing pace.
- [ ] Look at the character from front, back, left, right: the facing is right, the feet meet the
      ground, the camera does not clip through the head or the body.

## Estate view

- [ ] Switch back to Estate view: the joystick and Run disappear, the rail and the dock return.
- [ ] Tap a tree, a rock, a building and open ground: each selects the right thing (object panel, or
      the ground/cell).
- [ ] One-finger drag the world: the camera orbits, and the drag does **not** select anything on
      release.
- [ ] Two-finger pinch: zoom.
- [ ] Open the Build Shop: it comes up as a bottom sheet and the world stays visible above it.
- [ ] Scroll the catalog: the list scrolls, the camera does not orbit.
- [ ] Pick an item, press Place: the sheet closes, the placement HUD shows the asset, price, state,
      Confirm and Cancel.
- [ ] Tap a legal owned cell and Confirm: the object is placed. Tap Cancel instead: nothing changes.
- [ ] Try placing on unowned land, on water, and on an occupied cell: each refusal is explained.
- [ ] Select a placed object and use Move (tap a destination, confirm, and cancel), Rotate, Store
      (then restore it from the Storage sheet) and Delete (with its confirmation).

## Performance and stability

- [ ] Play for several minutes, switching Estate ↔ Character repeatedly and opening/closing the shop:
      the frame rate is steady, the device does not become uncomfortably hot, and the battery drain is
      acceptable.
- [ ] The console shows no errors and no repeated model downloads (`[character] loading` appears once).
- [ ] The joystick and Run still respond after twenty mode switches (no multiplied movement, no
      multiplied zoom).
- [ ] Backgrounding the tab and returning: the game resumes without a reload or a stuck input.

## Notes to fill in

- Browser tested: `____________`
- Device / OS: `____________`
- Subjective heat and battery: `____________`
- Anything that looked or felt wrong: `____________`
- Screenshots or a screen recording, if any: `____________`

## Already known, and expected

* The joystick only exists in Character view, and only for a coarse pointer. A phone with a mouse
  attached keeps its desktop controls.
* Estate view has no joystick by design: movement in estate view is click-to-move (and WASD).
* Two-finger pan is not implemented; panning is a mouse gesture.
