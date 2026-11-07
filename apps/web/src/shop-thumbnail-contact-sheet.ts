import { shops } from "@happy-farm/game-data";
import { createItemThumbnails } from "./items/thumbnails";
import { itemVisualFor } from "./items/visuals";
import { ITEM_THUMBNAIL_MAP } from "./items/item-thumbnail-map";

const thumbnails = createItemThumbnails();
const sheet = document.querySelector<HTMLElement>("#sheet");
if (sheet === null) throw new Error("contact sheet root is missing");

for (const entry of shops) {
  const itemId = entry.itemDefinitionId;
  const spec = ITEM_THUMBNAIL_MAP[itemId];
  const card = document.createElement("article");
  const thumb = document.createElement("div");
  thumb.className = "thumb";
  const image = document.createElement("img");
  image.alt = itemId;
  const name = document.createElement("h2");
  name.textContent = entry.shopDisplayNameKey ?? itemId;
  const meta = document.createElement("small");
  meta.textContent = `${entry.id} · ${entry.buyPrice === undefined ? "SELL" : entry.sellPrice === undefined ? "BUY" : "BUY + SELL"}`;
  const visual = itemVisualFor(itemId, { cropDefinitions: [], treeDefinitions: [], fish: [], resourceNodes: [] });
  image.addEventListener("error", () => {
    image.hidden = true;
    meta.className = "error";
    meta.textContent = `${entry.id} · thumbnail failed`;
  });
  thumbnails.apply(visual.request, image);
  thumb.appendChild(image);
  card.appendChild(thumb);
  card.appendChild(name);
  card.appendChild(meta);
  sheet.appendChild(card);
  if (spec === undefined) card.classList.add("error");
}
