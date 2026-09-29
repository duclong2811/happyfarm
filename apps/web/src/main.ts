import type {
  CropDefinitionDTO,
  CropStateDTO,
  FarmTileDTO,
  InventoryEntryDTO,
  PlayerProgressionDTO,
  PlotDTO,
  ShopEntryDTO,
  WalletDTO
} from "@happy-farm/contracts";
import { ApiClient, ApiError } from "./api";
import {
  createTranslator,
  currencyName,
  detectLanguage,
  displayName,
  errorMessage,
  languageTag,
  otherLanguage,
  readStoredLanguage,
  storeLanguage,
  terrainName,
  type Language,
  type MessageKey,
  type Translate
} from "./i18n";
import { progressionSummary } from "./progression";
import { describeSelection, formatRemainingGrowth, type SelectionView } from "./selection";
import {
  buildFarmSceneInput,
  createFarmScene,
  FarmRendererUnavailableError,
  type FarmSceneHandle
} from "./render";
import "./action-dock.css";
import "./hud.css";
import "./styles.css";

const FARM_KEY = "happy-farm.dev.farmId";
const REFRESH_INTERVAL_MS = 2_000;

interface SelectedTile {
  readonly x: number;
  readonly y: number;
}

/**
 * A line the status bar can say, in whatever language is current.
 *
 * Statuses are stored as this rather than as a finished string so switching language re-renders the
 * last thing that happened instead of leaving one stale sentence in the old language.
 */
type StatusText = (t: Translate, language: Language) => string;

interface AppState {
  language: Language;
  farmId: string | null;
  farmName: string;
  tiles: readonly FarmTileDTO[];
  crops: readonly CropStateDTO[];
  /** The server's crop catalogue: the only list of crops this page offers to plant. */
  cropDefinitions: readonly CropDefinitionDTO[];
  inventory: readonly InventoryEntryDTO[];
  shop: readonly ShopEntryDTO[];
  wallet: readonly WalletDTO[];
  progression: PlayerProgressionDTO | null;
  plots: readonly PlotDTO[];
  selected: SelectedTile | null;
  selectedCrop: string | null;
}

function initialLanguage(): Language {
  const saved = readStoredLanguage(localStorage);
  return detectLanguage(saved, typeof navigator === "undefined" ? null : navigator.language);
}

const state: AppState = {
  language: initialLanguage(),
  farmId: null,
  farmName: "",
  tiles: [],
  crops: [],
  cropDefinitions: [],
  inventory: [],
  shop: [],
  wallet: [],
  progression: null,
  plots: [],
  selected: null,
  selectedCrop: null
};

let t: Translate = createTranslator(state.language);
let statusText: StatusText = (translate) => translate("hud.starting");
let statusIsError = false;

// The 3D view is opt-in. Creating a WebGL context is the one thing this page cannot take back, so
// it happens on an explicit click instead of during load.
let scene: FarmSceneHandle | null = null;
let sceneState: StatusText = (translate) => translate("scene.prepare");

// The repository typechecks with both the DOM and `@cloudflare/workers-types` libraries, which
// declare conflicting `append`/`remove` signatures. The cast keeps this tiny id lookup usable.
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
function element<T>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`Missing element #${id}`);
  return found as unknown as T;
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

function setStatus(text: StatusText, isError = false): void {
  statusText = text;
  statusIsError = isError;
  renderStatus();
}

/** A short status for a message key, with its placeholders resolved in the current language. */
function message(key: MessageKey, params: Record<string, string | number> = {}): StatusText {
  return (translate) => translate(key, params);
}

/** Transient text (an error message that is not a message key) that is shown verbatim. */
function literal(text: string): StatusText {
  return () => text;
}

function renderStatus(): void {
  const node = element<HTMLParagraphElement>("status");
  node.textContent = statusText(t, state.language);
  node.classList.toggle("error", statusIsError);
}

function api(): ApiClient {
  return new ApiClient();
}

