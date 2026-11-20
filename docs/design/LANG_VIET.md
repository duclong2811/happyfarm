# Làng Việt: the Vietnamese village pack

Status: **phase 1 built** (2026-11-20). The owner asked for richer islands: more decorations and
houses, enough variety that every player can make the island they want, island templates that look
better, and assets with a Vietnamese identity ("thuần Việt").

## What similar games do, and what we take from it

- **Farm Together** (the reference for the core loop) sells decorations, fences, paths and houses as
  plain cosmetic pieces, and lets the player move or store anything. We already have the same
  machinery: a server-validated catalogue, placement, move, rotate, store and remove.
- **Animal Crossing: New Horizons** scores the island from placed furniture, fences, trees and
  flowers, so decorating has a goal. That is a design decision (an economy and progression change),
  so it is listed under "Next" for the owner rather than built.
- **Vietnamese farm games** (Nông Trại Vui Vẻ, Khu Vườn Trên Mây) lean on themed sets of decorations
  and seasonal pieces. A set the player recognises is what makes an island feel like home.

So phase 1 is one recognisable **set**: the Vietnamese village, in the island's own low-poly
language, sold through the existing catalogue.

## The pieces

Every piece is generated in code (`tools/asset-pipeline/node/viet.mjs`): original geometry, no
third-party asset, no texture. Each is unit-fitted (`fit: "unit"` in `specs.mjs`), and the client's
manifest (`apps/web/src/render/viet-model-urls.ts`) states its largest side in metres.

| Entry | Model | Category | Cells | Level | Price (gold) |
| --- | --- | --- | --- | --- | --- |
| Nhà tranh (thatched cottage) | `viet_house_thatch` | BUILDING | 3 x 3 | 3 | 1,200 |
| Nhà sàn (stilt house) | `viet_house_stilt` | BUILDING | 3 x 3 | 4 | 2,400 |
| Nhà ba gian (three-bay tiled house) | `viet_house_tiled` | BUILDING | 5 x 4 | 5 | 3,600 |
| Cổng làng (village gate) | `viet_village_gate` | MONUMENT | 3 x 2 | 5 | 1,800 |
| Miếu làng (shrine) | `viet_shrine` | MONUMENT | 2 x 2 | 5 | 1,500 |
| Giếng làng (well) | `viet_well` | DECORATION | 2 x 2 | 3 | 450 |
| Chum vại (jars) | `viet_jars` | DECORATION | 1 x 1 | 1 | 70 |
| Cây rơm (straw stack) | `viet_straw_stack` | DECORATION | 2 x 2 | 1 | 80 |
| Cối đá (stone mortar) | `viet_rice_mortar` | DECORATION | 1 x 1 | 1 | 60 |
| Chõng tre (bamboo daybed) | `viet_bamboo_daybed` | DECORATION | 2 x 1 | 3 | 130 |
| Cây cảnh (potted tree) | `viet_bonsai` | DECORATION | 1 x 1 | 3 | 110 |
| Hòn non bộ (miniature mountain) | `viet_rockery` | DECORATION | 2 x 2 | 5 | 380 |
| Ao sen (lotus pond) | `viet_lotus_pond` | DECORATION | 3 x 3 | 5 | 520 |
| Bình phong (screen wall) | `viet_screen_wall` | DECORATION | 2 x 1 | 5 | 340 |
| Cột đèn lồng (lantern post) | `viet_lantern_post` | LIGHTING | 1 x 1 | 5 | 160 |
| Dây đèn lồng (lantern string) | `viet_lantern_string` | LIGHTING | 3 x 1 | 5 | 260 |
| Rào tre (bamboo fence) | `viet_fence_bamboo` | FENCE | 1 x 1 | 1 | 45 |
| Rào gạch hoa (breeze-block fence) | `viet_fence_breeze` | FENCE | 1 x 1 | 3 | 70 |
| Cây đa (banyan) | `viet_tree_banyan` | VEGETATION | 2 x 2 | 5 | 220 |
| Khóm tre (bamboo clump) | `viet_bamboo_clump` | VEGETATION | 1 x 1 | 1 | 60 |
| Cây cau (areca palm) | `viet_tree_areca` | VEGETATION | 1 x 1 | 1 | 50 |
| Cây chuối (banana) | `viet_tree_banana` | VEGETATION | 1 x 1 | 1 | 45 |
| Cây mai vàng (mai blossom) | `viet_tree_mai` | VEGETATION | 1 x 1 | 3 | 150 |
| Cây đào (peach blossom) | `viet_tree_dao` | VEGETATION | 1 x 1 | 3 | 150 |

- **Prices and levels are provisional**, like every other catalogue number
  (`PROVISIONAL_ASSET_PRICES`, `PLACEMENT_LEVEL_POLICY` in `packages/game-data/src/placement/catalog.ts`).
  They sit in the magnitudes the catalogue already uses: a house costs about what the barn beside it
  does, a monument about what the windmill does, a jar about what a crate does. An economy pass owns
  them.
- **All cosmetic.** Every entry's gameplay definition is `COSMETIC` / `ACTIVE`: no production, no
  storage, no XP. Removal refunds follow the category (a house or a monument half its price, a fence a
  quarter, a decoration, a light or a planting nothing), so no piece can be a way to make gold.
- **Nothing new on the server.** The pieces are catalogue rows: the purchase, the level check, the
  ledger record, placement, move, rotate, store and remove are the existing construction use cases.
  No migration, no contract change. Every row carries the tag `lang_viet`.

## The island's own village

Every chosen island draws a decorative village round its camp (`apps/web/src/render/island-decor.ts`).
It used the farm pack (a windmill, an open barn, a silo, a coop). It now uses the Làng Việt pieces: a
brick well at the centre ringed by three lantern posts, the banyan at the village edge, a three-bay
house, a thatched cottage, a straw stack, jars, a daybed and a potted tree, beside the market cart
and the produce crates. This is presentation only: the island's cells, sites and the player's own
objects are unchanged, and the village still steps aside for anything the player builds.

## Budgets

A house or a monument: up to 1,500 triangles, 6 materials, 110 kB (as a ship: it is seen close and
turned about). A village piece or a tree: up to 900 triangles, 6 materials, 70 kB. The validator and
`tests/integration/asset-models.test.ts` hold every file to its spec.

## Next (for the owner to choose)

1. **Colour variants** (paint): one model, several palettes (red or green lacquer, white or yellow
   lime). Gives a lot of variety cheaply, but a placed object then carries a variant: a migration and
   a contract change.
2. **A "Làng Việt" filter in the shop**, so the set reads as a set across categories (the tag is
   already on every row).
3. **More sets**: Tết (câu đối, bánh chưng stall, firecracker garlands), the Mekong (xuồng ba lá,
   nhà lá, cầu khỉ), the highlands (nhà rông, cồng chiêng), Hội An (yellow shop-houses).
4. **An island beauty score**, as Animal Crossing does: placed decorations, trees and fences raise a
   score with rewards at thresholds. This is an economy and progression decision.
5. **Island templates**: better shores (rocks, reeds, mangroves), paths through the village, and
   fields of rice terraces on the hill islands. Visual changes can ship any time; anything that
   changes an island's cells is world generation and needs the owner's sign-off and a new generator
   version.
