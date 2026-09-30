# HappyFarm Art Bible

Status: living document. Update it in the same change that moves a number it states.
Audience: whoever authors or generates a HappyFarm model, in Blender or in code.

Every number below is read from the source that owns it. Nothing here invents a scale: if a value
changes in code, this file is wrong until it is updated in the same change.

## 1. Style

Stylized low-poly, warm, cute but not childish: chunky proportions, soft geometry, clean silhouettes,
and flat colour. Quality comes from silhouette, proportion, layering, bevels, and material contrast -
never from polygon count, texture detail, or realistic shading.

Avoid: photorealistic materials, anime character proportions, a blocky voxel look, mixing unrelated
asset packs, tiny details that vanish at gameplay distance, high-frequency textures, and PBR
complexity the renderer does not use.

## 2. World scale (canonical)

| Quantity | Value | Source |
| --- | --- | --- |
| Tile size / gap / pitch | 1.0 / 0.08 / **1.08** world units | `apps/web/src/render/layout.ts` |
| World origin | centre of the 12x12 starter land, tile (5.5, 5.5) — fixed for the farm's life | `layout.ts` |
| Tile slab thickness | 0.09 | `apps/web/src/render/terrain.ts` |
| Crop model envelope | **1 unit tall**, base on `y = 0`, footprint inside 1 x 1 centred on the origin | `apps/web/tools/generate-placeholder-models.mjs`, `tests/integration/crop-model-assets.test.ts` |
| Crop drawn height | scaled to `max(growthProgress * 0.95, 0.14)` | `apps/web/src/render/scene.ts` |
| Player height (visual) | 1.6 | `scene.ts` |
| Player collision | circle radius 0.28, speed 2.6 units/s | `apps/web/src/player/controller.ts` |
| Player feet | 0.02 above the tile base | `apps/web/src/main.ts` |
| Fence thickness / height / post | 0.09 / 0.62 / 0.1 square | `world-config.ts`, `terrain.ts` |
| Barn footprint (gameplay) | circle radius 2.2 at the canonical yard position | `world-config.ts` (`STATIC_OBSTACLES`) |
| Scenery tree scale | 0.78 on the shared model | `scene.ts` |
| Camera | perspective, FOV 45, direction (0.62, 0.95, 0.62), near 0.5, far 1400 | `scene.ts` |
| Camera distance | `framedExtent * 2.35 * zoom`; opens on the owned field, follow framing 9, zoom 0.62..`zoomRangeFor` | `scene.ts`, `camera.ts` |
| Farm field reservation | tiles [0, 35]^2 (36 x 36) | `world-config.ts` (`FARM_FIELD_BOUNDS`) |
| Playable island | tiles [-26, 62]^2 (89 x 89) | `world-config.ts` (`VISUAL_BOUNDS`) |
| Island outline | a superellipse, exponent 3.4, scaled by three radial lobes, plus 2 tiles of shore margin | `world-config.ts`, `terrain-height.ts` |
| Ground surface where level | `y = -0.04` | `terrain-height.ts` (`GROUND_SURFACE_Y`) |
| Hill relief | up to 6.5 world units, on the upland side of the island | `world-config.ts` (`TERRAIN_RELIEF_WORLD`) |
| Cultivated apron | 1.5 tiles of dirt around the land the farm owns | `world.ts` (`APRON_MARGIN_TILES`) |
| Road widths | 1.9 / 1.3 / 0.8 tiles for primary / secondary / path | `world-config.ts` (`ROAD_WIDTH_TILES`) |
| Scenery instances | capped at 700, of which at most 200 are the curated set | `world.ts` (`MAX_SCENERY`, `HERO_SCENERY_BUDGET`) |
| Scenery detail | flowers and grass tufts hide above zoom 2.2, so the estate view is masses and roads | `scene.ts` (`DETAIL_ZOOM_LIMIT`) |
| District ground | the plan uses **no** colour patches: identity is trees, rows, paths and buildings | `world-config.ts` (`DISTRICTS.ground`) |
| Unclaimed land | 14 props per plot, grass-heavy | `world.ts` (`LOCKED_PROPS_PER_PLOT`) |
| Island upland | rises toward the north-east, where the natural forest stands | `world-config.ts` (`ISLAND_UPLANDS`) |
| Environment model contract | one world unit across its **largest** dimension, centred on X/Z, base on `y = 0` | `tools/asset-pipeline/node/import-cc0.mjs`, `tests/integration/environment-model-assets.test.ts` |
| Scenery size | `instance.scale` **is** the size in world metres (the player is 1.6) | `environment-model-urls.ts` (`unitScale`), `world.ts` (`unitScaleFor`) |
| One plot cohort | 12 x 12 tiles | `packages/domain/src/plot.ts` |

Assets are authored in **world metres**, and the base of every model sits on `y = 0` so it can be
placed by a tile coordinate without a per-model offset.

## 3. Orientation and origin

* `+Y` is up, `+Z` is south (towards the spawn), `+X` is east. A model faces `+Z`.
* Origin: centred on the model's footprint, base at `y = 0`.
* One model = one node tree. The renderer places, rotates, and scales it; a model must not carry a
  position of its own.

## 4. Geometry language