function newRequestId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID()}`;
}

function describe(error: unknown): StatusText {
  if (error instanceof ApiError) return (translate) => errorMessage(translate, error.code);
  if (error instanceof Error) return literal(error.message);
  return literal(String(error));
}

function cropName(definitionId: string): string {
  const definition = state.cropDefinitions.find((entry) => entry.cropDefinitionId === definitionId);
  return definition === undefined
    ? definitionId
    : displayName(state.language, definition.displayNameKey, definitionId);
}

function itemName(itemDefinitionId: string, displayNameKey: string): string {
  return displayName(state.language, displayNameKey, itemDefinitionId);
}

/**
 * Everything the page knows about an item id.
 *
 * The catalogue and the inventory both carry the display key, so a name can almost always come from
 * server data. This only has to cover ids the page has never been told about, and it falls back to
 * the raw id rather than guessing.
 */
function itemDisplayKey(itemDefinitionId: string): string | null {
  const fromInventory = state.inventory.find((entry) => entry.itemDefinitionId === itemDefinitionId);
  if (fromInventory !== undefined) return fromInventory.displayNameKey;
  const fromShop = state.shop.find((entry) => entry.itemDefinitionId === itemDefinitionId);
  if (fromShop !== undefined) return fromShop.itemDisplayNameKey;
  const fromCatalogue = state.cropDefinitions.find(
    (entry) => entry.seedItemDefinitionId === itemDefinitionId
  );
  return fromCatalogue?.seedItemDisplayNameKey ?? null;
}

function itemLabel(itemDefinitionId: string): string {
  const key = itemDisplayKey(itemDefinitionId);
  return key === null ? itemDefinitionId : displayName(state.language, key, itemDefinitionId);
}

function currencyLabel(currencyId: string, displayNameKey: string | null): string {
  return displayNameKey === null
    ? currencyId
    : currencyName(state.language, displayNameKey, currencyId);
}

/** The display key for a currency the page has seen in a wallet, a market row, or a land price. */
function currencyDisplayKey(currencyId: string): string | null {
  return (
    state.wallet.find((entry) => entry.currencyId === currencyId)?.displayNameKey ??
    state.shop.find((entry) => entry.currencyId === currencyId)?.currencyDisplayNameKey ??
    state.plots.find((plot) => plot.currencyId === currencyId)?.currencyDisplayNameKey ??
    null
  );
}

function selectedTile(): FarmTileDTO | null {
  const selected = state.selected;
  if (selected === null) return null;
  return state.tiles.find((tile) => tile.x === selected.x && tile.y === selected.y) ?? null;
}

function cropAt(x: number, y: number): CropStateDTO | null {
  return state.crops.find((crop) => crop.tileX === x && crop.tileY === y) ?? null;
}

function renderFarm(): void {
  const info = element<HTMLParagraphElement>("farm-info");
  if (state.farmId === null) {
    info.textContent = t("farm.none");
    return;
  }
  info.textContent = t("farm.info", {
    name: state.farmName,
    farmId: state.farmId,
    tiles: state.tiles.length
  });
}

function renderWallet(): void {
  const node = element<HTMLParagraphElement>("wallet");
  node.textContent =
    state.wallet.length === 0
      ? t("wallet.none")
      : state.wallet
          .map(
            (entry) =>
              `${String(entry.balance)} ${currencyLabel(entry.currencyId, entry.displayNameKey)}`
          )
          .join(" · ");
}

function renderProgression(): void {
  const node = element<HTMLDivElement>("progression");
  node.replaceChildren();
  const progression = state.progression;
  if (progression === null) {
    node.appendChild(make("p", "muted", t("progression.signedOut")));
    return;
  }
  // The bar's width is the only value on this page the server does not send; it is the fraction the
  // server already derived, turned into pixels. No level or threshold is recomputed here.
  const summary = progressionSummary(progression, t);
  node.appendChild(make("p", "big", summary.title));
  const bar = make("div", "xp-bar");
  const fill = make("div", "xp-fill");
  fill.style.width = `${String(Math.round(summary.fraction * 100))}%`;
  bar.appendChild(fill);
  node.appendChild(bar);
  node.appendChild(make("p", "muted", summary.detail));
}

function renderPlots(): void {
  const node = element<HTMLDivElement>("plots");
  node.replaceChildren();
  if (state.farmId === null || state.plots.length === 0) {
    node.appendChild(make("p", "muted", t("land.load")));
    element<HTMLButtonElement>("expand-farm").disabled = true;
    return;
  }
  const next = state.plots.find((plot) => !plot.unlocked);
  if (next === undefined) {
    node.appendChild(make("p", "muted", t("land.all")));
    element<HTMLButtonElement>("expand-farm").disabled = true;
    return;
  }
  node.appendChild(
    make(
      "p",
      "big",
      t("land.next", {
        index: next.plotIndex,
        price: next.price,
        currency: currencyLabel(next.currencyId, next.currencyDisplayNameKey),
        level: next.requiredLevel
      })
    )
  );
  element<HTMLButtonElement>("expand-farm").disabled =
    (state.progression?.level ?? 1) < next.requiredLevel;
}

/**
 * Whether the server-reported level is below this crop's requirement.
 *
 * An unknown level -- signed out, or no account read yet -- locks nothing. Guessing "locked" would
 * hide an option the player has actually unlocked, and the server is the one that decides anyway.
 */
function cropIsLocked(definition: CropDefinitionDTO): boolean {
  const level = state.progression?.level ?? null;
  return level !== null && level < definition.requiredLevel;
}

/** How many of this crop's seeds the player currently holds. Server inventory, never a local guess. */
function seedCount(definition: CropDefinitionDTO): number {
  return state.inventory
    .filter((entry) => entry.itemDefinitionId === definition.seedItemDefinitionId)
    .reduce((total, entry) => total + entry.quantity, 0);
}

function selectedCropDefinition(): CropDefinitionDTO | null {
  if (state.selectedCrop === null) return null;
  return (
    state.cropDefinitions.find((entry) => entry.cropDefinitionId === state.selectedCrop) ?? null
  );
}

/** Keeps the planting selection valid: the first crop this player can actually plant. */
function ensurePlantableSelection(): void {
  const plantable = (definition: CropDefinitionDTO): boolean =>
    definition.cropDefinitionId === state.selectedCrop &&
    !cropIsLocked(definition) &&
    seedCount(definition) > 0;
  if (state.cropDefinitions.some(plantable)) return;
  state.selectedCrop =
    state.cropDefinitions.find((definition) => !cropIsLocked(definition))?.cropDefinitionId ?? null;
}

// The planting control is this page's only <select>, and it is rebuilt from the server's catalogue.
// Replacing its options while the list is open would collapse the dropdown, and this page re-renders
// after every action and on every growth poll, so the options are only replaced when they differ.
let renderedCropOptions: string | null = null;

function renderCrops(): void {
  const level = state.progression?.level ?? null;
  const signature = JSON.stringify([
    state.language,
    state.cropDefinitions.map((definition) => [
      definition.cropDefinitionId,
      definition.requiredLevel,
      seedCount(definition)
    ]),
    level,
    state.selectedCrop
  ]);
  if (signature === renderedCropOptions) return;
  renderedCropOptions = signature;

  const select = element<HTMLSelectElement>("crop-select");
  select.replaceChildren();
  if (state.cropDefinitions.length === 0) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "—";
    select.appendChild(placeholder);
    select.disabled = true;
    return;
  }
  select.disabled = false;
  for (const definition of state.cropDefinitions) {
    const option = document.createElement("option");
    option.value = definition.cropDefinitionId;
    // Every option carries the crop's name and the seed count the player holds, so the cost of
    // planting is visible before the button is pressed. A locked crop is offered with the level it
    // needs rather than hidden, so the player can see what to work towards.
    const parts = [cropName(definition.cropDefinitionId)];
    if (definition.requiredLevel > 1) {
      parts.push(`(${t("dock.locked", { level: definition.requiredLevel })})`);
    }
    parts.push(t("dock.seedCount", { count: seedCount(definition) }));
    option.disabled = cropIsLocked(definition);
    option.textContent = parts.join(" · ");
    select.appendChild(option);
  }
  select.value = state.selectedCrop ?? "";
}

/** The single place the page turns authoritative rows into "what the dock offers" semantics. */
function currentSelection(): SelectionView {
  const definition = selectedCropDefinition();
  return describeSelection({
    tiles: state.tiles,
    crops: state.crops,
    cropDefinitions: state.cropDefinitions,
    selected: state.selected,
    selectedCrop:
      definition === null
        ? null
        : {
            cropDefinitionId: definition.cropDefinitionId,
            unlocked: !cropIsLocked(definition),
            seedCount: seedCount(definition)
          },
    nowMs: Date.now()
  });
}

function at(coordinate: { readonly x: number; readonly y: number } | null): string {
  return coordinate === null ? "" : ` (${String(coordinate.x)}, ${String(coordinate.y)})`;
}

function renderSelection(): void {
  const node = element<HTMLSpanElement>("selection");
  const detail = element<HTMLSpanElement>("selection-detail");
  const selection = currentSelection();
  const where = at(selection.coordinate);

  switch (selection.kind) {
    case "none":
      node.textContent = t("selection.none.title");
      detail.textContent = t("selection.none.detail");
      break;
    case "missing":
      node.textContent = t("selection.missing.title", { at: where });
      detail.textContent = t("selection.missing.detail");
      break;
    case "empty": {
      const terrain =
        selection.terrainType === null
          ? t("terrain.unknown")
          : terrainName(state.language, selection.terrainType);
      node.textContent = t("selection.empty.title", { at: where, terrain });
      detail.textContent = emptyDetail(selection);
      break;
    }
    case "growing": {
      const crop = selection.crop;
      node.textContent = t("selection.growing.title", {
        at: where,
        crop: crop === null ? t("dock.crop") : cropName(crop.definitionId)
      });
      detail.textContent =
        crop === null
          ? t("selection.growing.detail", { percent: 0, time: formatRemainingGrowth(null, t) })
          : t("selection.growing.detail", {
              percent: Math.round(crop.growthProgress * 100),
              time: formatRemainingGrowth(selection.remainingSeconds, t)
            });
      break;
    }
    case "mature": {
      const crop = selection.crop;
      node.textContent = t("selection.mature.title", {
        at: where,
        crop: crop === null ? t("dock.crop") : cropName(crop.definitionId)
      });
      detail.textContent = t("selection.mature.detail");
      break;
    }
  }

  renderActionControls(selection);
}

/** Why the dock will not plant, phrased for the selection the player actually has. */
function emptyDetail(selection: SelectionView): string {
  const definition = selectedCropDefinition();
  switch (selection.plantBlocked) {
    case "terrain":
      return t("selection.empty.terrain");
    case "crop-locked":
      return t("selection.empty.locked", { level: definition?.requiredLevel ?? 1 });
    case "no-seed": {
      const key = definition?.seedItemDisplayNameKey ?? null;
      const seed =
        definition === null || key === null ? t("dock.crop") : itemName(definition.seedItemDefinitionId, key);
      return t("selection.empty.noSeed", { seed });
    }
    default:
      return t("selection.empty.detail");
  }
}

/**
 * The dock follows the selection: planting while the tile is bare soil, and harvest-or-uproot while
 * it holds a crop. A growing crop offers only uproot, so a mis-planted tile can be freed without
 * waiting, and an occupied tile can never send a plant request.
 */
function renderActionControls(selection: SelectionView): void {
  const hasCrop = selection.crop !== null;
  element<HTMLDivElement>("plant-controls").hidden = hasCrop;
  element<HTMLDivElement>("crop-controls").hidden = !hasCrop;
  element<HTMLButtonElement>("plant").disabled = !selection.canPlant;
  element<HTMLButtonElement>("harvest").disabled = !selection.canHarvest;
  element<HTMLButtonElement>("harvest").hidden = !selection.canHarvest;
  element<HTMLButtonElement>("uproot").disabled = !selection.canUproot;
}

function tileNode(tile: FarmTileDTO): HTMLDivElement {
  const crop = cropAt(tile.x, tile.y);
  const node = make("div", "tile");
  const selected = state.selected;
  const isSelected = selected !== null && selected.x === tile.x && selected.y === tile.y;
  node.classList.toggle("selected", isSelected);
  if (crop !== null) node.classList.add(crop.mature ? "mature" : "growing");
  if (tile.terrainType !== "SOIL") node.classList.add("blocked");
  node.tabIndex = 0;
  node.appendChild(make("span", "coords", t("field.tile", { x: tile.x, y: tile.y })));

  if (crop === null) {
    node.appendChild(
      make(
        "span",
        "crop",
        tile.terrainType === "SOIL"
          ? t("field.empty")
          : terrainName(state.language, tile.terrainType)
      )
    );
  } else {
    node.appendChild(make("span", "crop", cropName(crop.definitionId)));
    if (crop.mature) {
      node.appendChild(make("span", "state", t("field.ready")));
      const harvest = make("button", "mini", t("dock.harvest"));
      harvest.addEventListener("click", (event) => {
        event.stopPropagation();
        void run(() => harvestCrop(crop.cropInstanceId, crop.version));
      });
      node.appendChild(harvest);
    } else {
      node.appendChild(
        make(
          "span",
          "state",
          t("field.stage", {
            percent: Math.round(crop.growthProgress * 100),
            stage: crop.growthStage
          })
        )
      );
    }
  }

  const select = (): void => {
    selectTile(tile.x, tile.y);
  };
  node.addEventListener("click", select);
  node.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") select();
  });
  return node;
}

function renderField(): void {
  const container = element<HTMLDivElement>("field");
  container.replaceChildren();
  if (state.farmId === null) {
    container.appendChild(make("p", "muted", t("field.load")));
    return;
  }
  if (state.tiles.length === 0) {
    container.appendChild(make("p", "muted", t("field.none")));
    return;
  }
  const grid = make("div", "grid");
  for (const tile of [...state.tiles].sort((a, b) => a.y - b.y || a.x - b.x)) {
    grid.appendChild(tileNode(tile));
  }
  container.appendChild(grid);
}

function renderInventory(): void {
  const list = element<HTMLUListElement>("inventory");
  list.replaceChildren();
  if (state.inventory.length === 0) {
    list.appendChild(make("li", "muted", t("inventory.empty")));
    return;
  }
  for (const entry of state.inventory) {
    list.appendChild(
      make(
        "li",
        undefined,
        t("inventory.line", {
          item: itemName(entry.itemDefinitionId, entry.displayNameKey),
          quantity: entry.quantity
        })
      )
    );
  }
}

/**
 * The market, one row per entry, with a button only for the directions the server offers.
 *
 * Seeds carry a buy price and produce carries a sell price, so this renders whatever it is given
 * rather than deciding from the item's name. There is no row where a single click could buy and
 * sell the same item back.
 */
function renderShop(): void {
  const container = element<HTMLDivElement>("shop");
  container.replaceChildren();
  if (state.shop.length === 0) {
    container.appendChild(make("p", "muted", t("market.signedOut")));
    return;
  }
  for (const entry of state.shop) {
    const currency = currencyLabel(entry.currencyId, entry.currencyDisplayNameKey);
    const row = make("div", "shop-row");
    const price = entry.buyPrice ?? entry.sellPrice ?? 0;
    row.appendChild(
      make(
        "span",
        "shop-item",
        t("market.line", {
          item: itemName(entry.itemDefinitionId, entry.itemDisplayNameKey),
          price: `${String(price)} ${currency}`
        })
      )
    );
    const quantity = make("input");
    quantity.type = "number";
    quantity.min = "1";
    quantity.max = String(entry.maxQuantityPerRequest);
    quantity.value = "1";
    quantity.className = "quantity";
    row.appendChild(quantity);
    if (entry.buyPrice !== null) {
      const buy = make("button", undefined, t("market.buy"));
      buy.addEventListener("click", () => {
        void trade("buy", entry.shopEntryId, quantity.valueAsNumber);
      });
      row.appendChild(buy);
    }
    if (entry.sellPrice !== null) {
      const sell = make("button", undefined, t("market.sell"));
      sell.addEventListener("click", () => {
        void trade("sell", entry.shopEntryId, quantity.valueAsNumber);
      });
      row.appendChild(sell);
    }
    container.appendChild(row);
  }
}

/** Every string the layout itself owns, so a language change reaches the panel headings too. */
function renderChrome(): void {
  element<HTMLElement>("gold-label").textContent = t("hud.gold");
  element<HTMLElement>("inventory-title").textContent = t("panel.inventory");
  element<HTMLElement>("land-title").textContent = t("panel.land");
  element<HTMLElement>("market-title").textContent = t("panel.market");
  element<HTMLElement>("crop-label").textContent = t("dock.crop");
  element<HTMLButtonElement>("plant").textContent = t("dock.plant");
  element<HTMLButtonElement>("harvest").textContent = t("dock.harvest");
  element<HTMLButtonElement>("uproot").textContent = t("dock.uproot");
  element<HTMLButtonElement>("expand-farm").textContent = t("land.unlock");
  const language = element<HTMLButtonElement>("language");
  language.textContent = t("language.switch");
  language.title = t("language.label");
  language.setAttribute("aria-label", t("language.label"));
  element<HTMLButtonElement>("refresh").title = t("hud.refresh");
}

function render(): void {
  renderChrome();
  renderFarm();
  renderWallet();
  renderProgression();
  renderPlots();
  renderCrops();
  renderField();
  renderSelection();
  renderInventory();
  renderShop();
  renderStatus();
  renderSceneState();
}

async function refreshAccount(): Promise<void> {
  const client = api();
  const [inventory, wallet, shop, progression, cropDefinitions] = await Promise.all([
    client.getInventory(),
    client.getWallet(),
    client.getShop(),
    client.getProgression(),
    client.getCropDefinitions()
  ]);
  state.inventory = inventory.items;
  state.wallet = wallet.wallets;
  state.shop = shop.entries;
  state.progression = progression.progression;
  state.cropDefinitions = cropDefinitions.definitions;
  ensurePlantableSelection();
}

function setSceneState(text: StatusText): void {
  sceneState = text;
  renderSceneState();
}

function renderSceneState(): void {
  element<HTMLSpanElement>("render-3d-state").textContent = sceneState(t, state.language);
}

/** Applies a selection from either the 2D grid or the 3D view; both read and write this one state. */
function selectTile(x: number, y: number): void {
  state.selected = { x, y };
  renderField();
  renderSelection();
  refreshScene();
}

/** Pushes authoritative farm state into the renderer. The renderer invents no land and no crops. */
function refreshScene(): void {
  if (scene === null) return;
  try {
    scene.setState(
      buildFarmSceneInput({
        tiles: state.tiles,
        crops: state.crops,
        plots: state.plots,
        selected: state.selected
      })
    );
  } catch (error: unknown) {
    // The 3D view is a projection of state the rest of the page owns. A renderer problem must not
    // abort the authoritative refresh that called this, because the 2D field and the polling that
    // keeps it current do not depend on the 3D view working.
    const described = describe(error);
    setSceneState((translate, language) => translate("scene.error", { message: described(translate, language) }));
    return;
  }
  setSceneState((translate) =>
    translate("scene.active", { tiles: state.tiles.length, crops: state.crops.length })
  );
}

function enable3D(): void {
  try {
    scene ??= createFarmScene(element<HTMLCanvasElement>("scene"), {
      onTileSelected: (coordinate) => {
        selectTile(coordinate.x, coordinate.y);
      },
      onAssetProblem: (assetId, error) => {
        // The crop keeps its placeholder art, so this is information rather than a failure the page
        // has to recover from. Reported on the main status line because the scene status is
        // rewritten by the next refresh.
        const described = describe(error);
        setStatus(
          (translate, language) =>
            translate("scene.assetProblem", { asset: assetId, message: described(translate, language) }),
          true
        );
      }
    });
    refreshScene();
    setStatus(message("scene.ready"));
  } catch (error: unknown) {
    if (error instanceof FarmRendererUnavailableError) {
      setSceneState((translate) => translate("scene.unavailable"));
      setStatus(message("scene.noWebgl"), true);
      return;
    }
    setStatus(describe(error), true);
  }
}

async function refreshFarm(): Promise<void> {
  if (state.farmId === null) return;
  const client = api();
  const [tiles, crops, plots] = await Promise.all([
    client.getTiles(state.farmId),
    client.getCrops(state.farmId),
    client.getPlots(state.farmId)
  ]);
  state.tiles = tiles.tiles;
  state.crops = crops.crops;
  state.plots = plots.plots;
  refreshScene();
}

async function loadFarm(farmId: string): Promise<void> {
  const client = api();
  const result = await client.getFarm(farmId);
  state.farmId = result.farm.id;
  state.farmName = result.farm.name;
  // A coordinate selected on the previous farm means nothing here, and clearing it matches what
  // creating a farm already does.
  state.selected = null;
  localStorage.setItem(FARM_KEY, result.farm.id);
  await refreshFarm();
  await refreshAccount();
}

async function createFarm(): Promise<void> {
  const client = api();
  const created = await client.createFarm("Starter Farm");
  state.farmId = created.farm.id;
  state.farmName = created.farm.name;
  state.selected = null;
  localStorage.setItem(FARM_KEY, created.farm.id);
  await refreshFarm();
  await refreshAccount();
  setStatus(message("status.createdDetail", { name: created.farm.name, tiles: state.tiles.length }));
}

async function plant(): Promise<void> {
  const tile = selectedTile();
  if (state.farmId === null || tile === null) {
    setStatus(message("status.selectTile"), true);
    return;
  }
  const selection = currentSelection();
  if (!selection.canPlant) {
    setStatus(literal(emptyDetail(selection)), true);
    return;
  }
  const cropDefinitionId = state.selectedCrop;
  if (cropDefinitionId === null) {
    setStatus(message("status.noCrop"), true);
    return;
  }
  // Belt and braces: even if the derived dock view is stale, an occupied tile never reaches the
  // network. The server still owns the final TILE_OCCUPIED decision.
  if (cropAt(tile.x, tile.y) !== null) {
    setStatus(message("status.occupied"), true);
    return;
  }
  const client = api();
  await client.plantCrop(state.farmId, {
    requestId: newRequestId("plant"),
    cropDefinitionId,
    x: tile.x,
    y: tile.y,
    expectedTileVersion: tile.version
  });
  // The seed the planting spent comes back with the inventory refresh; nothing is subtracted here.
  await refreshFarm();
  await refreshAccount();
  setStatus(
    (translate) => translate("status.planted", { crop: cropName(cropDefinitionId), x: tile.x, y: tile.y })
  );
}

async function harvestCrop(cropInstanceId: string, expectedCropVersion: number): Promise<void> {
  if (state.farmId === null) return;
  const client = api();
  const result = await client.harvestCrop(state.farmId, cropInstanceId, {
    requestId: newRequestId("harvest"),
    expectedCropVersion
  });
  // Field, crops, plots, inventory, wallet, XP, level, and crop catalogue all come back from the
  // server, and the caller re-renders the dock from that refreshed state.
  await refreshFarm();
  await refreshAccount();
  // Levelling state comes from the refresh, not from the award, so the page and the server agree
  // even if another harvest landed in between. The award is used for the message only.
  const awarded = result.progression;
  const harvested = result.harvest;
  setStatus((translate) => {
    const base = translate("status.harvested", {
      quantity: harvested.quantityAdded,
      item: itemLabel(harvested.itemDefinitionId),
      xp: awarded.xpAwarded
    });
    return awarded.leveledUp
      ? `${base}${translate("status.levelUp", { level: awarded.progression.level })}`
      : base;
  });
}

/** Harvests whatever the dock is currently showing; only a server-mature crop can reach this. */
async function harvestSelected(): Promise<void> {
  if (state.farmId === null) {
    setStatus(message("status.loadFarm"), true);
    return;
  }
  const selection = currentSelection();
  if (selection.kind !== "mature" || selection.crop === null) {
    setStatus(message("status.selectMature"), true);
    return;
  }
  // Stop a double click from sending a second harvest while the first refresh is in flight. The
  // server would refuse it too, but the dock should not offer it either.
  element<HTMLButtonElement>("harvest").disabled = true;
  await harvestCrop(selection.crop.cropInstanceId, selection.crop.version);
}

/**
 * Removes the selected crop after an explicit confirmation.
 *
 * The confirmation is the dock's, not the server's: uprooting really does destroy the seed, so the
 * player is asked first. Everything about the command itself still goes through the server, which
 * decides on its own authority whether the crop exists, belongs to this farm, and is at the version
 * the client last saw.
 */
async function uprootSelected(): Promise<void> {
  const selection = currentSelection();
  if (state.farmId === null) {
    setStatus(message("status.loadFarm"), true);
    return;
  }
  if (selection.crop === null) {
    setStatus(message("status.selectMature"), true);
    return;
  }
  if (!window.confirm(t("dock.uproot.confirm"))) return;
  const coordinate = selection.coordinate;
  await api().uprootCrop(state.farmId, selection.crop.cropInstanceId, {
    requestId: newRequestId("uproot"),
    expectedCropVersion: selection.crop.version
  });
  await refreshFarm();
  await refreshAccount();
  setStatus(
    (translate) =>
      translate("status.uprooted", { x: coordinate?.x ?? 0, y: coordinate?.y ?? 0 })
  );
}

async function trade(direction: "buy" | "sell", shopEntryId: string, quantity: number): Promise<void> {
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    setStatus(message("status.quantity"), true);
    return;
  }
  const client = api();
  const body = { requestId: newRequestId(direction), shopEntryId, quantity };
  const result = direction === "buy" ? await client.buy(body) : await client.sell(body);
  const settlement = result.settlement;
  await refreshAccount();
  const moved = "amountSpent" in settlement ? settlement.amountSpent : settlement.amountReceived;
  const currency = currencyLabel(settlement.currencyId, currencyDisplayKey(settlement.currencyId));
  setStatus(
    (translate) =>
      translate(direction === "buy" ? "status.bought" : "status.sold", {
        quantity,
        amount: moved,
        currency,
        balance: settlement.newBalance
      })
  );
}

async function expandFarm(): Promise<void> {
  if (state.farmId === null) {
    setStatus(message("status.loadFarm"), true);
    return;
  }
  const result = await api().expandFarm(state.farmId, newRequestId("expand"));
  await refreshFarm();
  await refreshAccount();
  setStatus((translate) =>
    translate("status.expanded", {
      index: result.expansion.plotIndex,
      tiles: result.expansion.tilesAdded,
      amount: result.expansion.amountSpent,
      currency: currencyLabel(
        result.expansion.currencyId,
        currencyDisplayKey(result.expansion.currencyId)
      )
    })
  );
}

async function run(action: () => Promise<void>): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    setStatus(describe(error), true);
  }
  render();
}

/**
 * Switches language in place.
 *
 * Every string on the page is re-rendered from the new translator, and the choice is persisted, so
 * the game never reloads to change language and never comes back in the wrong one. The confirmed
 * dialog is the only string the page cannot rewrite after the fact, which is why the confirmation is
 * read at the moment it is shown.
 */
function setLanguage(language: Language): void {
  state.language = language;
  t = createTranslator(language);
  storeLanguage(localStorage, language);
  document.documentElement.lang = languageTag(language);
  renderedCropOptions = null;
  render();
}

function wire(): void {
  // The options are built by renderCrops from the server's crop catalogue, not compiled in here.
  const cropSelect = element<HTMLSelectElement>("crop-select");
  cropSelect.addEventListener("change", () => {
    state.selectedCrop = cropSelect.value;
    renderSelection();
    refreshScene();
  });

  element<HTMLButtonElement>("language").addEventListener("click", () => {
    setLanguage(otherLanguage(state.language));
  });
  element<HTMLButtonElement>("refresh").addEventListener("click", () => {
    void run(async () => {
      await refreshFarm();
      await refreshAccount();
      setStatus(message("status.refreshed"));
    });
  });
  element<HTMLButtonElement>("plant").addEventListener("click", () => {
    void run(plant);
  });
  element<HTMLButtonElement>("harvest").addEventListener("click", () => {
    void run(harvestSelected);
  });
  element<HTMLButtonElement>("uproot").addEventListener("click", () => {
    void run(uprootSelected);
  });
  element<HTMLButtonElement>("expand-farm").addEventListener("click", () => {
    void run(expandFarm);
  });
  element<HTMLButtonElement>("render-3d").addEventListener("click", enable3D);
  // A page restored from the back/forward cache would otherwise return with a disposed renderer and
  // a blank canvas, so the handle is dropped and the button starts a fresh one.
  window.addEventListener("pagehide", () => {
    scene?.dispose();
    scene = null;
    setSceneState((translate) => translate("scene.idle"));
  });

  window.setInterval(() => {
    if (state.farmId === null) return;
    void (async () => {
      try {
        await refreshFarm();
        render();
      } catch {
        // Growth polling is best-effort; explicit actions surface their own errors.
      }
    })();
  }, REFRESH_INTERVAL_MS);
}

document.documentElement.lang = languageTag(state.language);
wire();
render();
void run(async () => {
  await api().bootstrap();
  const storedFarm = localStorage.getItem(FARM_KEY);
  if (storedFarm !== null) {
    try {
      await loadFarm(storedFarm);
      enable3D();
      setStatus(message("status.loaded"));
      return;
    } catch (error: unknown) {
      if (!(error instanceof ApiError) || error.code !== "RESOURCE_NOT_FOUND") throw error;
      localStorage.removeItem(FARM_KEY);
    }
  }
  await createFarm();
  enable3D();
  setStatus(message("status.created"));
});
