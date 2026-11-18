/**
 * The Home Island picker, shown once to a new player before their farm exists.
 *
 * Everything here is presentation. The preview is generated in the browser so rerolling costs no
 * request; what the player confirms is three values (element, outline, seed) that the server turns
 * into the island it actually stores. If the browser's preview and the server's island ever differed
 * by a cell, the server's is the island - and the game draws the stored one, never this preview.
 */

import {
  generateHomeIsland,
  ISLAND_ELEMENTS,
  ISLAND_OUTLINES,
  type GeneratedIsland,
  type IslandCellKind,
  type IslandElement,
  type IslandOutline,
  type IslandSiteKind
} from "@happy-farm/game-data";
import type { MessageKey } from "./i18n";
import { islandRelief, RELIEF_BASE_WORLD, RELIEF_TAG } from "./render/island-relief";

export interface IslandPick {
  readonly name: string;
  readonly element: IslandElement;
  readonly outline: IslandOutline;
  readonly seed: number;
}

/** The largest seed the server accepts. */
export const ISLAND_SEED_LIMIT = 2_147_483_647;

/** The grid a Home Island is generated on; must match the server's `HOME_ISLAND_GRID_SIZE`. */
export const PICKER_GRID_SIZE = 96;

/** A seed in `[1, ISLAND_SEED_LIMIT]` from a source of uniform numbers in `[0, 1)`. */
export function randomIslandSeed(random: () => number): number {
  return 1 + Math.min(ISLAND_SEED_LIMIT - 1, Math.floor(random() * (ISLAND_SEED_LIMIT - 1)));
}

/** A browser seed from the crypto source, so two new players do not walk onto the same island. */
export function browserIslandSeed(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return 1 + ((buffer[0] ?? 0) % (ISLAND_SEED_LIMIT - 1));
}

export const PREVIEW_CELL_COLORS: Readonly<Record<IslandCellKind, readonly [number, number, number]>> = {
  DEEP: [30, 90, 150],
  SHALLOW: [98, 198, 230],
  SAND: [240, 216, 150],
  GRASS: [128, 196, 92],
  FOREST: [70, 150, 56],
  ROCK: [158, 148, 136],
  MEADOW: [196, 226, 112],
  FIELD: [201, 160, 96]
};

const SITE_COLORS: Partial<Readonly<Record<IslandSiteKind, string>>> = {
  ORE: "#5d5852",
  FISH_BAY: "#1e5a96",
  FISHING: "#f4f8ff",
  PASTURE: "#f6f0c8",
  DOCK: "#8c5528",
  CAMP: "#d24832"
};

/** What the island holds, in the numbers the picker prints under the preview. */
export function islandSiteCounts(island: GeneratedIsland): { readonly ore: number; readonly trees: number; readonly bays: number; readonly pastures: number } {
  const count = (kind: IslandSiteKind) => island.sites.filter((site) => site.kind === kind).length;
  return { ore: count("ORE"), trees: count("TREE"), bays: count("FISH_BAY"), pastures: count("PASTURE") };
}

/** A small, stable variation so a flat colour reads as ground rather than as a swatch. */
function grain(x: number, y: number): number {
  let h = (Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h >>> 24) / 255 - 0.5) * 14;
}

const isWaterKind = (kind: IslandCellKind | undefined): boolean => kind === undefined || kind === "DEEP" || kind === "SHALLOW";

/** Chamfer distance (1 / √2) from every cell to the nearest cell where `source` holds. */
function cellDistance(size: number, source: (index: number) => boolean): Float32Array {
  const far = size * 4;
  const d = new Float32Array(size * size);
  for (let index = 0; index < d.length; index += 1) d[index] = source(index) ? 0 : far;
  const pass = (y: number, x: number, dx: number, dy: number): void => {
    const index = y * size + x;
    let best = d[index] ?? far;
    const px = x - dx;
    const py = y - dy;
    if (px >= 0 && px < size) best = Math.min(best, (d[y * size + px] ?? far) + 1);
    if (py >= 0 && py < size) {
      best = Math.min(best, (d[py * size + x] ?? far) + 1);
      if (px >= 0 && px < size) best = Math.min(best, (d[py * size + px] ?? far) + Math.SQRT2);
      const qx = x + dx;
      if (qx >= 0 && qx < size) best = Math.min(best, (d[py * size + qx] ?? far) + Math.SQRT2);
    }
    d[index] = best;
  };
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) pass(y, x, 1, 1);
  for (let y = size - 1; y >= 0; y -= 1) for (let x = size - 1; x >= 0; x -= 1) pass(y, x, -1, -1);
  return d;
}

