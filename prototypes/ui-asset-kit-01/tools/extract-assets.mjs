import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
const source = path.resolve(root, "docs/design/references/HAPPYFARM_UI_ASSET_SHEET_01.png");
const output = path.resolve(root, "prototypes/ui-asset-kit-01/assets");

await fs.mkdir(output, { recursive: true });

async function crop(name, extract, options = {}) {
  await sharp(source)
    .extract(extract)
    .trim(options.trim ?? {})
    .png()
    .toFile(path.join(output, name));
}

// These crops are preview derivatives only. The source sheet includes baked labels and counts;
// only the isolated visual parts below are allowed into this prototype.
await crop("inventory-header-barn.png", { left: 26, top: 16, width: 215, height: 180 });
await crop("inventory-leaf-corner.png", { left: 6, top: 744, width: 128, height: 128 });
await crop("inventory-close.png", { left: 548, top: 72, width: 130, height: 130 });

// Remove the pale card backing from the tightly cropped apple while retaining the illustrated fruit.
const appleCrop = { left: 765, top: 310, width: 180, height: 152 };
const { data, info } = await sharp(source)
  .extract(appleCrop)
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
for (let index = 0; index < data.length; index += 4) {
  const red = data[index];
  const green = data[index + 1];
  const blue = data[index + 2];
  const paleCard = red > 172 && green > 128 && blue > 92 && red - blue < 105 && red - green < 95;
  if (paleCard) data[index + 3] = 0;
}
await sharp(data, { raw: info }).trim().png().toFile(path.join(output, "apple-icon.png"));
