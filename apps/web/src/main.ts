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
import { PLAYER_MAX_SLOPE, PLAYER_MAX_STEP_WORLD } from "./player/controller";
import {
  NO_CHARACTER_INTENT,
  cameraRelativeMovement,
  characterIntentFromInput,
  composeCharacterInput,
  type CharacterMoveIntent
} from "./player/character-input";
import { createMovementInput, isTypingTarget, NEUTRAL_INPUT, type MovementInput } from "./player/input";
import { createPlayerRuntime } from "./player/runtime";
import {
  deviceCapability,
  showTouchControls,
  type DeviceCapability
} from "./mobile/capability";
import { createHoldControl, createJoystickControl, type HoldControl, type JoystickControl } from "./mobile/joystick";
import { deviceQualityProfile } from "./render/render-quality";
import { DEFAULT_CAMERA_MODE, otherCameraMode, type CameraMode } from "./render/camera-mode";
import { GROUND_SURFACE_Y, terrainHeightAt } from "./render/terrain-height";
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
  ownedBounds,
  ownedCells,
  ownershipOverlayFor,
  selectedRow
} from "./object-editing";
import {
  activeObjects,
  indexWorldObjects,
  objectObstacles,
  objectPolicy,
  objectPresentation,
  removalRefundPreview,
  starterVisual,
  storageStacks,
  type WorldObjectDefinitions
} from "./world-objects";
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
import {
  COLLAPSED_DOCK,
  collapseDock,
  dockIsCompact,
  dockIsExpanded,
  dockPresentationFor,
  dockShowsExpand,
  toggleDockExpansion,
  type DockState
} from "./dock";
import { groundTapOpensContext, precisionFocusFor, type PrecisionActionKind } from "./render/precision-action";
import type { EstateFollowBehaviour } from "./render/estate-follow";
import type { EstateCameraFocus } from "./render";
import { homeIslandContext, type GameplayContext } from "./interaction/context";
import { interactionPromptFor, type InteractionCandidate } from "./interaction/model";
import {
  EMPTY_INTERACTION_INDEX,
  buildInteractionIndex,
  type InteractionIndex
} from "./interaction/registry";
import {
  interactionActivation,
  interactionKeyRequested,
  selectInteractionCandidate
} from "./interaction/selection";
import { REWARD_POP_DURATION_MS } from "./interaction/feedback";
import { createItemThumbnails, type ItemThumbnails } from "./items/thumbnails";
import { renderItemCard, type ItemCardState } from "./items/card";
import { itemVisualFor } from "./items/visuals";
import {
  inventoryCards,
  inventoryCategoryCounts,
  inventoryTabs,
  plantOptions,
  rememberedPlantChoice,
  storedCounts,
  visibleInventoryCards,
  type InventoryCard,
  type InventoryCategory,
  type PlantOption
} from "./items/catalogue";
import "./styles.css";

const FARM_KEY = "happy-farm.dev.farmId";
const REFRESH_INTERVAL_MS = 2_000;
// A success message is transient: it says what just happened and then gives the world its screen
// back. Errors are not on this clock - they stay until something replaces them, because they are
// usually the only sign that an action the player asked for did not happen.
const STATUS_TIMEOUT_MS = 6_000;
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
  /**
   * The authenticated player, as the session endpoint reported them, or null before a session.
   *
   * Read-only server state. It is *not* sent back anywhere (the server derives the actor from the
   * session), and it exists so the client can say where a player is *and* who they are as two separate
   * things - see `GameplayContext`.
   */
  playerId: string | null;
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
   * The island's own object definitions: what a starter tree or the mill *is*.
   *
   * Read-only reference data, like the crop catalogue. Without it the client could not draw or
   * describe an object the player never bought - which is the whole of V13.3.
   */
  worldObjects: WorldObjectDefinitions;
  /**
   * The catalogue entry the player is about to place, or null.
   *
   * UI state, and only UI state: it decides what the ghost draws and what the status line says. No
   * gold is spent, nothing is persisted, and no server command exists to send - which is exactly why
   * the shop's status says the placement pass has not arrived.
   */
  buildSelection: BuildCatalogEntryDTO | null;
  /**
   * Which way the island is being looked at: the estate camera, or behind the character.
   *
   * One piece of client state over one world. The estate view designs the island, the character view
   * lives in it, and nothing else differs - the terrain, the objects, the collision and the character
   * are the same in both. It lives here rather than inside the renderer because the HUD shows it, the
   * panels depend on it, and the movement keys are routed by it.
   */
  cameraMode: CameraMode;
  /**
   * The id of the built thing the player is editing, or null.
   *
   * An *id*, not a row and not an object reference: every poll replaces the list with fresh rows, so a
   * panel holding an old copy would describe an old version and then send that version to a server
   * that has moved on. The row is resolved from `state.constructions` whenever it is needed, and a row
   * that has gone (removed here or in another tab) resolves to nothing, which clears the selection.
   */
  selectedObjectId: string | null;
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
  playerId: null,
  tiles: [],
  crops: [],
  trees: [],
  cropDefinitions: [],
  treeDefinitions: [],
  buildCatalog: [],
  worldObjects: indexWorldObjects([]),
  buildSelection: null,
  /**
   * Which way the island is being looked at.
   *
   * One piece of client state over one world: the estate view designs it, the character view lives in
   * it, and nothing else differs between them. Owned here rather than in the renderer because the HUD
   * shows it, the panels depend on it, and the movement keys are routed by it.
   */
  cameraMode: DEFAULT_CAMERA_MODE,
  selectedObjectId: null,
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
/**
 * Whether the boot could not even start a session.
 *
 * Kept as state rather than written straight into the status line so the retry control can be shown
 * with it and the message survives a language switch.
 */
let bootFailed = false;
/**
 * How much of the selection surface is on screen.
 *
 * One boolean - is the compact strip open - and every decision about it belongs to `dock.ts`. Kept
 * here because the page owns what is selected; nothing about it reaches the server.
 */
let dock: DockState = COLLAPSED_DOCK;
/**
 * Whether the estate camera is following the player.
 *
 * A mirror of the renderer's own state, which is the only thing that can see the player move and the
 * only thing that knows whether the camera was just taken by hand. This copy exists so the recenter
 * control can say which of the two it would do.
 */
let estateFollow: EstateFollowBehaviour = "FOLLOW";
/** Whether the phone's overflow menu is open. Presentation only. */
let hudMenuOpen = false;
/** Which inventory tab is open. A view, not a preference: it is not stored and it decides no rule. */
let inventoryCategory: InventoryCategory = "ALL";
/**
 * The island's interactables, bucketed by the cell they stand on, and what is in reach right now.
 *
 * The index is rebuilt when the read models change and never per frame; the candidate is re-decided
 * from the index on the character's own pose stream, which is the only thing that can move the
 * answer. One candidate calculation, one consumer pair (the keyboard prompt and the touch button).
 */
let interactionIndex: InteractionIndex = EMPTY_INTERACTION_INDEX;
let interactionCandidate: InteractionCandidate | null = null;
/** The last thing the interaction surfaces were drawn from, so an unchanged frame writes no DOM. */
let interactionSignature = "";
/** Whether an interaction command is in flight, so one press cannot become two commands. */
let interactionPending = false;
/** The character's latest pose, kept so the interaction scan can ask where they are standing. */
let characterPose: FarmScenePlayer | null = null;
/** The pending clear for a transient success message, or null. */
let statusTimer: number | null = null;
/** What an empty status line is: no message at all, in any language. */
const NO_STATUS: StatusText = () => "";

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
  if (statusTimer !== null) {
    window.clearTimeout(statusTimer);
    statusTimer = null;
  }
  // A success message is transient, and errors are not: a refusal the player asked for has to stay
  // on screen until they can read it, while "Camera is following you" has said all it has to say.
  if (!isError) {
    statusTimer = window.setTimeout(() => {
      statusTimer = null;
      statusText = NO_STATUS;
      renderStatus();
    }, STATUS_TIMEOUT_MS);
  }
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
  // An empty status is no status: the world gets the space back rather than a blank pill hanging
  // over it. This is also what keeps routine polling silent - the poll never sets one.
  node.hidden = node.textContent.length === 0;
}

/**
 * Shows the retry control only when there is something to retry.
 *
 * A guest session is established once at boot, and the one way that can fail is the network. The
 * page must not sit at "Preparing 3D world…" forever, so the failure is a sentence and a button
 * rather than a spinner.
 */
function renderBootRetry(): void {
  const button = element<HTMLButtonElement>("boot-retry");
  button.hidden = !bootFailed;
  button.textContent = t("boot.retry");
}

/**
 * The overflow control, and the two secondary buttons it holds on a phone.
 *
 * On a wide screen the stylesheet keeps the wrapper as an ordinary row, so the desktop top bar is
 * exactly what it was; on a compact one it is a menu with a toggle. Only the class and the
 * `aria-expanded` state are decided here - which is where it appears is the stylesheet's business.
 */
function renderHudMenu(): void {
  const toggle = element<HTMLButtonElement>("hud-menu-toggle");
  const open = hudMenuOpen;
  element<HTMLElement>("hud-menu").classList.toggle("is-open", open);
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", t("hud.menu"));
  toggle.title = t("hud.menu");
}

/**
 * How much of the selection surface is on screen.
 *
 * The decision is `dockPresentationFor`, so the four states - hidden, strip, sheet, full dock - are
 * one rule with a test rather than a class name written out in three places. Character view can only
 * ever get the strip, which is what keeps walking around free of the farming editor.
 */
function renderDock(): void {
  const presentation = dockPresentationFor({
    hasSelection: state.selected !== null,
    compact: capability.compact,
    cameraMode: state.cameraMode,
    state: dock
  });
  const node = element<HTMLElement>("action-dock");
  node.hidden = presentation === "HIDDEN";
  node.classList.toggle("is-compact", dockIsCompact(presentation));
  node.classList.toggle("is-expanded", dockIsExpanded(presentation) && dockIsCompact(presentation));
  const expand = element<HTMLButtonElement>("dock-expand");
  expand.hidden = !dockShowsExpand(presentation);
  const label = dockIsExpanded(presentation) && dockIsCompact(presentation)
    ? t("dock.collapse")
    : t("dock.expand");
  expand.setAttribute("aria-label", label);
  expand.setAttribute("aria-expanded", String(dockIsCompact(presentation) && dockIsExpanded(presentation)));
  expand.title = label;
}

/**
 * The camera-mode control: which view is active, and what the two are called.
 *
 * Always visible, because the player should never have to guess which of two very different cameras
 * they are holding. Two buttons rather than one toggle: "Estate" and "Character" say what the modes
 * are, where a switch would only say "not this one".
 */