/** Ground height for the preview's hill shading only: beaches low, forest and rock standing up. */
function previewHeight(kind: IslandCellKind, inland: number): number {
  switch (kind) {
    case "DEEP": return -1;
    case "SHALLOW": return -0.4;
    case "SAND": return 0;
    case "FIELD":
    case "MEADOW":
    case "GRASS": return 0.25;
    case "FOREST": return 0.55;
    case "ROCK": return 0.6 + Math.min(inland, 10) * 0.09;
  }
}

function mix(a: readonly [number, number, number], b: readonly [number, number, number], t: number): [number, number, number] {
  const k = Math.min(1, Math.max(0, t));
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}

const FOAM: readonly [number, number, number] = [214, 244, 238];
const SHALLOW_NEAR: readonly [number, number, number] = [112, 214, 214];
const SHALLOW_FAR: readonly [number, number, number] = [62, 176, 206];
const DEEP_NEAR: readonly [number, number, number] = [36, 118, 176];
const DEEP_FAR: readonly [number, number, number] = [20, 62, 116];
const WET_SAND: readonly [number, number, number] = [214, 190, 132];
const PREVIEW_SNOW: readonly [number, number, number] = [238, 242, 248];
const PREVIEW_BASALT: readonly [number, number, number] = [86, 70, 64];
const PREVIEW_LAVA: readonly [number, number, number] = [255, 112, 34];
const PREVIEW_HIGH_ROCK: readonly [number, number, number] = [204, 198, 190];

/**
 * RGBA pixels for an island, one per cell. Pure, so it is testable without a canvas.
 *
 * Reads like the 3D island it previews:
 * - water is coloured by depth: turquoise shallows with a foam line at the beach, a clear step to blue
 *   deep water, darkening toward the open sea;
 * - the beach is wet at the waterline;
 * - land is hill-shaded from the top-left, so forest and rock stand up off the fields.
 */
export function islandPreviewPixels(island: GeneratedIsland): Uint8ClampedArray<ArrayBuffer> {
  const { size, cells } = island;
  const pixels = new Uint8ClampedArray(new ArrayBuffer(size * size * 4));
  const toLand = cellDistance(size, (index) => !isWaterKind(cells[index]));
  const toWater = cellDistance(size, (index) => isWaterKind(cells[index]));
  const toShallowEdge = cellDistance(size, (index) => cells[index] !== "DEEP");
  // The same mountains the 3D island raises: a range on Kim, a volcano on Hỏa (island-relief.ts).
  const relief = islandRelief({
    size,
    element: island.element,
    seed: island.seed,
    isRock: (index) => cells[index] === "ROCK",
    ore: island.sites.filter((site) => site.kind === "ORE")
  });
  const height = new Float32Array(size * size);
  for (let index = 0; index < height.length; index += 1) {
    const kind = cells[index] ?? "DEEP";
    height[index] = kind === "ROCK"
      ? 0.6 + ((relief.height[index] ?? RELIEF_BASE_WORLD) - RELIEF_BASE_WORLD) * 0.25
      : previewHeight(kind, toWater[index] ?? 0);
  }
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = y * size + x;
      const kind = cells[index] ?? "DEEP";
      let color: [number, number, number];
      if (kind === "SHALLOW") {
        const distance = toLand[index] ?? 0;
        color = mix(SHALLOW_NEAR, SHALLOW_FAR, (distance - 1) / 6);
        if (distance <= 1.01) color = mix(color, FOAM, 0.45);
      } else if (kind === "DEEP") {
        color = mix(DEEP_NEAR, DEEP_FAR, ((toShallowEdge[index] ?? 0) - 1) / 8);
        if ((toLand[index] ?? 9) <= 1.01) color = mix(color, FOAM, 0.4);
      } else {
        const base = PREVIEW_CELL_COLORS[kind];
        const tag = relief.tag[index] ?? RELIEF_TAG.NONE;
        color = kind === "SAND" && (toWater[index] ?? 9) <= 1.01 ? [...WET_SAND] : [base[0], base[1], base[2]];
        if (tag === RELIEF_TAG.SNOW) color = [...PREVIEW_SNOW];
        else if (tag === RELIEF_TAG.LAVA) color = [...PREVIEW_LAVA];
        else if (tag === RELIEF_TAG.BASALT) color = [...PREVIEW_BASALT];
        else if (kind === "ROCK") color = mix(color, PREVIEW_HIGH_ROCK, ((relief.height[index] ?? 0) - RELIEF_BASE_WORLD - 1) / 5);
        // Light from the top-left: a cell lower than its upper-left neighbour is in its shade.
        const upLeft = height[Math.max(0, y - 1) * size + Math.max(0, x - 1)] ?? 0;
        const downRight = height[Math.min(size - 1, y + 1) * size + Math.min(size - 1, x + 1)] ?? 0;
        const light = (upLeft - downRight) * -60;
        const speckle = kind === "FOREST" && grain(x * 3, y * 5) > 3 ? -18 : 0;
        const shade = light + grain(x, y) + speckle;
        color = [color[0] + shade, color[1] + shade, color[2] + shade];
      }
      pixels[index * 4] = color[0];
      pixels[index * 4 + 1] = color[1];
      pixels[index * 4 + 2] = color[2];
      pixels[index * 4 + 3] = 255;
    }
  }
  return pixels;
}