* Faceted, low-poly surfaces with **flat normals**; no smoothing groups, no subdivision.
* Soften silhouettes with small, cheap shapes: tapered trunks, bevel-ish chamfers, stacked layers,
  and gentle asymmetric variation rather than detail.
* Cylinders and canopies use 6-10 segments; a tree canopy is 2-4 overlapping low-poly masses.
* Cut anything invisible at 8-20 world units: sub-centimetre details, interior geometry, tiny trim.
* Prefer a few larger forms over many small ones. A silhouette must read at gameplay distance.

## 5. Palette and materials

One shared, flat palette. The renderer lights the scene with a hemisphere light (sky `#dcf0ff`,
ground `#6d8f52`, intensity 0.9), a small ambient light (0.16) and a warm directional sun
(`#fff0cd`, 2.3) that casts the scene's only shadows, and it tone-maps the result with ACES at 1.05
exposure, so materials should be mid-tone and warm rather than dark or glossy. Vertex colours are
used for two surfaces - the island's own ground and the rough ground on locked plots - and nowhere
else.

Base colours in use (`apps/web/src/render/materials.ts`):

| Slot | Hex | Use |
| --- | --- | --- |
| grass / meadow / foliage / pine | `#7dc35a` / `#8fd06a` / `#4f9d45` / `#3c7f4a` | ground, leaves, conifers |
| soil empty / soil occupied | `#b28356`+`#bb8c5e` / `#7f5a3a`+`#886340` | bare and planted tiles, alternating by row |
| dirt / dirt dark / bare earth | `#c9a26a` / `#b0854f` / `#c4a97b` | apron, paths, dry ground |
| sand / wet sand / rock / stone | `#e7d59a` / `#c9b184` / `#9aa3ab` / `#b4b1a6` | shore, stones, walls |
| water / water deep | `#49a7dd` / `#2b7fbf` | pond and shallows |
| wood / stake wood / barn wall / barn roof / barn trim | `#a9763f` / `#8a6440` / `#d1574a` / `#8d3f38` / `#f3e3c8` | fences, buildings |
| plaster / roof tile / timber / canvas / mill blade | `#f2e6d0` / `#a8503f` / `#7d5a3c` / `#e4585a` / `#e8dcbb` | landmarks |
| crop growing / crop mature | `#6fbf7f` / `#e0b64a` | crop readiness tint |
| player body / legs / skin / hat | `#3f6fd8` / `#39435c` / `#f1c7a1` / `#d9a441` | the farmer |

Rules:

* A model uses **one material per colour family**, not one per mesh. Three to six materials is normal.
* `metallicFactor = 0`, `roughnessFactor` 0.8-0.9.
* No texture files. Flat `baseColorFactor` only. A future texture needs its own decision, because it
  costs a download on a phone.
* Colours are authored as sRGB hex and converted to linear when written to glTF.

## 6. Growth and state vocabulary

Visual state must map onto state that already exists; art never invents a gameplay stage.

* Crops: the server reports `growthProgress` and `mature`. The model is one plant, scaled from 0.14
  to 0.95 of its height, and swapped to a warm "ready" material when the server says mature.
* Repeating tree: `SAPLING` (0.35), `GROWING` (0.55 + 0.35 x progress), `READY`/`REGROWING` (1.0);
  fruit is a separate decorative mesh shown only while READY.
* Buildings, fences, terrain and the player do not have visual stages.

## 7. Export contract (GLB)

Every generated model is written to this subset, which the repository's own validator and
`tests/integration/asset-models.test.ts` enforce:

* glTF 2.0 binary, one scene, one node, one mesh.
* Non-indexed triangle soup: `mode: 4`, `POSITION` and `NORMAL` only, flat per-face normals.
* One primitive per material.
* One buffer, non-interleaved: one non-overlapping, four-byte-aligned buffer view per accessor, no
  `byteStride`. This is a deliberate repository subset, not a glTF requirement.
* Base on `y = 0`, centred footprint, no embedded textures, no external files.
* Deterministic output: the generator is seeded and reruns byte-for-byte.

## 8. Naming

Stable snake-like ids, matching the domain: `crop_<name>`, `tree_<name>`, `building_<name>`,
`character_<name>`, `prop_<name>`. A file is `<id>.glb`, and an id is never reused for a different
object. Display names are not identifiers.

## 9. Budgets (web and mobile)

| Family | Triangles | Materials | File size |
| --- | --- | --- | --- |
| Crop | ≤ 400 | ≤ 4 | ≤ 12 kB |
| Scenery prop (tree, bush, rock) | ≤ 700 | ≤ 4 | ≤ 25 kB |
| Character | ≤ 1200 | ≤ 6 | ≤ 40 kB |
| Building | ≤ 1500 | ≤ 6 | ≤ 40 kB |

One model is loaded once and cloned or instanced per placement, never loaded per instance. Nothing
in the renderer may fetch a model during a farm refresh.

## 10. Pipeline

```text
spec (tools/asset-pipeline/*/specs)  +  generator (shared helpers)  →  GLB  →  validation  →  manifest  →  renderer
```

Two generators exist for the same contract: `tools/asset-pipeline/node/` (no extra software, this is
what CI and the committed files use) and `tools/asset-pipeline/blender/` (Blender Python, for
hand-tuned authoring when a workstation has Blender). Both must satisfy section 7; a Blender export
that does not is converted, not excused.
