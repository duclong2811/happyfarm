# Farm Market thumbnail audit

This is the complete Shop audit from `packages/game-data/src/shops/index.ts`. The table is keyed by
stable `itemDefinitionId`, not by a translated label. `BUY + SELL` means the same Shop row appears in
both tabs and therefore deliberately uses one visual. The contact sheet is available at
`apps/web/shop-thumbnail-contact-sheet.html` when opened through Vite.

| Shop ID | Item ID | Type | Name key | Source | Thumbnail |
| --- | --- | --- | --- | --- | --- |
| `shop_carrot_seed` | `item_carrot_seed` | SEED / BUY | `item.carrot_seed.name` | new SVG | `seed_carrot.svg` |
| `shop_wheat_seed` | `item_wheat_seed` | SEED / BUY | `item.wheat_seed.name` | new SVG | `seed_wheat.svg` |
| `shop_corn_seed` | `item_corn_seed` | SEED / BUY | `item.corn_seed.name` | new SVG | `seed_corn.svg` |
| `shop_potato_seed` | `item_potato_seed` | SEED / BUY | `item.potato_seed.name` | new SVG | `seed_potato.svg` |
| `shop_tomato_seed` | `item_tomato_seed` | SEED / BUY | `item.tomato_seed.name` | new SVG | `seed_tomato.svg` |
| `shop_strawberry_seed` | `item_strawberry_seed` | SEED / BUY | `item.strawberry_seed.name` | new SVG | `seed_strawberry.svg` |
| `shop_cabbage_seed` | `item_cabbage_seed` | SEED / BUY | `item.cabbage_seed.name` | new SVG | `seed_cabbage.svg` |
| `shop_pumpkin_seed` | `item_pumpkin_seed` | SEED / BUY | `item.pumpkin_seed.name` | new SVG | `seed_pumpkin.svg` |
| `shop_carrot` | `item_carrot` | CROP / SELL | `item.carrot.name` | existing GLB | `crop_carrot.glb` |
| `shop_wheat` | `item_wheat` | CROP / SELL | `item.wheat.name` | existing GLB | `crop_wheat.glb` |
| `shop_corn` | `item_corn` | CROP / SELL | `item.corn.name` | existing GLB | `crop_corn.glb` |
| `shop_potato` | `item_potato` | CROP / SELL | `item.potato.name` | existing GLB | `crop_potato.glb` |
| `shop_tomato` | `item_tomato` | CROP / SELL | `item.tomato.name` | existing GLB | `crop_tomato.glb` |
| `shop_strawberry` | `item_strawberry` | CROP / SELL | `item.strawberry.name` | existing GLB | `crop_strawberry.glb` |
| `shop_cabbage` | `item_cabbage` | CROP / SELL | `item.cabbage.name` | existing GLB | `crop_cabbage.glb` |
| `shop_pumpkin` | `item_pumpkin` | CROP / SELL | `item.pumpkin.name` | existing GLB | `crop_pumpkin.glb` |
| `shop_apple_sapling` | `item_apple_sapling` | SAPLING / BUY | `item.apple_sapling.name` | new SVG | `sapling_apple.svg` |
| `shop_orange_sapling` | `item_orange_sapling` | SAPLING / BUY | `item.orange_sapling.name` | new SVG | `sapling_orange.svg` |
| `shop_peach_sapling` | `item_peach_sapling` | SAPLING / BUY | `item.peach_sapling.name` | new SVG | `sapling_peach.svg` |
| `shop_wildwood_sapling` | `item_wildwood_sapling` | SAPLING / BUY | `item.wildwood_sapling.name` | new SVG | `sapling_wildwood.svg` |
| `shop_apple` | `item_apple` | CROP / SELL | `item.apple.name` | new SVG | `produce_apple.svg` |
| `shop_orange` | `item_orange` | CROP / SELL | `item.orange.name` | new SVG | `produce_orange.svg` |
| `shop_peach` | `item_peach` | CROP / SELL | `item.peach.name` | new SVG | `produce_peach.svg` |
| `shop_fish_tilapia` | `item_fish_tilapia` | FISH / BUY + SELL | `shop.fish_tilapia_stock.name` | new SVG | `fish_tilapia_fingerling.svg` |
| `shop_fish_tilapia_adult` | `item_fish_tilapia_adult` | FISH / SELL | `shop.fish_tilapia_adult.name` | existing GLB | `fish_tilapia.glb` |
| `shop_fish_carp` | `item_fish_carp` | FISH / SELL | `item.fish_carp.name` | existing GLB | `fish_carp.glb` |
| `shop_fish_catfish` | `item_fish_catfish` | FISH / SELL | `item.fish_catfish.name` | existing GLB | `fish_catfish.glb` |
| `shop_fish_sardine` | `item_fish_sardine` | FISH / SELL | `item.fish_sardine.name` | existing GLB | `fish_sardine.glb` |
| `shop_fish_mackerel` | `item_fish_mackerel` | FISH / SELL | `item.fish_mackerel.name` | existing GLB | `fish_mackerel.glb` |
| `shop_fish_snapper` | `item_fish_snapper` | FISH / SELL | `item.fish_snapper.name` | existing GLB | `fish_snapper.glb` |
| `shop_fish_tuna` | `item_fish_tuna` | FISH / SELL | `item.fish_tuna.name` | existing GLB | `fish_tuna.glb` |
| `shop_stone` | `item_stone` | MATERIAL / SELL | `item.stone.name` | existing GLB | `resource_stone.glb` |
| `shop_copper_ore` | `item_copper_ore` | MATERIAL / SELL | `item.copper_ore.name` | existing GLB | `resource_copper.glb` |
| `shop_iron_ore` | `item_iron_ore` | MATERIAL / SELL | `item.iron_ore.name` | existing GLB | `resource_iron.glb` |
| `shop_coal` | `item_coal` | MATERIAL / SELL | `item.coal.name` | existing GLB | `resource_coal.glb` |
| `shop_wood` | `item_wood` | MATERIAL / SELL | `item.wood.name` | new SVG | `material_wood.svg` |
| `shop_hardwood` | `item_hardwood` | MATERIAL / SELL | `item.hardwood.name` | new SVG | `material_hardwood.svg` |
| `shop_resin` | `item_resin` | MATERIAL / SELL | `item.resin.name` | new SVG | `material_resin.svg` |

There are 39 Shop rows and 38 unique item ids. The single duplicated market item is `item_fish_tilapia`;
its buy and sell cards share `image:fish_tilapia_fingerling`. `item_fish_tilapia_adult` is a distinct
server item and uses the existing adult tilapia GLB, so the two fish are never visually conflated.

The new SVGs are original repository assets with transparent backgrounds, no embedded text or prices,
and no external source or license dependency. Existing GLBs continue through the shared Three.js
thumbnail renderer and Vite emits both GLB and SVG URLs with content hashes.
