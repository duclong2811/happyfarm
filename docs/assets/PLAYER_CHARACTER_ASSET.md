# Player character asset

Status: what the player character is made of, where it came from, and what was done to it on the way
in. Update this file in the same change that replaces the character.

## The asset

| | |
| --- | --- |
| Asset | **Kenney Mini Characters** (pack version 1.0) |
| Creator | Kenney - <https://kenney.nl> |
| Source page | <https://kenney.nl/assets/mini-characters> |
| Download | <https://kenney.nl/media/pages/assets/mini-characters/bfc7e272b4-1774770718/kenney_mini-characters.zip> |
| Licence | **CC0 1.0** (Creative Commons Zero) - <https://creativecommons.org/publicdomain/zero/1.0/> |
| Retrieved | 2026-10-02 |
| Files used | `Models/GLB format/character-male-a.glb`, and the `Models/GLB format/Textures/colormap.png` it refers to |
| Shipped as | `apps/web/src/assets/models/player/player-farmer.glb` |

### Why this licence is safe to state

Two independent statements were read at the source, not inferred:

* the pack's own page says "Download this package (25 assets) for free, CC0 licensed!";
* the `License.txt` inside the archive says "Mini Characters (1.0) ... Created/distributed by Kenney
  (www.kenney.nl) ... License: (Creative Commons Zero, CC0) ... You can use this content for personal,
  educational, and commercial purposes."

Crediting Kenney is requested but not required by CC0; the credit is given here, in
`docs/ASSET_LICENSES.md`, and in the manifest entry that names the pack.

## What was used, and what was not

The pack holds twelve characters (six male, six female), a set of accessibility aids (canes, a
crutch, glasses, hearing aids, defibrillators), four wheelchairs, and a shared palette. **Only
`character-male-a` is shipped.** The other characters are a character-creator's worth of options that
nothing draws yet (see the extension points in `docs/design/PLAYER_CHARACTER.md`), and the aids and
wheelchairs are for a game about mobility rather than about farming. Nothing from the pack's FBX
folder is shipped.

## What was done to it

`tools/asset-pipeline/node/import-kenney-character.mjs` - run once, from a temporary extraction
outside the repository - does exactly one thing to the model: **the palette is embedded**. The pack
ships its GLB with the image as a sibling file (`Textures/colormap.png`), and a model that refers to a
sibling does not survive Vite's asset hashing, so the PNG (8,706 bytes, already small enough not to
need downscaling) is folded into the model's binary chunk as a `bufferView`.

Nothing else is touched:

* the **geometry is not normalised** - unlike every other model in this project, which the pipeline
  rewrites to "one unit tall, base on y = 0". This one is a *skinned* mesh, and rescaling POSITION
  accessors without the skeleton would tear the skin apart. Its size is handled as a presentation
  concern instead: the client measures the loaded model and scales it to the world's character height
  (`apps/web/src/render/player-character.ts`);
* the materials, the single palette texture, the skeleton and all 32 animation clips are kept exactly
  as the pack authored them.

The import's own report is committed as
`tools/asset-pipeline/node/character-import-report.json`, so a change in the pack is visible in review.

## The shipped file

| | |
| --- | --- |
| Size | 253,400 bytes (≈248 KiB) |
| Triangles | 723 |
| Meshes | 2 (body, head), both skinned |
| Skins | 2, of 7 joints each (root, torso, head, two legs, two arms) |
| Materials | 1 (`colormap`, base colour texture, metallic 0, double-sided) |
| Textures | 1 - the embedded 256-colour palette PNG |
| Animation clips | 32 |
| Native bounds | 0.767 × **0.671** × 0.340 world units, base on y = 0 |
| Drawn at | 1.6 m tall (scale ≈ 2.383), feet on the ground |

Most of the file is animation data rather than geometry. The whole clip set ships because a later pass
wants it (picking up, interacting, holding tools, the wheelchair set), and the brief for this pass
rules out destructive optimisation; a future pass that wants a smaller bundle can trim it to the
clips the game actually plays.

## Replacing it

1. Put the new model in `apps/web/src/assets/models/player/` (see the note in
   `character-model-urls.ts` about why an imported asset does not live beside the *generated*
   placeholder).
2. Add or edit one entry in `apps/web/src/render/character-model-urls.ts`.
3. Point `PLAYER_CHARACTER_ASSET` in `apps/web/src/render/player-character.ts` at that id and, if the
   new pack names its clips differently, update the idle/walk/run names and the facing correction.
4. Add a row to `docs/ASSET_LICENSES.md` and update this file.

No controller, camera, collision or scene code changes.