/** Draws an island into a canvas of any size, with its working sites marked. */
export function drawIslandPreview(canvas: HTMLCanvasElement, island: GeneratedIsland, options: { readonly sites: boolean }): void {
  const context = canvas.getContext("2d");
  if (context === null) return;
  const source = document.createElement("canvas");
  source.width = island.size;
  source.height = island.size;
  const sourceContext = source.getContext("2d");
  if (sourceContext === null) return;
  sourceContext.putImageData(new ImageData(islandPreviewPixels(island), island.size, island.size), 0, 0);
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (!options.sites) return;
  const scale = canvas.width / island.size;
  for (const site of island.sites) {
    const color = SITE_COLORS[site.kind];
    if (color === undefined) continue;
    const cx = (site.x + 0.5) * scale;
    const cy = (site.y + 0.5) * scale;
    const radius = Math.max(3, scale * (site.kind === "CAMP" || site.kind === "DOCK" ? 1.7 : 1.3));
    context.beginPath();
    context.arc(cx, cy, radius, 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
    context.lineWidth = Math.max(1.5, scale * 0.45);
    context.strokeStyle = "#ffffff";
    context.stroke();
  }
}

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * Shows the picker and resolves with the player's choice when they confirm.
 *
 * `onConfirm` runs the creation; while it is in flight the picker stays up and disabled, and if it
 * throws the picker re-enables with the error shown, so a dropped request is a retry rather than a
 * lost choice.
 */
export function showIslandPicker(options: {
  readonly host: HTMLElement;
  readonly translate: Translate;
  readonly seed?: () => number;
  readonly onConfirm: (pick: IslandPick) => Promise<void>;
  readonly describeError: (error: unknown) => string;
}): Promise<IslandPick> {
  const { host, translate } = options;
  const nextSeed = options.seed ?? browserIslandSeed;
  const cache = new Map<string, GeneratedIsland>();
  const island = (element: IslandElement, outline: IslandOutline, seed: number): GeneratedIsland => {
    const key = `${element}:${outline}:${String(seed)}`;
    let found = cache.get(key);
    if (found === undefined) {
      found = generateHomeIsland(element, seed, PICKER_GRID_SIZE, outline);
      cache.set(key, found);
    }
    return found;
  };

  let element: IslandElement = "THO";
  let outline: IslandOutline = "ROUND";
  let seed = nextSeed();
  let nameEdited = false;

  const root = document.createElement("div");
  root.id = "island-picker";
  root.className = "island-picker";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "island-picker-title");

  const card = document.createElement("div");
  card.className = "ip-card";
  const head = document.createElement("header");
  head.className = "ip-head";
  const title = document.createElement("h2");
  title.id = "island-picker-title";
  title.textContent = translate("islandPicker.title");
  const subtitle = document.createElement("p");
  subtitle.textContent = translate("islandPicker.subtitle");
  head.replaceChildren(title, subtitle);

  const body = document.createElement("div");
  body.className = "ip-body";

  const previewColumn = document.createElement("div");
  previewColumn.className = "ip-preview";
  const preview = document.createElement("canvas");
  preview.width = 480;
  preview.height = 480;
  preview.setAttribute("role", "img");
  const counts = document.createElement("p");
  counts.className = "ip-counts";
  const reroll = document.createElement("button");
  reroll.type = "button";
  reroll.className = "ip-reroll";
  reroll.textContent = translate("islandPicker.reroll");
  previewColumn.replaceChildren(preview, counts, reroll);

  const controls = document.createElement("div");
  controls.className = "ip-controls";
  const elementHeading = document.createElement("h3");
  elementHeading.textContent = translate("islandPicker.step.element");
  const elementRow = document.createElement("div");
  elementRow.className = "ip-elements";
  const elementButtons = ISLAND_ELEMENTS.map((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ip-element";
    button.dataset.element = candidate;
    // The icon is the element's own island, drawn small: forests, ridges and bays say more than a
    // pictogram, and it is the same art the player is choosing between.
    const icon = document.createElement("canvas");
    icon.className = "ip-element-icon";
    icon.width = 72;
    icon.height = 72;
    icon.setAttribute("aria-hidden", "true");
    const label = document.createElement("strong");
    label.textContent = translate(`island.element.${candidate}` as MessageKey);
    const trait = document.createElement("small");
    trait.textContent = translate(`island.trait.${candidate}` as MessageKey);
    button.replaceChildren(icon, label, trait);
    button.addEventListener("click", () => {
      element = candidate;
      if (!nameEdited) nameInput.value = defaultName();
      render();
    });
    return button;
  });
  elementRow.replaceChildren(...elementButtons);

  const outlineHeading = document.createElement("h3");
  outlineHeading.textContent = translate("islandPicker.step.outline");
  const outlineRow = document.createElement("div");
  outlineRow.className = "ip-outlines";
  const outlineButtons = ISLAND_OUTLINES.map((candidate) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ip-outline";
    button.dataset.outline = candidate;
    const thumbnail = document.createElement("canvas");
    thumbnail.width = 96;
    thumbnail.height = 96;
    thumbnail.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = translate(`island.outline.${candidate}` as MessageKey);
    button.replaceChildren(thumbnail, label);
    button.addEventListener("click", () => {
      outline = candidate;
      render();
    });
    return { button, thumbnail, candidate };
  });
  outlineRow.replaceChildren(...outlineButtons.map((entry) => entry.button));

  const nameHeading = document.createElement("h3");
  nameHeading.textContent = translate("islandPicker.step.name");
  const nameInput = document.createElement("input");
  nameInput.className = "ip-name";
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.autocomplete = "off";
  nameInput.placeholder = translate("islandPicker.namePlaceholder");
  nameInput.addEventListener("input", () => {
    nameEdited = true;
    confirm.disabled = nameInput.value.trim().length === 0;
  });
  const error = document.createElement("p");
  error.className = "ip-error";
  error.hidden = true;
  const confirm = document.createElement("button");
  confirm.type = "button";
  confirm.className = "primary ip-confirm";
  confirm.textContent = translate("islandPicker.confirm");
  controls.replaceChildren(elementHeading, elementRow, outlineHeading, outlineRow, nameHeading, nameInput, error, confirm);

  body.replaceChildren(previewColumn, controls);
  card.replaceChildren(head, body);
  root.replaceChildren(card);

  function defaultName(): string {
    return translate("islandPicker.defaultName", { element: translate(`island.element.${element}` as MessageKey) });
  }

  function render(): void {
    const current = island(element, outline, seed);
    drawIslandPreview(preview, current, { sites: true });
    preview.setAttribute(
      "aria-label",
      `${translate(`island.element.${element}` as MessageKey)} · ${translate(`island.outline.${outline}` as MessageKey)}`
    );
    const tally = islandSiteCounts(current);
    counts.textContent = (["ore", "trees", "bays", "pastures"] as const)
      .filter((kind) => tally[kind] > 0)
      .map((kind) => translate(`islandPicker.count.${kind}`, { count: tally[kind] }))
      .join(" · ");
    for (const button of elementButtons) {
      const candidate = button.dataset.element as IslandElement;
      const active = candidate === element;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-pressed", String(active));
      const icon = button.querySelector("canvas");
      if (icon !== null) drawIslandPreview(icon, island(candidate, outline, seed), { sites: false });
    }
    for (const entry of outlineButtons) {
      const active = entry.candidate === outline;
      entry.button.classList.toggle("is-active", active);
      entry.button.setAttribute("aria-pressed", String(active));
      drawIslandPreview(entry.thumbnail, island(element, entry.candidate, seed), { sites: false });
    }
  }

  nameInput.value = defaultName();
  host.appendChild(root);
  render();

  reroll.addEventListener("click", () => {
    seed = nextSeed();
    render();
  });

  return new Promise<IslandPick>((resolve) => {
    confirm.addEventListener("click", () => {
      const name = nameInput.value.trim();
      if (name.length === 0) return;
      const pick: IslandPick = { name, element, outline, seed };
      root.classList.add("is-busy");
      for (const control of root.querySelectorAll("button, input")) (control as HTMLButtonElement | HTMLInputElement).disabled = true;
      confirm.textContent = translate("islandPicker.creating");
      error.hidden = true;
      options.onConfirm(pick).then(
        () => {
          root.remove();
          resolve(pick);
        },
        (reason: unknown) => {
          root.classList.remove("is-busy");
          for (const control of root.querySelectorAll("button, input")) (control as HTMLButtonElement | HTMLInputElement).disabled = false;
          confirm.textContent = translate("islandPicker.confirm");
          error.textContent = options.describeError(reason);
          error.hidden = false;
        }
      );
    });
  });
}
