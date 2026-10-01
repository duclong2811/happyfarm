import type {
  BuildCatalogEntryDTO,
  ConstructionDTO,
  CropDefinitionDTO,
  CropStateDTO,
  FarmTileDTO,
  InventoryEntryDTO,
  PlayerProgressionDTO,
  PlotDTO,
  ShopEntryDTO,
  TreeDefinitionDTO,
  TreeStateDTO,
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
import { createIcon, renderIcons, type IconName } from "./icons";
import {
  closePanel,
  crossesPanelBreakpoint,
  MODULES,
  defaultPanelState,
  NO_PANEL,
  openPanel,
  togglePanel,
  type PanelState
} from "./panels";
import type { PlayerState } from "./player/controller";
import { createMovementInput, NEUTRAL_INPUT, type MovementInput } from "./player/input";
import { createPlayerRuntime } from "./player/runtime";
import { describeSelection, formatRemainingGrowth, type SelectionView } from "./selection";
import { tileToWorld, worldFrame } from "./render/layout";
import {
  buildFarmSceneInput,
  createFarmScene,
  FarmRendererUnavailableError,
  farmPresentationSignature,
  resolveRenderQuality,
  type FarmSceneInput,
  type FarmScenePlayer,
  type FarmSceneHandle,
  type RenderQualityName
} from "./render";
import { SPAWN_WORLD } from "./render/world-config";
import {
  cellKey,
  EMPTY_WORLD_CELL_MAP,
  worldToCell,
  type CellCapability,
  type WorldCell,
  type WorldCellMap
} from "./render/world-cell";
import {
  previewRejection,
  rejectionMessageKey,
  type PreviewRequirement
} from "./render/placement-preview";
import {
  entryAvailability,
  descriptionKeyFor,
  isProceduralVisual,
  normaliseQuarterTurns,
  quarterTurnYaw,
  resolveCategory,
  rotatedFootprint,
  shopCategories,
  visibleEntries,
  type AvailabilityFilter,
  type ShopCategory
} from "./build-shop/shop-state";
import { createShopThumbnails } from "./build-shop/shop-thumbnails";
import {
  renderAssetGrid,
  renderCategoryRail,
  renderInspector,
  renderSearchBar,
  renderShopGold,
  type CategoryLabelKey,
  type ShopViewContext,
  type ShopViewHandlers,
  type ShopViewState
} from "./build-shop/shop-view";
import { movementDestination } from "./render/world-cell-selection";
import { cellActionKey, cellLandKey, getAvailableCellActions } from "./render/world-cell-actions";
import { createPlayerCollisionWorld } from "./player/collision";
import type { CollisionWorld } from "./player/controller";
import "./styles.css";

const FARM_KEY = "happy-farm.dev.farmId";
const REFRESH_INTERVAL_MS = 2_000;
/** The separator the planting choices use between a name, its level, and its count. */
const OPTION_SEPARATOR = " \u00b7 ";

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
  trees: readonly TreeStateDTO[];
  /** The server's crop catalogue: the only list of crops this page offers to plant. */
  cropDefinitions: readonly CropDefinitionDTO[];
  /** The server's tree catalogue: the only list of trees this page offers to plant. */
  treeDefinitions: readonly TreeDefinitionDTO[];
  /**
   * What this deployment lets a player place.
   *
   * Read-only reference data, like the crop definitions: the panel that shows it is a *catalogue*,
   * and nothing in it buys anything, because placing is a command the server does not accept yet.
   */
  buildCatalog: readonly BuildCatalogEntryDTO[];
  /**
   * The catalogue entry the player is about to place, or null.
   *
   * UI state, and only UI state: it decides what the ghost draws and what the status line says. No
   * gold is spent, nothing is persisted, and no server command exists to send - which is exactly why
   * the shop's status says the placement pass has not arrived.
   */
  buildSelection: BuildCatalogEntryDTO | null;
  /**
   * Everything built on this farm, as the server last reported it.
   *
   * The world draws these; the shop's collision rule treats their footprints as taken. It is server
   * state, refreshed with the rest of the farm - never a local list the client maintains.
   */
  constructions: readonly ConstructionDTO[];
  /**
   * The island, cell by cell, as the renderer last projected it.
   *
   * The shop's placement preview has to ask the same question the world answers - is this ground, has
   * this player got it, may it be built on - and the answer is the WorldCell map. Keeping it here
   * means the preview reads the *renderer's* own map rather than building a second opinion about the
   * island, which is the mistake this codebase has already made once.
   */
  cellMap: WorldCellMap;
  inventory: readonly InventoryEntryDTO[];
  shop: readonly ShopEntryDTO[];
  wallet: readonly WalletDTO[];
  progression: PlayerProgressionDTO | null;
  plots: readonly PlotDTO[];
  selected: SelectedTile | null;
  selectedCrop: string | null;
  /** The tree chosen in the planting control. Exactly one of the two choices is ever set. */
  selectedTree: string | null;
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
  trees: [],
  cropDefinitions: [],
  treeDefinitions: [],
  buildCatalog: [],
  buildSelection: null,
  constructions: [],
  cellMap: EMPTY_WORLD_CELL_MAP,
  inventory: [],
  shop: [],
  wallet: [],
  progression: null,
  plots: [],
  selected: null,
  selectedCrop: null,
  selectedTree: null
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

/**
 * Writes a control's visible label without destroying the icon beside it.
 *
 * Icon buttons keep their `<span class="label">`, so a language switch rewrites the word and leaves
 * the drawn icon in place.
 */
function setLabel(id: string, text: string): void {
  const node = element<HTMLElement>(id);
  const label = node.querySelector(".label");
  if (label === null) node.textContent = text;
  else label.textContent = text;
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

/** The produce a tree's harvest yields, named through the item catalogue's display key. */
function treeHarvestItemLabel(definitionId: string): string {
  const definition = state.treeDefinitions.find((entry) => entry.treeDefinitionId === definitionId);
  if (definition === undefined) return t("dock.harvest");
  return itemLabel(definition.harvestItemDefinitionId);
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

/** The tree on a tile, by the server's own row. Occupancy is never inferred from art. */
function treeAt(x: number, y: number): TreeStateDTO | null {
  return state.trees.find((tree) => tree.tileX === x && tree.tileY === y) ?? null;
}

function treeName(definitionId: string): string {
  const definition = state.treeDefinitions.find((entry) => entry.treeDefinitionId === definitionId);
  return displayName(state.language, definition?.displayNameKey ?? "", definitionId);
}

/** An unknown level -- signed out, or no account read yet -- locks nothing, exactly as for crops. */
function treeIsLocked(definition: TreeDefinitionDTO): boolean {
  const level = state.progression?.level ?? null;
  return level !== null && level < definition.requiredLevel;
}

/** How many of this tree's saplings the player currently holds. Server inventory, never a guess. */
function saplingCount(definition: TreeDefinitionDTO): number {
  return state.inventory
    .filter((entry) => entry.itemDefinitionId === definition.saplingItemDefinitionId)
    .reduce((total, entry) => total + entry.quantity, 0);
}

function selectedTreeDefinition(): TreeDefinitionDTO | null {
  if (state.selectedTree === null) return null;
  return (
    state.treeDefinitions.find((entry) => entry.treeDefinitionId === state.selectedTree) ?? null
  );
}

/** The option value the planting control shows: one list, two catalogues. */
function selectedPlantOption(): string {
  if (state.selectedTree !== null) return `tree:${state.selectedTree}`;
  if (state.selectedCrop !== null) return `crop:${state.selectedCrop}`;
  return "";
}

function renderFarm(): void {
  // The farm id is diagnostic, not player-facing: it lives in the document title and the brand's
  // tooltip rather than in a HUD line that competes with the world.
  const brand = document.querySelector(".brand");
  const summary =
    state.farmId === null
      ? t("farm.none")
      : t("farm.info", { name: state.farmName, farmId: state.farmId, tiles: state.tiles.length });
  document.title = summary;
  if (brand instanceof HTMLElement) brand.title = summary;
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

/**
 * Keeps the planting selection valid: the first option this player can actually plant.
 *
 * Crops are preferred because they are what the farm's first minutes use, and a tree is chosen next
 * when nothing in the crop list is plantable. Both are only ever chosen from the server's
 * catalogues, and the server checks the same preconditions again when the request arrives.
 */
function ensurePlantableSelection(): void {
  const cropPlantable = (definition: CropDefinitionDTO): boolean =>
    definition.cropDefinitionId === state.selectedCrop &&
    !cropIsLocked(definition) &&
    seedCount(definition) > 0;
  const treePlantable = (definition: TreeDefinitionDTO): boolean =>
    definition.treeDefinitionId === state.selectedTree &&
    !treeIsLocked(definition) &&
    saplingCount(definition) > 0;
  if (
    (state.selectedCrop !== null && state.cropDefinitions.some(cropPlantable)) ||
    (state.selectedTree !== null && state.treeDefinitions.some(treePlantable))
  ) {
    return;
  }
  const crop = state.cropDefinitions.find(
    (definition) => !cropIsLocked(definition) && seedCount(definition) > 0
  );
  if (crop !== undefined) {
    state.selectedCrop = crop.cropDefinitionId;
    state.selectedTree = null;
    return;
  }
  const tree = state.treeDefinitions.find(
    (definition) => !treeIsLocked(definition) && saplingCount(definition) > 0
  );
  state.selectedTree = tree?.treeDefinitionId ?? null;
  state.selectedCrop = null;
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
    state.treeDefinitions.map((definition) => [
      definition.treeDefinitionId,
      definition.requiredLevel,
      saplingCount(definition)
    ]),
    level,
    state.selectedCrop,
    state.selectedTree
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
  // Crops and trees come from two catalogues and are grouped, because the player is choosing one
  // thing to plant: the group labels are the only place the page distinguishes them.
  const cropGroup = document.createElement("optgroup");
  cropGroup.label = t("plant.crops");
  select.appendChild(cropGroup);
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
    cropGroup.appendChild(option);
  }
  const treeGroup = document.createElement("optgroup");
  treeGroup.label = t("plant.trees");
  for (const definition of state.treeDefinitions) {
    const option = document.createElement("option");
    option.value = `tree:${definition.treeDefinitionId}`;
    const parts = [treeName(definition.treeDefinitionId)];
    if (definition.requiredLevel > 1) {
      parts.push(`(${t("dock.locked", { level: definition.requiredLevel })})`);
    }
    parts.push(t("dock.saplingCount", { count: saplingCount(definition) }));
    option.disabled = treeIsLocked(definition);
    option.textContent = parts.join(OPTION_SEPARATOR);
    treeGroup.appendChild(option);
  }
  if (state.treeDefinitions.length > 0) select.appendChild(treeGroup);
  select.value = selectedPlantOption();
}

/** The single place the page turns authoritative rows into "what the dock offers" semantics. */
function currentSelection(): SelectionView {
  const definition = selectedCropDefinition();
  const treeDefinition = selectedTreeDefinition();
  return describeSelection({
    tiles: state.tiles,
    crops: state.crops,
    trees: state.trees,
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions,
    selected: state.selected,
    selectedCrop:
      definition === null
        ? null
        : {
            cropDefinitionId: definition.cropDefinitionId,
            unlocked: !cropIsLocked(definition),
            seedCount: seedCount(definition)
          },
    selectedTree:
      treeDefinition === null
        ? null
        : {
            treeDefinitionId: treeDefinition.treeDefinitionId,
            unlocked: !treeIsLocked(treeDefinition),
            saplingCount: saplingCount(treeDefinition)
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
      // A coordinate that is not one of the farm's own rows is still a place on the island. If it is
      // a cell, the dock says what the land is for and what may be done with it - in words, never in
      // coordinates, because a player reads "wild land", not "20, 5".
      {
        const cell = selectionCell(selection.coordinate);
        if (cell !== null) {
          node.textContent = t("cell.land.title", { land: t(cellLandKey(cell)) });
          detail.textContent = t("cell.actions.detail", {
            actions: availableActionNames(cell, selection)
          });
          break;
        }
      }
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
    case "tree": {
      const tree = selection.tree;
      node.textContent = t("selection.tree.title", {
        at: where,
        tree: tree === null ? t("dock.tree") : treeName(tree.definitionId),
        state:
          tree === null
            ? t("tree.state.GROWING")
            : t(`tree.state.${tree.phase}` as MessageKey)
      });
      detail.textContent =
        tree === null
          ? t("selection.tree.regrowingDetail", { time: formatRemainingGrowth(null, t) })
          : tree.phase === "READY"
            ? t("selection.tree.readyDetail", { item: treeHarvestItemLabel(tree.definitionId) })
            : tree.phase === "GROWING"
              ? t("selection.tree.growingDetail", {
                  percent: Math.round(tree.growthProgress * 100),
                  time: formatRemainingGrowth(selection.remainingSeconds, t)
                })
              : t("selection.tree.regrowingDetail", {
                  time: formatRemainingGrowth(selection.remainingSeconds, t)
                });
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
    case "tree-locked":
      return t("selection.empty.treeLocked", { level: selectedTreeDefinition()?.requiredLevel ?? 1 });
    case "no-sapling": {
      const tree = selectedTreeDefinition();
      const key = tree?.saplingItemDisplayNameKey ?? null;
      const sapling =
        tree === null || key === null
          ? t("dock.tree")
          : itemName(tree.saplingItemDefinitionId, key);
      return t("selection.empty.noSapling", { sapling });
    }
    default:
      return t("selection.empty.detail");
  }
}

/** The island cell behind a selection, or null when the coordinate is off the island. */
function selectionCell(coordinate: SelectedTile | null): WorldCell | null {
  if (coordinate === null) return null;
  return sceneInput().cells.cells.get(cellKey(coordinate.x, coordinate.y)) ?? null;
}

/**
 * The actions the selected cell offers, in the player's language, and only the ones that are usable.
 *
 * `selection.canPlant` and friends are the server-derived preconditions the dock already honours, so
 * the resolver reports what *would* be offered rather than a second opinion about what is allowed.
 */
function availableActionNames(cell: WorldCell, selection: SelectionView): string {
  const actions = getAvailableCellActions(cell, {
    canPlant: selection.canPlant,
    crop: selection.crop === null ? null : { mature: selection.canHarvest },
    tree: selection.tree === null ? null : { ready: selection.canHarvestTree }
  });
  const names = actions
    .filter((action) => action.enabled)
    .map((action) => t(cellActionKey(action.id) as MessageKey));
  return names.length === 0 ? t("selection.none.detail") : names.join(", ");
}

/**
 * The dock follows the selection: planting while the tile is bare soil, and harvest-or-uproot while
 * it holds a crop. A growing crop offers only uproot, so a mis-planted tile can be freed without
 * waiting, and an occupied tile can never send a plant request.
 */
function renderActionControls(selection: SelectionView): void {
  const hasCrop = selection.crop !== null;
  const hasTree = selection.tree !== null;
  element<HTMLDivElement>("plant-controls").hidden = hasCrop || hasTree;
  element<HTMLDivElement>("crop-controls").hidden = !hasCrop;
  element<HTMLDivElement>("tree-controls").hidden = !hasTree;
  element<HTMLButtonElement>("plant").disabled = !selection.canPlant;
  element<HTMLButtonElement>("harvest").disabled = !selection.canHarvest;
  element<HTMLButtonElement>("harvest").hidden = !selection.canHarvest;
  element<HTMLButtonElement>("uproot").disabled = !selection.canUproot;
  // A tree offers harvest only while the server's own row says this cycle is ready; growing and
  // regrowing trees offer removal instead, so a mis-planted tree never has to be waited out.
  const harvestTreeButton = element<HTMLButtonElement>("harvest-tree");
  harvestTreeButton.disabled = !selection.canHarvestTree;
  harvestTreeButton.hidden = selection.tree !== null && selection.tree.phase !== "READY";
  element<HTMLButtonElement>("remove-tree").disabled = !selection.canRemoveTree;
  const treeState = element<HTMLElement>("tree-state");
  treeState.textContent =
    selection.tree === null
      ? ""
      : t(`tree.state.${selection.tree.phase}` as MessageKey);
  // No selection, no surface: the world keeps the space instead of an empty bar.
  element<HTMLElement>("action-dock").hidden = state.selected === null;
  // The planting grid follows the same state the dock does: it appears exactly when the planting
  // control is offered, so a player can see where a seed may go. It names no tile and sends nothing.
  scene?.setInteraction(selection.canPlant ? "PLANT" : "NONE");
}

/**
 * "Go": walk the character to the selected tile.
 *
 * The destination is client-local and travels through the same runtime the keyboard drives, so the
 * collision world still has the final word and no position is ever sent to the server. It is offered
 * on every viewport, which is how a touch player walks without a joystick or a keyboard.
 */
function renderGo(): void {
  const button = element<HTMLButtonElement>("go");
  const selected = state.selected;
  button.hidden = selected === null;
  button.disabled = scene === null || selected === null;
  setLabel("go", t("dock.go"));
  button.title = t("dock.goTitle");
  button.setAttribute("aria-label", t("dock.goTitle"));
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

  const tree = treeAt(tile.x, tile.y);
  if (tree !== null) {
    // A tree is shown with the server's phase, and a ready one offers the same one-tap harvest the
    // 3D view and the dock do.
    node.classList.add("tree");
    node.appendChild(make("span", "crop", treeName(tree.definitionId)));
    node.appendChild(make("span", "state", t(`tree.state.${tree.phase}` as MessageKey)));
    if (tree.ready) {
      const harvest = make("button", "mini", t("dock.harvest"));
      harvest.addEventListener("click", (event) => {
        event.stopPropagation();
        void run(() => harvestTree(tree.treeInstanceId, tree.version));
      });
      node.appendChild(harvest);
    }
  } else if (crop === null) {
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
    selectCell(tile.x, tile.y);
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
    // One cell per stack: name and count, no card, so a growing inventory stays scannable.
    const cell = make("li", "inventory-cell");
    cell.appendChild(make("span", "inventory-name", itemName(entry.itemDefinitionId, entry.displayNameKey)));
    cell.appendChild(make("span", "inventory-count", `×${String(entry.quantity)}`));
    list.appendChild(cell);
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
  const direction = marketDirection();
  const entries = state.shop.filter((entry) =>
    direction === "buy" ? entry.buyPrice !== null : entry.sellPrice !== null
  );
  if (entries.length === 0) {
    container.appendChild(make("p", "muted", t(direction === "buy" ? "market.noBuy" : "market.noSell")));
    return;
  }
  for (const entry of entries) {
    container.appendChild(shopRow(entry, direction));
  }
}

/**
 * One market row: what it is, what it costs, how many, and the one action that applies.
 *
 * Rows rather than cards. The server decides the directions a row offers, so the tab and the button
 * are read from `ShopEntryDTO` and never from a client-side guess; prices come from the same DTO and
 * are never computed here.
 */
function shopRow(entry: ShopEntryDTO, direction: MarketDirection): HTMLDivElement {
  const currency = currencyLabel(entry.currencyId, entry.currencyDisplayNameKey);
  const price = direction === "buy" ? entry.buyPrice : entry.sellPrice;
  const row = make("div", "shop-row");
  // Product information and controls are separated: the name carries the hierarchy, the price is
  // metadata under it, and everything the player can press sits to the right on one line.
  const product = make("div", "shop-product");
  product.appendChild(make("span", "shop-name", itemName(entry.itemDefinitionId, entry.itemDisplayNameKey)));
  product.appendChild(make("span", "shop-price", `${String(price ?? 0)} ${currency}`));
  row.appendChild(product);

  const quantity = make("input");
  quantity.type = "number";
  quantity.min = "1";
  quantity.max = String(entry.maxQuantityPerRequest);
  quantity.value = "1";
  quantity.className = "quantity";
  quantity.setAttribute("aria-label", t("market.quantity"));

  const stepper = make("div", "stepper");
  const decrease = make("button", "stepper-button");
  decrease.type = "button";
  decrease.appendChild(createIcon("minus", 14));
  decrease.setAttribute("aria-label", t("market.decrease"));
  decrease.addEventListener("click", () => {
    const next = Math.max(1, (quantity.valueAsNumber || 1) - 1);
    quantity.value = String(next);
  });
  const increase = make("button", "stepper-button");
  increase.type = "button";
  increase.appendChild(createIcon("plus", 14));
  increase.setAttribute("aria-label", t("market.increase"));
  increase.addEventListener("click", () => {
    const max = entry.maxQuantityPerRequest;
    const next = Math.min(max, (quantity.valueAsNumber || 1) + 1);
    quantity.value = String(next);
  });
  // `appendChild` rather than `append`: the repository typechecks against both the DOM and the
  // Workers lib, whose `append` signatures disagree.
  stepper.appendChild(decrease);
  stepper.appendChild(quantity);
  stepper.appendChild(increase);
  row.appendChild(stepper);

  const action = make("button", "shop-action", t(direction === "buy" ? "market.buy" : "market.sell"));
  action.addEventListener("click", () => {
    void trade(direction, entry.shopEntryId, quantity.valueAsNumber);
  });
  row.appendChild(action);
  return row;
}

/**
 * Which build category the panel is showing.
 *
 * Presentation only, exactly like the market's direction tab: it filters rows the catalogue already
 * labels, and it never changes what a row is or what it costs.
 */
/**
 * The shop's own browsing state: which category, what is typed in the search box, which filter, and
 * which card is being inspected.
 *
 * Selection lives here rather than in `state`: it is a fact about the panel, not about the farm, and
 * nothing outside the shop may read it.
 */
let buildCategory: ShopCategory = "ROAD";
let buildQuery = "";
let buildFilter: AvailabilityFilter = "ALL";
let shopSelection: BuildCatalogEntryDTO | null = null;

/** How far the item in hand has been turned, in quarter turns. Placement preview state only. */
let placementTurns = 0;

/** True while a placement command is in flight, so one click cannot build twice. */
let placementPending = false;

/**
 * The shop's thumbnail source: one renderer for the whole page, created on the first ask.
 *
 * A session that never opens the shop never creates one, and the card grid and the inspector share
 * everything it has already drawn - which is what makes inspecting an item free.
 */
const shopThumbnails = createShopThumbnails((modelId) => {
  reportMissingThumbnail(modelId);
});

/** A thumbnail that could not be drawn is worth saying once, quietly, on the status line. */
let reportedThumbnailProblem = false;
function reportMissingThumbnail(modelId: string): void {
  if (reportedThumbnailProblem) return;
  reportedThumbnailProblem = true;
  setStatus((translate) => translate("build.thumbnailProblem", { model: modelId }));
}

/** The translation key for a category, spelled out so the translator stays total. */
function buildCategoryKey(category: ShopCategory): CategoryLabelKey {
  switch (category) {
    case "ROAD":
      return "build.category.road";
    case "VEGETATION":
      return "build.category.vegetation";
    case "DECORATION":
      return "build.category.decoration";
    case "FENCE":
      return "build.category.fence";
    case "LIGHTING":
      return "build.category.lighting";
    case "UTILITY":
      return "build.category.utility";
    case "WATERFRONT":
      return "build.category.waterfront";
    case "BUILDING":
      return "build.category.building";
    case "MONUMENT":
      return "build.category.monument";
  }
}

/** The glyph a category tab wears, from the same icon set the rest of the HUD uses. */
function buildCategoryIcon(category: ShopCategory): IconName {
  switch (category) {
    case "ROAD":
      return "road";
    case "BUILDING":
      return "farm";
    case "VEGETATION":
      return "plant";
    case "DECORATION":
      return "star";
    case "FENCE":
      return "fence";
    case "LIGHTING":
      return "lamp";
    case "UTILITY":
      return "build";
    case "WATERFRONT":
      return "water";
    case "MONUMENT":
      return "monument";
  }
}

/**
 * The construction shop: browse on the left, look in the middle, inspect on the right.
 *
 * Three areas and one flow. The rail picks a category, the grid shows what things look like, and the
 * inspector is where a player reads the price, the level and the footprint before pressing PLACE.
 * Clicking a card only *selects* it - a purchase is not a side effect of browsing, and the placement
 * pass that follows is a picture of an intention rather than a transaction.
 *
 * Everything the shop says about an item comes from the catalogue or from translations. Prices,
 * levels, footprints, tiers and unlock rules are never restated in this file.
 */
function renderBuildPanel(): void {
  const categories = shopCategories(state.buildCatalog);
  buildCategory = resolveCategory(state.buildCatalog, buildCategory) ?? buildCategory;
  const view = currentShopView(categories);
  const context = shopContext();
  const handlers = shopHandlers();

  renderShopGold(element<HTMLElement>("build-gold"), view, context);
  renderCategoryRail(element<HTMLElement>("build-rail"), view, context, handlers);
  renderSearchBar(element<HTMLElement>("build-search"), view, context, handlers);
  renderAssetGrid(element<HTMLElement>("build-rows"), view, context, handlers);
  renderInspector(element<HTMLElement>("build-inspector"), view, context, handlers);
  renderBuildStatus();
}

/**
 * The pieces of shop state the view needs, derived in one place.
 *
 * `visible` is the searched and filtered category; `categorySize` is how many entries the category
 * holds at all, which is the difference between "this category is empty" and "nothing matched".
 */
function currentShopView(categories: readonly ShopCategory[]): ShopViewState {
  const level = state.progression?.level ?? 1;
  const inCategory = state.buildCatalog.filter((entry) => entry.category === buildCategory);
  return {
    category: buildCategory,
    categories,
    query: buildQuery,
    filter: buildFilter,
    playerLevel: level,
    selected: shopSelection,
    visible: visibleEntries(state.buildCatalog, {
      category: buildCategory,
      query: buildQuery,
      filter: buildFilter,
      playerLevel: level,
      nameOf: buildEntryName
    }),
    categorySize: inCategory.length,
    goldText: goldText()
  };
}

/** Re-renders the browsing areas and the inspector: what a keystroke in the search box costs. */
function refreshShopBrowsing(): void {
  const view = currentShopView(shopCategories(state.buildCatalog));
  const context = shopContext();
  const handlers = shopHandlers();
  renderAssetGrid(element<HTMLElement>("build-rows"), view, context, handlers);
  renderInspector(element<HTMLElement>("build-inspector"), view, context, handlers);
  renderBuildStatus();
}

function shopHandlers(): ShopViewHandlers {
  return {
    onCategory: (category) => {
      buildCategory = category;
      renderBuildPanel();
    },
    onSearch: (query) => {
      buildQuery = query;
      // Only the browsing area redraws, so the search box keeps focus and the world is untouched.
      refreshShopBrowsing();
    },
    onFilter: (filter) => {
      buildFilter = filter;
      refreshShopBrowsing();
    },
    onSelect: (entry) => {
      // Selection is inspection, not purchase: the card gets a border and the inspector fills in.
      shopSelection = entry;
      refreshShopBrowsing();
    },
    onPlace: () => {
      if (shopSelection === null) return;
      if (entryAvailability(shopSelection, state.progression?.level ?? 1) !== "AVAILABLE") return;
      enterPlacement(shopSelection);
    }
  };
}

function shopContext(): ShopViewContext {
  return {
    t,
    icon: (name, size) => createIcon(name, size),
    categoryLabelKey: buildCategoryKey,
    categoryIcon: buildCategoryIcon,
    nameOf: buildEntryName,
    descriptionOf: buildEntryDescription,
    priceOf: buildPriceText,
    cachedThumbnail: (entry) => shopThumbnails.cached(entry),
    requestThumbnail: (entry, image) => {
      void shopThumbnails
        .request(entry)
        .then((result) => {
          if (result.dataUrl !== null) image.src = result.dataUrl;
        })
        .catch(() => {
          // A thumbnail is decoration: a picture that cannot be drawn leaves the card's background.
        });
    },
    upgradeNameOf: (entry) => {
      if (entry.upgradeTo === null) return null;
      const next = state.buildCatalog.find((candidate) => candidate.entryId === entry.upgradeTo);
      return next === undefined ? null : buildEntryName(next);
    },
    effectOf: (entry) => buildEntryEffect(entry),
    resourceOf: (resource) => t(resourceLabelKey(resource)),
    durationOf: (seconds) => durationText(seconds),
    workerName: (role) =>
      t(
        role === "FORESTRY_WORKER"
          ? "build.worker.forestry"
          : role === "FISHERY_WORKER"
            ? "build.worker.fishery"
            : "build.worker.farm"
      )
  };
}

/** The status line under the shop: what is selected, and whether it can be built today. */
function renderBuildStatus(): void {
  const node = element<HTMLParagraphElement>("build-status");
  node.classList.remove("is-warning");
  if (shopSelection === null) {
    node.textContent = t("build.catalogOnly");
    return;
  }
  const availability = entryAvailability(shopSelection, state.progression?.level ?? 1);
  if (availability === "LOCKED") {
    node.classList.add("is-warning");
    node.textContent = t("build.unlocksAt", { level: shopSelection.requiredLevel });
    return;
  }
  if (availability === "PREVIEW_ONLY") {
    node.textContent = t("build.previewOnly");
    return;
  }
  node.textContent = t("build.status.selected", { item: buildEntryName(shopSelection) });
}

/**
 * A persisted construction, as the renderer wants it: which model, where, and how far turned.
 *
 * The model is looked up from the entry's `modelId` through the catalogue the shop already holds, so
 * the world and the shop draw the same asset and a client cannot invent one.
 */
function toSceneConstruction(construction: ConstructionDTO): {
  readonly id: string;
  readonly modelId: string | null;
  readonly worldX: number;
  readonly worldZ: number;
  readonly rotationY: number;
} {
  const entry = state.buildCatalog.find((candidate) => candidate.entryId === construction.entryId);
  const anchor = tileToWorld({ x: construction.anchorX, y: construction.anchorY }, worldFrame());
  const modelId = entry?.modelId ?? null;
  return {
    id: construction.constructionId,
    modelId: modelId !== null && !modelId.startsWith("road.") ? modelId : null,
    worldX: anchor.worldX,
    worldZ: anchor.worldZ,
    rotationY: (construction.rotation * Math.PI) / 2
  };
}

/** The shop's name for an entry: a translation when the client has one, else the catalogue's label. */
function buildEntryName(entry: BuildCatalogEntryDTO): string {
  return displayName(state.language, entry.displayNameKey, entry.label);
}

/**
 * The shop's description for an entry.
 *
 * A description is presentation: the catalogue's own key when it has one, else the client's mapping
 * for that stable id, else nothing at all - which is honest, and never an internal id on screen.
 */
function buildEntryDescription(entry: BuildCatalogEntryDTO): string {
  const key = descriptionKeyFor(entry);
  return key === null ? "" : displayName(state.language, key, "");
}

/** The one-line "what it does": the catalogue's own summary, with an honest fallback. */
function buildEntryEffect(entry: BuildCatalogEntryDTO): string {
  const text = displayName(state.language, entry.gameplay.summaryKey, "");
  if (text !== "") return text;
  return entry.gameplay.classification === "COSMETIC" ? t("build.decorationOnly") : "";
}

/** A resource id as a player reads it. */
function resourceLabelKey(resource: string): MessageKey {
  switch (resource) {
    case "WOOD":
      return "build.resource.wood";
    case "FOOD":
      return "build.resource.food";
    case "STONE":
      return "build.resource.stone";
    default:
      return "build.resource.gold";
  }
}

/** A duration in seconds, said the way the rest of the HUD says it. */
function durationText(seconds: number): string {
  if (seconds < 60) return t("time.seconds", { seconds });
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return t("time.minutes", { minutes });
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? t("time.hours", { hours }) : t("time.hoursMinutes", { hours, minutes: rest });
}

/** The price, formatted for the language the player is reading. The coin icon carries the currency. */
function buildPriceText(entry: BuildCatalogEntryDTO): string {
  return entry.price.toLocaleString(state.language);
}

/** The player's own gold, read from the wallet the server reports. Never a second local balance. */
function goldText(): string {
  const gold = state.wallet.find((entry) => entry.currencyId === "currency_gold");
  return (gold?.balance ?? 0).toLocaleString(state.language);
}

/** The capability a catalogue entry asks of a cell, as the world's own vocabulary spells it. */
function capabilityOf(entry: BuildCatalogEntryDTO): CellCapability {
  return entry.capability as CellCapability;
}

/** The requirement the preview rule reads, taken entirely from the catalogue entry and its rotation. */
function previewRequirement(
  entry: BuildCatalogEntryDTO,
  footprint: { readonly widthCells: number; readonly depthCells: number }
): PreviewRequirement {
  return {
    capability: capabilityOf(entry),
    footprint,
    isRoad: entry.category === "ROAD",
    // Everything a player builds goes on land the player has. The catalogue says so per entry; today
    // every entry says `OWNED_LAND`, and the field is what lets a later civic item say otherwise.
    requiresOwnership: entry.unlockCondition === "OWNED_LAND"
  };
}

/**
 * Why the entry in hand cannot go on the selected cell, or null when it can.
 *
 * The rule is the placement-preview module's; this only feeds it the two things it needs.
 */
function placementRejectionFor(
  entry: BuildCatalogEntryDTO,
  footprint: { readonly widthCells: number; readonly depthCells: number }
): MessageKey | null {
  if (scene === null) return null;
  const rejection = previewRejection(state.cellMap, state.selected, previewRequirement(entry, footprint));
  return rejection === null ? null : (rejectionMessageKey(rejection) as MessageKey);
}

/**
 * The footprint the item in hand actually occupies, once its rotation is taken into account.
 *
 * A road is the awkward one: its direction comes from the camera as well as from the player's turns,
 * because a road is laid along the axis the player is looking down. Everything else is turned by the
 * player alone, so a 2x3 building becomes 3x2 at a quarter turn.
 */
function placementFootprint(entry: BuildCatalogEntryDTO): {
  readonly widthCells: number;
  readonly depthCells: number;
} {
  if (entry.category !== "ROAD") return rotatedFootprint(entry.footprint, placementTurns);
  const cameraQuarters = Math.round(roadPreviewYaw() / (Math.PI / 2));
  return rotatedFootprint(entry.footprint, normaliseQuarterTurns(cameraQuarters + placementTurns));
}

/** Where the ghost faces: the player's turns, plus the road's camera-derived starting direction. */
function previewRotationY(entry: BuildCatalogEntryDTO): number {
  const turned = quarterTurnYaw(placementTurns);
  return entry.category === "ROAD" ? roadPreviewYaw() + turned : turned;
}

/**
 * Picks an entry up: the shop closes, the ghost appears, and the placement HUD explains the rest.
 *
 * Deliberately *not* a purchase. The card is a catalogue row, the ghost is a picture of an intention,
 * and the moment this stops being true is the moment the server has a placement command to send.
 */
function enterPlacement(entry: BuildCatalogEntryDTO): void {
  state.buildSelection = entry;
  placementTurns = 0;
  setActivePanel(NO_PANEL);
  // Pick a cell to hold the item *before* the camera moves: the one the player selected, or the cell
  // the camera is already looking at. Placement always starts somewhere concrete, and the camera comes
  // close enough that a one-cell item is an object rather than a speck.
  const focus =
    state.selected ??
    (scene === null ? null : worldToCell({ worldX: scene.cameraFrame().targetX, worldZ: scene.cameraFrame().targetZ }));
  if (focus !== null) {
    state.selected = focus;
    scene?.setSelection(focus);
    scene?.focusOnCell(focus);
    renderField();
    renderSelection();
  }
  updatePlacementPreview();
  renderPlacementHud();
  const rejection = placementRejectionFor(entry, placementFootprint(entry));
  setStatus(
    (translate) =>
      rejection === null
        ? translate("status.placing", {
            item: buildEntryName(entry),
            at: state.selected === null ? translate("status.placingPickCell") : at(state.selected)
          })
        : translate("status.placingBlocked", {
            item: buildEntryName(entry),
            reason: translate(rejection)
          })
  );
}

/** Draws the item in hand on the selected cell: the ghost, its footprint, and whether it fits. */
function updatePlacementPreview(): void {
  const entry = state.buildSelection;
  if (entry === null) {
    scene?.setPlacementPreview(null);
    return;
  }
  const footprint = placementFootprint(entry);
  scene?.setPlacementPreview({
    modelId: entry.modelId !== null && !isProceduralVisual(entry.modelId) ? entry.modelId : null,
    roadTierId: entry.category === "ROAD" ? entry.tier : null,
    widthCells: footprint.widthCells,
    depthCells: footprint.depthCells,
    valid: placementRejectionFor(entry, footprint) === null,
    rotationY: previewRotationY(entry)
  });
}

/**
 * Turns the item in hand a quarter turn.
 *
 * Only the preview is rebuilt: no world rebuild, no renderer, no model reload, no catalogue fetch.
 */
function rotatePlacement(step: number): void {
  const entry = state.buildSelection;
  if (entry === null) return;
  if (!entry.rotatable) {
    setStatus(message("build.notRotatable"));
    return;
  }
  placementTurns = normaliseQuarterTurns(placementTurns + step);
  updatePlacementPreview();
  renderPlacementHud();
}

/**
 * The compact placement HUD: what is in hand, what it costs, where it may go, and the controls.
 *
 * Preview only. Nothing here spends gold or writes state, so the confirm line says what a click does
 * rather than promising a building.
 */
function renderPlacementHud(): void {
  const node = element<HTMLElement>("placement-hud");
  const entry = state.buildSelection;
  if (entry === null) {
    node.hidden = true;
    node.replaceChildren();
    document.body.classList.remove("is-placing");
    return;
  }
  node.hidden = false;
  // The dock's plant/harvest controls are not what a player is doing while something is in hand.
  document.body.classList.add("is-placing");
  node.replaceChildren();

  const footprint = placementFootprint(entry);
  const rejection = placementRejectionFor(entry, footprint);

  const copy = make("div", "placement-copy");
  copy.appendChild(make("strong", "placement-name", buildEntryName(entry)));
  const meta = make("span", "placement-meta");
  meta.appendChild(createIcon("coin", 13));
  meta.appendChild(make("span", undefined, buildPriceText(entry)));
  meta.appendChild(make("span", "placement-sep", "·"));
  meta.appendChild(
    make(
      "span",
      undefined,
      t("build.inspector.cells", { width: footprint.widthCells, depth: footprint.depthCells })
    )
  );
  copy.appendChild(meta);
  node.appendChild(copy);

  const line = make("p", rejection === null ? "placement-state is-valid" : "placement-state is-invalid");
  const where = state.selected === null ? "" : ` ${at(state.selected)}`;
  line.textContent =
    (rejection === null
      ? t("build.validLocation")
      : t("build.cannotPlace", { reason: t(rejection) })) + where;
  node.appendChild(line);

  const keys = make("ul", "placement-keys");
  const entryFor = (keysText: string, label: string): HTMLLIElement => {
    const item = make("li");
    item.appendChild(make("kbd", undefined, keysText));
    item.appendChild(make("span", undefined, label));
    return item;
  };
  if (entry.rotatable) keys.appendChild(entryFor("Q / E", t("build.hud.rotate")));
  keys.appendChild(entryFor(t("build.hud.clickKey"), t("build.hud.move")));
  keys.appendChild(entryFor("Enter", t("build.hud.confirm")));
  keys.appendChild(entryFor("Esc", t("build.hud.cancel")));
  node.appendChild(keys);

  const confirm = make("button", "placement-confirm");
  confirm.type = "button";
  confirm.disabled = placementPending || rejection !== null;
  confirm.textContent = placementPending ? t("build.hud.pending") : t("build.hud.confirm");
  confirm.addEventListener("click", () => {
    void confirmPlacement();
  });
  node.appendChild(confirm);
}

/**
 * Confirms the placement: the one place in the client that asks the server to build something.
 *
 * The preview has already told the player whether the cell *looks* acceptable; this sends the intent
 * and lets the server decide. The request id makes a double click a single command, and the button is
 * disabled while the command is in flight, so the two together make a duplicate construction
 * impossible from this page.
 */
async function confirmPlacement(): Promise<void> {
  const entry = state.buildSelection;
  if (entry === null || placementPending) return;
  if (state.farmId === null || state.selected === null) {
    setStatus(message("status.placingPickCell"), true);
    return;
  }
  const footprint = placementFootprint(entry);
  const rejection = placementRejectionFor(entry, footprint);
  if (rejection !== null) {
    setStatus((translate) => translate("build.cannotPlace", { reason: translate(rejection) }), true);
    return;
  }

  placementPending = true;
  renderPlacementHud();
  try {
    const built = await api().placeConstruction(state.farmId, {
      requestId: newRequestId("build"),
      entryId: entry.entryId,
      anchorX: state.selected.x,
      anchorY: state.selected.y,
      rotation: normaliseQuarterTurns(placementTurns)
    });
    // The server's own row is what the world draws: no local guess at an id, a cost or a footprint.
    state.constructions = [...state.constructions, built.construction];
    state.buildSelection = null;
    placementTurns = 0;
    scene?.setPlacementPreview(null);
    renderPlacementHud();
    refreshScene();
    await refreshAccount();
    setStatus(
      (translate) =>
        translate("build.built", {
          item: buildEntryName(entry),
          price: buildPriceText(entry)
        })
    );
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    placementPending = false;
    renderPlacementHud();
  }
}

/** Puts the entry down: no ghost, no footprint, no selection - and nothing was ever spent. */
function cancelBuildSelection(): void {
  if (state.buildSelection === null) return;
  state.buildSelection = null;
  placementTurns = 0;
  scene?.setPlacementPreview(null);
  renderPlacementHud();
  setStatus(message("status.placementCancelled"));
}

/**
 * The bearing a road preview runs along: whichever axis the camera is facing most squarely.
 *
 * Snapped to the lattice on purpose. The authoritative road command will take a cell and an
 * orientation, so the preview snaps to the four the world actually has rather than to a free angle
 * the server could not represent.
 */
function roadPreviewYaw(): number {
  if (scene === null || state.selected === null) return 0;
  const yaw = scene.cameraFrame().yaw;
  const quarter = Math.round(yaw / (Math.PI / 2)) * (Math.PI / 2);
  // The camera's yaw is where the *eye* sits; the road runs across the view, so it takes the normal.
  return quarter - Math.PI / 2;
}

/** Every string the layout itself owns, so a language change reaches the panel headings too. */
function renderChrome(): void {
  element<HTMLElement>("gold-label").textContent = t("hud.gold");
  element<HTMLElement>("inventory-title").textContent = t("panel.inventory");
  element<HTMLElement>("build-title").textContent = t("panel.build");
  element<HTMLElement>("build-rail").setAttribute("aria-label", t("build.categories"));
  element<HTMLElement>("build-search").setAttribute("aria-label", t("build.search"));
  element<HTMLElement>("land-title").textContent = t("panel.land");
  element<HTMLElement>("market-title").textContent = t("panel.market");
  element<HTMLElement>("module-rail").setAttribute("aria-label", t("hud.modules"));
  renderMarketTabs();
  element<HTMLElement>("crop-label").textContent = t("dock.crop");
  setLabel("plant", t("dock.plant"));
  setLabel("harvest", t("dock.harvest"));
  setLabel("uproot", t("dock.uproot"));
  setLabel("harvest-tree", t("dock.harvest"));
  setLabel("remove-tree", t("dock.removeTree"));
  setLabel("expand-farm", t("land.unlock"));
  const language = element<HTMLButtonElement>("language");
  language.title = t("language.label");
  language.setAttribute("aria-label", t("language.label"));
  element<HTMLButtonElement>("refresh").title = t("hud.refresh");
}

function render(): void {
  renderChrome();
  renderPanels();
  renderFarm();
  renderWallet();
  renderProgression();
  renderPlots();
  renderCrops();
  renderField();
  renderSelection();
  renderGo();
  renderInventory();
  renderShop();
  // The shop's own render is driven by the panel: see `setActivePanel`.
  if (panels.active === "build") renderBuildPanel();
  renderStatus();
  renderSceneState();
  syncLayoutMetrics();
}

/*
 * The side panels, as UI state only.
 *
 * Open or folded is a property of this page, never of the farm: nothing here is stored, sent, or
 * read by a game rule. A wide viewport opens both panels, a narrow one folds them into tabs, and a
 * resize that crosses the breakpoint re-applies those defaults so a panel can never end up parked
 * off-screen. A resize that stays inside a breakpoint leaves the player's own choice alone.
 */

let panels: PanelState = panelRequested();
let lastViewportWidth = window.innerWidth;

/**
 * Which direction the market is showing.
 *
 * Buy and sell are the same list read two ways, so the tab is presentation: it filters rows the
 * server already marked as buyable or sellable, and it never changes what a row can do.
 */
type MarketDirection = "buy" | "sell";

let shopDirection: MarketDirection = "buy";

function marketDirection(): MarketDirection {
  return shopDirection;
}

function renderMarketTabs(): void {
  for (const direction of ["buy", "sell"] as const) {
    const tab = element<HTMLButtonElement>(direction === "buy" ? "market-tab-buy" : "market-tab-sell");
    tab.textContent = t(direction === "buy" ? "market.buy" : "market.sell");
    const active = shopDirection === direction;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  }
}

/**
 * Applies the panel state to the document.
 *
 * One module is open or none: the open panel loses `hidden`, its launcher reports
 * `aria-expanded="true"`, and every other panel is closed and reports nothing is expanded. Closed
 * panels are `hidden`, so the area they would occupy is canvas again rather than an invisible
 * blocker.
 */
function renderPanels(): void {
  for (const module of MODULES) {
    const open = panels.active === module.id;
    const label = t(module.labelKey);
    element<HTMLElement>(module.panelId).hidden = !open;
    const launcher = element<HTMLButtonElement>(module.launcherId);
    launcher.setAttribute("aria-expanded", open ? "true" : "false");
    launcher.setAttribute("aria-label", label);
    launcher.title = label;
    launcher.classList.toggle("is-active", open);
    const close = element<HTMLButtonElement>(module.closeId);
    close.setAttribute("aria-label", t("panel.close"));
    close.title = t("panel.close");
  }
}

function setActivePanel(next: PanelState): void {
  panels = next;
  renderPanels();
  syncLayoutMetrics();
  // The shop draws itself when it is opened, and only then: a session that never opens it never asks
  // for a thumbnail, and so never creates the offscreen renderer those thumbnails need.
  if (panels.active === "build") renderBuildPanel();
}

/**
 * Publishes the measured height of the HUD bands as CSS variables.
 *
 * The responsive stylesheet places the status line and the folded panel tabs *below* the top HUD and
 * above the action dock. Those bands change height with the viewport, the language, and whether a
 * control wrapped, so the stylesheet reads their real size instead of guessing with a magic number:
 * an overlay can never land on top of the controls it is supposed to sit beside.
 */
function syncLayoutMetrics(): void {
  const root = document.documentElement;
  root.style.setProperty("--hud-height", `${String(Math.round(element<HTMLElement>("top-hud").getBoundingClientRect().height))}px`);
}

async function refreshAccount(): Promise<void> {
  const client = api();
  const [inventory, wallet, shop, progression, cropDefinitions, treeDefinitions, buildCatalog] = await Promise.all([
    client.getInventory(),
    client.getWallet(),
    client.getShop(),
    client.getProgression(),
    client.getCropDefinitions(),
    client.getTreeDefinitions(),
    client.getBuildCatalog()
  ]);
  state.inventory = inventory.items;
  state.wallet = wallet.wallets;
  state.shop = shop.entries;
  state.progression = progression.progression;
  state.cropDefinitions = cropDefinitions.definitions;
  state.treeDefinitions = treeDefinitions.definitions;
  state.buildCatalog = buildCatalog.entries;
  ensurePlantableSelection();
}

function setSceneState(text: StatusText): void {
  sceneState = text;
  renderSceneState();
}

function renderSceneState(): void {
  element<HTMLSpanElement>("render-3d-state").textContent = sceneState(t, state.language);
}

/*
 * The local character.
 *
 * It is client-local and non-authoritative: the server never receives this position, and no game
 * rule reads it. The character exists so the world has a body in it, and it is created only with the
 * 3D view, because a character that cannot be drawn is only state that can go wrong.
 *
 * The pure modules under `player/` decide how it moves and when it runs; this only supplies the
 * platform - the keyboard, `requestAnimationFrame`, and the renderer to publish a pose to - and the
 * farm rows that block a step. The runtime sleeps while no movement key is held, so the renderer
 * keeps drawing on demand rather than every frame.
 */

/** The avatar stands on the tray surface, which is a hair above the tiles' base. */
const PLAYER_FEET_Y = 0.02;

let movement: MovementInput | null = null;
let playerFrameHandle: number | null = null;

function toScenePlayer(current: PlayerState): FarmScenePlayer {
  return {
    worldX: current.x,
    worldY: current.y,
    worldZ: current.z,
    facingYaw: current.facingYaw,
    movementState: current.movementState,
    elapsedWalk: current.elapsedWalk
  };
}

const playerRuntime = createPlayerRuntime({
  spawn: SPAWN_WORLD,
  feetY: PLAYER_FEET_Y,
  readInput: () => movement?.vector() ?? NEUTRAL_INPUT,
  onPose: (pose) => {
    scene?.setPlayer(pose === null ? null : toScenePlayer(pose));
  },
  requestFrame: (tick) => {
    playerFrameHandle = window.requestAnimationFrame((timestampMs) => {
      // Cleared before the tick runs, so the runtime can schedule the next frame from inside it.
      playerFrameHandle = null;
      tick(timestampMs);
    });
  },
  cancelFrame: () => {
    if (playerFrameHandle === null) return;
    window.cancelAnimationFrame(playerFrameHandle);
    playerFrameHandle = null;
  }
});

/**
 * The collision world the *selection* reads, kept in step with the one the character walks in.
 *
 * A click and a step have to agree about what is solid: if they did not, the game would offer a
 * destination the walker then refuses to reach.
 */
let selectionCollision: CollisionWorld = createPlayerCollisionWorld([]);

function startPlayer(): void {
  stopPlayer();
  movement = createMovementInput({
    onActivityChange: (active) => {
      if (active) playerRuntime.wake();
    }
  });
  movement.attach();
  playerRuntime.start();
}

function stopPlayer(): void {
  movement?.detach();
  movement = null;
  playerRuntime.stop();
}

/**
 * Whether this session asked for the developer overlay.
 *
 * A query parameter rather than a button, because it is not a player feature: the brief for this pass
 * is that the island's grid is invisible in normal play, and the only thing allowed to draw it is a
 * developer who asked for it by name.
 */
function debugRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("debug") === "1";
  } catch {
    return false;
  }
}

/**
 * A module named in the query string, so a screenshot can show a panel without a mouse.
 *
 * The same dev-facing mechanism as `?debug=1`: it opens a panel this session would otherwise have
 * closed, and it changes nothing about the panel itself. Unknown names are ignored, so a stale link
 * opens the world rather than breaking the page.
 */
function panelRequested(): PanelState {
  try {
    const name = new URLSearchParams(window.location.search).get("panel");
    if (name === null) return defaultPanelState();
    const match = MODULES.find((module) => module.id === name);
    return match === undefined ? defaultPanelState() : openPanel(defaultPanelState(), match.id);
  } catch {
    return defaultPanelState();
  }
}

/**
 * How expensive the 3D view is allowed to be, from the query string.
 *
 * A development switch, not a player setting: `?quality=low` caps the pixel ratio, turns the shadow
 * map off, and drops the small scenery, so a development machine can keep a *correct* scene running
 * while somebody works on it. Nothing it changes is read by a game rule - land, walkability, crop
 * maturity, and ownership are identical at either level.
 */
function renderQualityRequested(): RenderQualityName {
  try {
    return resolveRenderQuality(new URLSearchParams(window.location.search).get("quality"));
  } catch {
    return "NORMAL";
  }
}

/** Applies a selection from either the 2D field or the 3D view; both read and write this one state. */
function selectCell(x: number, y: number): void {
  state.selected = { x, y };
  renderField();
  renderSelection();
  // The walk command is part of what a selection offers, so it appears with the rest of the dock.
  renderGo();
  refreshScene();
  scene?.setSelection(state.selected);
  // While an item is in hand, a click is also "put it here": the ghost follows the selection and the
  // placement HUD re-reads whether this cell would accept it.
  if (state.buildSelection !== null) {
    updatePlacementPreview();
    renderPlacementHud();
    setStatus(
      (translate) =>
        translate("status.placing", {
          item: buildEntryName(state.buildSelection as BuildCatalogEntryDTO),
          at: at(state.selected)
        })
    );
  }
  // Clicking the ground is also how a player says "walk there". The destination is offered only for
  // a cell a character can actually stand on, and it is never an *action*: planting and harvesting
  // stay on the dock's own buttons, so a mis-click cannot change the farm.
  const destination = walkDestinationFor(state.selected);
  if (destination !== null) playerRuntime.setDestination(destination);
}

/**
 * Where a click on this cell should send the character, or null when it cannot be walked to.
 *
 * The collision world is the one the character actually walks in - rebuilt whenever the farm state
 * is - so a destination this accepts is a destination the controller will reach, and one it refuses
 * is one the walker would have had to cross a building, a trunk, or the sea to get to.
 */
function walkDestinationFor(coordinate: { readonly x: number; readonly y: number }): { readonly worldX: number; readonly worldZ: number } | null {
  const cells = sceneInput().cells;
  const cell: WorldCell | undefined = cells.cells.get(cellKey(coordinate.x, coordinate.y));
  if (cell === undefined) return null;
  return movementDestination(cell, cells, (worldX, worldZ) => selectionCollision.depth(worldX, worldZ) > 0);
}

/** The renderer's view of the farm right now: one descriptor set for drawing and for collision. */
function sceneInput(): FarmSceneInput {
  return buildFarmSceneInput({
    tiles: state.tiles,
    crops: state.crops,
    trees: state.trees,
    plots: state.plots,
    selected: state.selected
  });
}

/** Pushes authoritative farm state into the renderer. The renderer invents no land and no crops. */
let scenePushSignature: string | null = null;

function refreshScene(): void {
  // The 3D view is the only consumer, so there is nothing to build while it is closed. Returning
  // before the world model is projected is the difference between a poll costing nothing and a poll
  // building an island, a cell map and a thousand scenery placements nobody will draw.
  if (scene === null) return;
  // A poll that finds the farm exactly as it was has nothing to push. `farmPresentationSignature`
  // covers everything these groups draw, growth quantised to the precision the panels print.
  // Built things are pushed before the gate: the signature is about the farm the server reports, and
  // a construction arriving is exactly the kind of change the setter is written to accept cheaply.
  scene.setConstructions(state.constructions.map(toSceneConstruction));
  const signature = farmPresentationSignature(state);
  if (signature === scenePushSignature) return;
  const input = sceneInput();
  // The shop's preview asks the same map the renderer draws from, so the two cannot disagree about
  // what ground is, what it can carry, or what stands on it.
  state.cellMap = input.cells;
  // Movement is blocked by the same rows the renderer draws, so a crop that grows under the
  // character starts blocking the next step without a second refresh path. Rebuilding the collision
  // world never moves the character: it only changes where the next step may go.
  playerRuntime.setTiles(input.tiles);
  // The selection asks the same world whether a cell can be walked to, so a destination can never be
  // offered for ground the character would refuse.
  selectionCollision = createPlayerCollisionWorld(input.tiles);
  try {
    scene.setState(input);
  } catch (error: unknown) {
    // The 3D view is a projection of state the rest of the page owns. A renderer problem must not
    // abort the authoritative refresh that called this, because the 2D field and the polling that
    // keeps it current do not depend on the 3D view working.
    const described = describe(error);
    setSceneState((translate, language) => translate("scene.error", { message: described(translate, language) }));
    return;
  }
  // Recorded only once the push succeeded, so a renderer problem is retried by the next refresh
  // rather than being remembered as done.
  scenePushSignature = signature;
  setSceneState((translate) =>
    translate("scene.active", { tiles: state.tiles.length, crops: state.crops.length })
  );
}

function enable3D(): void {
  if (scene === null) {
    try {
      scene = createFarmScene(element<HTMLCanvasElement>("scene"), {
        quality: renderQualityRequested(),
        onCellSelected: (cell) => {
          selectCell(cell.x, cell.y);
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
    } catch (error: unknown) {
      if (error instanceof FarmRendererUnavailableError) {
        setSceneState((translate) => translate("scene.unavailable"));
        setStatus(message("scene.noWebgl"), true);
        return;
      }
      setStatus(describe(error), true);
      return;
    }
    // The character exists exactly as long as the 3D view does: it listens for movement keys and
    // wakes the render loop while a key is held.
    startPlayer();
    // The cell grid is a development tool: it is on only when the page was opened with `?debug=1`,
    // so a normal session never sees the lattice the engine thinks in.
    scene.setDebugMode(debugRequested());
  }
  // A fresh renderer holds nothing, whatever the last one was told: forgetting the signature is what
  // makes the very next refresh fill it.
  scenePushSignature = null;
  refreshScene();
  renderGo();
  setStatus(message("scene.ready"));
}

async function refreshFarm(): Promise<void> {
  if (state.farmId === null) return;
  const client = api();
  const [tiles, crops, plots, trees, constructions] = await Promise.all([
    client.getTiles(state.farmId),
    client.getCrops(state.farmId),
    client.getPlots(state.farmId),
    client.getTrees(state.farmId),
    client.getFarmConstructions(state.farmId)
  ]);
  state.tiles = tiles.tiles;
  state.crops = crops.crops;
  state.plots = plots.plots;
  state.trees = trees.trees;
  state.constructions = constructions.constructions;
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
  playerRuntime.respawn();
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
  playerRuntime.respawn();
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
  if (selection.plantOption === "tree") {
    await plantTree(tile);
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

/** Plants the chosen tree: the sapling comes from the definition, and the server spends exactly one. */
async function plantTree(tile: FarmTileDTO): Promise<void> {
  const definitionId = state.selectedTree;
  if (state.farmId === null || definitionId === null) {
    setStatus(message("status.noCrop"), true);
    return;
  }
  // Belt and braces: an occupied tile never reaches the network, whichever occupant holds it.
  if (cropAt(tile.x, tile.y) !== null || treeAt(tile.x, tile.y) !== null) {
    setStatus(message("status.occupied"), true);
    return;
  }
  await api().plantTree(state.farmId, {
    requestId: newRequestId("plant-tree"),
    treeDefinitionId: definitionId,
    x: tile.x,
    y: tile.y,
    expectedTileVersion: tile.version
  });
  await refreshFarm();
  await refreshAccount();
  setStatus((translate) =>
    translate("status.plantedTree", { tree: treeName(definitionId), x: tile.x, y: tile.y })
  );
}

/**
 * Harvests one tree cycle.
 *
 * The tree survives, so nothing is removed locally: the refresh reports it regrowing at its next
 * revision, and the fruit and experience in the message are the award the server returned while the
 * page's own numbers come from the refreshed reads.
 */
async function harvestTree(treeInstanceId: string, expectedTreeVersion: number): Promise<void> {
  if (state.farmId === null) return;
  const result = await api().harvestTree(state.farmId, treeInstanceId, {
    requestId: newRequestId("harvest-tree"),
    expectedTreeVersion
  });
  await refreshFarm();
  await refreshAccount();
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

/** Harvests the selected tree; only a cycle the server reported ready can reach this. */
async function harvestSelectedTree(): Promise<void> {
  if (state.farmId === null) {
    setStatus(message("status.loadFarm"), true);
    return;
  }
  const selection = currentSelection();
  if (selection.kind !== "tree" || selection.tree === null || !selection.canHarvestTree) {
    setStatus(message("status.selectReadyTree"), true);
    return;
  }
  element<HTMLButtonElement>("harvest-tree").disabled = true;
  await harvestTree(selection.tree.treeInstanceId, selection.tree.version);
}

/**
 * Removes the selected tree after an explicit confirmation.
 *
 * The confirmation is the page's, not the server's: removing a tree destroys the sapling, so the
 * player is asked first. The command itself still goes through the server, which decides on its own
 * authority whether the tree exists, belongs to this farm, and is at the version last seen.
 */
async function removeSelectedTree(): Promise<void> {
  const selection = currentSelection();
  if (state.farmId === null) {
    setStatus(message("status.loadFarm"), true);
    return;
  }
  if (selection.tree === null) {
    setStatus(message("status.selectReadyTree"), true);
    return;
  }
  if (!window.confirm(t("dock.removeTree.confirm"))) return;
  const coordinate = selection.coordinate;
  await api().removeTree(state.farmId, selection.tree.treeInstanceId, {
    requestId: newRequestId("remove-tree"),
    expectedTreeVersion: selection.tree.version
  });
  await refreshFarm();
  await refreshAccount();
  setStatus((translate) =>
    translate("status.removedTree", { x: coordinate?.x ?? 0, y: coordinate?.y ?? 0 })
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
    // One control, two catalogues: a tree option is prefixed, and choosing either clears the other
    // so exactly one plant intent is ever pending.
    const chosen = cropSelect.value;
    if (chosen.startsWith("tree:")) {
      state.selectedTree = chosen.slice("tree:".length);
      state.selectedCrop = null;
    } else {
      state.selectedCrop = chosen;
      state.selectedTree = null;
    }
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
  element<HTMLButtonElement>("harvest-tree").addEventListener("click", () => {
    void run(harvestSelectedTree);
  });
  element<HTMLButtonElement>("remove-tree").addEventListener("click", () => {
    void run(removeSelectedTree);
  });
  element<HTMLButtonElement>("expand-farm").addEventListener("click", () => {
    void run(expandFarm);
  });
  element<HTMLButtonElement>("go").addEventListener("click", () => {
    const selected = state.selected;
    if (selected === null) return;
    playerRuntime.setDestination(tileToWorld({ x: selected.x, y: selected.y }, worldFrame()));
    setStatus(message("status.going", { at: at(selected) }));
  });
  for (const module of MODULES) {
    const launcher = element<HTMLButtonElement>(module.launcherId);
    launcher.addEventListener("click", () => {
      setActivePanel(togglePanel(panels, module.id));
    });
    element<HTMLButtonElement>(module.closeId).addEventListener("click", () => {
      setActivePanel(closePanel(panels));
      launcher.focus();
    });
  }
  for (const direction of ["buy", "sell"] as const) {
    element<HTMLButtonElement>(direction === "buy" ? "market-tab-buy" : "market-tab-sell").addEventListener(
      "click",
      () => {
        shopDirection = direction;
        renderMarketTabs();
        renderShop();
      }
    );
  }
  document.addEventListener("keydown", (event) => {
    // A key typed into the search box belongs to the search box, not to the item in hand.
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    // Turn the item in hand. Q and E are the shop's own keys: they exist only in placement mode, so
    // they cannot collide with the camera or with the field's own shortcuts.
    if (!typing && state.buildSelection !== null && (event.key === "q" || event.key === "Q")) {
      rotatePlacement(-1);
      return;
    }
    if (!typing && state.buildSelection !== null && (event.key === "e" || event.key === "E")) {
      rotatePlacement(1);
      return;
    }
    if (state.buildSelection !== null && event.key === "Enter") {
      void confirmPlacement();
      return;
    }
    if (event.key !== "Escape") return;
    // Escape lets go of whatever the page is holding, innermost first: the item in hand, then the
    // panel. Cancelling a placement must leave nothing behind - no ghost, no footprint, no state.
    if (state.buildSelection !== null) {
      cancelBuildSelection();
      return;
    }
    if (panels.active !== null) setActivePanel(closePanel(panels));
  });
  window.addEventListener("resize", () => {
    const width = window.innerWidth;
    if (crossesPanelBreakpoint(lastViewportWidth, width)) {
      // The panel's presentation changed underneath it, so it closes rather than half-adapting.
      setActivePanel(defaultPanelState());
    }
    lastViewportWidth = width;
    syncLayoutMetrics();
  });
  element<HTMLButtonElement>("render-3d").addEventListener("click", enable3D);
  // A page restored from the back/forward cache would otherwise return with a disposed renderer and
  // a blank canvas, so the handle is dropped and the button starts a fresh one.
  window.addEventListener("pagehide", () => {
    scene?.dispose();
    scene = null;
    stopPlayer();
    setSceneState((translate) => translate("scene.idle"));
  });

  /**
   * Whether a poll is still running.
   *
   * The interval is fixed, and a slow round trip - a cold development API, a machine already under
   * load - used to let ticks stack: another four requests, another state push, another whole-page
   * re-render, every two seconds, all overlapping the tick before. That is a self-sustaining load
   * spiral on exactly the machine this recovery pass exists to rescue, so a tick that arrives while
   * the previous one is still running is dropped. The next tick is at most two seconds away and the
   * lost poll is indistinguishable from a slow response.
   */
  let farmRefreshInFlight = false;

  window.setInterval(() => {
    if (state.farmId === null || farmRefreshInFlight) return;
    farmRefreshInFlight = true;
    void (async () => {
      try {
        await refreshFarm();
        render();
      } catch {
        // Growth polling is best-effort; explicit actions surface their own errors.
      } finally {
        farmRefreshInFlight = false;
      }
    })();
  }, REFRESH_INTERVAL_MS);
}

document.documentElement.lang = languageTag(state.language);
wire();
renderIcons();
render();
void run(async () => {
  // No startup handshake: a deployed Worker authenticates the visitor and creates their Player row
  // on the first API call, and the development host does the same server-side. Keeping the dev
  // bootstrap out of the client is what keeps a development-only route out of the shipped bundle.
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
