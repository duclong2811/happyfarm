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
| World origin | centre of the 6x6 starter land, tile (2.5, 2.5) — fixed for the farm's life | `layout.ts` |
| Tile slab thickness | 0.09 | `apps/web/src/render/terrain.ts` |
| Crop model envelope | **1 unit tall**, base on `y = 0`, footprint inside 1 x 1 centred on the origin | `apps/web/tools/generate-placeholder-models.mjs`, `tests/integration/crop-model-assets.test.ts` |
| Crop drawn height | scaled to `max(growthProgress * 0.95, 0.14)` | `apps/web/src/render/scene.ts` |
| Player height (visual) | 1.6 | `scene.ts` |
| Player collision | circle radius 0.28, speed 2.6 units/s | `apps/web/src/player/controller.ts` |
| Player feet | 0.02 above the tile base | `apps/web/src/main.ts` |
| Fence thickness / height / post | 0.09 / 0.62 / 0.1 square | `world-config.ts`, `terrain.ts` |
| Barn footprint (gameplay) | circle radius 2.2 at the canonical yard position | `world-config.ts` (`STATIC_OBSTACLES`) |
| Scenery tree scale | 0.78 on the shared model | `scene.ts` |
| Camera | perspective, FOV 45, direction (0.66, 0.82, 0.74), near 0.1, far 800 | `scene.ts` |
| Camera distance | `framedExtent * 2.35 * zoom`, follow framing 7.5, zoom 0.62..2.4 | `scene.ts`, `camera.ts` |
| Farm field reservation | tiles [0, 17]^2 | `world-config.ts` (`FARM_FIELD_BOUNDS`) |

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

One shared, flat palette. The renderer lights the scene with a hemisphere light (sky `#dfefff`,
ground `#4a6a3f`, intensity 1.15), an ambient light (0.45) and a warm directional sun (`#fff4d6`,
1.9), so materials should be mid-tone and warm rather than dark or glossy.

Base colours in use (`apps/web/src/render/materials.ts`):

| Slot | Hex | Use |
| --- | --- | --- |
| grass / foliage / pine | `#7dc35a` / `#4f9d45` / `#3c7f4a` | ground, leaves, conifers |
| soil empty / soil occupied | `#b98a5a` / `#8a6440` | bare and planted tiles |
| dirt / dirt dark | `#c9a26a` / `#b0854f` | apron, paths |
| sand / rock / water | `#e7d59a` / `#9aa3ab` / `#49a7dd` | shore, stones, pond |
| wood / barn wall / barn roof / barn trim | `#a9763f` / `#d1574a` / `#8d3f38` / `#f3e3c8` | fences, buildings |
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
