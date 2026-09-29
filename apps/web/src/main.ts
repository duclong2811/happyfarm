import type {
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
import {
  closePanel,
  crossesPanelBreakpoint,
  MODULES,
  defaultPanelState,
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
  type FarmSceneInput,
  type FarmScenePlayer,
  type FarmSceneHandle
} from "./render";
import { SPAWN_WORLD } from "./render/world-config";
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
  button.textContent = `👣 ${t("dock.go")}`;
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
  row.appendChild(
    make("span", "shop-name", itemName(entry.itemDefinitionId, entry.itemDisplayNameKey))
  );
  row.appendChild(make("span", "shop-price", `${String(price ?? 0)} ${currency}`));

  const quantity = make("input");
  quantity.type = "number";
  quantity.min = "1";
  quantity.max = String(entry.maxQuantityPerRequest);
  quantity.value = "1";
  quantity.className = "quantity";
  quantity.setAttribute("aria-label", t("market.quantity"));

  const stepper = make("div", "stepper");
  const decrease = make("button", "stepper-button", "−");
  decrease.type = "button";
  decrease.setAttribute("aria-label", t("market.decrease"));
  decrease.addEventListener("click", () => {
    const next = Math.max(1, (quantity.valueAsNumber || 1) - 1);
    quantity.value = String(next);
  });
  const increase = make("button", "stepper-button", "+");
  increase.type = "button";
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

/** Every string the layout itself owns, so a language change reaches the panel headings too. */
function renderChrome(): void {
  element<HTMLElement>("gold-label").textContent = t("hud.gold");
  element<HTMLElement>("inventory-title").textContent = t("panel.inventory");
  element<HTMLElement>("land-title").textContent = t("panel.land");
  element<HTMLElement>("market-title").textContent = t("panel.market");
  element<HTMLElement>("module-rail").setAttribute("aria-label", t("hud.modules"));
  renderMarketTabs();
  element<HTMLElement>("crop-label").textContent = t("dock.crop");
  element<HTMLButtonElement>("plant").textContent = t("dock.plant");
  element<HTMLButtonElement>("harvest").textContent = t("dock.harvest");
  element<HTMLButtonElement>("uproot").textContent = t("dock.uproot");
  element<HTMLButtonElement>("harvest-tree").textContent = t("dock.harvest");
  element<HTMLButtonElement>("remove-tree").textContent = t("dock.removeTree");
  element<HTMLButtonElement>("expand-farm").textContent = t("land.unlock");
  const language = element<HTMLButtonElement>("language");
  language.textContent = t("language.switch");
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

let panels: PanelState = defaultPanelState();
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
  const [inventory, wallet, shop, progression, cropDefinitions, treeDefinitions] = await Promise.all([
    client.getInventory(),
    client.getWallet(),
    client.getShop(),
    client.getProgression(),
    client.getCropDefinitions(),
    client.getTreeDefinitions()
  ]);
  state.inventory = inventory.items;
  state.wallet = wallet.wallets;
  state.shop = shop.entries;
  state.progression = progression.progression;
  state.cropDefinitions = cropDefinitions.definitions;
  state.treeDefinitions = treeDefinitions.definitions;
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

/** Applies a selection from either the 2D grid or the 3D view; both read and write this one state. */
function selectTile(x: number, y: number): void {
  state.selected = { x, y };
  renderField();
  renderSelection();
  // The walk command is part of what a selection offers, so it appears with the rest of the dock.
  renderGo();
  refreshScene();
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
function refreshScene(): void {
  const input = sceneInput();
  // Movement is blocked by the same rows the renderer draws, so a crop that grows under the
  // character starts blocking the next step without a second refresh path. Rebuilding the collision
  // world never moves the character: it only changes where the next step may go.
  playerRuntime.setTiles(input.tiles);
  if (scene === null) return;
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
  setSceneState((translate) =>
    translate("scene.active", { tiles: state.tiles.length, crops: state.crops.length })
  );
}

function enable3D(): void {
  if (scene === null) {
    try {
      scene = createFarmScene(element<HTMLCanvasElement>("scene"), {
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
  }
  refreshScene();
  renderGo();
  setStatus(message("scene.ready"));
}

async function refreshFarm(): Promise<void> {
  if (state.farmId === null) return;
  const client = api();
  const [tiles, crops, plots, trees] = await Promise.all([
    client.getTiles(state.farmId),
    client.getCrops(state.farmId),
    client.getPlots(state.farmId),
    client.getTrees(state.farmId)
  ]);
  state.tiles = tiles.tiles;
  state.crops = crops.crops;
  state.plots = plots.plots;
  state.trees = trees.trees;
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
    if (event.key === "Escape" && panels.active !== null) setActivePanel(closePanel(panels));
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
