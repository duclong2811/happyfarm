import type { BuildCatalogEntryDTO } from "@happy-farm/contracts";
import type { Translate } from "../i18n";
import type { IconName } from "../icons";
import {
  entryAvailability,
  isPreviewOnly,
  type AvailabilityFilter,
  type ShopCategory
} from "./shop-state";

/**
 * The construction shop's three areas, as DOM.
 *
 * The rail browses, the grid shows what a thing looks like, and the inspector is where a player reads
 * what they are about to spend gold on. Nothing here decides anything: availability, filtering and
 * cost come from `shop-state.ts` and the catalogue, and every action is a callback the host wires to
 * real state.
 */

export type CategoryLabelKey =
  | "build.category.road"
  | "build.category.vegetation"
  | "build.category.decoration"
  | "build.category.fence"
  | "build.category.lighting"
  | "build.category.utility"
  | "build.category.waterfront"
  | "build.category.building"
  | "build.category.monument";

export interface ShopViewState {
  readonly category: ShopCategory | null;
  readonly categories: readonly ShopCategory[];
  readonly query: string;
  readonly filter: AvailabilityFilter;
  readonly playerLevel: number;
  readonly selected: BuildCatalogEntryDTO | null;
  /** The entries the grid shows: already grouped, searched and filtered. */
  readonly visible: readonly BuildCatalogEntryDTO[];
  /** Whether the category has entries at all, so an empty search can say so. */
  readonly categorySize: number;
  readonly goldText: string;
}

export interface ShopViewHandlers {
  readonly onCategory: (category: ShopCategory) => void;
  readonly onSearch: (query: string) => void;
  readonly onFilter: (filter: AvailabilityFilter) => void;
  readonly onSelect: (entry: BuildCatalogEntryDTO) => void;
  readonly onPlace: () => void;
}