function renderCameraMode(): void {
  const group = element<HTMLElement>("camera-mode");
  group.setAttribute("aria-label", t("camera.mode.aria"));
  const estate = element<HTMLButtonElement>("camera-estate");
  const character = element<HTMLButtonElement>("camera-character");
  const inEstate = state.cameraMode === "ESTATE";
  estate.textContent = t("camera.mode.estate");
  character.textContent = t("camera.mode.character");
  estate.classList.toggle("is-active", inEstate);
  character.classList.toggle("is-active", !inEstate);
  estate.setAttribute("aria-pressed", String(inEstate));
  character.setAttribute("aria-pressed", String(!inEstate));
  estate.title = t("camera.mode.estateHint");
  character.title = t("camera.mode.characterHint");
  // The recenter control belongs to the estate view, which is the only view it can move, and it says
  // which of its two jobs it would do: bring the camera back, or nothing at all.
  const recenter = element<HTMLButtonElement>("camera-recenter");
  const free = estateFollow === "FREE";
  recenter.hidden = !inEstate;
  recenter.classList.toggle("is-free", free);
  const recenterLabel = t(free ? "camera.recenterFree" : "camera.recenter");
  recenter.title = recenterLabel;
  recenter.setAttribute("aria-label", recenterLabel);
  // The Run button's own words, so the touch control is translated like every other one.
  const run = element<HTMLButtonElement>("run-button");
  run.textContent = t("mobile.run");
  run.setAttribute("aria-label", t("mobile.run.aria"));
}

/** Whether the one-time "how to walk about" hint has been shown this session. */
let characterHintShown = false;

/**
 * The first-time hint for the character view.
 *
 * Shown once per session, on the first entry, and it fades itself out: the brief asks for four lines
 * that explain the controls, not a tutorial modal, and a player who already knows them should never
 * see it a second time in the same sitting.
 */
function showCharacterHint(): void {
  if (characterHintShown) return;
  characterHintShown = true;
  const hint = element<HTMLElement>("camera-hint");
  hint.textContent = t("camera.hint");
  hint.hidden = false;
  // A frame after unhiding, so the fade-in actually transitions rather than appearing at full opacity.
  window.requestAnimationFrame(() => {
    hint.classList.add("is-visible");
  });
  window.setTimeout(() => {
    hint.classList.remove("is-visible");
  }, 6500);
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
  // The rule lives in `items/catalogue.ts`, where it is a test: keep the remembered choice while the
  // player can still make it, otherwise take the first one they can. Called before the picker draws and
  // after every account refresh, so the chosen crop is never one the player cannot plant.
  const options = plantOptionModels();
  const chosen = rememberedPlantChoice(selectedPlantOption(), options);
  const option = options.find((candidate) => candidate.key === chosen) ?? null;
  state.selectedCrop = option?.kind === "CROP" ? option.definitionId : null;
  state.selectedTree = option?.kind === "TREE" ? option.definitionId : null;
}

/**
 * The planting picker: a row of visual crop cards, not a dropdown.
 *
 * A picture is what a player recognises, and a native select is a web form - the whole point of V14.2
 * is that the farming loop reads like a game. Each card is the shared item card with this catalogue
 * entry's own state on it: how many seeds are held, whether it is unlocked, and whether it is chosen.
 * The list is sorted so the choices a player can actually use come first, and a level-locked crop says
 * so rather than blaming an empty seed pouch.
 *
 * Rebuilt only when the signature changes, because this page re-renders after every action and on
 * every growth poll, and a card row that rebuilt itself under a thumb would be unusable.
 */
let renderedPlantSignature: string | null = null;

/** The options, straight from the catalogues and the inventory the server last sent. */
function plantOptionModels(): PlantOption[] {
  const counts = storedCounts(state.inventory);
  return plantOptions({
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions,
    playerLevel: state.progression?.level ?? null,
    // One map serves both families: an item id is unique, and a crop's seed and a tree's sapling are
    // different items.
    seedCounts: counts,
    saplingCounts: counts
  });
}

function renderPlantPicker(): void {
  const options = plantOptionModels();
  const signature = JSON.stringify([
    state.language,
    options.map((option) => [option.key, option.stored, option.group, option.requiredLevel]),
    state.selectedCrop,
    state.selectedTree
  ]);
  if (signature === renderedPlantSignature) return;
  renderedPlantSignature = signature;

  ensurePlantableSelection();
  const chosenKey = selectedPlantOption();
  const picker = element<HTMLElement>("plant-picker");
  picker.replaceChildren();
  picker.setAttribute("aria-label", t("plant.pick"));
  for (const option of options) {
    picker.appendChild(plantOptionCard(option, chosenKey));
  }
  renderPlantAction(options.find((option) => option.key === chosenKey) ?? null);
}

/** One crop in the picker: the shared card, with this catalogue entry's own state. */
function plantOptionCard(option: PlantOption, chosenKey: string): HTMLElement {
  const name = option.kind === "CROP" ? cropName(option.definitionId) : treeName(option.definitionId);
  const chosen = option.key === chosenKey;
  const cardState: ItemCardState =
    option.group === "LOCKED" ? "LOCKED" : option.group === "NO_SEEDS" ? "EMPTY" : chosen ? "SELECTED" : "NORMAL";
  // The blocker in the order a player would fix it: the level first, because no amount of shopping
  // fixes a locked crop, and only then the empty pouch.
  const note =
    option.blockedReason === "LEVEL"
      ? t("plant.levelRequired", { level: option.requiredLevel })
      : option.blockedReason === "NO_SEEDS"
        ? t("plant.noSeeds")
        : t("plant.growsIn", { time: durationText(option.growthSeconds) });
  const quantityLabel = t(option.kind === "CROP" ? "plant.seedsHeld" : "plant.saplingsHeld", {
    quantity: option.stored,
    item: name
  });
  return renderItemCard(
    {
      key: option.key,
      visual: option.visual,
      name,
      quantity: option.stored,
      quantityLabel,
      note,
      state: cardState,
      disabled: !option.selectable,
      ariaLabel: `${name} — ${quantityLabel}, ${note}`
    },
    itemCardDeps(),
    {
      onSelect: () => {
        choosePlantOption(option);
      }
    }
  );
}

/** Choosing a crop or a tree is one choice: picking either clears the other. */
function choosePlantOption(option: PlantOption): void {
  if (!option.selectable) return;
  const alreadyChosen =
    (option.kind === "CROP" && state.selectedCrop === option.definitionId && state.selectedTree === null) ||
    (option.kind === "TREE" && state.selectedTree === option.definitionId && state.selectedCrop === null);
  if (alreadyChosen) return;
  state.selectedCrop = option.kind === "CROP" ? option.definitionId : null;
  state.selectedTree = option.kind === "TREE" ? option.definitionId : null;
  renderedPlantSignature = null;
  renderPlantPicker();
  renderSelection();
}

/** The action's own words: "Plant Carrot", not "Plant crop". */
function renderPlantAction(chosen: PlantOption | null): void {
  const label =
    chosen === null
      ? t("dock.plant")
      : t("dock.plantNamed", {
          crop: chosen.kind === "CROP" ? cropName(chosen.definitionId) : treeName(chosen.definitionId)
        });
  setLabel("plant", label);
  const button = element<HTMLButtonElement>("plant");
  button.setAttribute("aria-label", label);
  button.title = label;
}
/**
 * The single place the page turns authoritative rows into "what the dock offers" semantics.
 *
 * Takes the coordinate rather than reading `state.selected`, so a cell can be *asked about* before it
 * is selected: that is what lets a tap in character view decide whether it is worth opening the
 * context strip at all.
 */
