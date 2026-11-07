/**
 * Explicit market art decisions. Item ids are the stable contract; display names and language never
 * participate in choosing a picture. Model-backed entries reuse the same GLB thumbnail everywhere,
 * while the small static illustrations cover planting inputs and materials without a suitable GLB.
 */
export type ItemThumbnailSpec =
  | { readonly kind: "MODEL"; readonly modelId: string }
  | { readonly kind: "IMAGE"; readonly assetName: string };

export const ITEM_THUMBNAIL_MAP: Readonly<Record<string, ItemThumbnailSpec>> = {
  item_carrot: { kind: "MODEL", modelId: "crop_carrot" },
  item_wheat: { kind: "MODEL", modelId: "crop_wheat" },
  item_corn: { kind: "MODEL", modelId: "crop_corn" },
  item_potato: { kind: "MODEL", modelId: "crop_potato" },
  item_tomato: { kind: "MODEL", modelId: "crop_tomato" },
  item_strawberry: { kind: "MODEL", modelId: "crop_strawberry" },
  item_cabbage: { kind: "MODEL", modelId: "crop_cabbage" },
  item_pumpkin: { kind: "MODEL", modelId: "crop_pumpkin" },
  item_carrot_seed: { kind: "IMAGE", assetName: "seed_carrot" },
  item_wheat_seed: { kind: "IMAGE", assetName: "seed_wheat" },
  item_corn_seed: { kind: "IMAGE", assetName: "seed_corn" },
  item_potato_seed: { kind: "IMAGE", assetName: "seed_potato" },
  item_tomato_seed: { kind: "IMAGE", assetName: "seed_tomato" },
  item_strawberry_seed: { kind: "IMAGE", assetName: "seed_strawberry" },
  item_cabbage_seed: { kind: "IMAGE", assetName: "seed_cabbage" },
  item_pumpkin_seed: { kind: "IMAGE", assetName: "seed_pumpkin" },
  item_apple_sapling: { kind: "IMAGE", assetName: "sapling_apple" },
  item_orange_sapling: { kind: "IMAGE", assetName: "sapling_orange" },
  item_peach_sapling: { kind: "IMAGE", assetName: "sapling_peach" },
  item_wildwood_sapling: { kind: "IMAGE", assetName: "sapling_wildwood" },
  item_apple: { kind: "IMAGE", assetName: "produce_apple" },
  item_orange: { kind: "IMAGE", assetName: "produce_orange" },
  item_peach: { kind: "IMAGE", assetName: "produce_peach" },
  item_fish_tilapia: { kind: "IMAGE", assetName: "fish_tilapia_fingerling" },
  item_fish_tilapia_adult: { kind: "MODEL", modelId: "fish_tilapia" },
  item_fish_carp: { kind: "MODEL", modelId: "fish_carp" },
  item_fish_catfish: { kind: "MODEL", modelId: "fish_catfish" },
  item_fish_sardine: { kind: "MODEL", modelId: "fish_sardine" },
  item_fish_mackerel: { kind: "MODEL", modelId: "fish_mackerel" },
  item_fish_snapper: { kind: "MODEL", modelId: "fish_snapper" },
  item_fish_tuna: { kind: "MODEL", modelId: "fish_tuna" },
  item_ore: { kind: "MODEL", modelId: "resource_stone" },
  item_stone: { kind: "MODEL", modelId: "resource_stone" },
  item_copper_ore: { kind: "MODEL", modelId: "resource_copper" },
  item_iron_ore: { kind: "MODEL", modelId: "resource_iron" },
  item_coal: { kind: "MODEL", modelId: "resource_coal" },
  item_wood: { kind: "IMAGE", assetName: "material_wood" },
  item_hardwood: { kind: "IMAGE", assetName: "material_hardwood" },
  item_resin: { kind: "IMAGE", assetName: "material_resin" }
};
