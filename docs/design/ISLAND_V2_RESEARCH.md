# Island v2: what comparable games teach

Status: research for Island Generator v2 (`docs/briefs/ISLAND_V2.md`). These are notes on how other games
make an island read well and play well. We take the ideas only: no assets, names, maps or layouts are
copied (see `AGENTS.md`).

## Games looked at

| Game | What it does well for us |
|---|---|
| Animal Crossing: New Horizons | Readable island at a glance: a clean beach ring, a river that splits the land into a few large regions, cliff tiers as landmarks, and a deliberate "front door" (dock and plaza) |
| Farm Together | Big flat, workable ground; decoration at the edges; expansion that grows outward from a core |
| Stardew Valley (Ginger Island) | Each zone has a strong identity (jungle, volcano, beach); water depth signals what can be done where |
| Islanders, Townscaper | Low-poly islands that look good with almost no texture: depth-coloured water, a white foam line, soft flat-shaded colour |
| Dorfromantik | Biomes as large, coherent patches with clean borders, never salt-and-pepper noise |
| Sea of Thieves | Turquoise shallows over sand and a sharp drop to navy deep water: the player reads "I can wade here" instantly |
| Coral Island, Cozy Grove | Cosy palettes, shore props (rocks, shells, reeds), and gentle relief instead of flat plates |

## Takeaways we apply

1. **Depth is colour.** Shallow water is light turquoise over visible sand. It darkens with distance from
   the coast and turns deep blue past the shelf. The player should never have to ask whether a tile is
   wadeable. (Sea of Thieves, Islanders)
2. **A foam line and a wet-sand band** at the waterline do more for "finished" than any texture. Draw the
   foam as a light ring on the water surface and darken the sand just above the waterline. (Townscaper)
3. **Large, coherent regions.** Coastlines get a few headlands and coves, never one-cell slivers. Biomes
   come in big patches with soft borders. Small noise is only colour grain, never cell kind. (Dorfromantik)
4. **Water is a walkable shelf, not a wall.** A ring of shallows around every island lets players walk
   around a headland. Thủy's lagoons and inlets are shallow, so they make the island prettier without
   cutting it into fingers. Deep water is the boundary and the fishing ground. (Sea of Thieves, ACNH beaches)
5. **One front door.** The camp sits on open, flat ground near the middle, and the dock faces deep water
   on the side nearest the camp. A player arriving understands where "home" is. (ACNH plaza and dock)
6. **One landmark per element.**
   - Kim: a rock massif with spires.
   - Mộc: an old-growth forest core.
   - Thủy: lagoons and a reef ring.
   - Hỏa: a meadow plain under a ridge.
   - Thổ: terraced fields.

   Landmarks give the estate view a focal point. (Ginger Island zones)
7. **Workable ground stays flat; relief lives where work doesn't.** Fields, meadows and camp are level.
   Rock, forest cores and shore rise or fall gently. (Farm Together)
8. **Props at the edges.** Shore rocks, reeds and flowers along borders make the island feel hand-made at
   no cost to the playable area. (Coral Island, Cozy Grove)
9. **Readable from above.** The picker preview must show depth, beach, relief shading and the marked
   sites, so the choice is informed. (ACNH island selection)

## What this means for v2

- Generator: smooth, warped outlines with cleanup passes (remove slivers, specks and pinholes). A
  per-element shallow shelf, wider for Thủy, with lagoons and reef flats. Connectivity repair, so every
  land and shallow region links to the camp through land or shallows. Deterministic site rules for camp
  and dock. Deep-water fishing places.
- Rendering: a water gradient by distance to land, a foam ring, wet sand, wadeable shallows,
  element-specific shore props, and a nicer picker preview with depth and hill shading.
