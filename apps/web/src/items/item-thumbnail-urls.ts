import seedCarrotUrl from "../assets/items/seed_carrot.svg?url";
import seedWheatUrl from "../assets/items/seed_wheat.svg?url";
import seedCornUrl from "../assets/items/seed_corn.svg?url";
import seedPotatoUrl from "../assets/items/seed_potato.svg?url";
import seedTomatoUrl from "../assets/items/seed_tomato.svg?url";
import seedStrawberryUrl from "../assets/items/seed_strawberry.svg?url";
import seedCabbageUrl from "../assets/items/seed_cabbage.svg?url";
import seedPumpkinUrl from "../assets/items/seed_pumpkin.svg?url";
import saplingAppleUrl from "../assets/items/sapling_apple.svg?url";
import saplingOrangeUrl from "../assets/items/sapling_orange.svg?url";
import saplingPeachUrl from "../assets/items/sapling_peach.svg?url";
import saplingWildwoodUrl from "../assets/items/sapling_wildwood.svg?url";
import fingerlingTilapiaUrl from "../assets/items/fish_tilapia_fingerling.svg?url";
import materialWoodUrl from "../assets/items/material_wood.svg?url";
import materialHardwoodUrl from "../assets/items/material_hardwood.svg?url";
import materialResinUrl from "../assets/items/material_resin.svg?url";
import materialOreUrl from "../assets/items/material_ore.svg?url";
import produceAppleUrl from "../assets/items/produce_apple.svg?url";
import produceOrangeUrl from "../assets/items/produce_orange.svg?url";
import producePeachUrl from "../assets/items/produce_peach.svg?url";

export const ITEM_THUMBNAIL_URLS: Readonly<Record<string, string>> = {
  seed_carrot: seedCarrotUrl,
  seed_wheat: seedWheatUrl,
  seed_corn: seedCornUrl,
  seed_potato: seedPotatoUrl,
  seed_tomato: seedTomatoUrl,
  seed_strawberry: seedStrawberryUrl,
  seed_cabbage: seedCabbageUrl,
  seed_pumpkin: seedPumpkinUrl,
  sapling_apple: saplingAppleUrl,
  sapling_orange: saplingOrangeUrl,
  sapling_peach: saplingPeachUrl,
  sapling_wildwood: saplingWildwoodUrl,
  fish_tilapia_fingerling: fingerlingTilapiaUrl,
  material_wood: materialWoodUrl,
  material_hardwood: materialHardwoodUrl,
  material_resin: materialResinUrl,
  material_ore: materialOreUrl,
  produce_apple: produceAppleUrl,
  produce_orange: produceOrangeUrl,
  produce_peach: producePeachUrl
};

export function itemThumbnailUrl(assetName: string): string | null {
  return ITEM_THUMBNAIL_URLS[assetName] ?? null;
}