export interface ShopViewContext {
  readonly t: Translate;
  readonly icon: (name: IconName, size: number) => SVGElement;
  readonly categoryLabelKey: (category: ShopCategory) => CategoryLabelKey;
  readonly categoryIcon: (category: ShopCategory) => IconName;
  readonly nameOf: (entry: BuildCatalogEntryDTO) => string;
  readonly descriptionOf: (entry: BuildCatalogEntryDTO) => string;
  readonly priceOf: (entry: BuildCatalogEntryDTO) => string;
  /** The picture if it is drawn, else null - the caller starts the render either way. */
  readonly cachedThumbnail: (entry: BuildCatalogEntryDTO) => string | null;
  readonly requestThumbnail: (entry: BuildCatalogEntryDTO, image: HTMLImageElement) => void;
  /** `Upgrade to <name>`: the next rung's name, when the catalogue names one. */
  readonly upgradeNameOf: (entry: BuildCatalogEntryDTO) => string | null;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** One picture element, filled from the cache or as soon as the renderer answers. */
function thumbnail(context: ShopViewContext, entry: BuildCatalogEntryDTO): HTMLImageElement {
  const image = make("img", "shop-thumb-image");
  image.alt = "";
  image.decoding = "async";
  const cached = context.cachedThumbnail(entry);
  if (cached !== null) image.src = cached;
  else context.requestThumbnail(entry, image);
  return image;
}

/** The category rail: one icon and one short label per non-empty category. */
export function renderCategoryRail(
  rail: HTMLElement,
  state: ShopViewState,
  context: ShopViewContext,
  handlers: ShopViewHandlers
): void {
  rail.replaceChildren();
  rail.setAttribute("role", "tablist");
  for (const category of state.categories) {
    const selected = category === state.category;
    const button = make("button", "shop-rail-item");
    button.type = "button";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.classList.toggle("is-active", selected);
    button.appendChild(context.icon(context.categoryIcon(category), 18));
    button.appendChild(make("span", "shop-rail-label", context.t(context.categoryLabelKey(category))));
    button.addEventListener("click", () => {
      handlers.onCategory(category);
    });
    rail.appendChild(button);
  }
}

/** The search box and the All/Available/Locked filter. */
export function renderSearchBar(
  bar: HTMLElement,
  state: ShopViewState,
  context: ShopViewContext,
  handlers: ShopViewHandlers
): void {
  bar.replaceChildren();

  const label = make("label", "visually-hidden", context.t("build.search"));
  const input = make("input", "shop-search-input");
  input.type = "search";
  input.id = "build-search";
  input.value = state.query;
  input.placeholder = context.t("build.searchPlaceholder");
  input.autocomplete = "off";
  label.setAttribute("for", input.id);
  input.addEventListener("input", () => {
    handlers.onSearch(input.value);
  });
  bar.appendChild(label);
  bar.appendChild(input);

  const filters = make("div", "shop-filters");
  filters.setAttribute("role", "group");
  const options: readonly AvailabilityFilter[] = ["ALL", "AVAILABLE", "LOCKED"];
  for (const option of options) {
    const button = make("button", "shop-filter");
    button.type = "button";
    button.textContent = context.t(
      option === "ALL" ? "build.filter.all" : option === "AVAILABLE" ? "build.filter.available" : "build.filter.locked"
    );
    button.setAttribute("aria-pressed", state.filter === option ? "true" : "false");
    button.classList.toggle("is-active", state.filter === option);
    button.addEventListener("click", () => {
      handlers.onFilter(option);
    });
    filters.appendChild(button);
  }
  bar.appendChild(filters);
}

/** One grid card: the picture, the name, the price, and only the badges that matter. */
export function renderAssetCard(
  entry: BuildCatalogEntryDTO,
  state: ShopViewState,
  context: ShopViewContext,
  handlers: ShopViewHandlers
): HTMLButtonElement {
  const availability = entryAvailability(entry, state.playerLevel);
  const card = make("button", "shop-card");
  card.type = "button";
  card.dataset.entryId = entry.entryId;
  const selected = state.selected?.entryId === entry.entryId;
  card.classList.toggle("is-selected", selected);
  card.classList.toggle("is-locked", availability === "LOCKED");
  card.classList.toggle("is-preview", availability === "PREVIEW_ONLY");
  // A locked card is still a *selectable* card: inspecting what you will unlock is the point of the
  // progression preview. So it stays a real button and only the PLACE action is refused.
  card.setAttribute("aria-selected", selected ? "true" : "false");
  if (availability !== "AVAILABLE") card.setAttribute("aria-disabled", "true");

  const thumb = make("div", "shop-card-thumb");
  thumb.appendChild(thumbnail(context, entry));
  if (availability === "LOCKED") {
    const lock = make("div", "shop-card-lock");
    lock.appendChild(context.icon("lock", 13));
    lock.appendChild(make("span", undefined, context.t("build.levelShort", { level: entry.requiredLevel })));
    thumb.appendChild(lock);
  } else if (availability === "PREVIEW_ONLY") {
    thumb.appendChild(make("span", "shop-card-preview", context.t("build.preview")));
  }
  card.appendChild(thumb);

  const meta = make("div", "shop-card-meta");
  meta.appendChild(make("span", "shop-card-name", context.nameOf(entry)));
  const line = make("div", "shop-card-line");
  const price = make("span", "shop-card-price");
  price.appendChild(context.icon("coin", 12));
  price.appendChild(make("span", undefined, context.priceOf(entry)));
  line.appendChild(price);
  if (entry.requiredLevel > 1) {
    line.appendChild(make("span", "shop-card-level", context.t("build.levelShort", { level: entry.requiredLevel })));
  }
  meta.appendChild(line);
  card.appendChild(meta);

  card.addEventListener("click", () => {
    handlers.onSelect(entry);
  });
  return card;
}

/** The grid, or the one empty state that explains why there is nothing to show. */
export function renderAssetGrid(
  grid: HTMLElement,
  state: ShopViewState,
  context: ShopViewContext,
  handlers: ShopViewHandlers
): void {
  grid.replaceChildren();
  if (state.visible.length === 0) {
    const empty = state.categorySize === 0 ? "build.empty" : "build.searchEmpty";
    grid.appendChild(make("p", "shop-empty", context.t(empty)));
    return;
  }
  for (const entry of state.visible) {
    grid.appendChild(renderAssetCard(entry, state, context, handlers));
  }
}

/**
 * The inspector: everything a player should know before spending gold.
 *
 * It reads the catalogue and nothing else. When there is no selection it says so, because an empty
 * column with a button in it is worse than a sentence.
 */
export function renderInspector(
  inspector: HTMLElement,
  state: ShopViewState,
  context: ShopViewContext,
  handlers: ShopViewHandlers
): void {
  inspector.replaceChildren();
  const entry = state.selected;
  if (entry === null) {
    inspector.appendChild(make("p", "shop-inspector-empty", context.t("build.inspector.none")));
    return;
  }

  const availability = entryAvailability(entry, state.playerLevel);
  const picture = make("div", "shop-inspector-picture");
  picture.appendChild(thumbnail(context, entry));
  inspector.appendChild(picture);

  inspector.appendChild(make("h3", "shop-inspector-name", context.nameOf(entry)));
  inspector.appendChild(make("p", "shop-inspector-description", context.descriptionOf(entry)));

  const facts = make("dl", "shop-facts");
  const fact = (label: string, value: Node | string): void => {
    facts.appendChild(make("dt", undefined, label));
    const cell = make("dd");
    if (typeof value === "string") cell.textContent = value;
    else cell.appendChild(value);
    facts.appendChild(cell);
  };

  const price = make("span", "shop-fact-price");
  price.appendChild(context.icon("coin", 14));
  price.appendChild(make("span", undefined, context.priceOf(entry)));
  fact(context.t("build.inspector.price"), price);
  if (entry.category === "ROAD") {
    // The catalogue sells a road by the four-cell segment, so the inspector says so instead of
    // implying that the price is per cell.
    fact(
      context.t("build.inspector.cost"),
      context.t("build.inspector.perCells", { cells: entry.footprint.widthCells * entry.footprint.depthCells })
    );
  }
  if (entry.requiredLevel > 1) {
    fact(context.t("build.inspector.level"), context.t("build.levelFull", { level: entry.requiredLevel }));
  }
  fact(
    context.t("build.inspector.footprint"),
    context.t("build.inspector.cells", {
      width: entry.footprint.widthCells,
      depth: entry.footprint.depthCells
    })
  );
  if (entry.tierRank !== null) {
    fact(context.t("build.inspector.tier"), context.t("build.tier", { tier: entry.tierRank }));
  }
  const upgradeName = context.upgradeNameOf(entry);
  if (upgradeName !== null) {
    fact(context.t("build.inspector.upgrade"), context.t("build.inspector.upgradeTo", { item: upgradeName }));
  }
  inspector.appendChild(facts);

  const state_line = make("p", "shop-inspector-state");
  state_line.classList.toggle("is-locked", availability === "LOCKED");
  state_line.classList.toggle("is-preview", availability === "PREVIEW_ONLY");
  state_line.textContent =
    availability === "LOCKED"
      ? context.t("build.unlocksAt", { level: entry.requiredLevel })
      : availability === "PREVIEW_ONLY"
        ? context.t("build.previewOnly")
        : context.t("build.available");
  inspector.appendChild(state_line);

  const place = make("button", "shop-place");
  place.type = "button";
  place.disabled = availability !== "AVAILABLE";
  place.textContent =
    availability === "LOCKED"
      ? context.t("build.lockedAt", { level: entry.requiredLevel })
      : availability === "PREVIEW_ONLY"
        ? context.t("build.previewOnly")
        : context.t("build.place");
  place.addEventListener("click", () => {
    handlers.onPlace();
  });
  inspector.appendChild(place);
}

/** The gold readout in the shop header: the wallet the game already reports, and nothing else. */
export function renderShopGold(node: HTMLElement, state: ShopViewState, context: ShopViewContext): void {
  node.replaceChildren();
  node.appendChild(context.icon("coin", 15));
  node.appendChild(make("span", undefined, state.goldText));
}

/** Whether a preview-only entry is the selected one - the shop's own question, asked in one place. */
export function selectedIsPreviewOnly(selected: BuildCatalogEntryDTO | null): boolean {
  return selected !== null && isPreviewOnly(selected);
}