function selectionAt(selected: SelectedTile | null): SelectionView {
  const definition = selectedCropDefinition();
  const treeDefinition = selectedTreeDefinition();
  return describeSelection({
    tiles: state.tiles,
    crops: state.crops,
    trees: state.trees,
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions,
    selected,
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

function currentSelection(): SelectionView {
  return selectionAt(state.selected);
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
/**
 * What may actually be done on a cell right now, as names in the current language.
 *
 * One resolver for both readers: the dock's detail line lists them, and a character-view tap asks
 * whether the list is empty before it opens the surface.
 */
function availableActions(cell: WorldCell | null, selection: SelectionView): string[] {
  if (cell === null) return [];
  const actions = getAvailableCellActions(cell, {
    canPlant: selection.canPlant,
    crop: selection.crop === null ? null : { mature: selection.canHarvest },
    tree: selection.tree === null ? null : { ready: selection.canHarvestTree }
  });
  return actions
    .filter((action) => action.enabled)
    .map((action) => t(cellActionKey(action.id) as MessageKey));
}

function availableActionNames(cell: WorldCell, selection: SelectionView): string {
  const names = availableActions(cell, selection);
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
  // No selection, no surface: the world keeps the space instead of an empty bar. How much of it is
  // on screen is the dock's own rule, which is what the compact strip and the chevron come from.
  renderDock();
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
  // Character view has no click-to-move - the character is steered with the movement keys - so the
  // button is not offered there even if a cell was selected before the camera changed.
  const walkable = state.cameraMode === "ESTATE" && selected !== null;
  button.hidden = !walkable;
  button.disabled = scene === null || !walkable;
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
  const cards = inventoryCards({
    inventory: state.inventory,
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions
  });
  const tabs = inventoryTabs(cards);
  // A tab can empty out while it is open - the last seed spent on the last cell. Falling back to
  // everything keeps the panel showing the farm rather than an empty shelf.
  if (!tabs.includes(inventoryCategory)) inventoryCategory = "ALL";
  const counts = inventoryCategoryCounts(cards);

  const tabBar = element<HTMLElement>("inventory-tabs");
  tabBar.replaceChildren();
  tabBar.hidden = cards.length === 0;
  for (const category of tabs) {
    const tab = make("button", "item-tab");
    tab.type = "button";
    tab.setAttribute("role", "tab");
    const active = category === inventoryCategory;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.textContent = `${t(inventoryCategoryKey(category))} (${String(counts[category])})`;
    tab.addEventListener("click", () => {
      inventoryCategory = category;
      renderInventory();
    });
    tabBar.appendChild(tab);
  }

  const grid = element<HTMLElement>("inventory-grid");
  grid.replaceChildren();
  for (const card of visibleInventoryCards(cards, inventoryCategory)) {
    grid.appendChild(inventoryCardNode(card));
  }
  const empty = element<HTMLElement>("inventory-empty");
  empty.hidden = cards.length > 0;
  empty.textContent = t("inventory.empty");
}

/** The tab's own words, spelled out so the translator stays total. */
function inventoryCategoryKey(category: InventoryCategory): MessageKey {
  switch (category) {
    case "ALL":
      return "inventory.category.all";
    case "PRODUCE":
      return "inventory.category.produce";
    case "SEEDS":
      return "inventory.category.seeds";
    case "SAPLINGS":
      return "inventory.category.saplings";
  }
}

/**
 * One item on the shelf: a picture, a name, how many, and what the market pays for it if anything.
 *
 * No button and no action. The inventory answers "what do I own?"; using an item is either planting
 * (cell-based, and the dock's job) or selling (the market's row). A card that looked pressable and did
 * nothing would be the web-form problem in a new costume.
 */
function inventoryCardNode(card: InventoryCard): HTMLElement {
  const name = itemName(card.itemDefinitionId, card.nameKey ?? card.itemDefinitionId);
  const quantityLabel = t("inventory.quantityLabel", { quantity: card.quantity, item: name });
  return renderItemCard(
    {
      key: card.key,
      visual: card.visual,
      name,
      quantity: card.quantity,
      quantityLabel,
      note: inventoryNoteFor(card.itemDefinitionId),
      state: "NORMAL",
      disabled: false,
      ariaLabel: `${name} — ${quantityLabel}`
    },
    itemCardDeps()
  );
}

/** What the market pays for this item, when it buys it at all. Server data, never a client guess. */
function inventoryNoteFor(itemDefinitionId: string): string | null {
  const entry = state.shop.find((row) => row.itemDefinitionId === itemDefinitionId);
  if (entry === undefined || entry.sellPrice === null) return null;
  return t("inventory.sellsFor", {
    price: entry.sellPrice,
    currency: currencyLabel(entry.currencyId, entry.currencyDisplayNameKey)
  });
}

/** What every visual item card needs: the shared picture cache and the icon set. */
function itemCardDeps(): {
  readonly thumbnails: ItemThumbnails;
  readonly icon: (name: IconName, size?: number) => SVGElement;
} {
  return { thumbnails: itemThumbnails, icon: (name, size) => createIcon(name, size) };
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
const itemThumbnails: ItemThumbnails = createItemThumbnails((modelId) => {
  reportMissingThumbnail(modelId);
});

/**
 * The shop's view of the same cache.
 *
 * Four surfaces draw an item picture - the shop, the inventory, the planting picker and the reward pop
 * - and they all come through *this* cache, so a carrot costs one draw per session and there is one
 * WebGL context behind all of them. See `apps/web/src/items/thumbnails.ts`.
 */
const shopThumbnails = createShopThumbnails((modelId) => {
  reportMissingThumbnail(modelId);
}, itemThumbnails);

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
  renderBuildStorage();
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
  readonly landmarkKind: string | null;
  readonly sizeWorld: number;
  readonly worldX: number;
  readonly worldZ: number;
  readonly rotationY: number;
  readonly widthCells: number;
  readonly depthCells: number;
} {
  const anchor = tileToWorld({ x: construction.anchorX, y: construction.anchorY }, worldFrame());
  // The island's own arrangement of this object, when it has one: which model a tree grew as, how
  // tall it was, and which way it faced. A row the player placed has no arrangement and is resolved
  // from its catalogue entry instead.
  const visual = starterVisual(construction.placementKey);
  const presentation =
    visual !== undefined && visual.modelId !== null && visual.sizeWorld !== null
      ? { modelId: visual.modelId, sizeWorld: visual.sizeWorld }
      : objectPresentation(construction, state.worldObjects, state.buildCatalog);
  const definition = state.worldObjects.get(construction.entryId);
  return {
    id: construction.constructionId,
    modelId: presentation.modelId !== null && !presentation.modelId.startsWith("road.") ? presentation.modelId : null,
    landmarkKind: definition?.landmarkKind ?? null,
    sizeWorld: presentation.sizeWorld,
    worldX: anchor.worldX,
    worldZ: anchor.worldZ,
    // The island's authored facing, plus however many quarter turns the player has applied since.
    rotationY: (visual?.baseYaw ?? 0) + (construction.rotation * Math.PI) / 2,
    widthCells: construction.footprint.widthCells,
    depthCells: construction.footprint.depthCells
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

/** The requirement the preview rule reads, taken entirely from the catalogue entry and its rotation. */
function previewRequirement(
  entry: BuildCatalogEntryDTO,
  footprint: { readonly widthCells: number; readonly depthCells: number }
): PreviewRequirement {
  return {
    // The asset's own ground requirement, straight from the catalogue: dry land for almost everything,
    // the shallows for a moored cage. No economic district is consulted, because none exists.
    allowedTerrain: entry.allowedTerrain,
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
  // Placing is precise work and belongs to the estate view: the brief's rule is that entering the
  // build flow brings the camera back up rather than asking the player to place a barn from behind
  // their own shoulder.
  setCameraMode("ESTATE");
  // An object being edited and an item in hand are two different gestures: picking one up puts the
  // other down.
  clearObjectSelection();
  scene?.setObjectPicking(false);
  refreshOwnershipOverlay();
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

  // The mark on the ground is the answer to "where is my land"; this is the sentence that names it,
  // because a colour with no legend is a decoration.
  const owned = make("p", "placement-note");
  owned.textContent = t("build.hud.ownedHint");
  node.appendChild(owned);

  const diagnostic = debugDiagnostic(state.selected);
  if (diagnostic !== null) node.appendChild(make("p", "placement-note", diagnostic));

  const confirm = make("button", "placement-confirm");
  confirm.type = "button";
  confirm.disabled = placementPending || rejection !== null;
  confirm.textContent = placementPending ? t("build.hud.pending") : t("build.hud.confirm");
  confirm.addEventListener("click", () => {
    void confirmPlacement();
  });
  // Confirm and Cancel together, in the panel itself. The keyboard shortcuts still work, but a phone
  // has no Escape key: every "put it down / carry it / place it" state has to be leavable by touch.
  const actions = make("div", "placement-actions");
  const cancel = make("button", "placement-cancel");
  cancel.type = "button";
  cancel.textContent = t("build.hud.cancel");
  cancel.addEventListener("click", () => {
    cancelBuildSelection();
  });
  actions.appendChild(confirm);
  actions.appendChild(cancel);
  node.appendChild(actions);
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
    scene?.setObjectPicking(true);
    refreshOwnershipOverlay();
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
  scene?.setObjectPicking(true);
  refreshOwnershipOverlay();
  renderPlacementHud();
  setStatus(message("status.placementCancelled"));
}

/*
 * Editing what is already built: select an object, then move it, turn it, or take it down.
 *
 * The panel and the ghost are UI state. Every *rule* lives on the server: which objects may be moved
 * or removed is the asset's own policy there, whether the destination is free is checked against the
 * server's own rows, and the refund is the definition's number computed in the settlement. What this
 * half does is describe the intention and show the server's answer.
 */

/**
 * The object being carried, or null.
 *
 * One session for both directions of the same gesture: carrying something already on the island to a
 * new cell (`MOVE`), and carrying something out of storage back onto the island (`RESTORE`). The
 * ghost, the ownership mark, the validity rule and the keyboard all belong to the gesture rather than
 * to the command, so they are shared; only the confirm differs.
 */
let moveSession: { readonly kind: "MOVE" | "RESTORE"; readonly construction: ConstructionDTO; turns: 0 | 1 | 2 | 3 } | null =
  null;
/** True while an edit command is in flight, so a double click cannot send two. */
let objectPending = false;
/** True once the player has pressed Delete and is being asked to confirm it. */
let deleteArmed = false;

/** The catalogue entry a built thing came from: what it is called, and what may be done to it. */
function constructionEntry(construction: ConstructionDTO): BuildCatalogEntryDTO | undefined {
  return state.buildCatalog.find((candidate) => candidate.entryId === construction.entryId);
}

/**
 * What may be done with an object, whoever made it.
 *
 * A starter tree and a bought tree answer through the same policy shape: the source of an object
 * never decides which buttons it gets.
 */
function objectPolicyFor(construction: ConstructionDTO) {
  return objectPolicy(construction, state.worldObjects, state.buildCatalog);
}

/** The name a player reads for an object, from whichever definition family describes it. */
function objectName(construction: ConstructionDTO): string {
  const policy = objectPolicyFor(construction);
  if (policy === null) return construction.entryId;
  if (policy.label !== null) return policy.label;
  if (policy.displayNameKey !== null) {
    // The definition's words when the client has them, and a readable fallback derived from the key
    // when it does not - a starter object must never show a raw id to a player.
    return displayName(state.language, policy.displayNameKey, construction.entryId.replace(/^world\./, "").replace(/_/g, " "));
  }
  return construction.entryId;
}

/** The object's own footprint, before the player's turns are applied to it. */
function objectFootprint(construction: ConstructionDTO): { readonly widthCells: number; readonly depthCells: number } {
  const world = state.worldObjects.get(construction.entryId);
  if (world !== undefined) return world.footprint;
  const entry = constructionEntry(construction);
  return entry?.footprint ?? construction.footprint;
}

/** The model a ghost draws for an object, and how big it is. */
function objectModel(construction: ConstructionDTO): { modelId: string | null; sizeWorld: number } {
  return objectPresentation(construction, state.worldObjects, state.buildCatalog);
}

/** Every cell a construction covers, as the preview's "not an obstacle to itself" list. */
function constructionCells(construction: ConstructionDTO): readonly { readonly x: number; readonly y: number }[] {
  const startX = construction.anchorX - Math.floor((construction.footprint.widthCells - 1) / 2);
  const startY = construction.anchorY - Math.floor((construction.footprint.depthCells - 1) / 2);
  const cells: { x: number; y: number }[] = [];
  for (let y = 0; y < construction.footprint.depthCells; y += 1) {
    for (let x = 0; x < construction.footprint.widthCells; x += 1) cells.push({ x: startX + x, y: startY + y });
  }
  return cells;
}

/** Replaces one row in the client's copy of the server's list. The server's answer is the new truth. */
function replaceConstruction(next: ConstructionDTO): void {
  state.constructions = state.constructions.map((candidate) =>
    candidate.constructionId === next.constructionId ? next : candidate
  );
}

/** The row the player is editing, resolved from the server's latest list by id. */
function selectedConstruction(): ConstructionDTO | null {
  return selectedRow(state.constructions, state.selectedObjectId);
}

/**
 * Shows the player their own land while they are using it - and only then.
 *
 * The first live failure this pass fixes: the placement ghost could be moved around the island, and
 * the answer to "may I build here" was "you do not own that land yet", with nothing on screen saying
 * where the player's land was. The mark is drawn while something is in hand for placement or a move,
 * and it is taken away the moment neither is true, so normal play still shows no grid at all.
 */
function refreshOwnershipOverlay(): void {
  scene?.setOwnershipOverlay(
    ownershipOverlayFor({
      placing: state.buildSelection !== null,
      moving: moveSession !== null,
      cells: state.cellMap
    })
  );
}

/**
 * The developer's line: the owned bounds, the cell in hand, and - while carrying something - where it
 * came from.
 *
 * Behind `?debug=1` and nowhere else. It exists because the first live report of this pass was "many
 * apparently normal cells say I do not own them", and there was no way to answer it from the screen;
 * the numbers that settle it are these, and a player must never see them.
 */
function debugDiagnostic(selected: SelectedTile | null): string | null {
  if (!debugRequested()) return null;
  const bounds = ownedBounds(ownedCells(state.cellMap));
  const owned = bounds === null ? "none" : `${String(bounds.minX)},${String(bounds.minY)}..${String(bounds.maxX)},${String(bounds.maxY)} (${String(bounds.count)})`;
  const here = selected === null ? "-" : `${String(selected.x)},${String(selected.y)}`;
  const carried = moveSession === null ? "" : ` from ${String(moveSession.construction.anchorX)},${String(moveSession.construction.anchorY)}`;
  return `debug: owned ${owned}; cell ${here}${carried}; pick ${state.selectedObjectId ?? "-"}`;
}

/**
 * Reacts to the farm's list changing underneath the editor.
 *
 * A poll that replaced the rows is harmless - the selection is an id - but a row that has *gone*
 * (removed in another tab, or by this one) has to take its panel and its mark with it rather than
 * leave the player looking at a ghost.
 */
function reconcileObjectSelection(): void {
  if (state.selectedObjectId === null) return;
  if (selectedConstruction() !== null) return;
  state.selectedObjectId = null;
  moveSession = null;
  deleteArmed = false;
  scene?.setObjectSelection(null);
  scene?.setPlacementPreview(null);
  scene?.setObjectPicking(true);
  document.body.classList.remove("is-placing");
  renderObjectPanel();
}

/** The player clicked one of their own objects: remember it and offer the asset's own actions. */
function selectObject(constructionId: string): void {
  const construction = state.constructions.find((candidate) => candidate.constructionId === constructionId);
  if (construction === undefined) return;
  // Picking a cell and picking an object are the same kind of act: only one of them is current.
  state.buildSelection = null;
  placementTurns = 0;
  scene?.setPlacementPreview(null);
  scene?.setOwnershipOverlay(null);
  renderPlacementHud();
  state.selectedObjectId = construction.constructionId;
  deleteArmed = false;
  scene?.setObjectSelection(construction.constructionId);
  renderObjectPanel();
  renderField();
  // The panel is the answer, and this is the sentence that says where it came from: a player who
  // clicked something and saw nothing would otherwise have no way to tell selection from a dead click.
  const entry = constructionEntry(construction);
  setStatus((translate) =>
    translate("object.selected", { item: entry === undefined ? construction.entryId : buildEntryName(entry) })
  );
}

/** Drops the object selection: no mark, no panel, no armed delete. */
function clearObjectSelection(): void {
  if (state.selectedObjectId === null && moveSession === null) return;
  state.selectedObjectId = null;
  moveSession = null;
  deleteArmed = false;
  scene?.setObjectSelection(null);
  scene?.setPlacementPreview(null);
  scene?.setOwnershipOverlay(null);
  scene?.setObjectPicking(true);
  document.body.classList.remove("is-placing");
  renderObjectPanel();
}

/**
 * Picks the selected object up as a ghost.
 *
 * The original keeps its row, its cells and its rendering the whole time: the player is choosing a
 * destination, not deleting and re-buying. Nothing is sent until the move is confirmed, so cancelling
 * costs nothing at all and a failed move leaves the object exactly where it was.
 */
function beginMove(): void {
  const construction = selectedConstruction();
  if (construction === null || moveSession !== null) return;
  const policy = objectPolicyFor(construction);
  if (policy === null || !policy.movable) {
    setStatus(message("object.notMovable"), true);
    return;
  }
  moveSession = { kind: "MOVE", construction, turns: construction.rotation };
  deleteArmed = false;
  // Moving an object is estate work: the same reason placing is. The brief's rule, and the reason the
  // ghost, the ownership wash and the destination cells all belong to the high view.
  setCameraMode("ESTATE");
  // The ghost is drawn where the object already is, so the first thing the player sees is "this one".
  selectCell(construction.anchorX, construction.anchorY);
  scene?.setObjectPicking(false);
  // Carrying something is exactly the moment the player has to know where their land ends.
  refreshOwnershipOverlay();
  document.body.classList.add("is-placing");
  scene?.focusOnCell({ x: construction.anchorX, y: construction.anchorY });
  updateMovePreview();
  renderObjectPanel();
  setStatus(message("object.moveHint"));
}

/**
 * Picks a *stored* object up as a ghost, ready to put back on the island.
 *
 * The same gesture as a move, from storage instead of from a cell: nothing is charged, the row keeps
 * its identity, and a failed placement leaves it exactly where it was - in storage.
 */
function beginRestore(construction: ConstructionDTO): void {
  if (moveSession !== null) return;
  const policy = objectPolicyFor(construction);
  if (policy === null || !policy.storable) {
    setStatus(message("object.notStorable"), true);
    return;
  }
  state.selectedObjectId = construction.constructionId;
  deleteArmed = false;
  moveSession = { kind: "RESTORE", construction, turns: construction.rotation };
  setCameraMode("ESTATE");
  setActivePanel(NO_PANEL);
  const focus = state.selected ?? worldToCell({ worldX: scene?.cameraFrame().targetX ?? 0, worldZ: scene?.cameraFrame().targetZ ?? 0 });
  selectCell(focus.x, focus.y);
  scene?.setObjectPicking(false);
  scene?.setObjectSelection(construction.constructionId);
  refreshOwnershipOverlay();
  document.body.classList.add("is-placing");
  updateMovePreview();
  renderObjectPanel();
  setStatus(message("object.restoreHint"));
}

/** Abandons the move: the ghost goes, the object was never touched. */
function cancelMove(): void {
  if (moveSession === null) return;
  moveSession = null;
  scene?.setPlacementPreview(null);
  scene?.setObjectPicking(true);
  refreshOwnershipOverlay();
  document.body.classList.remove("is-placing");
  renderObjectPanel();
  setStatus(message("object.moveCancelled"));
}

/** Draws the ghost at the prospective destination, valid or not, exactly as placement does. */
function updateMovePreview(): void {
  const session = moveSession;
  if (session === null) return;
  const model = objectModel(session.construction);
  const footprint = rotatedFootprint(objectFootprint(session.construction), session.turns);
  scene?.setPlacementPreview({
    modelId: model.modelId !== null && !isProceduralVisual(model.modelId) ? model.modelId : null,
    // A world object names a model, never a road tier: the tier belongs to the road catalogue alone.
    roadTierId: constructionEntry(session.construction)?.category === "ROAD" ? constructionEntry(session.construction)?.tier ?? null : null,
    widthCells: footprint.widthCells,
    depthCells: footprint.depthCells,
    valid: moveRejectionFor(session) === null,
    rotationY: quarterTurnYaw(session.turns)
  });
}

/** Why the object cannot go where the selection currently is, or null when it can. */
function moveRejectionFor(session: { readonly construction: ConstructionDTO; readonly turns: 0 | 1 | 2 | 3 }): MessageKey | null {
  if (scene === null) return null;
  const policy = objectPolicyFor(session.construction);
  if (policy === null) return null;
  const footprint = rotatedFootprint(objectFootprint(session.construction), session.turns);
  const rejection = previewRejection(state.cellMap, state.selected, {
    allowedTerrain: state.worldObjects.get(session.construction.entryId)?.allowedTerrain ?? constructionEntry(session.construction)?.allowedTerrain ?? ["LAND"],
    footprint,
    isRoad: constructionEntry(session.construction)?.category === "ROAD",
    requiresOwnership: true,
    // The object is not an obstacle to itself; everything else on the island still is.
    ignore: constructionCells(session.construction)
  });
  return rejection === null ? null : (rejectionMessageKey(rejection) as MessageKey);
}

/** Turns the ghost. Only the preview is rebuilt: no world rebuild, no command. */
function rotateMovePreview(step: number): void {
  const session = moveSession;
  if (session === null) return;
  const policy = objectPolicyFor(session.construction);
  if (policy === null || !policy.rotatable) {
    setStatus(message("build.notRotatable"));
    return;
  }
  moveSession = { ...session, turns: normaliseQuarterTurns(session.turns + step) };
  updateMovePreview();
  renderObjectPanel();
}

/** Sends the move. The server decides whether the ground is free and writes one atomic row. */
async function confirmMove(): Promise<void> {
  const session = moveSession;
  if (session === null || objectPending || state.farmId === null || state.selected === null) return;
  const policy = objectPolicyFor(session.construction);
  if (policy === null) return;
  const rejection = moveRejectionFor(session);
  if (rejection !== null) {
    setStatus((translate) => translate("build.cannotPlace", { reason: translate(rejection) }), true);
    return;
  }
  objectPending = true;
  renderObjectPanel();
  try {
    // Carrying something in from storage and carrying something across the island are the same
    // gesture with one different command; both send the cell, the turn and the version they read.
    const body = {
      requestId: newRequestId(session.kind === "RESTORE" ? "restore" : "move"),
      anchorX: state.selected.x,
      anchorY: state.selected.y,
      rotation: session.turns,
      // The version the client is looking at: the server refuses an edit built on a stale copy.
      expectedVersion: session.construction.version
    };
    const outcome =
      session.kind === "RESTORE"
        ? await api().restoreConstruction(state.farmId, session.construction.constructionId, body)
        : await api().moveConstruction(state.farmId, session.construction.constructionId, body);
    replaceConstruction(outcome.construction);
    moveSession = null;
    scene?.setPlacementPreview(null);
    scene?.setObjectPicking(true);
    document.body.classList.remove("is-placing");
    scene?.setObjectSelection(outcome.construction.constructionId);
    refreshScene();
    setStatus((translate) =>
      translate(session.kind === "RESTORE" ? "object.restored" : "object.moved", {
        item: objectName(session.construction)
      })
    );
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    objectPending = false;
    renderObjectPanel();
  }
}

/**
 * Turns the selected object a quarter turn clockwise, in place.
 *
 * A turn is not a move: the anchor does not change, so the server re-checks only the footprint of the
 * new orientation. One activation, one quarter turn - not a separate preview mode, because the shape
 * of a barn is easy to predict and the server refuses an overlap either way.
 */
/**
 * Puts the selected object into storage.
 *
 * The safe half of "get this out of the way": the object leaves the island, keeps its identity and
 * its cost basis, and can be placed again from the Build panel's storage list without being bought
 * again. Nothing is charged and nothing is refunded, because nothing changed hands.
 */
async function storeSelectedObject(): Promise<void> {
  const construction = selectedConstruction();
  if (construction === null || objectPending || state.farmId === null || moveSession !== null) return;
  const policy = objectPolicyFor(construction);
  if (policy === null || !policy.storable) {
    setStatus(message("object.notStorable"), true);
    return;
  }
  objectPending = true;
  deleteArmed = false;
  renderObjectPanel();
  try {
    const stored = await api().storeConstruction(state.farmId, construction.constructionId, {
      requestId: newRequestId("store"),
      expectedVersion: construction.version
    });
    replaceConstruction(stored.construction);
    state.selectedObjectId = null;
    scene?.setObjectSelection(null);
    refreshScene();
    if (panels.active === "build") renderBuildPanel();
    setStatus((translate) => translate("object.stored", { item: objectName(construction) }));
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    objectPending = false;
    renderObjectPanel();
  }
}

/**
 * What the player has in storage, in the Build panel.
 *
 * A short list of stacks rather than a second inventory screen: the point of storage is that an
 * object a player already owns can be placed again, and the smallest honest UI for that is a row per
 * definition with how many are held and one button to put the newest one back on the island.
 */
function renderBuildStorage(): void {
  const node = element<HTMLElement>("build-storage");
  const stacks = storageStacks(state.constructions);
  if (stacks.length === 0) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }
  node.hidden = false;
  node.replaceChildren();
  node.appendChild(make("h3", "build-storage-title", t("storage.title")));
  const list = make("ul", "build-storage-list");
  for (const stack of stacks) {
    const item = make("li", "build-storage-item");
    item.appendChild(make("span", "build-storage-name", objectName(stack.newest)));
    item.appendChild(make("span", "build-storage-count", `×${String(stack.count)}`));
    const place = make("button", "object-action");
    place.type = "button";
    place.textContent = t("storage.place");
    place.disabled = objectPending || moveSession !== null;
    place.addEventListener("click", () => {
      beginRestore(stack.newest);
    });
    item.appendChild(place);
    list.appendChild(item);
  }
  node.appendChild(list);
}

async function rotateSelectedObject(): Promise<void> {
  const construction = selectedConstruction();
  if (construction === null || objectPending || state.farmId === null || moveSession !== null) return;
  const entry = constructionEntry(construction);
  if (entry === undefined || !entry.rotatable) {
    setStatus(message("build.notRotatable"), true);
    return;
  }
  objectPending = true;
  deleteArmed = false;
  renderObjectPanel();
  try {
    const turned = await api().rotateConstruction(state.farmId, construction.constructionId, {
      requestId: newRequestId("turn"),
      rotation: normaliseQuarterTurns(construction.rotation + 1),
      expectedVersion: construction.version
    });
    replaceConstruction(turned.construction);
    scene?.setObjectSelection(turned.construction.constructionId);
    refreshScene();
    setStatus((translate) => translate("object.rotated", { item: buildEntryName(entry) }));
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    objectPending = false;
    renderObjectPanel();
  }
}

/** Takes the selected object down, once the player has confirmed it and the server has said so. */
async function confirmDelete(): Promise<void> {
  const construction = selectedConstruction();
  if (construction === null || objectPending || !deleteArmed || state.farmId === null) return;
  const entry = constructionEntry(construction);
  if (entry === undefined) return;
  objectPending = true;
  renderObjectPanel();
  try {
    const removed = await api().removeConstruction(state.farmId, construction.constructionId, {
      requestId: newRequestId("remove"),
      expectedVersion: construction.version
    });
    state.constructions = state.constructions.filter(
      (candidate) => candidate.constructionId !== removed.constructionId
    );
    state.selectedObjectId = null;
    deleteArmed = false;
    scene?.setObjectSelection(null);
    refreshScene();
    await refreshAccount();
    setStatus(
      removed.refundAmount > 0
        ? (translate) => translate("object.removedRefund", { item: buildEntryName(entry), gold: removed.refundAmount.toLocaleString(state.language) })
        : (translate) => translate("object.removed", { item: buildEntryName(entry) })
    );
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    objectPending = false;
    renderObjectPanel();
  }
}

/**
 * The compact panel for the selected object.
 *
 * Only the actions the asset allows are offered, and Delete is two presses rather than one: the first
 * asks, the second does it. A refund is described as a *range of what the server will decide* only
 * after the fact - the panel says what the asset's policy returns, and the status line reports what
 * actually came back.
 */
function renderObjectPanel(): void {
  const node = element<HTMLElement>("object-panel");
  const construction = selectedConstruction();
  if (construction === null) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }
  // The panel is shown for *any* selected row, even one the client has no definition for: a player
  // who clicked their own barn and saw nothing would have no way to tell a missing definition from a
  // dead click. The actions are what the definition decides, and no definition means no actions yet.
  const policy = objectPolicyFor(construction);
  const actions = {
    move: policy?.movable ?? false,
    rotate: policy?.rotatable ?? false,
    store: policy?.storable ?? false,
    remove: policy?.removable ?? false
  };
  const name = objectName(construction);
  node.hidden = false;
  node.replaceChildren();

  const copy = make("div", "placement-copy");
  copy.appendChild(make("strong", "placement-name", name));
  const meta = make("span", "placement-meta");
  meta.appendChild(
    make(
      "span",
      undefined,
      t("build.inspector.cells", {
        width: construction.footprint.widthCells,
        depth: construction.footprint.depthCells
      })
    )
  );
  if (policy !== null) {
    meta.appendChild(make("span", "placement-sep", "·"));
    meta.appendChild(make("span", undefined, t("object.info.level", { level: policy.requiredLevel })));
  }
  copy.appendChild(meta);
  node.appendChild(copy);

  if (moveSession !== null) {
    const line = make("p", moveRejectionFor(moveSession) === null ? "placement-state is-valid" : "placement-state is-invalid");
    const where = state.selected === null ? "" : ` ${at(state.selected)}`;
    line.textContent =
      (moveRejectionFor(moveSession) === null
        ? t("object.moveValid")
        : t("build.cannotPlace", { reason: t(moveRejectionFor(moveSession) as MessageKey) })) + where;
    node.appendChild(line);
    const keys = make("ul", "placement-keys");
    const key = (keysText: string, label: string): HTMLLIElement => {
      const item = make("li");
      item.appendChild(make("kbd", undefined, keysText));
      item.appendChild(make("span", undefined, label));
      return item;
    };
    if (actions.rotate) keys.appendChild(key("Q / E", t("build.hud.rotate")));
    keys.appendChild(key(t("build.hud.clickKey"), t("object.move.pick")));
    keys.appendChild(key("Enter", t("object.move.confirm")));
    keys.appendChild(key("Esc", t("build.hud.cancel")));
    node.appendChild(keys);
    // The same escape hatch the placement HUD has, for the same reason: a move or a restore has to be
    // abandonable with one thumb. It cancels through the existing path, which changes nothing at all -
    // the object is still exactly where it was.
    const cancel = make("button", "object-cancel");
    cancel.type = "button";
    cancel.textContent = t("object.move.cancel");
    cancel.addEventListener("click", () => {
      cancelMove();
    });
    node.appendChild(cancel);
  }

  if (deleteArmed) {
    const refund = policy === null ? 0 : removalRefundPreview(construction, policy);
    const line = make("p", "placement-state is-invalid");
    line.textContent = t("object.delete.confirm", { item: name });
    node.appendChild(line);
    const note = make("p", "placement-note");
    // Said either way. "Nothing comes back" is a policy, not a missing line: a player deciding
    // whether to take a tree down should be told what they get, including when the answer is zero.
    note.textContent =
      refund > 0
        ? t("object.delete.refund", { gold: refund.toLocaleString(state.language) })
        : t("object.delete.noRefund");
    node.appendChild(note);
  }

  const actionRow = make("div", "object-actions");
  const action = (label: string, className: string, handler: () => void, disabled = false): HTMLButtonElement => {
    const button = make("button", className);
    button.type = "button";
    button.textContent = label;
    button.disabled = disabled || objectPending;
    button.addEventListener("click", handler);
    return button;
  };
  // Confirming a delete replaces the action row rather than joining it: the question is "delete
  // this?", and offering Move and Rotate underneath it would be three answers to one question.
  if (deleteArmed) {
    actionRow.appendChild(action(t("object.delete.yes"), "object-action is-danger", () => void confirmDelete()));
    actionRow.appendChild(
      action(t("object.delete.no"), "object-action", () => {
        deleteArmed = false;
        renderObjectPanel();
      })
    );
  } else if (moveSession === null) {
    if (actions.move) actionRow.appendChild(action(t("object.action.move"), "object-action", beginMove));
    if (actions.rotate) {
      actionRow.appendChild(action(t("object.action.rotate"), "object-action", () => void rotateSelectedObject()));
    }
    if (actions.store) {
      // Store sits between Rotate and Delete on purpose: it is the *safe* remodeling action, and the
      // one a player should reach for when they are not sure they want the thing gone for good.
      actionRow.appendChild(action(t("object.action.store"), "object-action", () => void storeSelectedObject()));
    }
    if (actions.remove) {
      actionRow.appendChild(
        action(
          t("object.action.delete"),
          "object-action is-danger",
          () => {
            deleteArmed = true;
            renderObjectPanel();
          },
          objectPending
        )
      );
    }
    actionRow.appendChild(action(t("object.action.close"), "object-action", clearObjectSelection));
  } else {
    actionRow.appendChild(action(t("object.move.confirm"), "placement-confirm", () => void confirmMove()));
    actionRow.appendChild(action(t("object.move.cancel"), "object-action", cancelMove));
  }
  node.appendChild(actionRow);

  // While something is being carried in from storage, say so and how much of that stack is left.
  if (moveSession?.kind === "RESTORE") {
    const note = make("p", "placement-note");
    note.textContent = t("object.restoreNote", { item: name });
    node.appendChild(note);
  }

  const diagnostic = debugDiagnostic(state.selected);
  if (diagnostic !== null) node.appendChild(make("p", "placement-note", diagnostic));
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
  renderBootRetry();
}

function render(): void {
  renderChrome();
  renderHudMenu();
  renderCameraMode();
  // The interaction surfaces follow the language, so they are re-decided with everything else; their
  // own signature gate keeps a rewrite from costing anything when nothing changed.
  renderInteraction();
  renderPanels();
  renderFarm();
  renderWallet();
  renderProgression();
  renderPlots();
  renderPlantPicker();
  renderField();
  renderSelection();
  renderGo();
  renderInventory();
  renderShop();
  // The shop's own render is driven by the panel: see `setActivePanel`.
  if (panels.active === "build") renderBuildPanel();
  renderObjectPanel();
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
  // Building is precise, cell-based work and belongs to the estate view: opening the Build panel
  // brings the camera back up rather than asking a player to place a barn from behind their own
  // shoulder (the brief's rule, and the reason the shop's ghost and ownership wash make sense there).
  if (panels.active === "build") setCameraMode("ESTATE");
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
  const [inventory, wallet, shop, progression, cropDefinitions, treeDefinitions, buildCatalog, worldObjects] = await Promise.all([
    client.getInventory(),
    client.getWallet(),
    client.getShop(),
    client.getProgression(),
    client.getCropDefinitions(),
    client.getTreeDefinitions(),
    client.getBuildCatalog(),
    client.getWorldObjects()
  ]);
  state.inventory = inventory.items;
  state.wallet = wallet.wallets;
  state.shop = shop.entries;
  state.progression = progression.progression;
  state.cropDefinitions = cropDefinitions.definitions;
  state.treeDefinitions = treeDefinitions.definitions;
  state.buildCatalog = buildCatalog.entries;
  state.worldObjects = indexWorldObjects(worldObjects.objects);
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
    elapsedWalk: current.elapsedWalk,
    // The character's clip is chosen from this, and from nothing else: the runtime has already
    // applied the pace, so the presentation layer only has to know which of the three states to show.
    running: current.movementState === "WALKING" && (movement?.isRunning() ?? false)
  };
}

const playerRuntime = createPlayerRuntime({
  spawn: SPAWN_WORLD,
  feetY: PLAYER_FEET_Y,
  /**
   * The movement the character should make this frame.
   *
   * The keys are read once, and which *frame* they mean depends on the camera: in the estate view the
   * character walks the world's own axes, and in character view the same keys walk relative to where
   * the camera is looking - which is what makes W mean "away from the camera" rather than "south".
   */
  readInput: () => {
    const held = movement?.vector() ?? NEUTRAL_INPUT;
    if (state.cameraMode !== "CHARACTER") return held;
    // Two adapters, one rule (see `composeCharacterInput`): a deflected joystick wins, otherwise the
    // keyboard does, and exactly one of them is ever used - so holding both cannot double the speed.
    // Only a finger gets to steer the stick: on a device without one the intent is always neutral.
    const touch: CharacterMoveIntent = capability.coarse && joystick !== null ? joystick.intent() : NO_CHARACTER_INTENT;
    const composed = composeCharacterInput(characterIntentFromInput(held), touch);
    return cameraRelativeMovement(composed.intent, scene?.cameraBearing() ?? 0);
  },
  // Running is the character view's: in the estate view the character is a marker being moved between
  // places, and a sprint there would be a silent behaviour change to shipped movement.
  readRun: () =>
    state.cameraMode === "CHARACTER" && ((movement?.isRunning() ?? false) || runHeld),
  onPose: (pose) => {
    characterPose = pose === null ? null : toScenePlayer(pose);
    scene?.setPlayer(characterPose);
    // The character moved, so what is in reach may have changed. This is the pose stream, which only
    // ticks while they are moving, so a standing character costs no scans at all.
    refreshInteractionCandidate();
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

/**
 * Switches the way the island is looked at.
 *
 * One world, two viewpoints: nothing is reloaded, no state is duplicated, and the character stays
 * exactly where they were standing. What does change is who is driving - the camera, and the hands on
 * the movement keys - so the switch also settles the two things that could be left running: a walk
 * queued in the estate view, and a key held down across the change.
 */
function setCameraMode(mode: CameraMode, focus?: EstateCameraFocus): void {
  if (state.cameraMode === mode && focus === undefined) return;
  const changed = state.cameraMode !== mode;
  state.cameraMode = mode;
  // A key held across the switch must not keep driving the character: the same W that walked them in
  // the character view would otherwise carry straight on in the estate view the instant the camera
  // moved. Clearing the held keys is what "no stuck W key" means in practice.
  movement?.clear();
  if (mode === "CHARACTER") {
    // The player's own hand takes over: a walk queued with "Go" is cancelled rather than left to
    // fight the movement keys, which is the behaviour the brief asks for.
    playerRuntime.clearDestination();
    showCharacterHint();
  }
  if (changed) {
    // A different view is a different screen: the surface returns to its strip rather than leaving a
    // sheet open over a camera it is no longer describing, and the overflow menu closes with it.
    dock = collapseDock();
    hudMenuOpen = false;
  }
  scene?.setCameraMode(mode, focus);
  // Leaving character view hides the interaction surfaces, and entering it decides what is in reach
  // from wherever the character is standing. A stale prompt must never survive a mode switch.
  refreshInteractionCandidate();
  // The touch controls exist only in character view: leaving it clears the stick and the Run button
  // before they can be forgotten about, which is the "no stuck movement across a mode switch" rule.
  syncTouchControls();
  render();
}

/**
 * Puts the estate camera back on the player and resumes following them.
 *
 * The target in the top bar and the R key are the same action: one camera, one rule, two ways to ask
 * for it. Nothing is sent anywhere - the camera is client-local, like the character.
 */
function recenterCamera(): void {
  estateFollow = "FOLLOW";
  scene?.recenterEstateCamera();
  renderCameraMode();
  setStatus(message("camera.following"));
}

/**
 * Performs a precision action, in the view that can actually do it.
 *
 * Planting a seed and placing a barn are cell work, and cell work is the estate camera's: from
 * character view the game changes viewpoint and takes the camera to the cell the player was working
 * on, rather than answering "not available" and leaving them to find the switch. Nothing is sent here
 * and nothing is disabled - the action itself stays where it always was.
 */
function beginPrecisionAction(kind: PrecisionActionKind): void {
  setCameraMode("ESTATE", precisionFocusFor(kind, { selected: state.selected, anchor: null }));
  if (kind === "PLANT") {
    // The compact surface opens on the control the player just asked for, so "Plant" does not land on
    // a strip whose crop chooser is one more tap away.
    dock = { expanded: true };
    renderDock();
    setStatus(message("status.precisionPlant"));
    return;
  }
  setStatus(message("status.precisionBuild"));
}

/** Estate to character and back, for the F key and the HUD control. */
function toggleCameraMode(): void {
  setCameraMode(otherCameraMode(state.cameraMode));
}

/**
 * The circles the player's own objects put in the way.
 *
 * Derived from the footprint the server reports, in world metres, and only for objects *standing* on
 * the island: a stored barn blocks nothing, and a moved one blocks where it now is. The refined
 * per-definition collision radius a later pass may add is a refinement of this, not a replacement for
 * it - what matters is that the circle follows the row.
 */
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

/**
 * What kind of device this page is on, from the browser's own capability signals.
 *
 * Capability rather than user-agent sniffing, and deliberately *two* answers: whether the primary
 * pointer is a finger (which decides whether the touch controls are offered at all) and whether the
 * viewport is small (which the stylesheet decides with the same breakpoints). A touchscreen laptop
 * keeps its mouse and keyboard controls, and a narrow desktop window gets the compact layout without
 * being handed a joystick it has no use for.
 */
function readDeviceCapability(): DeviceCapability {
  const matches = (query: string): boolean => {
    try {
      return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
    } catch {
      return false;
    }
  };
  return deviceCapability({
    coarsePointer: matches("(pointer: coarse)"),
    hoverNone: matches("(hover: none)"),
    maxTouchPoints: typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight
  });
}

/** Re-read on every resize and orientation change: a device can gain or lose a keyboard. */
let capability: DeviceCapability = readDeviceCapability();

/**
 * The touch controls, created once and shown or hidden as the mode and the device require.
 *
 * They exist for the life of the page rather than being built and torn down per mode: the brief's
 * long-session check is about not accumulating listeners, and the cheapest way to pass it is to add
 * each listener exactly once.
 */
let joystick: JoystickControl | null = null;
let runControl: HoldControl | null = null;
/** Whether the Run button is currently held. Touch state, never gameplay state. */
let runHeld = false;

/**
 * Shows the touch controls only where they belong, and clears them when they go away.
 *
 * Two independent conditions, which is the point: the *input* has to be a finger (a touchscreen
 * laptop keeps its keyboard and mouse), and the game has to be in character view (estate view is for
 * selecting and building, where a movement stick would be in the way). Leaving character view clears
 * both controls, so a finger lifted during the switch cannot leave the character walking.
 */
function syncTouchControls(): void {
  const visible = showTouchControls(capability, state.cameraMode);
  const controls = element<HTMLElement>("touch-controls");
  if (controls.hidden === visible) controls.hidden = !visible;
  document.body.classList.toggle("is-character-mode", state.cameraMode === "CHARACTER");
  if (visible) return;
  joystick?.clear();
  runControl?.clear();
  runHeld = false;
  element<HTMLButtonElement>("run-button").setAttribute("aria-pressed", "false");
}

/**
 * A tap on the ground.
 *
 * Estate view selects whatever the player points at, exactly as it always has. Character view is
 * mostly *pointing at the world*, so a tap there only opens the context strip when the cell actually
 * offers something - the player's own soil to plant, a crop or a tree to inspect. Anywhere else the
 * tap clears the selection and the joystick keeps the screen to itself.
 */
function onGroundTap(cell: SelectedTile): void {
  const same = state.selected !== null && state.selected.x === cell.x && state.selected.y === cell.y;
  if (same) return;
  if (!groundTapOpensContext({ mode: state.cameraMode, hasContextAction: cellOffersContext(cell) })) {
    clearSelection();
    return;
  }
  selectCell(cell.x, cell.y);
}

/** Whether this cell has anything a player could do or inspect on it. */
function cellOffersContext(cell: SelectedTile): boolean {
  return availableActions(selectionCell(cell), selectionAt(cell)).length > 0;
}

/** Drops the selection and everything that hangs off it. */
function clearSelection(): void {
  if (state.selected === null) return;
  state.selected = null;
  dock = collapseDock();
  scene?.setSelection(null);
  renderField();
  renderSelection();
  renderGo();
  refreshScene();
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
  // While an object is being moved, the same click is the destination: the ghost follows the
  // selection, the panel re-reads whether this cell accepts the object, and nothing is sent until the
  // player confirms it.
  if (moveSession !== null) {
    updateMovePreview();
    renderObjectPanel();
  }
  // Clicking the ground is also how a player says "walk there". The destination is offered only for
  // a cell a character can actually stand on, and it is never an *action*: planting and harvesting
  // stay on the dock's own buttons, so a mis-click cannot change the farm.
  //
  // While an object is being carried, the same clicks are *its* destination and nothing else: the
  // player is choosing where a barn goes, and setting off on foot to every cell they hover over
  // would be a second, unwanted answer to the same click.
  if (moveSession === null) {
    const destination = walkDestinationFor(state.selected);
    if (destination !== null) playerRuntime.setDestination(destination);
  }
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
  // Only what is *standing* on the island: a stored object is the player's, and it is not there. The
  // rows themselves are one list - storage is a state, not a second inventory - so this filter is the
  // whole of "storage is a place objects are not drawn".
  scene.setConstructions(activeObjects(state.constructions).map(toSceneConstruction));
  // The interaction registry is rebuilt here, before the refresh gate below: a stored or removed
  // object has to leave it immediately, whatever else did or did not change. It is a few hundred map
  // inserts on a poll that already rebuilt the cell map, and it is never rebuilt per frame.
  rebuildInteractionIndex();
  refreshInteractionCandidate();
  const signature = farmPresentationSignature(state);
  if (signature === scenePushSignature) return;
  const input = sceneInput();
  // The shop's preview asks the same map the renderer draws from, so the two cannot disagree about
  // what ground is, what it can carry, or what stands on it.
  state.cellMap = input.cells;
  // The ownership mark is drawn from the map, so a farm refresh that changes the land also refreshes
  // the mark. `setOwnershipOverlay` compares what it is given and does nothing when it has not moved.
  refreshOwnershipOverlay();
  // And a row that the refresh no longer reports takes its panel and its mark with it.
  reconcileObjectSelection();
  // Movement is blocked by the same rows the renderer draws, so a crop that grows under the
  // character starts blocking the next step without a second refresh path. Rebuilding the collision
  // world never moves the character: it only changes where the next step may go.
  playerRuntime.setTiles(input.tiles);
  // The island's own objects are solid too: a tree the player can select is a tree the character
  // walks around, and because the circles come from the rows, moving or storing one takes it away.
  const objectCircles = objectObstacles(state.constructions, worldFrame(), state.worldObjects);
  playerRuntime.setObstacles(objectCircles);
  // The island's own surface, so the character stands on the hills instead of the flat plane the
  // grid is laid out on - and so a cliff is something they cannot walk up.
  const terrain = {
    heightAt: (worldX: number, worldZ: number) =>
      GROUND_SURFACE_Y + terrainHeightAt(worldX, worldZ, input.world.terrain),
    maxSlope: PLAYER_MAX_SLOPE,
    maxStepWorld: PLAYER_MAX_STEP_WORLD
  };
  playerRuntime.setTerrain(terrain);
  // The selection asks the same world whether a cell can be walked to, so a destination can never be
  // offered for ground the character would refuse.
  selectionCollision = createPlayerCollisionWorld(input.tiles, objectCircles, terrain);
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

/*
 * Character interaction (V14.1).
 *
 * Character view is the gameplay view: walk up to something useful and use it. Everything below rests
 * on three rules, and they are the reason this is a module rather than a click handler:
 *
 *  * **Discovery does not mutate.** The registry describes what is on the island and the candidate is
 *    "what is in reach"; neither of them sends anything anywhere.
 *  * **One calculation.** The keyboard prompt and the touch button render the same candidate, so the
 *    two input methods cannot disagree about what the player would be acting on.
 *  * **Location is not authority.** The gameplay context says where the player is; every command still
 *    travels with the farm it means and is authorized server-side from the authenticated actor.
 */

/** Where the player is, and who they are: two facts the architecture keeps apart. */
function gameplayContext(): GameplayContext | null {
  const farmId = state.farmId;
  return farmId === null ? null : homeIslandContext(state.playerId, farmId);
}

/** Rebuilds the island's interactable registry from the read models. Data change only. */
function rebuildInteractionIndex(): void {
  interactionIndex = buildInteractionIndex({
    crops: state.crops,
    trees: state.trees,
    constructions: state.constructions,
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions,
    worldObjects: state.worldObjects,
    buildCatalog: state.buildCatalog,
    nowMs: Date.now()
  });
}

/**
 * Re-decides what is in reach, from where the character is standing right now.
 *
 * Cheap by construction: the index is a map of cells, so this walks the neighbourhood rather than the
 * island, and it runs on the pose stream - which only ticks while the character moves - rather than
 * once per frame.
 */
function refreshInteractionCandidate(): void {
  const pose = characterPose;
  // The context is the gate: with no farm there is no zone to be present in, and with no place there
  // is nothing to interact with. It is asked rather than assumed, which is the point of having one.
  const context = gameplayContext();
  interactionCandidate =
    pose === null || context === null || state.cameraMode !== "CHARACTER"
      ? null
      : selectInteractionCandidate(interactionIndex, {
          worldX: pose.worldX,
          worldZ: pose.worldZ,
          facingYaw: pose.facingYaw
        });
  // The mark follows the same candidate the prompt does: one ring under the thing E would act on, so a
  // field of ripe crops does not leave the player guessing which one is meant.
  scene?.setInteractionTarget(
    interactionCandidate === null
      ? null
      : { x: interactionCandidate.tileX, y: interactionCandidate.tileY }
  );
  renderInteraction();
}

/**
 * Draws the two interaction surfaces from the one candidate.
 *
 * The keyboard prompt belongs to a keyboard and the button inside the touch controls belongs to a
 * finger, so exactly one of them is visible on any device - but both carry the same action word,
 * because they are the same decision. The write is gated on a signature, so a walking character does
 * not repaint the HUD sixty times a second.
 */
function renderInteraction(): void {
  const candidate = interactionCandidate;
  const signature =
    candidate === null
      ? ""
      : `${String(capability.coarse)}|${state.language}|${candidate.key}|${candidate.action}|${String(candidate.version)}|${String(candidate.readyInSeconds ?? "")}`;
  if (signature === interactionSignature) return;
  interactionSignature = signature;

  const prompt = element<HTMLElement>("interaction-prompt");
  const button = element<HTMLButtonElement>("interact-button");
  const shows = candidate !== null;
  prompt.hidden = !(shows && !capability.coarse);
  button.hidden = !shows;
  if (candidate === null) return;

  const text = interactionPromptFor(candidate);
  const target = displayName(state.language, text.nameKey ?? "", text.nameFallback);
  const action = t(text.actionKey);
  element<HTMLElement>("interaction-action").textContent = action;
  element<HTMLElement>("interaction-target").textContent =
    candidate.readyInSeconds === null
      ? target
      : `${target} · ${t("interaction.readyIn", { time: formatRemainingGrowth(candidate.readyInSeconds, t) })}`;

  button.textContent = action;
  const label = t("interaction.button", { action, target });
  button.setAttribute("aria-label", label);
  button.title = label;
}

/**
 * Activates the interaction the prompt is showing.
 *
 * The prompt may be a moment old, so this asks discovery again for where the player is *now* and
 * refuses a candidate the world has moved past rather than acting on a stale one. The server decides
 * actual legality either way - range, ownership, maturity, idempotency - so nothing here grants
 * anything.
 */
async function runInteraction(): Promise<void> {
  // One interaction at a time. A second press while the first command is still in flight would send a
  // second harvest for a crop the server is already settling - the server refuses it, and the player
  // sees a pointless error. The gesture and the prompt stay responsive either way.
  if (state.cameraMode !== "CHARACTER" || interactionPending) return;
  interactionPending = true;
  try {
    await activateInteraction();
  } finally {
    interactionPending = false;
  }
}

async function activateInteraction(): Promise<void> {
  const selected = interactionCandidate;
  const pose = characterPose;
  const fresh =
    pose === null
      ? null
      : selectInteractionCandidate(interactionIndex, {
          worldX: pose.worldX,
          worldZ: pose.worldZ,
          facingYaw: pose.facingYaw
        });
  interactionCandidate = fresh;
  renderInteraction();

  const decision = interactionActivation(selected, fresh);
  switch (decision.kind) {
    case "STALE":
      setStatus(message("interaction.tooFar"), true);
      return;
    case "INSPECT":
      inspectTarget(decision.target);
      return;
    case "HARVEST_CROP":
      // The bow begins with the press, not with the answer: the request is already on its way, so
      // nothing in the game waits for an animation event - and a failure never pays a reward.
      scene?.playHarvestGesture();
      await harvestCrop(decision.cropInstanceId, decision.expectedCropVersion);
      return;
    case "HARVEST_TREE":
      scene?.playHarvestGesture();
      await harvestTree(decision.treeInstanceId, decision.expectedTreeVersion);
      return;
  }
}

/**
 * Looking at something: the same selection the rest of the page uses, so what the player reads comes
 * from the authoritative rows rather than a second description written for this pass.
 */
function inspectTarget(target: InteractionCandidate): void {
  if (target.kind === "WORLD_OBJECT") selectObject(target.targetId);
  else selectCell(target.tileX, target.tileY);
}

/**
 * The number a harvest paid, rising from the crop that paid it.
 *
 * The quantity is the *server's* own `quantityAdded` - never a client estimate - and the picture is the
 * item's thumbnail from the same shared cache every other surface uses. One element is reused, and the
 * animation is CSS: this is feedback, not a second system.
 */
function showRewardPop(
  itemDefinitionId: string,
  quantity: number,
  tile: { readonly x: number; readonly y: number } | null
): void {
  const node = element<HTMLElement>("reward-pop");
  if (tile === null || scene === null) {
    node.hidden = true;
    return;
  }
  const at = scene.projectCellToScreen(tile);
  if (!at.visible) {
    // Somewhere behind the camera: the status line still says what happened, so nothing is lost.
    node.hidden = true;
    return;
  }
  const image = document.createElement("img");
  image.alt = "";
  const visual = itemVisualFor(itemDefinitionId, {
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions
  });
  itemThumbnails.apply(visual.request, image, (result) => {
    // No picture for this item: the words carry the whole message rather than a broken image.
    if (result.dataUrl === null) image.remove();
  });
  const label = document.createElement("span");
  label.textContent = t("interaction.reward", {
    quantity,
    item: itemLabel(itemDefinitionId)
  });
  node.replaceChildren(image, label);
  node.style.left = `${String(Math.round(at.x))}px`;
  node.style.top = `${String(Math.round(at.y))}px`;
  node.hidden = false;
  // Restart the CSS animation rather than trusting it to replay on a node that is already there: the
  // layout read between removing and re-adding the class is what makes the browser start it again.
  node.classList.remove("is-live");
  node.getBoundingClientRect();
  node.classList.add("is-live");
  window.setTimeout(() => {
    node.hidden = true;
    node.classList.remove("is-live");
  }, REWARD_POP_DURATION_MS);
}

function enable3D(): void {
  if (scene === null) {
    try {
      scene = createFarmScene(element<HTMLCanvasElement>("scene"), {
        // The mobile profile is chosen by *capability*, never by a game rule: a coarse-pointer touch
        // device gets a conservative pixel ratio, a smaller shadow map and no micro-scenery. An
        // explicit `?quality=low` still wins, because that is a developer asking by name.
        quality: deviceQualityProfile(renderQualityRequested(), capability),
        onCellSelected: onGroundTap,
        onEstateFollowChange: (behaviour) => {
          // The renderer decides whether the estate camera is following; this is only how the
          // recenter control learns whether it would do anything.
          estateFollow = behaviour;
          renderCameraMode();
        },
        onObjectSelected: (constructionId) => {
          // While something is in hand or an object is being moved, a click belongs to that gesture -
          // the renderer only reports objects when the host has said they are pickable.
          selectObject(constructionId);
        },
        onCameraModeToggle: () => {
          // The renderer reports the shortcut and decides nothing: which mode is active, and what
          // that means for the panels and the movement keys, is this page's business.
          toggleCameraMode();
        },
        onInteractionKeyRequested: (event) => {
          // E is context-sensitive: with something in reach the host claims it, and with nothing in
          // reach it stays the camera's orbit-right key. The rule is pure and lives in the interaction
          // module; the scene only asks, so there is one arbitration rather than two.
          const requested = interactionKeyRequested({
            key: event.key,
            typing: isTypingTarget(event.target),
            repeat: event.repeat,
            cameraMode: state.cameraMode,
            hasCandidate: interactionCandidate !== null,
            uiOpen: panels.active !== null || state.buildSelection !== null || moveSession !== null
          });
          if (requested) void run(runInteraction);
          return requested;
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
    // The renderer owns the follow state; this is the first read of it, so the recenter control shows
    // the right job from the moment the world exists.
    estateFollow = scene.estateFollowBehaviour();
    // The interactable registry needs the 3D view to exist first only because the candidate drives
    // HUD elements; the index itself is built from the read models, which are already here.
    rebuildInteractionIndex();
    refreshInteractionCandidate();
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
  // Planting is cell work. Asked for from character view, the answer is the estate view - focused on
  // the cell the player chose - rather than a refusal (see `beginPrecisionAction`).
  if (state.cameraMode !== "ESTATE") {
    beginPrecisionAction("PLANT");
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
  // Where the crop stands, read before the refresh removes it: the reward pop rises from the thing
  // that paid it, and after the settle there is no row left to ask.
  const standing = state.crops.find((row) => row.cropInstanceId === cropInstanceId);
  const tile = standing === undefined ? null : { x: standing.tileX, y: standing.tileY };
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
  showRewardPop(harvested.itemDefinitionId, harvested.quantityAdded, tile);
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
  const standing = state.trees.find((row) => row.treeInstanceId === treeInstanceId);
  const tile = standing === undefined ? null : { x: standing.tileX, y: standing.tileY };
  const result = await api().harvestTree(state.farmId, treeInstanceId, {
    requestId: newRequestId("harvest-tree"),
    expectedTreeVersion
  });
  await refreshFarm();
  await refreshAccount();
  const awarded = result.progression;
  const harvested = result.harvest;
  showRewardPop(harvested.itemDefinitionId, harvested.quantityAdded, tile);
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
  renderedPlantSignature = null;
  render();
}

function wire(): void {
  element<HTMLButtonElement>("language").addEventListener("click", () => {
    setLanguage(otherLanguage(state.language));
  });
  // The two camera buttons: named, so the mode is a choice rather than a mysterious switch.
  element<HTMLButtonElement>("camera-estate").addEventListener("click", () => {
    setCameraMode("ESTATE");
  });
  element<HTMLButtonElement>("camera-character").addEventListener("click", () => {
    setCameraMode("CHARACTER");
  });
  // The recenter control: the same action as the R key, and estate view only.
  element<HTMLButtonElement>("camera-recenter").addEventListener("click", () => {
    recenterCamera();
  });
  // The overflow menu, and the two secondary controls inside it. A click anywhere else closes it,
  // which is what makes it feel like a menu rather than a mode.
  element<HTMLButtonElement>("hud-menu-toggle").addEventListener("click", () => {
    hudMenuOpen = !hudMenuOpen;
    renderHudMenu();
  });
  element<HTMLElement>("hud-menu").addEventListener("click", () => {
    hudMenuOpen = false;
    renderHudMenu();
  });
  document.addEventListener("click", (event) => {
    if (!hudMenuOpen) return;
    const target = event.target;
    if (!(target instanceof Node)) return;
    if (element<HTMLElement>("hud-menu").contains(target)) return;
    if (element<HTMLElement>("hud-menu-toggle").contains(target)) return;
    hudMenuOpen = false;
    renderHudMenu();
  });
  // The bottom surface's chevron: opens the full dock on a compact screen, closes it again.
  element<HTMLButtonElement>("dock-expand").addEventListener("click", () => {
    dock = toggleDockExpansion(dock);
    renderDock();
  });
  // The touch controls: a fixed joystick that produces the same movement intent the keyboard does,
  // and a press-and-hold Run button. Both are bound once and shown only where the brief wants them.
  joystick = createJoystickControl({
    surface: element<HTMLElement>("joystick"),
    thumb: element<HTMLElement>("joystick-thumb"),
    target: window,
    // Any change of the stick's state asks for a frame: the render loop sleeps while nothing moves,
    // and a finger is a reason to wake it. `wake` is a no-op while a frame is already pending.
    onIntent: () => {
      playerRuntime.wake();
    }
  });
  joystick.attach();
  runControl = createHoldControl({
    element: element<HTMLButtonElement>("run-button"),
    target: window,
    onChange: (held) => {
      runHeld = held;
      element<HTMLButtonElement>("run-button").setAttribute("aria-pressed", String(held));
      playerRuntime.wake();
    }
  });
  runControl.attach();
  // The interaction button is a real button inside the touch controls, so its tap belongs to it and
  // never reaches the canvas - the camera cannot rotate and the ground cannot be selected from it.
  // It runs exactly the intent the E key runs.
  element<HTMLButtonElement>("interact-button").addEventListener("click", () => {
    void run(runInteraction);
  });
  syncTouchControls();
  // The retry control only exists when the boot session could not be established; clicking it runs
  // the same boot the page ran on load.
  element<HTMLButtonElement>("boot-retry").addEventListener("click", () => {
    void run(boot);
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
    // The same keys drive a move: Q/E turn the ghost, Enter puts it down. A move owns the keyboard
    // while it is in progress, exactly as an item in hand does.
    if (!typing && moveSession !== null && (event.key === "q" || event.key === "Q")) {
      rotateMovePreview(-1);
      return;
    }
    if (!typing && moveSession !== null && (event.key === "e" || event.key === "E")) {
      rotateMovePreview(1);
      return;
    }
    if (moveSession !== null && event.key === "Enter") {
      void confirmMove();
      return;
    }
    // R recentres the estate camera, next to F for the mode switch: the two controls a player reaches
    // for while looking at the island. Only in estate view - character view is read-only about where
    // the camera points, and its camera is already on the player.
    if (!typing && state.cameraMode === "ESTATE" && (event.key === "r" || event.key === "R")) {
      recenterCamera();
      return;
    }
    if (event.key !== "Escape") return;
    // Escape lets go of whatever the page is holding, innermost first: the item in hand, then the
    // panel. Cancelling a placement must leave nothing behind - no ghost, no footprint, no state.
    if (state.buildSelection !== null) {
      cancelBuildSelection();
      return;
    }
    if (moveSession !== null) {
      cancelMove();
      return;
    }
    if (state.selectedObjectId !== null) {
      clearObjectSelection();
      return;
    }
    if (panels.active !== null) setActivePanel(closePanel(panels));
  });
  window.addEventListener("resize", () => {
    // A rotation can change the input *and* the layout: a phone in landscape is coarse and short, the
    // same phone in portrait is coarse and tall, and a tablet with a keyboard attached may stop being
    // coarse at all. Capability is re-read and the controls follow; the world, the models and the
    // player's position are untouched.
    capability = readDeviceCapability();
    syncTouchControls();
    // A rotation can change whether the desktop dock fits at all, so the surface is re-decided with
    // the same rule rather than left in the shape the previous orientation chose.
    renderDock();
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

/**
 * Asks the server who this browser is, which is also what establishes a guest session.
 *
 * The guest credential lives in an HttpOnly cookie the page cannot read, so the only way to get one
 * is to ask. A host that has no session endpoint - the development bridge - answers
 * `RESOURCE_NOT_FOUND`, and that is not a failure: there the plain API is the whole story.
 */
async function startSession(): Promise<boolean> {
  try {
    const session = await api().getSession();
    // The server's own answer about who this browser is. It is recorded, never sent back: the actor
    // every command is authorized against still comes from the session on the server.
    state.playerId = session.player.playerId;
    return true;
  } catch (error: unknown) {
    // A host with no session endpoint - the development bridge - is not a failure: there the plain
    // API is the whole story, and the page simply has no player id to record.
    return error instanceof ApiError && error.code === "RESOURCE_NOT_FOUND";
  }
}

/**
 * Opens the farm: session, then the farm this browser already has or a fresh one.
 *
 * The stored farm id is only a cache of a server-owned fact - the cookie is what proves who the
 * player is - so a stale or foreign id is dropped and the server's answer for this session wins.
 */
async function boot(): Promise<void> {
  bootFailed = false;
  renderBootRetry();
  if (!(await startSession())) {
    bootFailed = true;
    setStatus(message("boot.sessionFailed"), true);
    renderBootRetry();
    return;
  }
  const storedFarm = localStorage.getItem(FARM_KEY);
  if (storedFarm !== null) {
    try {
      await loadFarm(storedFarm);
      enable3D();
      setStatus(message("status.loaded"));
      return;
    } catch (error: unknown) {
      /**
       * Two answers mean "this browser is remembering a farm that is not ours": the farm no longer
       * exists, or it exists and belongs to somebody else.
       *
       * The second is what a playtest hits. Two testers who share a laptop share a browser profile and
       * therefore this one stored id, and the server answers the second tester with NOT_AUTHORIZED -
       * which is the authorization working, not a fault. Retrying that id forever leaves them staring
       * at a page that never leaves its loading state, so the stale id is dropped and the player goes
       * on to create the farm this browser will use, exactly as when a stored farm has been deleted.
       */
      if (
        !(error instanceof ApiError) ||
        (error.code !== "RESOURCE_NOT_FOUND" && error.code !== "NOT_AUTHORIZED")
      ) {
        throw error;
      }
      localStorage.removeItem(FARM_KEY);
    }
  }
  await createFarm();
  enable3D();
  setStatus(message("status.created"));
}

void run(boot);
