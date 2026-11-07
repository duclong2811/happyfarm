import type {
  BuildCatalogEntryDTO,
  ConstructionDTO,
  CropDefinitionDTO,
  CropStateDTO,
  FarmTileDTO,
  FishDefinitionDTO,
  FishingActionDTO,
  FishingSpotDTO,
  InventoryEntryDTO,
  PlayerProgressionDTO,
  PlotDTO,
  ResourceActionDTO,
  ResourceNodeDTO,
  ShopEntryDTO,
  TreeDefinitionDTO,
  TreeStateDTO,
  WalletDTO,
  WarehouseStatusDTO,
  WorkAreaCellDTO,
  WorkAreaDTO,
  WorkAreaKind,
  WorkAreaSummaryDTO,
  ActorDTO,
  JobDTO,
  JobKind,
  CargoDTO,
  AutoPlanDTO,
  AutoStepDTO,
  AutoAnchorDTO,
  LifecycleFamilyDTO,
  WaitReasonDTO
  ,OrchardVisualAssignmentSnapshot
  ,AquaculturePondDTO
  ,NeighborSnapshotDTO
} from "@happy-farm/contracts";
import { ApiClient, ApiError } from "./api";
import {
  MAX_WORK_AREA_CELLS,
  MAX_WORK_AREA_NAME_LENGTH,
  WORK_AREA_KINDS,
  WORK_AREA_KIND_LABEL_KEYS,
  applyDraftClick,
  cellFitsKind,
  draftCellList,
  normalizeNameInput,
  workAreaEditScene,
  workAreaListSignature
} from "./work-areas/model";
import {
  autoFieldProgress,
  autoPreviewFor,
  autoRunStatusFor,
  autoStatusFor,
  compatibleAreas,
  jobListSignature,
  jobOrderOf,
  jobTargetsFor,
  kindIsAssignable,
  lifecycleStepsFor,
  moveJobInOrder,
  planForAssignment,
  type AutoStatus,
  type LifecycleStepToken,
  type JobTargetSources
} from "./workers/model";
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
import { LEVEL_UP_DURATION_MS, levelUpFeedback, unlockNotices } from "./unlocks";
import { GROWTH_REFRESH_MIN_MS, nextGrowthRefreshDelayMs, shouldRefreshGrowth } from "./polling";
import {
  FULL_FARM_REFRESH,
  GROWTH_REFRESH,
  farmRefreshScopeFor,
  type FarmRefreshScope
} from "./farm-refresh";
import { createIcon, renderIcons, type IconName } from "./icons";
import {
  FARM_MARKET_ANCHOR_TILE,
  HOME_WAREHOUSE_ANCHOR_TILE,
  forestryConstructionDefinition,
  resourceDefinitionRegistry,
  resourceDropTableRegistry
} from "@happy-farm/game-data";
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
import { createOrchardActorVisualAdapter, type OrchardActorVisualAdapter } from "./workers/orchard-actor-visual";
import {
  deviceCapability,
  showTouchControls,
  type DeviceCapability
} from "./mobile/capability";
import { createHoldControl, createJoystickControl, type HoldControl, type JoystickControl } from "./mobile/joystick";
import { deviceQualityProfile } from "./render/render-quality";
import { DEFAULT_CAMERA_MODE, otherCameraMode, type CameraMode } from "./render/camera-mode";
import { GROUND_SURFACE_Y, terrainHeightAt } from "./render/terrain-height";
import { neighborForestLayout, neighborGroundHeight, neighborIslandTemplate } from "./render/neighbor-island-template";
import { MOC_PREVIEW_LAYOUT, mocPresentationDockWorld, mocPresentationSpawnWorld, mocPreviewForestPlacements, mocPreviewPlacement } from "./moc-island-preview-data";
import { WORLD_CENTER_WORLD } from "./render/world-config";
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
  type SceneNeighborIslandPreview,
  type SceneWorldTarget,
  type RenderQualityName
} from "./render";
import { SPAWN_WORLD } from "./render/world-config";
import {
  bootPerfInteractionDiagnostic,
  bootPerfInteractionTrace,
  bootPerfInteractionTraceId,
  bootPerfMark
} from "./boot-performance";
import {
  aquaculturePanelState,
  aquacultureRemainingSeconds,
  formatAquacultureTimestamp,
  isAquacultureConstruction
} from "./aquaculture/panel";
import { plantedForestryPanelState, resourcePanelState } from "./forestry/panel";
import { miningPanelState } from "./mining/panel";
import {
  createAquaculturePondLoader,
  selectedAquaculturePond,
  type AquacultureLoadState
} from "./aquaculture/load";
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
import { settleIndependentReads } from "./account-bootstrap";
import {
  ownedBounds,
  ownedCells,
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
import { movementDestination, movementDestinationForTarget } from "./render/world-cell-selection";
import { cellActionKey, cellLandKey, getAvailableCellActions } from "./render/world-cell-actions";
import { createPlayerCollisionWorld } from "./player/collision";
import { resourceNodeCollisionObstacles } from "./render/resource-cluster";
import { neighborTerrainCollisionDepth } from "./player/neighbor-collision";
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
import { interactionActionKey, type InteractionCandidate } from "./interaction/model";
import {
  EMPTY_INTERACTION_INDEX,
  buildInteractionIndex,
  type InteractionIndex
} from "./interaction/registry";
import {
  interactionActivation,
  interactionKeyRequested,
  selectFocusedInteractionCandidate
} from "./interaction/selection";
import { REWARD_POP_DURATION_MS } from "./interaction/feedback";
import {
  areaHarvestGroups,
  areaHarvestPanelStage,
  isRepeatingFruitTree,
  previewAreaHarvest,
  type AreaHarvestCandidate,
  type AreaHarvestCropCandidate,
  type AreaHarvestCellClassification,
  type AreaHarvestCorner,
  type AreaHarvestPreview
} from "./area-harvest";
import { previewAreaPlanting, type AreaPlantCell, type AreaPlantPreview } from "./area-planting";
import { createItemThumbnails, type ItemThumbnails } from "./items/thumbnails";
import { renderItemCard, type ItemCardState } from "./items/card";
import {
  createActionButton,
  decorateGameUi,
  renderCapacityBar,
  renderCategoryTabs,
  renderInventorySlot
} from "./ui/components";
import {
  cropVisualFor,
  itemVisualFor,
  resourceVisualFor,
  unknownItemVisual,
  type ItemVisual,
  type ItemVisualCatalogues
} from "./items/visuals";
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
import {
  clampMarketQuantity,
  defaultMarketDirection,
  marketCanSubmit,
  marketCardFor,
  marketCards,
  marketQuantityBounds,
  marketQuantityStep,
  marketTotal,
  type MarketCard
} from "./market/market";
import "@fontsource-variable/baloo-2/index.css";
import "@fontsource-variable/nunito/index.css";
import "./styles.css";
import "./build-shop/shop.css";
import "./ui/warm-harvest.css";

bootPerfMark("app_started");

const FARM_KEY = "happy-farm.dev.farmId";
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
   * The water the player may fish, and the species they may catch.
   *
   * Static game data served with the catalogue: the client draws the spots and names the catch from
   * it, and the server decides everything else. Read once at load, never polled.
   */
  fishingSpots: readonly FishingSpotDTO[];
  fish: readonly FishDefinitionDTO[];
  /**
   * The player's live fishing attempt, if any.
   *
   * Set by a start, cleared by a settle or a cancel, and restored from the server on load so a
   * refresh resumes the wait rather than losing it. The client shows a countdown; the server owns
   * whether the catch is actually ready.
   */
  fishingAction: FishingActionDTO | null;
  /**
   * The island's resource nodes, with the actor's own zone's availability.
   *
   * Static placements plus mutable state, so this is read at load and re-read after a gather - a
   * semantic event - rather than polled. A depleted node is drawn as rubble and counted down locally.
   */
  resourceNodes: readonly ResourceNodeDTO[];
  /** The player's live gather, if any. Restored from the server on load, like a fishing cast. */
  resourceAction: ResourceActionDTO | null;
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
  /** The selected planted tree id, kept separately so a stored tree remains addressable after it leaves the map. */
  selectedTreeInstanceId: string | null;
  /**
   * Everything built on this farm, as the server last reported it.
   *
   * The world draws these; the shop's collision rule treats their footprints as taken. It is server
   * state, refreshed with the rest of the farm - never a local list the client maintains.
   */
  constructions: readonly ConstructionDTO[];
  /** Discrete pond lifecycle snapshots; refreshed with built objects, never from the frame loop. */
  aquaculturePonds: readonly AquaculturePondDTO[];
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
  /**
   * The Home Island warehouse, as the server last reported it.
   *
   * Presentation only: the tier, the usage and the next cost all come from `/warehouse`, and the
   * upgrade command sends a request id and nothing else. Refreshed with the rest of the account on
   * load and after a mutation that changed what the island holds - never on a timer.
   */
  warehouse: WarehouseStatusDTO | null;
  /**
   * The farm's work areas, as the management panel last read them.
   *
   * Deliberately outside the farm's ordinary loads: they are read when the panel is opened and after
   * a mutation, never on boot and never on the growth poll.
   */
  workAreas: readonly WorkAreaSummaryDTO[];
  /**
   * The owner's Main Character and its configured jobs, as the worker panel last read them.
   *
   * Deliberately outside the farm's ordinary loads: read when the panel is opened and after a
   * mutation, never on boot, never on the growth poll, never in the frame, pointer or movement loops.
   */
  workerActor: ActorDTO | null;
  workers: readonly JobDTO[];
  /**
   * What the Main Character is carrying, as the worker panel last read it.
   *
   * A container of its own: these goods are *not* in the Warehouse. Read with the worker panel and
   * after an unload - never on boot, never on a tick, never while walking.
   */
  cargo: CargoDTO | null;
  /**
   * The plan the resolver last produced for this actor, as the Auto panel last read it.
   *
   * A plan, not state: it is derived from the snapshot the server read, it is never sent back, and it
   * is read when the panel is opened and after an Auto action - never on a timer.
   */
  autoPlan: AutoPlanDTO | null;
  /**
   * The last Auto step the server performed, as the panel last read it.
   *
   * The live status line and the walk the character is drawing both come from this, never from a guess
   * about what Auto might do next: while a step is in flight the honest answer is what the server said.
   */
  autoStep: AutoStepDTO | null;
  orchardVisualAssignments: readonly OrchardVisualAssignmentSnapshot[];
  shop: readonly ShopEntryDTO[];
  wallet: readonly WalletDTO[];
  progression: PlayerProgressionDTO | null;
  plots: readonly PlotDTO[];
  selected: SelectedTile | null;
  selectedCrop: string | null;
  /** The tree chosen in the planting control. Exactly one of the two choices is ever set. */
  selectedTree: string | null;
  neighbor: NeighborSnapshotDTO | null;
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
  fishingSpots: [],
  fish: [],
  fishingAction: null,
  resourceNodes: [],
  resourceAction: null,
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
  selectedTreeInstanceId: null,
  constructions: [],
  aquaculturePonds: [],
  cellMap: EMPTY_WORLD_CELL_MAP,
  inventory: [],
  warehouse: null,
  shop: [],
  workAreas: [],
  workerActor: null,
  workers: [],
  cargo: null,
  autoPlan: null,
  autoStep: null,
  orchardVisualAssignments: [],
  wallet: [],
  progression: null,
  plots: [],
  selected: null,
  selectedCrop: null,
  selectedTree: null,
  neighbor: null
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
let neighborSelectedTarget: "DOCK" | "NPC" | null = null;
/**
 * The renderer may be usable before the first authoritative account read completes. Economic
 * commands stay closed during that short window so an empty/stale client snapshot can never be
 * used as the basis for a mutation.
 */
let accountReady = false;
let reconciliationPending = false;
let accountRefreshInFlight: Promise<void> | null = null;
let accountRefreshGeneration = 0;
let initialEconomicBootstrapInFlight: Promise<void> | null = null;
let returnPopupShown = false;
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
/** Single-flight guard for the read-only Ore Mine locator. */
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
/** A directly tapped resource/fishing target, retained while the character walks into range. */
let interactionFocusKey: string | null = null;
/** The contextual profession panel's resource id, separate from player-owned constructions. */
let selectedResourceNodeId: string | null = null;
/** The last thing the interaction surfaces were drawn from, so an unchanged frame writes no DOM. */
let interactionSignature = "";
/** Whether an interaction command is in flight, so one press cannot become two commands. */
let interactionPending = false;
interface AreaHarvestSelectionState {
  active: boolean;
  operation: "HARVEST" | "PLANT";
  plantOptionKey: string | null;
  first: AreaHarvestCorner | null;
  second: AreaHarvestCorner | null;
  pending: boolean;
  minimized: boolean;
  requestId: string | null;
  taskFarmId: string | null;
  taskGroups: readonly AreaRunnerGroup[] | null;
  syncing: boolean;
  focus: AreaHarvestCorner | null;
  progress: { completedGroups: number; totalGroups: number; completedCells: number; totalCells: number; succeeded: number; skipped: number; reasons: readonly string[] } | null;
  lastResult: { succeeded: number; skipped: number; reasons: readonly string[] } | null;
}
type AreaRunnerGroup =
  | { readonly kind: "TREE"; readonly items: readonly AreaHarvestCandidate[] }
  | { readonly kind: "CROP"; readonly items: readonly AreaHarvestCropCandidate[] }
  | { readonly kind: "PLANT_CROP"; readonly definitionId: string; readonly items: readonly AreaPlantCell[] }
  | { readonly kind: "PLANT_TREE"; readonly definitionId: string; readonly items: readonly AreaPlantCell[] };
let areaHarvestSelection: AreaHarvestSelectionState = {
  active: false,
  operation: "HARVEST",
  plantOptionKey: null,
  first: null,
  second: null,
  pending: false,
  minimized: false,
  requestId: null,
  taskFarmId: null,
  taskGroups: null,
  syncing: false,
  focus: null,
  progress: null,
  lastResult: null
};
let areaPlantPickerOpen = false;
let aquacultureLoadState: AquacultureLoadState = { kind: "IDLE", farmId: null };
let aquacultureCountdownTimer: number | null = null;
let forestryCountdownTimer: number | null = null;
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
  if (state.neighbor?.visit.currentPlace === "NEIGHBOR_ISLAND") {
    element<HTMLElement>("action-dock").hidden = true;
    return;
  }
  // Profession panels own their selected tree. The underlying cell must not leave a second Farming
  // dock visible underneath it, especially when a natural resource node sits beside farm land.
  if (areaHarvestSelection.active || state.selectedObjectId !== null || selectedResourceNodeId !== null || selectedWildwoodTree() !== null) {
    const node = element<HTMLElement>("action-dock");
    node.hidden = true;
    return;
  }
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

const loadAquaculturePonds = createAquaculturePondLoader(
  async (farmId) => (await api().getAquaculturePonds(farmId)).ponds,
  (next) => {
    aquacultureLoadState = next;
    if (next.kind === "LOADED" && next.farmId === state.farmId) {
      state.aquaculturePonds = next.ponds;
      rebuildInteractionIndex();
      refreshInteractionCandidate();
      refreshScene();
    }
    // A selected cage must leave loading/error/not-found as soon as its read settles, including a
    // rejected request; otherwise the panel can remain visually stale forever.
    renderObjectPanel();
    renderAquaculturePanel();
    renderForestryConstructionPanel();
  }
);

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

function selectedWildwoodTree(): TreeStateDTO | null {
  const byId = state.selectedTreeInstanceId === null
    ? null
    : state.trees.find((candidate) => candidate.treeInstanceId === state.selectedTreeInstanceId) ?? null;
  const tree = byId ?? (state.selected === null ? null : treeAt(state.selected.x, state.selected.y));
  return tree?.definitionId === "tree_wildwood" ? tree : null;
}

function selectedPlantedTree(): TreeStateDTO | null {
  if (state.selectedTreeInstanceId !== null) {
    return state.trees.find((candidate) => candidate.treeInstanceId === state.selectedTreeInstanceId) ?? null;
  }
  return state.selected === null ? null : treeAt(state.selected.x, state.selected.y);
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
    unowned: { plantable: unownedPlantableCell(selected) },
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
    case "open":
      // Natural ground the farm has no row for yet: it is simply plantable (V14.5.2).
      node.textContent = t("selection.open.title", { at: where });
      detail.textContent = selection.canPlant ? t("selection.open.detail") : emptyDetail(selection);
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
              : tree.phase === "DEPLETED"
                ? t("selection.tree.depletedDetail")
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
 * Whether an unowned selected cell is a valid planting target.
 *
 * The client's read of the island, not authority: dry land the island would let a farm work, with
 * nothing on it. With a crop or tree chosen, unlocked and in stock, the dock offers the plant and the
 * action buys the cell first. The server checks the same geography again when it quotes the price.
 */
function unownedPlantableCell(selected: SelectedTile | null): boolean {
  if (selected === null) return false;
  const cell = state.cellMap.cells.get(cellKey(selected.x, selected.y));
  if (cell === undefined) return false;
  return !cell.owned && cell.terrain === "LAND" && cell.buildable && cell.occupancy === "EMPTY";
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
  if (state.selectedObjectId !== null || selectedResourceNodeId !== null || selectedWildwoodTree() !== null) {
    element<HTMLElement>("action-dock").hidden = true;
    scene?.setInteraction("NONE");
    return;
  }
  const economicReady = accountReady && !reconciliationPending && state.farmId !== null;
  const hasCrop = selection.crop !== null;
  const hasTree = selection.tree !== null;
  element<HTMLDivElement>("plant-controls").hidden = hasCrop || hasTree;
  element<HTMLDivElement>("crop-controls").hidden = !hasCrop;
  element<HTMLDivElement>("tree-controls").hidden = !hasTree;
  element<HTMLButtonElement>("plant").disabled = !economicReady || !selection.canPlant;
  element<HTMLButtonElement>("harvest").disabled = !economicReady || !selection.canHarvest;
  element<HTMLButtonElement>("harvest").hidden = !selection.canHarvest;
  element<HTMLButtonElement>("uproot").disabled = !economicReady || !selection.canUproot;
  // A tree offers harvest only while the server's own row says this cycle is ready; growing and
  // regrowing trees offer removal instead, so a mis-planted tree never has to be waited out.
  const harvestTreeButton = element<HTMLButtonElement>("harvest-tree");
  harvestTreeButton.disabled = !economicReady || !selection.canHarvestTree;
  harvestTreeButton.hidden = selection.tree !== null && selection.tree.phase !== "READY";
  setLabel(
    "remove-tree",
    selection.tree?.phase === "DEPLETED" ? t("dock.clearStump") : t("dock.removeTree")
  );
  element<HTMLButtonElement>("remove-tree").disabled = !economicReady || !selection.canRemoveTree;
  const treeState = element<HTMLElement>("tree-state");
  treeState.textContent =
    selection.tree === null
      ? ""
      : t(`tree.state.${selection.tree.phase}` as MessageKey);
  const areaButton = element<HTMLButtonElement>("harvest-area");
  const repeatingReadyTrees = state.trees.some(
    (tree) => tree.storageState !== "STORED" && tree.ready && isRepeatingFruitTree(tree.definitionId)
  ) || state.crops.length > 0;
  areaButton.hidden = !repeatingReadyTrees && !plantOptionModels().some((option) => option.selectable) && !areaHarvestSelection.active;
  areaButton.disabled = !economicReady;
  areaButton.textContent = areaHarvestSelection.active
    ? areaHarvestSelection.pending ? t("areaHarvest.restoreProgress") : t("areaHarvest.cancel")
    : t("areaHarvest.open");
  // No selection, no surface: the world keeps the space instead of an empty bar. How much of it is
  // on screen is the dock's own rule, which is what the compact strip and the chevron come from.
  renderDock();
  // The planting grid follows the same state the dock does: it appears exactly when the planting
  // control is offered, so a player can see where a seed may go. It names no tile and sends nothing.
  scene?.setInteraction(economicReady && selection.canPlant ? "PLANT" : "NONE");
  const harvestKind = selection.tree !== null ? "TREE" : selection.crop !== null ? "CROP" : null;
  const harvestReady = selection.tree?.ready ?? selection.crop?.mature ?? false;
  const harvestAllowed = selection.tree !== null ? selection.canHarvestTree : selection.canHarvest;
  bootPerfInteractionDiagnostic("harvest_control", {
    kind: harvestKind,
    targetId: selection.tree?.treeInstanceId ?? selection.crop?.cropInstanceId ?? null,
    coordinate: selection.coordinate,
    serverReady: harvestReady,
    selectionAllowsHarvest: harvestAllowed,
    economicReady,
    farmLoaded: state.farmId !== null,
    accountReady,
    reconciliationPending,
    disabledReason:
      harvestKind === null
        ? "NO_HARVEST_TARGET"
        : !economicReady
          ? state.farmId === null
            ? "NO_FARM"
            : !accountReady
              ? "ACCOUNT_NOT_READY"
              : reconciliationPending
                ? "RECONCILIATION_PENDING"
                : "ECONOMIC_STATE_NOT_READY"
          : !harvestAllowed
            ? "TARGET_NOT_READY"
            : "ENABLED"
  });
}

function currentAreaHarvestPreview(): AreaHarvestPreview {
  return areaHarvestSelection.first !== null && areaHarvestSelection.second !== null
    ? previewAreaHarvest(
        state.trees,
        state.treeDefinitions,
        [areaHarvestSelection.first, areaHarvestSelection.second],
        state.crops,
        state.cropDefinitions,
        state.cellMap
      )
    : { bounds: null, treesInArea: 0, cropsInArea: 0, fruitReadyCount: 0, cropReadyCount: 0, readyCount: 0, skippedCount: 0, plannedCells: [], waitingCells: [], invalidCells: [], candidates: [], cropCandidates: [], products: [] };
}

function currentAreaPlantOption(): PlantOption | null {
  const options = plantOptionModels();
  const selected = options.find((option) => option.key === areaHarvestSelection.plantOptionKey && option.selectable);
  return selected ?? options.find((option) => option.selectable) ?? null;
}

function currentAreaPlantPreview(): AreaPlantPreview {
  return areaHarvestSelection.first !== null && areaHarvestSelection.second !== null
    ? previewAreaPlanting(
        state.cellMap,
        state.tiles,
        state.crops,
        state.trees,
        currentAreaPlantOption(),
        [areaHarvestSelection.first, areaHarvestSelection.second]
      )
    : {
        bounds: null,
        cellsInArea: 0,
        plantableCount: 0,
        plannedCount: 0,
        skippedCount: 0,
        shortageCount: 0,
        validCells: [],
        plannedCells: [],
        shortageCells: [],
        skipped: []
      };
}

function syncAreaHarvestOverlay(): void {
  if (!areaHarvestSelection.active) {
    scene?.setAreaHarvestEdit(null);
    return;
  }
  const planting = areaHarvestSelection.operation === "PLANT" ? currentAreaPlantPreview() : null;
  const harvest = planting === null ? currentAreaHarvestPreview() : null;
  scene?.setAreaHarvestEdit({
    first: areaHarvestSelection.first,
    second: areaHarvestSelection.second,
    cells: planting === null
      ? (harvest?.plannedCells ?? []).map(({ x, y }) => ({ x, y }))
      : planting.plannedCells.map(({ x, y }) => ({ x, y })),
    invalid: planting === null
      ? (harvest?.invalidCells ?? []).map(({ x, y }) => ({ x, y }))
      : planting.skipped.map(({ x, y }) => ({ x, y })),
    shortage: planting === null
      ? []
      : planting.shortageCells.map(({ x, y }) => ({ x, y })),
    waiting: planting === null
      ? (harvest?.waitingCells ?? []).map(({ x, y }) => ({ x, y }))
      : [],
    focus: areaHarvestSelection.focus
  });
}

function areaProgressPercent(progress: AreaHarvestSelectionState["progress"]): number {
  if (progress === null || progress.totalCells <= 0) return 0;
  return Math.floor((progress.completedCells / progress.totalCells) * 100);
}

function areaTaskIsCurrent(requestId: string, farmId: string): boolean {
  return state.farmId === farmId && areaHarvestSelection.pending && areaHarvestSelection.requestId === requestId && areaHarvestSelection.taskFarmId === farmId;
}

function areaHarvestCellAt(cell: AreaHarvestCorner): AreaHarvestCellClassification | null {
  if (areaHarvestSelection.first === null || areaHarvestSelection.second === null) return null;
  if (areaHarvestSelection.operation === "HARVEST") {
    const preview = currentAreaHarvestPreview();
    return [...preview.plannedCells, ...preview.waitingCells, ...preview.invalidCells]
      .find((candidate) => candidate.x === cell.x && candidate.y === cell.y) ?? null;
  }
  const planting = currentAreaPlantPreview();
  const planned = planting.plannedCells.find((candidate) => candidate.x === cell.x && candidate.y === cell.y);
  if (planned !== undefined) return { x: cell.x, y: cell.y, bucket: "PLANNED", reason: "NO_TARGET" };
  const shortage = planting.shortageCells.find((candidate) => candidate.x === cell.x && candidate.y === cell.y);
  if (shortage !== undefined) return { x: cell.x, y: cell.y, bucket: "WAITING", reason: "NO_TARGET" };
  const invalid = planting.skipped.find((candidate) => candidate.x === cell.x && candidate.y === cell.y);
  return invalid === undefined ? null : { x: cell.x, y: cell.y, bucket: "INVALID", reason: invalid.reason === "STALE" || invalid.reason === "NO_SEEDS" || invalid.reason === "LEVEL" ? "NO_TARGET" : invalid.reason };
}

function areaHarvestFocusHint(): string | null {
  const focus = areaHarvestSelection.focus;
  if (focus === null) return null;
  const cell = areaHarvestCellAt(focus);
  if (cell === null) return null;
  if (cell.bucket === "PLANNED") return t("areaHarvest.cell.planned");
  if (areaHarvestSelection.operation === "PLANT" && cell.bucket === "WAITING") return t("areaHarvest.reason.NO_SEEDS");
  return areaHarvestReason(cell.reason);
}

function minimizeAreaHarvest(): void {
  if (!areaHarvestSelection.active || !areaHarvestSelection.pending) return;
  areaHarvestSelection = { ...areaHarvestSelection, minimized: true };
  renderAreaHarvestPanel();
  renderAreaHarvestLauncher();
}

function restoreAreaHarvest(): void {
  if (!areaHarvestSelection.active || !areaHarvestSelection.minimized) return;
  areaHarvestSelection = { ...areaHarvestSelection, minimized: false };
  renderAreaHarvestPanel();
  renderAreaHarvestLauncher();
}

function renderAreaHarvestProgressDock(): void {
  const dock = element<HTMLButtonElement>("area-harvest-progress-dock");
  const visible = areaHarvestSelection.active && areaHarvestSelection.minimized &&
    (areaHarvestSelection.pending || areaHarvestSelection.lastResult === null || areaHarvestSelection.lastResult.skipped > 0);
  dock.hidden = !visible;
  if (!visible) return;
  const progress = areaHarvestSelection.progress;
  const label = areaHarvestSelection.operation === "PLANT" ? t("areaHarvest.actionPlant") : t("areaHarvest.actionHarvest");
  const body = progress === null
    ? t("areaHarvest.progressCells", { completed: 0, total: 0, percent: 0 })
    : t("areaHarvest.progressCells", { completed: progress.completedCells, total: progress.totalCells, percent: areaProgressPercent(progress) });
  dock.textContent = areaHarvestSelection.syncing ? t("areaHarvest.syncing") : `${label} ${body}`;
  dock.classList.toggle("is-error", !areaHarvestSelection.pending && areaHarvestSelection.lastResult !== null && areaHarvestSelection.lastResult.skipped > 0);
  dock.title = t("areaHarvest.restoreProgress");
  dock.setAttribute("aria-label", t("areaHarvest.restoreProgress"));
}

function renderAreaHarvestLauncher(): void {
  const button = element<HTMLButtonElement>("harvest-area-global");
  const available = state.trees.some(
    (tree) => tree.storageState !== "STORED" && isRepeatingFruitTree(tree.definitionId)
  ) || state.crops.length > 0 || plantOptionModels().some((option) => option.selectable);
  button.hidden = !available && !areaHarvestSelection.active;
  button.disabled = false;
  button.title = t("areaHarvest.open");
  button.setAttribute("aria-label", t("areaHarvest.open"));
  button.setAttribute("aria-pressed", String(areaHarvestSelection.active));
}

function areaHarvestReason(reason: string): string {
  const key = `areaHarvest.reason.${reason}` as MessageKey;
  return t(key);
}

function renderAreaPlantOptionCard(option: PlantOption, selectOption?: () => void): HTMLElement {
  const selected = currentAreaPlantOption()?.key === option.key;
  const name = option.kind === "CROP" ? cropName(option.definitionId) : treeName(option.definitionId);
  const note = option.blockedReason === "LEVEL"
    ? t("plant.levelRequired", { level: option.requiredLevel })
    : option.blockedReason === "NO_SEEDS"
      ? t("plant.noSeeds")
      : t("plant.growsIn", { time: durationText(option.growthSeconds) });
  return renderItemCard(
    {
      key: option.key,
      visual: option.visual,
      name,
      quantity: option.stored,
      quantityLabel: t(option.kind === "CROP" ? "plant.seedsHeld" : "plant.saplingsHeld", { quantity: option.stored, item: name }),
      note,
      state: option.group === "LOCKED" ? "LOCKED" : option.group === "NO_SEEDS" ? "EMPTY" : selected ? "SELECTED" : "NORMAL",
      disabled: !option.selectable,
      ariaLabel: `${name} — ${String(option.stored)}, ${note}`
    },
    itemCardDeps(),
    { onSelect: () => {
      if (!option.selectable) return;
      if (selectOption !== undefined) {
        selectOption();
        return;
      }
      areaPlantPickerOpen = false;
      areaHarvestSelection = { ...areaHarvestSelection, plantOptionKey: option.key, focus: null, progress: null, requestId: null, taskFarmId: null, taskGroups: null, syncing: false, lastResult: null };
      syncAreaHarvestOverlay();
      renderAreaHarvestPanel();
    } }
  );
}

/** The picker is a replacement surface, never a second layer above the action bar. */
function renderAreaPlantPickerSurface(panel: HTMLElement, options: readonly PlantOption[]): void {
  panel.dataset.surface = "PICKER";
  panel.dataset.picker = "open";
  const head = make("div", "area-harvest-picker-head");
  head.appendChild(make("span", "area-harvest-picker-title", t("areaHarvest.pickerTitle")));
  const close = make("button", "panel-close area-harvest-picker-close");
  close.appendChild(createIcon("close", 17));
  close.type = "button";
  close.setAttribute("aria-label", t("areaHarvest.closePicker"));
  close.title = t("areaHarvest.closePicker");
  close.addEventListener("click", () => {
    areaPlantPickerOpen = false;
    renderAreaHarvestPanel();
  });
  head.appendChild(close);

  const body = make("div", "area-harvest-picker-body");
  const owned = options.filter((option) => option.group === "AVAILABLE");
  const appendGroup = (title: string, group: readonly PlantOption[]): void => {
    if (group.length === 0) return;
    const section = make("section", "area-harvest-picker-section");
    section.appendChild(make("h3", "area-harvest-picker-section-title", title));
    const grid = make("div", "area-harvest-option-picker");
    for (const option of group) grid.appendChild(renderAreaPlantOptionCard(option));
    section.appendChild(grid);
    body.appendChild(section);
  };

  if (owned.length === 0) {
    const empty = make("div", "area-harvest-picker-empty");
    const icon = make("span", "area-harvest-picker-empty-icon");
    icon.appendChild(createIcon("seed", 28));
    empty.appendChild(icon);
    const copy = make("div", "area-harvest-picker-empty-copy");
    copy.appendChild(make("strong", undefined, t("areaHarvest.noSeeds")));
    copy.appendChild(make("span", undefined, t("areaHarvest.noSeedsHint")));
    empty.appendChild(copy);
    const market = make("button", "secondary area-harvest-market-button", t("areaHarvest.openMarket"));
    market.type = "button";
    market.addEventListener("click", () => {
      areaPlantPickerOpen = false;
      openFarmMarket({ direction: "buy" });
    });
    empty.appendChild(market);
    body.appendChild(empty);
  } else {
    appendGroup(t("areaHarvest.cropChoices"), owned.filter((option) => option.kind === "CROP"));
    appendGroup(t("areaHarvest.treeChoices"), owned.filter((option) => option.kind === "TREE"));
  }

  const unavailable = options.filter((option) => option.group !== "AVAILABLE");
  if (unavailable.length > 0) {
    const more = make("details", "area-harvest-picker-more");
    more.appendChild(make("summary", undefined, t("areaHarvest.moreChoices")));
    const grid = make("div", "area-harvest-option-picker area-harvest-option-picker-more");
    for (const option of unavailable) grid.appendChild(renderAreaPlantOptionCard(option));
    more.appendChild(grid);
    body.appendChild(more);
  }
  panel.replaceChildren(head, body);
}

function renderAreaHarvestPanel(): void {
  const panel = element<HTMLElement>("area-harvest-panel");
  panel.hidden = !areaHarvestSelection.active || areaHarvestSelection.minimized;
  renderAreaHarvestProgressDock();
  if (!areaHarvestSelection.active || areaHarvestSelection.minimized) return;
  const stage = areaHarvestPanelStage(areaHarvestSelection.first, areaHarvestSelection.second);
  const preview = currentAreaHarvestPreview();
  const planting = currentAreaPlantPreview();
  const plantingMode = areaHarvestSelection.operation === "PLANT";
  panel.dataset.stage = stage;
  panel.dataset.operation = areaHarvestSelection.operation;
  panel.dataset.picker = areaPlantPickerOpen ? "open" : "closed";
  if (plantingMode && stage === "PREVIEW" && areaPlantPickerOpen) {
    renderAreaPlantPickerSurface(panel, plantOptionModels());
    return;
  }
  panel.dataset.surface = "BAR";
  const toolbar = make("div", "area-harvest-toolbar");
  const toolIcon = make("span", "area-harvest-tool");
  toolIcon.appendChild(createIcon(plantingMode ? "plant" : "harvest", 21));
  toolbar.appendChild(toolIcon);
  const mode = make("div", "area-harvest-mode");
  for (const [operation, labelKey] of [["HARVEST", "areaHarvest.actionHarvest"], ["PLANT", "areaHarvest.actionPlant"]] as const) {
    const button = make("button", operation === areaHarvestSelection.operation ? "secondary is-selected" : "secondary", t(labelKey as MessageKey));
    button.type = "button";
    button.disabled = areaHarvestSelection.pending;
    button.addEventListener("click", () => {
      areaPlantPickerOpen = false;
      areaHarvestSelection = { ...areaHarvestSelection, operation, first: null, second: null, focus: null, progress: null, requestId: null, taskFarmId: null, taskGroups: null, syncing: false, lastResult: null };
      syncAreaHarvestOverlay();
      renderAreaHarvestPanel();
    });
    mode.appendChild(button);
  }
  toolbar.appendChild(mode);
  toolbar.appendChild(make("span", "area-harvest-instruction", stage === "CHOOSE_FIRST"
    ? t("areaHarvest.chooseFirst")
    : stage === "CHOOSE_SECOND"
      ? t("areaHarvest.chooseSecond")
      : t("areaHarvest.preview")));
  const close = make("button", "panel-close area-harvest-close");
  close.appendChild(createIcon("close", 17));
  close.setAttribute("aria-label", areaHarvestSelection.pending ? t("areaHarvest.minimize") : t("areaHarvest.cancel"));
  close.title = areaHarvestSelection.pending ? t("areaHarvest.minimize") : t("areaHarvest.cancel");
  close.type = "button";
  close.addEventListener("click", () => {
    if (areaHarvestSelection.pending) minimizeAreaHarvest();
    else cancelAreaHarvest();
  });
  toolbar.appendChild(close);
  if (stage === "CHOOSE_FIRST") {
    panel.replaceChildren(toolbar);
    return;
  }
  if (stage === "CHOOSE_SECOND") {
    const reset = make("button", "secondary area-harvest-reset", t("areaHarvest.resetFirst"));
    reset.type = "button";
    reset.disabled = areaHarvestSelection.pending;
    reset.addEventListener("click", () => {
      areaHarvestSelection = { ...areaHarvestSelection, first: null, second: null, focus: null, progress: null, requestId: null, taskGroups: null, lastResult: null };
      syncAreaHarvestOverlay();
      renderAreaHarvestPanel();
    });
    const step = make("div", "area-harvest-step-actions");
    step.appendChild(reset);
    panel.replaceChildren(toolbar, step);
    return;
  }
  const plannedCount = plantingMode ? planting.plannedCount : preview.readyCount;
  const skippedCount = plantingMode ? planting.skippedCount : preview.skippedCount;
  const summary = make("div", "area-harvest-summary");
  summary.appendChild(make("strong", undefined, plantingMode
    ? planting.shortageCount > 0
      ? t("areaHarvest.plantSummary", {
          planned: planting.plannedCount,
          valid: planting.plantableCount,
          shortage: planting.shortageCount
        })
      : `${String(planting.plantableCount)} ${t("areaHarvest.plantable")}`
    : `${String(preview.readyCount)} ${t("areaHarvest.readySummary")}`));
  const legend = make("div", "area-harvest-legend");
  const legendEntries = plantingMode
    ? [["planned", planting.plannedCount], ["waiting", planting.shortageCount], ["invalid", planting.skipped.length]] as const
    : [["planned", preview.plannedCells.length], ["waiting", preview.waitingCells.length], ["invalid", preview.invalidCells.length]] as const;
  for (const [kind, count] of legendEntries) {
    const entry = make("span", `area-harvest-legend-item area-harvest-legend-${kind}`);
    entry.appendChild(make("i"));
    entry.appendChild(document.createTextNode(`${String(count)} ${t(`areaHarvest.legend.${kind}` as MessageKey)}`));
    legend.appendChild(entry);
  }
  if (skippedCount > 0) summary.appendChild(document.createTextNode(` · ${String(skippedCount)} ${t("areaHarvest.skipped")}`));
  const details = make("details", "area-harvest-details");
  details.hidden = skippedCount === 0;
  details.appendChild(make("summary", undefined, `${t("areaHarvest.details")} (${String(skippedCount)})`));
  if (plantingMode) {
    const reasonCounts = new Map<string, number>();
    for (const cell of planting.skipped) reasonCounts.set(cell.reason, (reasonCounts.get(cell.reason) ?? 0) + 1);
    if (planting.shortageCount > 0) reasonCounts.set("NO_SEEDS", (reasonCounts.get("NO_SEEDS") ?? 0) + planting.shortageCount);
    for (const [reason, count] of reasonCounts) details.appendChild(make("p", undefined, `${String(count)} · ${areaHarvestReason(reason)}`));
  } else if (skippedCount > 0) {
    const reasonCounts = new Map<string, number>();
    for (const cell of [...preview.waitingCells, ...preview.invalidCells]) reasonCounts.set(cell.reason, (reasonCounts.get(cell.reason) ?? 0) + 1);
    for (const [reason, count] of reasonCounts) details.appendChild(make("p", undefined, `${String(count)} · ${areaHarvestReason(reason)}`));
  }
  const products = make("div", "area-harvest-products");
  products.hidden = plantingMode || preview.products.length === 0;
  if (!plantingMode && preview.products.length > 0) {
    products.textContent = preview.products.map((product) => `+${String(product.quantity)} ${itemLabel(product.itemDefinitionId)}`).join(" · ");
  }
  const productCards = make("div", "area-harvest-product-list");
  if (!plantingMode) {
    for (const product of preview.products) {
      const visual = itemVisualFor(product.itemDefinitionId, itemVisualCatalogues());
      productCards.appendChild(renderItemCard({
        key: `area-product:${product.itemDefinitionId}`,
        visual,
        name: itemLabel(product.itemDefinitionId),
        quantity: product.quantity,
        quantityLabel: `${String(product.quantity)} ${itemLabel(product.itemDefinitionId)}`,
        note: null,
        state: "NORMAL",
        disabled: false,
        ariaLabel: `${itemLabel(product.itemDefinitionId)} · ${String(product.quantity)}`
      }, itemCardDeps()));
    }
  }
  const selector = make("div", "area-harvest-seed-selection");
  if (plantingMode) {
    const selected = currentAreaPlantOption();
    if (selected !== null) {
      const selectedCard = renderAreaPlantOptionCard(selected, () => {
        areaPlantPickerOpen = true;
        renderAreaHarvestPanel();
      });
      selectedCard.classList.add("area-harvest-seed-chip");
      selector.appendChild(selectedCard);
    }
    const change = make("button", "secondary area-harvest-change", t("areaHarvest.changePlant"));
    change.type = "button";
    change.addEventListener("click", () => {
      areaPlantPickerOpen = true;
      renderAreaHarvestPanel();
    });
    selector.appendChild(change);
  }
  const empty = make("p", "area-harvest-empty");
  empty.hidden = plannedCount > 0;
  empty.textContent = plantingMode
    ? t("areaHarvest.noPlantable")
    : preview.treesInArea + preview.cropsInArea === 0
      ? t("areaHarvest.empty")
      : t("areaHarvest.noReady");
  const actions = make("div", "area-harvest-actions");
  const cancel = make("button", "secondary area-harvest-cancel", t("areaHarvest.cancelAction"));
  cancel.type = "button";
  cancel.disabled = false;
  cancel.addEventListener("click", cancelAreaHarvest);
  actions.appendChild(cancel);
  const progress = areaHarvestSelection.progress;
  if (areaHarvestSelection.pending) {
    actions.appendChild(make("span", "area-harvest-progress-action", progress === null
      ? t("areaHarvest.progressCells", { completed: 0, total: 0, percent: 0 })
      : t("areaHarvest.progressCells", { completed: progress.completedCells, total: progress.totalCells, percent: areaProgressPercent(progress) })));
  } else {
    const confirm = make("button", "primary", plantingMode
      ? t("areaHarvest.plantConfirm", { count: planting.plannedCount })
      : t("areaHarvest.confirm"));
    confirm.type = "button";
    confirm.disabled = plantingMode ? planting.plannedCount === 0 || currentAreaPlantOption() === null : preview.readyCount === 0;
    confirm.addEventListener("click", () => void run(plantingMode ? confirmAreaPlanting : confirmAreaHarvest));
    actions.appendChild(confirm);
  }
  const progressNote = progress === null
    ? null
    : make(
        "p",
        "muted",
        t("areaHarvest.progressShort", {
          completed: progress.completedGroups,
          total: progress.totalGroups
        })
      );
  const partialNote = progress !== null && !areaHarvestSelection.pending && areaHarvestSelection.lastResult === null
    ? make("p", "error", t("areaHarvest.partialRetry"))
    : null;
  const progressNodes = [areaHarvestSelection.pending || areaHarvestSelection.lastResult !== null ? null : progressNote, partialNote].filter((node): node is HTMLParagraphElement => node !== null);
  const previewBody = make("div", "area-harvest-preview");
  previewBody.appendChild(summary);
  previewBody.appendChild(legend);
  previewBody.appendChild(details);
  previewBody.appendChild(empty);
  previewBody.appendChild(products);
  previewBody.appendChild(productCards);
  previewBody.appendChild(selector);
  for (const node of progressNodes) previewBody.appendChild(node);
  if (areaHarvestSelection.lastResult !== null) {
    const result = areaHarvestSelection.lastResult;
    const reasons = result.reasons.length === 0 ? "" : ` ${t("areaHarvest.reasons")}: ${[...new Set(result.reasons)].map(areaHarvestReason).join(", ")}`;
    previewBody.appendChild(make("p", "area-harvest-result", `${t(plantingMode ? "areaHarvest.plantResult" : "areaHarvest.result", { harvested: result.succeeded, planted: result.succeeded, skipped: result.skipped })}${reasons}`));
  }
  const hint = areaHarvestFocusHint();
  if (hint !== null) previewBody.appendChild(make("p", "area-harvest-cell-hint", hint));
  panel.replaceChildren(toolbar, previewBody, actions);
}

function startAreaHarvest(): void {
  if (!requireEconomicState()) return;
  // The area preview uses the same authoritative cell projection as the renderer. Keep it warm
  // even when the optional 3D canvas has not been opened yet, otherwise an empty map would paint
  // every cell red and teach the wrong placement rule.
  if (scene === null) state.cellMap = sceneInput().cells;
  areaPlantPickerOpen = false;
  areaHarvestSelection = { active: true, operation: "HARVEST", plantOptionKey: plantOptionModels().find((option) => option.selectable)?.key ?? null, first: null, second: null, pending: false, minimized: false, requestId: null, taskFarmId: null, taskGroups: null, syncing: false, focus: null, progress: null, lastResult: null };
  clearSelection();
  clearObjectSelection();
  clearResourceNodeSelection();
  syncAreaHarvestOverlay();
  renderAreaHarvestPanel();
  renderAreaHarvestLauncher();
  renderDock();
}

function cancelAreaHarvest(): void {
  if (areaHarvestSelection.pending) return;
  areaPlantPickerOpen = false;
  areaHarvestSelection = { active: false, operation: "HARVEST", plantOptionKey: null, first: null, second: null, pending: false, minimized: false, requestId: null, taskFarmId: null, taskGroups: null, syncing: false, focus: null, progress: null, lastResult: null };
  syncAreaHarvestOverlay();
  renderAreaHarvestPanel();
  renderAreaHarvestLauncher();
  renderActionControls(currentSelection());
}

function setAreaHarvestCorner(corner: AreaHarvestCorner): void {
  if (!areaHarvestSelection.active || areaHarvestSelection.pending || areaHarvestSelection.minimized) return;
  if (areaHarvestSelection.second !== null) {
    areaHarvestSelection = { ...areaHarvestSelection, focus: corner };
  } else if (areaHarvestSelection.first === null) {
    areaHarvestSelection = { ...areaHarvestSelection, first: corner, focus: null, progress: null, requestId: null, taskGroups: null, lastResult: null };
  } else {
    areaHarvestSelection = { ...areaHarvestSelection, second: corner, focus: null, progress: null, requestId: null, taskGroups: null, lastResult: null };
  }
  scene?.setSelection(null);
  syncAreaHarvestOverlay();
  const preview = currentAreaHarvestPreview();
  bootPerfInteractionDiagnostic("area_harvest_corner_selected", {
    corner,
    first: areaHarvestSelection.first,
    second: areaHarvestSelection.second,
    treesInArea: preview.treesInArea,
    cropsInArea: preview.cropsInArea,
    readyCount: preview.readyCount,
    skippedCount: preview.skippedCount
  });
  renderAreaHarvestPanel();
}

async function runAreaTask(): Promise<void> {
  if (!requireEconomicState() || state.farmId === null || areaHarvestSelection.pending) return;
  const taskFarmId = state.farmId;
  const planting = areaHarvestSelection.operation === "PLANT";
  const option = planting ? currentAreaPlantOption() : null;
  const preview = planting ? null : currentAreaHarvestPreview();
  const plantingPreview = planting ? currentAreaPlantPreview() : null;
  if (planting && (option === null || plantingPreview === null || plantingPreview.plannedCells.length === 0)) return;
  if (!planting && (preview === null || preview.readyCount === 0)) return;
  const baseRequestId = areaHarvestSelection.requestId ?? newRequestId(planting ? "plant-area" : "harvest-area");
  const groups: readonly AreaRunnerGroup[] = areaHarvestSelection.taskGroups ?? (planting
    ? areaHarvestGroups(plantingPreview?.plannedCells ?? []).map((items) => option?.kind === "CROP"
      ? { kind: "PLANT_CROP" as const, definitionId: option.definitionId, items }
      : { kind: "PLANT_TREE" as const, definitionId: option?.definitionId ?? "", items })
    : [
        ...areaHarvestGroups(preview?.candidates ?? []).map((items) => ({ kind: "TREE" as const, items })),
        ...areaHarvestGroups(preview?.cropCandidates ?? []).map((items) => ({ kind: "CROP" as const, items }))
      ]);
  const totalCells = groups.reduce((sum, group) => sum + group.items.length, 0);
  const existing = areaHarvestSelection.progress;
  const progress = existing ?? { completedGroups: 0, totalGroups: groups.length, completedCells: 0, totalCells, succeeded: 0, skipped: 0, reasons: [] as readonly string[] };
  areaHarvestSelection = { ...areaHarvestSelection, pending: true, syncing: false, requestId: baseRequestId, taskFarmId, taskGroups: groups, progress, lastResult: null };
  renderAreaHarvestPanel();
  renderAreaHarvestLauncher();
  try {
    for (let groupIndex = progress.completedGroups; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex];
      if (group === undefined) continue;
      const groupStartedAt = performance.now();
      const result = group.kind === "TREE"
        ? await api().harvestTreeArea(taskFarmId, { requestId: `${baseRequestId}_tree_${String(groupIndex)}`, trees: group.items.map(({ treeInstanceId, expectedTreeVersion }) => ({ treeInstanceId, expectedTreeVersion })) })
        : group.kind === "CROP"
          ? await api().harvestCropArea(taskFarmId, { requestId: `${baseRequestId}_crop_${String(groupIndex)}`, crops: group.items.map(({ cropInstanceId, expectedCropVersion }) => ({ cropInstanceId, expectedCropVersion })) })
          : group.kind === "PLANT_CROP"
            ? await api().plantCropArea(taskFarmId, { requestId: `${baseRequestId}_crop_${String(groupIndex)}`, cropDefinitionId: group.definitionId, cells: group.items })
            : await api().plantTreeArea(taskFarmId, { requestId: `${baseRequestId}_tree_${String(groupIndex)}`, treeDefinitionId: group.definitionId, cells: group.items });
      if (!areaTaskIsCurrent(baseRequestId, taskFarmId)) return;
      const succeeded = "harvestedCount" in result ? result.harvestedCount : result.plantedCount;
      const skipped = result.skippedCount;
      const currentProgress = areaHarvestSelection.progress;
      if (currentProgress === null) return;
      const reasons = [...currentProgress.reasons, ...result.results.filter((item) => item.reason !== null).map((item) => item.reason as string)];
      areaHarvestSelection = {
        ...areaHarvestSelection,
        progress: { ...currentProgress, completedGroups: groupIndex + 1, completedCells: currentProgress.completedCells + result.results.length, succeeded: currentProgress.succeeded + succeeded, skipped: currentProgress.skipped + skipped, reasons }
      };
      bootPerfInteractionDiagnostic("area_group_finished", { operation: planting ? "PLANT" : "HARVEST", group: groupIndex + 1, totalGroups: groups.length, submitted: group.items.length, succeeded, skipped, elapsedMs: Math.round((performance.now() - groupStartedAt) * 100) / 100 });
      renderAreaHarvestPanel();
    }
    if (!areaTaskIsCurrent(baseRequestId, taskFarmId)) return;
    areaHarvestSelection = { ...areaHarvestSelection, syncing: true };
    renderAreaHarvestPanel();
    const refreshStartedAt = performance.now();
    await Promise.all([refreshFarm({ tiles: true, crops: true, trees: true, constructions: false }), refreshAccount()]);
    if (!areaTaskIsCurrent(baseRequestId, taskFarmId)) return;
    const finalProgress = areaHarvestSelection.progress;
    if (finalProgress === null) return;
    const finalResult = { succeeded: finalProgress.succeeded, skipped: finalProgress.skipped, reasons: finalProgress.reasons };
    bootPerfInteractionDiagnostic("area_refresh_finished", { operation: planting ? "PLANT" : "HARVEST", elapsedMs: Math.round((performance.now() - refreshStartedAt) * 100) / 100 });
    areaHarvestSelection = { ...areaHarvestSelection, pending: false, syncing: false, minimized: finalResult.skipped > 0 ? areaHarvestSelection.minimized : false, requestId: null, taskFarmId: null, taskGroups: null, lastResult: finalResult };
    setStatus((translate) => translate(planting ? "areaHarvest.plantResult" : "areaHarvest.result", { planted: finalResult.succeeded, harvested: finalResult.succeeded, skipped: finalResult.skipped }));
  } catch (error: unknown) {
    if (areaTaskIsCurrent(baseRequestId, taskFarmId)) {
      areaHarvestSelection = { ...areaHarvestSelection, pending: false, syncing: false };
      renderAreaHarvestPanel();
      renderAreaHarvestLauncher();
    }
    throw error;
  } finally {
    renderAreaHarvestPanel();
    renderAreaHarvestLauncher();
    renderActionControls(currentSelection());
  }
}

async function confirmAreaHarvest(): Promise<void> {
  if (areaHarvestSelection.operation !== "HARVEST") return;
  await runAreaTask();
}

async function confirmAreaPlanting(): Promise<void> {
  if (areaHarvestSelection.operation !== "PLANT") return;
  await runAreaTask();
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
    treeDefinitions: state.treeDefinitions,
    fish: state.fish,
    resourceNodes: state.resourceNodes
  });
  const tabs = inventoryTabs(cards);
  // A tab can empty out while it is open - the last seed spent on the last cell. Falling back to
  // everything keeps the panel showing the farm rather than an empty shelf.
  if (!tabs.includes(inventoryCategory)) inventoryCategory = "ALL";
  const counts = inventoryCategoryCounts(cards);

  const tabBar = element<HTMLElement>("inventory-tabs");
  tabBar.hidden = cards.length === 0;
  renderCategoryTabs(
    tabBar,
    tabs.map((category) => ({
      id: category,
      label: t(inventoryCategoryKey(category)),
      count: counts[category]
    })),
    inventoryCategory,
    (category) => {
      inventoryCategory = category;
      renderInventory();
    }
  );

  const grid = element<HTMLElement>("inventory-grid");
  grid.replaceChildren();
  for (const card of visibleInventoryCards(cards, inventoryCategory)) {
    grid.appendChild(inventoryCardNode(card));
  }
  const empty = element<HTMLElement>("inventory-empty");
  empty.hidden = cards.length > 0;
  empty.textContent = t("inventory.empty");
}

/** One pending warehouse upgrade at a time, so a double click cannot send two commands. */
let warehouseUpgradePending = false;

/**
 * The Home Island warehouse, as one compact strip above the shelf.
 *
 * Everything drawn here is the server's: the tier name, the usage, the capacity and the next cost all
 * come from `/warehouse`, and the button sends a request id and nothing else. When the island cannot
 * accept a reward the server answers `WAREHOUSE_FULL`, which the shared error table already
 * localises, so this strip only has to say what the island is holding and what the next step costs.
 */
function renderWarehouse(): void {
  const node = element<HTMLElement>("warehouse");
  const warehouse = state.warehouse;
  node.hidden = warehouse === null;
  if (warehouse === null) return;
  const format = (value: number): string => value.toLocaleString(state.language);

  element<HTMLElement>("warehouse-title").textContent = t("warehouse.title");
  element<HTMLElement>("warehouse-tier").textContent = t(
    warehouse.tierDisplayNameKey as MessageKey
  );
  element<HTMLElement>("warehouse-usage").textContent = t("warehouse.usedOf", {
    used: format(warehouse.used),
    capacity: format(warehouse.capacity)
  });
  const ratio = warehouse.capacity === 0 ? 1 : Math.min(1, warehouse.used / warehouse.capacity);
  renderCapacityBar(
    element<HTMLElement>("warehouse-bar"),
    element<HTMLElement>("warehouse-bar-fill"),
    ratio,
    warehouse.overCapacity ? "over" : warehouse.available === 0 ? "full" : "normal"
  );
  node.classList.toggle("is-full", warehouse.available === 0);
  node.classList.toggle("is-over", warehouse.overCapacity);

  const note = element<HTMLElement>("warehouse-note");
  const noteText = warehouse.overCapacity
    ? t("warehouse.overCapacity")
    : warehouse.available === 0
      ? t("warehouse.fullHint")
      : "";
  note.hidden = noteText === "";
  note.textContent = noteText;

  const next = element<HTMLElement>("warehouse-next");
  const upgrade = element<HTMLButtonElement>("warehouse-upgrade");
  const cost = warehouse.nextUpgrade;
  if (warehouse.nextTier === null || cost === null || warehouse.nextCapacity === null) {
    next.textContent = t("warehouse.maxTier");
    upgrade.hidden = true;
    return;
  }
  const costParts = [
    `${format(cost.gold)} ${currencyLabel(cost.currencyId, currencyDisplayKey(cost.currencyId))}`,
    ...cost.materials.map(
      (material) => `${format(material.quantity)} ${itemName(material.itemDefinitionId, itemDisplayKey(material.itemDefinitionId) ?? "")}`
    )
  ];
  next.textContent = `${t("warehouse.nextCapacity", { capacity: format(warehouse.nextCapacity) })} · ${t("warehouse.cost", { cost: costParts.join(" · ") })}`;
  upgrade.hidden = false;
  upgrade.disabled = warehouseUpgradePending || !accountReady || reconciliationPending;
  upgrade.textContent = warehouseUpgradePending ? t("warehouse.upgrading") : t("warehouse.upgrade");
}

/**
 * Buys the next warehouse tier.
 *
 * The server decides the tier and its price from the catalogue; this sends a request id, adopts the
 * status the server returns, and refreshes the account so the shelf and the wallet agree with it.
 */
async function upgradeWarehouse(): Promise<void> {
  if (!requireEconomicState() || state.warehouse === null || warehouseUpgradePending) return;
  warehouseUpgradePending = true;
  renderWarehouse();
  try {
    const result = await api().upgradeWarehouse(newRequestId("warehouse"));
    state.warehouse = result.warehouse;
    await refreshAccount();
    setStatus((translate) =>
      translate("status.warehouseUpgraded", {
        tier: translate(result.warehouse.tierDisplayNameKey as MessageKey),
        capacity: result.warehouse.capacity.toLocaleString(state.language)
      })
    );
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    warehouseUpgradePending = false;
    renderWarehouse();
  }
}

/** The tab's own words, spelled out so the translator stays total. */
function inventoryCategoryKey(category: InventoryCategory): MessageKey {
  switch (category) {
    case "ALL":
      return "inventory.category.all";
    case "PRODUCE":
      return "inventory.category.produce";
    case "FISH":
      return "inventory.category.fish";
    case "MATERIALS":
      return "inventory.category.materials";
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
  // A sellable stack offers the one action the inventory can honestly offer: take it to the market.
  // The market is still where the trade settles, and the goods the player does not sell are not
  // touched - a card that sold on click would be an inventory screen with a shop hidden in it.
  const sellEntry = state.shop.find(
    (row) => row.itemDefinitionId === card.itemDefinitionId && row.sellPrice !== null
  );
  const sellLabel = sellEntry === undefined ? "" : `, ${t("inventory.sellAtMarket")}`;
  return renderInventorySlot(
    {
      key: card.key,
      visual: card.visual,
      name,
      quantity: card.quantity,
      quantityLabel,
      note: inventoryNoteFor(card.itemDefinitionId),
      state: "NORMAL",
      disabled: false,
      ariaLabel: `${name} — ${quantityLabel}${sellLabel}`
    },
    itemCardDeps(),
    sellEntry === undefined
      ? {}
      : {
          onSelect: () => {
            openFarmMarket({ direction: "sell", entryId: sellEntry.shopEntryId });
          }
        }
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

function inventoryQuantity(itemDefinitionId: string): number {
  return state.inventory
    .filter((entry) => entry.itemDefinitionId === itemDefinitionId)
    .reduce((total, entry) => total + entry.quantity, 0);
}

/** What every visual item card needs: the shared picture cache and the icon set. */
function itemCardDeps(): {
  readonly thumbnails: ItemThumbnails;
  readonly icon: (name: IconName, size?: number) => SVGElement;
} {
  return { thumbnails: itemThumbnails, icon: (name, size) => createIcon(name, size) };
}

/**
 * The Farm Market: a shelf of visual cards and one transaction panel.
 *
 * It used to be a vertical list of text rows, each carrying its own stepper and Buy button - a web
 * form wearing a game's clothes. V14.3 keeps the server side exactly as it was (the same buy and sell
 * commands, the same prices, the same ledger) and changes only the shape of the question: pick a card,
 * then say how many, then confirm. One item is in play at a time, which is why the quantity control
 * lives in the panel rather than on every card.
 */

/** Which card the trade panel is showing, and how many the player has asked for. */
let marketSelection: string | null = null;
let marketQuantity = 1;
/** One trade at a time: a second press while the first is settling does nothing (the server's own
 * idempotency is the real boundary - this only stops the UI from asking twice). */
let marketTradePending = false;
let marketGridSignature = "";
let marketTradeSignature = "";

/** The market's cards for a direction, from the rows the server last sent. */
function marketCardsFor(direction: MarketDirection): MarketCard[] {
  return marketCards({
    entries: state.shop,
    direction,
    inventory: state.inventory,
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions,
    fish: state.fish,
    resourceNodes: state.resourceNodes,
    playerLevel: state.progression?.level ?? null
  });
}

/** The wallet the market trades in. Absent means zero, which is what it is. */
function goldBalance(): number {
  return state.wallet.find((entry) => entry.currencyId === "currency_gold")?.balance ?? 0;
}

/*
 * Work areas: player-named groups of cells a future Job may be asked to work.
 *
 * Estate view only, because naming a field is map work: a character standing in the crop cannot pick
 * the twelve cells along the shore. The panel is the *only* reader. Work areas are not part of the
 * farm's ordinary loads and never part of the growth poll, so a player who never opens the panel
 * causes no work-area traffic at all - which is the D1 rule this slice has to keep.
 *
 * The durable model is the explicit cell list the server stores. A rectangle is only how a finger
 * picks cells, so two taps fill one and the result is converted to cells before it is ever sent.
 */

type WorkAreaEditorMode = "CREATE" | "CELLS" | "RENAME";

interface WorkAreaEditor {
  readonly mode: WorkAreaEditorMode;
  readonly workAreaId: string | null;
  readonly version: number;
  kind: WorkAreaKind;
  name: string;
  draft: ReadonlySet<string>;
  corner: { readonly x: number; readonly y: number } | null;
  /** The cell under the pointer, purely local feedback - never sent, never persisted. */
  hover: { readonly x: number; readonly y: number } | null;
}

let workAreaEditor: WorkAreaEditor | null = null;
let pendingMiningSetup: { readonly nodeId: string } | null = null;
let workAreasLoaded = false;
let workAreasBusy = false;
let workAreaRenderSignature = "";

/** Reads the farm's areas. Called when the panel opens and after a mutation - never on a timer. */
async function loadWorkAreas(): Promise<void> {
  if (state.farmId === null) return;
  workAreasBusy = true;
  workAreaRenderSignature = "";
  renderWorkAreas();
  try {
    const result = await api().getWorkAreas(state.farmId);
    state.workAreas = result.workAreas;
    workAreasLoaded = true;
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    workAreasBusy = false;
    workAreaRenderSignature = "";
    renderWorkAreas();
  }
}

function workAreaKindLabel(kind: WorkAreaKind): string {
  return t(WORK_AREA_KIND_LABEL_KEYS[kind] as MessageKey);
}

function workAreaRow(area: WorkAreaSummaryDTO): HTMLElement {
  const row = make("div", "work-area-row");
  row.setAttribute("role", "listitem");

  const title = make("strong", "work-area-name", area.displayName);
  const meta = make("span", "work-area-meta");
  meta.textContent = `${workAreaKindLabel(area.kind)} · ${t("workAreas.cells", { count: area.cellCount })}`;

  const actions = make("div", "work-area-actions");
  const rename = make("button", undefined, t("workAreas.rename"));
  rename.type = "button";
  rename.addEventListener("click", () => {
    workAreaEditor = {
      mode: "RENAME",
      workAreaId: area.workAreaId,
      version: area.version,
      kind: area.kind,
      name: area.displayName,
      draft: new Set(),
      corner: null,
      hover: null
    };
    scene?.setWorkAreaEdit(null);
    workAreaRenderSignature = "";
    renderWorkAreas();
  });
  const cells = make("button", undefined, t("workAreas.editCells"));
  cells.type = "button";
  cells.addEventListener("click", () => void beginWorkAreaCells(area));
  const remove = make("button", "danger", t("workAreas.delete"));
  remove.type = "button";
  remove.addEventListener("click", () => void deleteWorkArea(area));
  actions.appendChild(rename);
  actions.appendChild(cells);
  actions.appendChild(remove);

  row.appendChild(title);
  row.appendChild(meta);
  row.appendChild(actions);
  return row;
}

async function beginWorkAreaCells(area: WorkAreaSummaryDTO): Promise<void> {
  if (state.farmId === null) return;
  try {
    const detail = await api().getWorkArea(state.farmId, area.workAreaId);
    setWorkAreaEditor("CELLS", detail.workArea);
  } catch (error: unknown) {
    setStatus(describe(error), true);
  }
}

function setWorkAreaEditor(
  mode: WorkAreaEditorMode,
  area?: WorkAreaDTO,
  defaults: { readonly kind?: WorkAreaKind; readonly cells?: readonly { readonly x: number; readonly y: number }[]; readonly name?: string } = {}
): void {
  const draft = new Set<string>(
    (area?.cells ?? defaults.cells ?? []).map((cell) => `${String(cell.x)},${String(cell.y)}`)
  );
  workAreaEditor = {
    mode,
    workAreaId: area?.workAreaId ?? null,
    version: area?.version ?? 0,
    kind: area?.kind ?? defaults.kind ?? "FARM",
    name: area?.displayName ?? defaults.name ?? "",
    draft,
    corner: null,
    hover: null
  };
  // An existing area opens with its own committed cells already highlighted; a new one opens empty.
  syncWorkAreaScene();
    if (mode === "CREATE") setStatus(message("workAreas.pickFirst"));
  workAreaRenderSignature = "";
  renderWorkAreas();
}

function cancelWorkAreaEditor(): void {
  // Cancelling leaves persisted membership exactly where it was: the draft was never sent, so there
  // is nothing to undo, and the overlay simply goes away.
  workAreaEditor = null;
  pendingMiningSetup = null;
  scene?.setWorkAreaEdit(null);
  workAreaRenderSignature = "";
  renderWorkAreas();
}

/** Whether the ground under a cell can be worked for the area being edited. Client-side preview only. */
function workAreaCellFits(kind: WorkAreaKind, cell: { readonly x: number; readonly y: number }): boolean {
  const world = state.cellMap.cells.get(cellKey(cell.x, cell.y));
  return world !== undefined && cellFitsKind(kind, world.capabilities);
}

/**
 * Pushes the editor's whole picture at the renderer, in one call.
 *
 * Nothing here touches the network: the draft, the rectangle between the armed corner and the pointer,
 * the cells that cannot be worked and the hovered cell are all local. The rectangle is expanded to
 * cells here and nowhere else, which is what keeps the stored model a cell list.
 */
function syncWorkAreaScene(): void {
  const session = workAreaEditor;
  if (session === null) {
    scene?.setWorkAreaEdit(null);
    return;
  }
  const active = session;
  scene?.setWorkAreaEdit(
    workAreaEditScene({
      mode: active.mode,
      draft: active.draft,
      corner: active.corner,
      hover: active.hover,
      fits: (cell) => workAreaCellFits(active.kind, cell)
    })
  );
}

/**
 * One tap on the map while the editor is open.
 *
 * Deterministic, and the same three rules on a phone and a mouse:
 *
 * - a tap on a cell already in the draft **removes** it, and disarms any corner (a removal is never
 *   the start of a rectangle);
 * - otherwise, with no corner armed, the tap **adds** that cell and arms it as the first corner;
 * - otherwise the tap **fills the rectangle** between the armed corner and this cell, adding only the
 *   cells the kind can actually be worked on, and disarms the corner.
 *
 * A tap on ground the kind refuses does nothing but say so; the server would refuse it anyway.
 */
function editWorkAreaDraftAt(x: number, y: number): void {
  const session = workAreaEditor;
  if (session === null || session.mode === "RENAME") return;
  const cell = { x, y };
  const result = applyDraftClick(
    { draft: session.draft, corner: session.corner },
    cell,
    workAreaCellFits(session.kind, cell)
  );
  if (result.kind === "REFUSED") {
    setStatus(
      message(result.reason === "INVALID" ? "workAreas.invalidCell" : "workAreas.capReached", {
        max: MAX_WORK_AREA_CELLS
      }),
      true
    );
    return;
  }
  session.draft = result.next.draft;
  session.corner = result.next.corner;
  if (result.truncated) {
    setStatus(message("workAreas.capReached", { max: MAX_WORK_AREA_CELLS }), true);
  } else if (result.corner === "ARMED") {
    setStatus(message("workAreas.pickSecond"));
  }
  workAreaRenderSignature = "";
  syncWorkAreaScene();
  renderWorkAreas();
}

/** The renderer's hover, forwarded. Local feedback only: no request, no database, no rebuild. */
function onWorkAreaHover(cell: { readonly x: number; readonly y: number } | null): void {
  const session = workAreaEditor;
  if (session === null || session.mode === "RENAME") return;
  const same =
    (cell === null && session.hover === null) ||
    (cell !== null && session.hover !== null && cell.x === session.hover.x && cell.y === session.hover.y);
  if (same) return;
  session.hover = cell === null ? null : { x: cell.x, y: cell.y };
  syncWorkAreaScene();
}

function renderWorkAreaEditor(editor: HTMLElement): void {
  const session = workAreaEditor;
  editor.hidden = session === null;
  if (session === null) {
    editor.replaceChildren();
    return;
  }
  const children: HTMLElement[] = [];

  if (session.mode === "CREATE") {
    const kindField = make("label", "work-area-field", t("workAreas.kind"));
    const select = make("select");
    select.id = "work-area-kind";
    for (const kind of WORK_AREA_KINDS) {
      const option = make("option");
      option.value = kind;
      option.textContent = workAreaKindLabel(kind);
      option.selected = kind === session.kind;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      if (workAreaEditor !== null) workAreaEditor.kind = select.value as WorkAreaKind;
    });
    kindField.appendChild(select);
    children.push(kindField);
  }

  if (session.mode !== "CELLS") {
    const nameField = make("label", "work-area-field", t("workAreas.name"));
    const input = make("input");
    input.id = "work-area-name";
    input.type = "text";
    input.maxLength = MAX_WORK_AREA_NAME_LENGTH;
    input.value = session.name;
    input.addEventListener("input", () => {
      if (workAreaEditor !== null) workAreaEditor.name = input.value;
    });
    nameField.appendChild(input);
    children.push(nameField);
  }

  if (session.mode !== "RENAME") {
    const hint = make("p", "muted", t("workAreas.selectHint"));
    const count = make("p", "work-area-count", t("workAreas.selected", { count: session.draft.size }));
    children.push(hint, count);
  }

  const controls = make("div", "work-area-editor-controls");
  const save = make("button", "primary compact", t("workAreas.save"));
  save.type = "button";
  save.addEventListener("click", () => void saveWorkAreaEditor());
  const cancel = make("button", undefined, t("workAreas.cancel"));
  cancel.type = "button";
  cancel.addEventListener("click", cancelWorkAreaEditor);
  controls.appendChild(save);
  controls.appendChild(cancel);
  if (session.mode !== "RENAME") {
    const clear = make("button", undefined, t("workAreas.clear"));
    clear.type = "button";
    clear.addEventListener("click", () => {
      if (workAreaEditor === null) return;
      workAreaEditor.draft = new Set();
      workAreaEditor.corner = null;
      syncWorkAreaScene();
      workAreaRenderSignature = "";
      renderWorkAreas();
    });
    controls.appendChild(clear);
  }
  children.push(controls);
  editor.replaceChildren(...children);
}

function renderWorkAreas(): void {
  element<HTMLButtonElement>("work-area-create").textContent = t("workAreas.new");
  const session = workAreaEditor;
  const signature = [
    workAreaListSignature(state.workAreas),
    state.language,
    String(workAreasBusy),
    String(workAreasLoaded),
    session?.mode ?? "",
    session?.workAreaId ?? "",
    session?.mode === "CREATE" ? session.kind : "",
    session === null ? "" : [...session.draft].sort().join(";"),
    session?.corner === null || session?.corner === undefined
      ? ""
      : `${String(session.corner.x)},${String(session.corner.y)}`
  ].join("#");
  if (signature === workAreaRenderSignature) return;
  workAreaRenderSignature = signature;

  const note = element<HTMLElement>("work-areas-note");
  if (workAreasBusy) {
    note.hidden = false;
    note.textContent = t("workAreas.loading");
  } else if (!workAreasLoaded) {
    note.hidden = true;
  } else if (state.workAreas.length === 0) {
    note.hidden = false;
    note.textContent = t("workAreas.empty");
  } else {
    note.hidden = true;
  }

  element<HTMLElement>("work-area-list").replaceChildren(...state.workAreas.map(workAreaRow));
  renderWorkAreaEditor(element<HTMLElement>("work-area-editor"));
}

async function saveWorkAreaEditor(): Promise<void> {
  const session = workAreaEditor;
  if (session === null || state.farmId === null) return;
  const nameInput = document.getElementById("work-area-name") as HTMLInputElement | null;
  const normalized = normalizeNameInput(session.name || nameInput?.value || "");
  if (session.mode !== "CELLS") {
    if (normalized.problem === "EMPTY") {
      setStatus(message("workAreas.nameRequired"), true);
      return;
    }
    if (normalized.problem === "TOO_LONG") {
      setStatus(message("workAreas.nameTooLong", { max: MAX_WORK_AREA_NAME_LENGTH }), true);
      return;
    }
  }
  const cells: readonly WorkAreaCellDTO[] = draftCellList(session.draft).map((cell) => ({ x: cell.x, y: cell.y }));
  const farmId = state.farmId;
  let completedMiningNodeId: string | null = null;
  try {
    if (session.mode === "RENAME") {
      await api().renameWorkArea(farmId, session.workAreaId ?? "", {
        requestId: newRequestId("wa-rename"),
        name: normalized.value,
        expectedVersion: session.version
      });
      setStatus(message("workAreas.renamed"));
    } else if (session.mode === "CREATE") {
      if (cells.length === 0) {
        setStatus(message("workAreas.cellsRequired"), true);
        return;
      }
      const created = await api().createWorkArea(farmId, {
        requestId: newRequestId("wa-create"),
        kind: session.kind,
        name: normalized.value,
        cells
      });
      const miningSetup = pendingMiningSetup;
      pendingMiningSetup = null;
      if (miningSetup !== null && session.kind === "MINING") {
        // The explicit Save is the confirmation that permits both writes. Opening the mine panel
        // never creates an area or assignment by itself.
        const assigned = await assignJob("MINING", "resource_ore", created.workArea.workAreaId, false);
        if (assigned) {
          selectedResourceNodeId = miningSetup.nodeId;
          interactionFocusKey = `resource:${miningSetup.nodeId}`;
          completedMiningNodeId = miningSetup.nodeId;
          setStatus(message("mining.setupDone"));
        }
      } else {
        setStatus(message("workAreas.created", { name: normalized.value }));
      }
    } else {
      if (cells.length === 0) {
        setStatus(message("workAreas.cellsRequired"), true);
        return;
      }
      await api().replaceWorkAreaCells(farmId, session.workAreaId ?? "", {
        requestId: newRequestId("wa-cells"),
        cells,
        expectedVersion: session.version
      });
      setStatus(message("workAreas.cellsSaved"));
    }
  } catch (error: unknown) {
    setStatus(describe(error), true);
    return;
  }
  cancelWorkAreaEditor();
  await loadWorkAreas();
  if (completedMiningNodeId !== null) {
    setActivePanel(NO_PANEL);
    refreshInteractionCandidate();
    renderResourcePanel();
  }
}

async function deleteWorkArea(area: WorkAreaSummaryDTO): Promise<void> {
  if (state.farmId === null) return;
  if (!window.confirm(t("workAreas.confirmDelete", { name: area.displayName }))) return;
  try {
    await api().deleteWorkArea(state.farmId, area.workAreaId, {
      requestId: newRequestId("wa-delete"),
      expectedVersion: area.version
    });
    if (workAreaEditor?.workAreaId === area.workAreaId) cancelWorkAreaEditor();
    setStatus(message("workAreas.deleted"));
    await loadWorkAreas();
  } catch (error: unknown) {
    setStatus(describe(error), true);
  }
}

/*
/*
 * Auto: the Main Character, its Work Assignments, and what Auto would do next.
 *
 * D1 plans and explains; it does not act. Nothing in this panel plants, harvests, travels, unloads or
 * buys, the resolver it shows is a pure function of a bounded snapshot, and the panel is read when it
 * is opened and after an Auto action - never on a boot, a timer, the growth poll, the frame loop, the
 * pointer loop or the movement loop.
 */

let workersBusy = false;
let workersLoaded = false;
let workersError: unknown = null;
type WorkersView = "OVERVIEW" | "ASSIGNMENT_EDITOR";
let workersView: WorkersView = "OVERVIEW";
let workersRenderSignature = "";
/** The profession the assignment editor is open for, or null when it is closed. */
let workersDraftKind: JobKind | null = null;
/** The skill the editor is considering, reset whenever the profession changes. */
let workersDraftTarget = "";
/** The area the editor has selected, so a Mining panel can hand off its chosen area. */
let workersDraftAreaId = "";
/** The supply policy the editor would save with a new assignment. Off is the safe default. */
let workersDraftPolicy = false;
/** Reorder mode: full-width rows with large controls instead of two tiny arrows on every card. */
let workersReorderMode = false;

function autoEditorDiagnostic(event: string, detail = ""): void {
  const host = window.location.hostname;
  const development = host === "localhost" || host === "127.0.0.1";
  if (!development && !host.includes("happyfarm-staging")) return;
  console.info(`[AutoEditor] ${event}${detail === "" ? "" : ` ${detail}`}`);
}

/** The catalogues the assignment editor offers targets from: only what the world actually ships. */
function jobTargetSources(): JobTargetSources {
  return {
    crops: state.cropDefinitions,
    trees: state.treeDefinitions,
    resourceNodes: state.resourceNodes,
    fishingSpots: state.fishingSpots
  };
}

/** The catalogues an item's picture is looked up in - the same source every other surface uses. */
function itemVisualCatalogues(): ItemVisualCatalogues {
  return {
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions,
    fish: state.fish,
    resourceNodes: state.resourceNodes
  };
}

/**
 * The panel's whole read: the actor, its assignments, the farm's area names, its cargo and the plan.
 *
 * Four bounded reads, all only while this panel is open, and none of them a poll: a waiting state is a
 * comparison of timestamps on the server, so there is nothing here to poll *for*. The resolver runs for
 * this read and for an Auto action, and nowhere else.
 */
async function loadWorkers(): Promise<void> {
  if (state.farmId === null) return;
  workersBusy = true;
  autoEditorDiagnostic("EDITOR_DATA_LOAD_STARTED", `view=${workersView}`);
  workersError = null;
  workersRenderSignature = "";
  renderWorkers();
  renderResourcePanel();
  try {
    const [panelResult, areasResult, cargoResult, autoResult] = await Promise.allSettled([
      api().getWorkers(state.farmId),
      // The area list is the farm's own names, so a card can say where it works and the editor can
      // offer only areas of the right kind.
      api().getWorkAreas(state.farmId),
      // What the actor is *carrying*, which is a separate container from what is stored.
      api().getActorCargo(state.farmId),
      // What Auto would do next, and why. A plan, never an action.
      api().getAutoPlan(state.farmId)
    ]);
    if (panelResult.status === "rejected") throw panelResult.reason;
    if (areasResult.status === "rejected") throw areasResult.reason;
    state.workerActor = panelResult.value.actor;
    state.workers = panelResult.value.jobs;
    state.workAreas = areasResult.value.workAreas;
    if (cargoResult.status === "fulfilled") state.cargo = cargoResult.value.cargo;
    if (autoResult.status === "fulfilled") state.autoPlan = autoResult.value.plan;
    else {
      // The editor does not depend on the plan. Keep it usable when the optional preview read fails.
      state.autoPlan = null;
      setStatus(describe(autoResult.reason), true);
    }
    workersLoaded = true;
  } catch (error: unknown) {
    workersError = error;
    workersLoaded = false;
    setStatus(describe(error), true);
  } finally {
    workersBusy = false;
    workersRenderSignature = "";
    renderWorkers();
    renderResourcePanel();
    autoEditorDiagnostic("EDITOR_DATA_LOAD_SETTLED", `view=${workersView}`);
  }
}

function workersDataReady(): boolean {
  return workersLoaded && workersError === null && !workersBusy;
}

function workerAreaName(workAreaId: string): string {
  return state.workAreas.find((area) => area.workAreaId === workAreaId)?.displayName ?? "";
}

function workerAreaCells(workAreaId: string): number {
  return state.workAreas.find((area) => area.workAreaId === workAreaId)?.cellCount ?? 0;
}

function workerTargetName(job: JobDTO): string {
  return displayName(state.language, job.targetDisplayNameKey, job.targetDefinitionId);
}

/** The family a profession runs, for the lifecycle strip a card draws before a plan exists. */
function familyForJobKind(kind: JobKind): LifecycleFamilyDTO {
  switch (kind) {
    case "FARM":
      return "REPLANT_CROP";
    case "ORCHARD":
      return "PERENNIAL_PRODUCTION";
    case "FORESTRY":
    case "MINING":
      return "RESOURCE_NODE_GATHERING";
    case "AQUACULTURE":
    case "FISHERY":
      return "FISHING";
    case "LIVESTOCK":
      return "LIVESTOCK";
  }
}

/**
 * The picture for a skill: the real crop, tree or deposit art where this build ships it.
 *
 * The same shared thumbnail cache every other surface uses, and a deliberate, sized fallback where no
 * asset exists - never a broken image and never an invented model.
 */
function targetVisualFor(kind: JobKind, targetDefinitionId: string): ItemVisual {
  if (kind === "FARM") return cropVisualFor(targetDefinitionId);
  if (kind === "ORCHARD") {
    const tree = state.treeDefinitions.find((definition) => definition.treeDefinitionId === targetDefinitionId);
    if (tree !== undefined) return itemVisualFor(tree.harvestItemDefinitionId, itemVisualCatalogues());
  }
  if (kind === "FISHERY") {
    const spot = state.fishingSpots.find((candidate) => candidate.spotId === targetDefinitionId);
    const fish = state.fish[0];
    return spot === undefined || fish === undefined ? unknownItemVisual() : itemVisualFor(fish.itemDefinitionId, itemVisualCatalogues());
  }
  const node = state.resourceNodes.find((definition) => definition.definitionId === targetDefinitionId);
  return node === undefined ? unknownItemVisual() : resourceVisualFor(node.modelId);
}

function workerSkillVisual(job: JobDTO): ItemVisual {
  return targetVisualFor(job.kind, job.targetDefinitionId);
}

/** One thumbnail slot: the picture when the cache has one, the styled fallback when it does not. */
function visualNode(visual: ItemVisual, className: string, size = 40): HTMLElement {
  const box = make("span", className);
  box.dataset.fallback = visual.fallback;
  box.style.setProperty("--thumb-size", `${String(size)}px`);
  const image = document.createElement("img");
  image.alt = "";
  itemThumbnails.apply(visual.request, image, (result) => {
    // A picture that cannot be drawn leaves the card's own fallback, never a broken image.
    if (result.dataUrl === null) image.hidden = true;
  });
  box.appendChild(image);
  return box;
}

/** The icon each lifecycle step draws. Short labels carry the rest; no enum name ever reaches the HUD. */
const LIFECYCLE_ICONS: Readonly<Record<LifecycleStepToken, IconName>> = {
  seed: "seed",
  sapling: "sprout",
  plant: "plant",
  plantOnce: "plant",
  grow: "sprout",
  harvest: "harvest",
  warehouse: "inventory",
  travel: "walk",
  gather: "harvest",
  wait: "refresh",
  repeat: "refresh"
};

/** The production cycle, as a picture: thumbnails and short labels, separated by drawn arrows. */
function lifecycleStrip(family: LifecycleFamilyDTO): HTMLElement {
  const strip = make("div", "auto-cycle");
  strip.setAttribute("aria-label", t("workers.lifecycle"));
  lifecycleStepsFor(family).forEach((step, index) => {
    if (index > 0) strip.appendChild(make("span", "auto-cycle-arrow"));
    const node = make("span", "auto-cycle-step");
    const slot = make("span", "auto-cycle-icon");
    slot.appendChild(createIcon(LIFECYCLE_ICONS[step], 15));
    node.appendChild(slot);
    node.appendChild(make("span", "auto-cycle-label", t(`auto.step.${step}` as MessageKey)));
    strip.appendChild(node);
  });
  return strip;
}

/**
 * A status line in the player's words, from the server's own action or wait reason.
 *
 * The vocabulary is the resolver's; the wording is the panel's. `Ready` is a step the engine would take
 * now, and it is still only a plan - the panel says so once, above the list, rather than on every card.
 */
function autoStatusText(status: AutoStatus, action: AutoPlanDTO["action"]): string {
  const detail = t(`auto.detail.${status.token}` as MessageKey, {
    item: action !== null && "itemDefinitionId" in action ? itemLabel(action.itemDefinitionId) : "",
    count: action !== null && "cells" in action ? String(action.cells) : ""
  });
  return status.tone === "off" ? detail : `${t(`auto.status.${status.tone}` as MessageKey)}: ${detail}`;
}

/**
 * One Work Assignment, as a card.
 *
 * The card shows what the assignment *is* - its area, its skill, its cycle, its order, its policy - and
 * what Auto would do next with it. The words are "assignment" and "skill" throughout; the durable name
 * `job` stays in the protocol where it belongs.
 */
function workerCard(job: JobDTO, index: number, total: number): HTMLElement {
  const plan = planForAssignment(state.autoPlan, job.jobId);
  const fallbackReason: WaitReasonDTO | null = job.enabled ? null : "DISABLED";
  const status = autoStatusFor(plan?.action ?? null, plan?.waitReason ?? fallbackReason);
  const card = make("article", `auto-card auto-tone-${status.tone}`);
  card.setAttribute("role", "listitem");
  card.dataset.jobId = job.jobId;

  const head = make("div", "auto-card-head");
  head.appendChild(visualNode(workerSkillVisual(job), "auto-thumb", 44));
  const titles = make("div", "auto-card-titles");
  titles.appendChild(make("strong", "auto-card-name", workerTargetName(job)));
  titles.appendChild(
    make(
      "span",
      "auto-card-area muted",
      `${workerAreaName(job.workAreaId)} - ${t("workers.usableCells", {
        count: String(workerAreaCells(job.workAreaId))
      })}`
    )
  );
  head.appendChild(titles);
  head.appendChild(make("span", "auto-priority", t("workers.priority", { priority: String(job.priority) })));
  card.appendChild(head);

  card.appendChild(lifecycleStrip(plan?.skillFamily ?? familyForJobKind(job.kind)));
  card.appendChild(make("p", `auto-card-status auto-tone-${status.tone}`, autoStatusText(status, plan?.action ?? null)));
  if (plan?.claimed === true) card.appendChild(make("p", "auto-card-claimed muted", t("workers.claimed")));

  const policy = make("label", "auto-policy");
  const policyInput = make("input");
  policyInput.type = "checkbox";
  policyInput.checked = job.autoPurchaseSupplies;
  policyInput.disabled = workersBusy;
  policyInput.addEventListener("change", () => void setAssignmentPolicy(job, policyInput.checked));
  policy.appendChild(policyInput);
  policy.appendChild(make("span", "auto-policy-text", t("workers.policy")));
  card.appendChild(policy);
  card.appendChild(fundingBlock(job));

  const actions = make("div", "auto-card-actions");
  const toggle = make("button", "compact", job.enabled ? t("workers.disable") : t("workers.enable"));
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", job.enabled ? "true" : "false");
  toggle.addEventListener("click", () => void setJobEnabled(job, !job.enabled));
  actions.appendChild(toggle);
  // Reordering only appears in reorder mode, and then as full-size controls rather than tiny arrows.
  if (workersReorderMode) {
    const up = make("button", "compact auto-move", t("workers.up"));
    up.type = "button";
    up.disabled = index === 0;
    up.addEventListener("click", () => void moveJob(job.jobId, -1));
    const down = make("button", "compact auto-move", t("workers.down"));
    down.type = "button";
    down.disabled = index === total - 1;
    down.addEventListener("click", () => void moveJob(job.jobId, 1));
    actions.appendChild(up);
    actions.appendChild(down);
  }
  const remove = make("button", "danger compact", t("workers.remove"));
  remove.type = "button";
  remove.addEventListener("click", () => void removeJob(job));
  actions.appendChild(remove);
  card.appendChild(actions);
  return card;
}

/**
 * The assignment editor: pick the work, pick the skill, pick the area, set the policy, save.
 *
 * Cards rather than a form of selects, because the choice is short and visual: the profession, the
 * skill (with its own art), the area and one toggle. The player never configures buy, load, plant,
 * harvest or unload - those are the skill's internal steps, and the strip shows them as a picture.
 */
function renderWorkersEditor(editor: HTMLElement): void {
  const kind = workersDraftKind;
  editor.hidden = workersView !== "ASSIGNMENT_EDITOR" || !workersDataReady();
  autoEditorDiagnostic("EDITOR_RENDER_BRANCH", `view=${workersView} rendered=${String(!editor.hidden)}`);
  if (workersView !== "ASSIGNMENT_EDITOR" || kind === null) {
    editor.replaceChildren();
    return;
  }
  const sources = jobTargetSources();
  const targets = jobTargetsFor(kind, sources);
  const areas = compatibleAreas(kind, state.workAreas);
  if (workersDraftTarget === "" || !targets.some((option) => option.id === workersDraftTarget)) {
    workersDraftTarget = targets[0]?.id ?? "";
  }

  const kindRow = make("div", "auto-picker-row");
  kindRow.appendChild(make("span", "auto-picker-label", t("workers.pickKind")));
  const kindChips = make("div", "auto-chips");
  for (const candidate of WORK_AREA_KINDS) {
    const chip = make("button", "auto-chip-button", workAreaKindLabel(candidate));
    chip.type = "button";
    // A profession with nothing to assign is shown but not choosable: say why rather than hide it.
    chip.disabled = !kindIsAssignable(candidate, sources);
    if (candidate === kind) chip.classList.add("is-active");
    chip.addEventListener("click", () => {
      workersDraftKind = candidate;
      workersDraftTarget = "";
      workersDraftAreaId = "";
      workersRenderSignature = "";
      renderWorkers();
    });
    kindChips.appendChild(chip);
  }
  kindRow.appendChild(kindChips);

  const skillRow = make("div", "auto-picker-row");
  skillRow.appendChild(make("span", "auto-picker-label", t("workers.pickSkill")));
  const skillGrid = make("div", "auto-skill-grid");
  for (const option of targets) {
    const card = make("button", `auto-skill-card${option.id === workersDraftTarget ? " is-active" : ""}`);
    card.type = "button";
    card.appendChild(visualNode(targetVisualFor(kind, option.id), "auto-thumb", 40));
    card.appendChild(make("span", "auto-skill-name", displayName(state.language, option.displayNameKey, option.id)));
    card.addEventListener("click", () => {
      workersDraftTarget = option.id;
      workersRenderSignature = "";
      renderWorkers();
    });
    skillGrid.appendChild(card);
  }
  skillRow.appendChild(skillGrid);

  const areaRow = make("div", "auto-picker-row");
  areaRow.appendChild(make("span", "auto-picker-label", t("workers.pickArea")));
  const areaGrid = make("div", "auto-area-grid");
  let selectedArea = areas.some((area) => area.workAreaId === workersDraftAreaId)
    ? workersDraftAreaId
    : areas[0]?.workAreaId ?? "";
  workersDraftAreaId = selectedArea;
  for (const area of areas) {
    const card = make("button", `auto-area-card${area.workAreaId === selectedArea ? " is-active" : ""}`);
    card.type = "button";
    card.appendChild(make("strong", undefined, area.displayName));
    card.appendChild(
      make("span", "muted", t("workers.usableCells", { count: String(area.cellCount) }))
    );
    card.addEventListener("click", () => {
      for (const sibling of Array.from(areaGrid.children)) sibling.classList.remove("is-active");
      card.classList.add("is-active");
      selectedArea = area.workAreaId;
      workersDraftAreaId = selectedArea;
    });
    areaGrid.appendChild(card);
  }
  areaRow.appendChild(areaGrid);

  const policy = make("label", "auto-policy");
  const policyInput = make("input");
  policyInput.type = "checkbox";
  policyInput.checked = workersDraftPolicy;
  policyInput.addEventListener("change", () => {
    workersDraftPolicy = policyInput.checked;
  });
  policy.appendChild(policyInput);
  policy.appendChild(make("span", "auto-policy-text", t("workers.policy")));
  policy.appendChild(make("span", "auto-policy-hint muted", t("workers.policyHint")));

  const controls = make("div", "worker-editor-controls");
  const save = make("button", "primary compact", t("workers.save"));
  save.type = "button";
  save.disabled = targets.length === 0 || areas.length === 0;
  save.addEventListener("click", () =>
    void assignJob(kind, workersDraftTarget, selectedArea, workersDraftPolicy)
  );
  const cancel = make("button", undefined, t("workers.cancel"));
  cancel.type = "button";
  cancel.addEventListener("click", () => {
    autoEditorDiagnostic("EDITOR_CLOSED", "reason=cancel");
    workersView = "OVERVIEW";
    workersDraftKind = null;
    workersDraftTarget = "";
    workersDraftAreaId = "";
    workersRenderSignature = "";
    renderWorkers();
  });
  controls.appendChild(save);
  controls.appendChild(cancel);

  const note = make(
    "p",
    "muted",
    targets.length === 0 ? t("workers.noTargets") : areas.length === 0 ? t("workers.noAreas") : ""
  );
  note.hidden = targets.length > 0 && areas.length > 0;
  editor.replaceChildren(
    kindRow,
    skillRow,
    selectedSkillStrip(targets),
    areaRow,
    policy,
    note,
    controls
  );
}

/** The cycle of the skill the editor currently has selected, below the grid rather than on every card. */
function selectedSkillStrip(targets: readonly { readonly id: string }[]): HTMLElement {
  const strip = make("div", "auto-picker-strip");
  if (workersDraftKind === null || !targets.some((option) => option.id === workersDraftTarget)) return strip;
  strip.appendChild(lifecycleStrip(familyForJobKind(workersDraftKind)));
  return strip;
}

/** The actor header: who works, who is driving, and how full their hands are. */
function renderWorkersActor(): void {
  const actor = element<HTMLElement>("workers-actor");
  const actorDto = state.workerActor;
  actor.hidden = !workersDataReady() || actorDto === null;
  if (actorDto === null) return;
  element<HTMLElement>("workers-actor-name").textContent = t("workers.actor");
  const auto = actorDto.controlMode === "AUTO_CONTROLLED";
  const control = element<HTMLElement>("workers-control");
  control.textContent = t(auto ? "workers.autoOn" : "workers.autoOff");
  control.classList.toggle("is-auto", auto);
  control.classList.toggle("is-manual", !auto);

  const used = state.cargo?.used ?? 0;
  const capacity = state.cargo?.capacity ?? 0;
  element<HTMLElement>("workers-cargo-usage").textContent = t("workers.cargoUsage", {
    used: used.toLocaleString(state.language),
    capacity: capacity.toLocaleString(state.language)
  });
  const bar = element<HTMLElement>("workers-cargo-bar");
  const ratio = capacity <= 0 ? 0 : Math.min(1, used / capacity);
  bar.style.width = `${String(Math.round(ratio * 100))}%`;
  bar.classList.toggle("is-full", capacity > 0 && used >= capacity);
}

/** The one control, and the plan it would run. */
function renderWorkersAuto(): void {
  const section = element<HTMLElement>("workers-auto");
  const actorDto = state.workerActor;
  section.hidden = !workersDataReady() || actorDto === null;
  if (actorDto === null) return;
  const auto = actorDto.controlMode === "AUTO_CONTROLLED";
  const button = element<HTMLButtonElement>("workers-auto-toggle");
  button.textContent = t(auto ? "workers.autoStop" : "workers.autoStart");
  button.disabled = workersBusy || !accountReady || reconciliationPending;
  button.classList.toggle("is-auto", auto);

  const status = element<HTMLElement>("workers-auto-status");
  const progress = element<HTMLElement>("workers-auto-progress");
  const step = state.autoStep;
  // While Auto is running the line says what the server just *did*, with the numbers it reported -
  // never a client guess about what it might do next.
  if (auto && step !== null) {
    const run = autoRunStatusFor(step);
    const item = run.itemDefinitionId === null ? "" : itemLabel(run.itemDefinitionId);
    const skill =
      step.targetDisplayNameKey === null
        ? ""
        : displayName(state.language, step.targetDisplayNameKey, step.targetDefinitionId ?? "");
    status.textContent = t(`auto.run.${run.token}` as MessageKey, {
      item,
      quantity: run.quantity === null ? "" : String(run.quantity),
      skill
    });
    status.className = "auto-status auto-status-run auto-tone-ready";
    const field = autoFieldProgress(step.progress);
    progress.hidden = !auto;
    progress.textContent = [
      field === null ? "" : t("auto.run.progress", { planted: String(field.planted), total: String(field.total) }),
      t("auto.run.cargo", {
        used: step.cargo.used.toLocaleString(state.language),
        capacity: step.cargo.capacity.toLocaleString(state.language)
      })
    ]
      .filter((part) => part !== "")
      .join(" Â· ");
    return;
  }
  progress.hidden = true;
  progress.textContent = "";
  const plan = state.autoPlan;
  if (plan === null) {
    status.textContent = t("workers.noPlan");
    status.className = "auto-status auto-tone-off";
    return;
  }
  // Whether the actor is driven or not, the plan answers - which is the whole point of showing what
  // Auto *would* do before the player hands the character over.
  const shown = auto
    ? { status: autoStatusFor(plan.action, plan.waitReason), action: plan.action }
    : autoPreviewFor(plan);
  status.textContent = autoStatusText(shown.status, shown.action);
  status.className = `auto-status auto-tone-${shown.status.tone}`;
}

function renderWorkers(): void {
  const dataReady = workersDataReady();
  element<HTMLElement>("workers-title").textContent = t("panel.workers");
  const assign = element<HTMLButtonElement>("workers-assign");
  assign.textContent = t("workers.addAssignment");
  assign.hidden = !dataReady;
  const reorder = element<HTMLButtonElement>("workers-reorder");
  reorder.textContent = t(workersReorderMode ? "workers.reorderDone" : "workers.reorder");
  reorder.hidden = !dataReady || state.workers.length < 2;
  reorder.setAttribute("aria-pressed", workersReorderMode ? "true" : "false");

  const signature = [
    jobListSignature(state.workers),
    state.language,
    String(workersBusy),
    String(workersLoaded),
    String(workersReorderMode),
    state.workerActor === null ? "" : `${state.workerActor.actorId}:${state.workerActor.controlMode}:${String(state.workerActor.version)}`,
    workersDraftKind ?? "",
    workersDraftTarget,
    workersDraftAreaId,
    String(workersDraftPolicy),
    state.workAreas.map((area) => `${area.workAreaId}:${area.kind}:${area.displayName}:${String(area.cellCount)}`).join(","),
    state.autoPlan === null ? "" : JSON.stringify(state.autoPlan),
    state.cargo === null
      ? ""
      : `${String(state.cargo.version)}:${String(state.cargo.used)}:${state.cargo.items
          .map((item) => `${item.itemDefinitionId}x${String(item.quantity)}`)
          .join(",")}`
  ].join("#");
  if (signature === workersRenderSignature) return;
  workersRenderSignature = signature;

  const note = element<HTMLElement>("workers-note");
  if (workersBusy) {
    note.hidden = false;
    note.textContent = t("workers.loading");
  } else if (workersError !== null) {
    note.hidden = false;
    note.textContent = `${t("workers.loadError")} `;
    const retry = make("button", "compact", t("workers.retry"));
    retry.type = "button";
    retry.addEventListener("click", () => void loadWorkers());
    note.appendChild(retry);
  } else if (!workersLoaded) {
    note.hidden = true;
  } else if (state.workers.length === 0) {
    note.hidden = false;
    note.textContent = t("workers.empty");
  } else {
    // D1's honesty rule: the panel shows a plan, and says there is no work behind it yet.
    note.hidden = false;
    note.textContent = t("workers.planNote");
  }

  renderWorkersActor();
  renderWorkersAuto();
  const list = element<HTMLElement>("workers-list");
  list.hidden = !dataReady;
  list.replaceChildren(...(dataReady ? state.workers.map((job, index) => workerCard(job, index, state.workers.length)) : []));
  renderWorkersCargo();
  renderWorkersEditor(element<HTMLElement>("workers-editor"));
}

/**
 * The cargo strip: what the actor is carrying, and the one button that moves it into the warehouse.
 *
 * The copy says plainly that these goods are *carried*, not stored - the whole point of a separate
 * container - and the button is described as the foundation affordance it is: there is no travel yet,
 * so this is a manual unload rather than an actor walking home.
 */
function renderWorkersCargo(): void {
  const section = element<HTMLElement>("workers-cargo");
  const cargo = state.cargo;
  section.hidden = !workersDataReady() || cargo === null;
  if (!workersDataReady() || cargo === null) return;

  element<HTMLElement>("workers-cargo-title").textContent = t("workers.cargoTitle");

  const note = element<HTMLElement>("workers-cargo-note");
  note.hidden = cargo.items.length > 0;
  note.textContent = t("workers.cargoEmpty");

  element<HTMLElement>("workers-cargo-list").replaceChildren(
    ...cargo.items.map((item) => {
      const row = make("span", "workers-cargo-stack");
      row.setAttribute("role", "listitem");
      row.appendChild(make("strong", undefined, t(item.displayNameKey as MessageKey)));
      row.appendChild(make("span", "muted", `x${String(item.quantity)}`));
      return row;
    })
  );

  const unload = element<HTMLButtonElement>("workers-cargo-unload");
  unload.hidden = cargo.items.length === 0;
  unload.disabled = workersBusy || !accountReady || reconciliationPending;
  unload.textContent = t("workers.unload");
  unload.title = t("workers.unloadFoundation");
}

async function unloadCargoAtWarehouse(): Promise<void> {
  const cargo = state.cargo;
  if (!requireEconomicState() || state.farmId === null || cargo === null || cargo.items.length === 0) return;
  const client = api();
  const farmId = state.farmId;
  workersBusy = true;
  workersRenderSignature = "";
  renderWorkers();
  try {
    const result = await client.unloadCargo(farmId, {
      requestId: newRequestId("cargo-unload"),
      expectedVersion: cargo.version
    });
    state.cargo = result.cargo;
    setStatus(message("workers.unloaded"));
  } catch (error: unknown) {
    setStatus(
      error instanceof ApiError && error.code === "WAREHOUSE_FULL"
        ? message("workers.unloadFull")
        : describe(error),
      true
    );
  } finally {
    workersBusy = false;
  }
  // The warehouse changed, so the account state it feeds is re-read with it.
  await refreshAccount();
  await loadWorkers();
}

/**
 * The one control: START_AUTO / STOP_AUTO on the farm owner's Main Character.
 *
 * It changes control and nothing else. It does not plant, spend, teleport or simulate work, and the
 * plan the panel shows afterwards comes from the resolver reading the world as it is.
 */
async function toggleAuto(): Promise<void> {
  const actorDto = state.workerActor;
  if (!requireEconomicState() || state.farmId === null || actorDto === null) return;
  const farmId = state.farmId;
  const startAuto = actorDto.controlMode !== "AUTO_CONTROLLED";
  autoControlDiagnostic(startAuto ? "EXPLICIT_START_REQUESTED" : "EXPLICIT_STOP_REQUESTED");
  try {
    await api().setActorControl(farmId, {
      requestId: newRequestId(startAuto ? "auto-start" : "auto-stop"),
      startAuto,
      expectedVersion: actorDto.version
    });
    autoControlDiagnostic(startAuto ? "EXPLICIT_START_ACCEPTED" : "EXPLICIT_STOP_ACCEPTED");
    setStatus(message(startAuto ? "workers.autoStarted" : "workers.autoStopped"));
  } catch (error: unknown) {
    setStatus(describe(error), true);
    return;
  }
  // The loop follows control, never the other way round: starting asks the server for the first step,
  // and stopping abandons whatever walk the client was drawing.
  if (startAuto) {
    state.autoStep = null;
    kickAutoStep();
  } else {
    stopAutoStepLoop();
  }
  await loadWorkers();
}

function toggleReorderMode(): void {
  workersReorderMode = !workersReorderMode;
  workersRenderSignature = "";
  renderWorkers();
}

async function assignJob(
  kind: JobKind,
  targetDefinitionId: string,
  workAreaId: string,
  autoPurchaseSupplies: boolean
): Promise<boolean> {
  if (!requireEconomicState() || state.farmId === null || targetDefinitionId === "" || workAreaId === "") return false;
  try {
    const created = await api().createJob(state.farmId, {
      requestId: newRequestId("job-create"),
      workAreaId,
      kind,
      targetDefinitionId
    });
    // The policy is a second, separate write on the row that was just created - never a field of the
    // create command, so a client can never invent a policy on an assignment it does not own.
    if (autoPurchaseSupplies) {
      await api().setAssignmentPolicy(state.farmId, created.job.jobId, {
        requestId: newRequestId("job-policy"),
        autoPurchaseSupplies: true,
        expectedVersion: created.job.version
      });
    }
    autoEditorDiagnostic("EDITOR_CLOSED", "reason=save");
    workersView = "OVERVIEW";
    workersDraftKind = null;
    workersDraftTarget = "";
    workersDraftAreaId = "";
    workersDraftPolicy = false;
    setStatus(message("workers.created"));
  } catch (error: unknown) {
    setStatus(describe(error), true);
    return false;
  }
  await loadWorkers();
  return true;
}

async function setAssignmentPolicy(job: JobDTO, autoPurchaseSupplies: boolean): Promise<void> {
  if (!requireEconomicState()) return;
  if (state.farmId === null) return;
  try {
    await api().setAssignmentPolicy(state.farmId, job.jobId, {
      requestId: newRequestId("job-policy"),
      autoPurchaseSupplies,
      expectedVersion: job.version,
      // The command replaces the whole policy, so the funding half travels with it unchanged.
      funding: { enabled: job.autoFundingEnabled, items: job.fundingItems }
    });
    setStatus(message("workers.policySaved"));
  } catch (error: unknown) {
    setStatus(describe(error), true);
    return;
  }
  await loadWorkers();
}

/** The most resources one assignment may whitelist for emergency funding (domain bound). */
const MAX_FUNDING_ITEMS = 8;

/**
 * The emergency-funding controls for one assignment.
 *
 * Everything here is a *request*: the server owns the policy, the catalogue and the prices. The block
 * only offers items the authoritative shop already buys, and the list's order is the priority Auto
 * follows when it has to fund a purchase.
 */
function fundingBlock(job: JobDTO): HTMLElement {
  const wrap = make("div", "auto-funding");
  const toggle = make("label", "auto-policy");
  const input = make("input");
  input.type = "checkbox";
  input.checked = job.autoFundingEnabled;
  input.disabled = workersBusy;
  input.addEventListener("change", () => void setFundingPolicy(job, input.checked, [...job.fundingItems]));
  toggle.appendChild(input);
  toggle.appendChild(make("span", "auto-policy-text", t("workers.funding")));
  wrap.appendChild(toggle);
  wrap.appendChild(make("p", "auto-funding-hint muted", t("workers.fundingHint")));
  if (!job.autoFundingEnabled && job.fundingItems.length === 0) return wrap;

  const list = make("ul", "auto-funding-list");
  const selected = [...job.fundingItems];
  for (const [index, itemDefinitionId] of selected.entries()) {
    const row = make("li", "auto-funding-row");
    const check = make("input");
    check.type = "checkbox";
    check.checked = true;
    check.disabled = workersBusy;
    check.addEventListener("change", () =>
      void setFundingPolicy(job, job.autoFundingEnabled, selected.filter((id) => id !== itemDefinitionId))
    );
    row.appendChild(check);
    row.appendChild(make("span", "auto-funding-name", itemLabel(itemDefinitionId)));
    row.appendChild(fundingMoveButton(job, selected, index, -1, t("workers.up")));
    row.appendChild(fundingMoveButton(job, selected, index, 1, t("workers.down")));
    list.appendChild(row);
  }
  for (const entry of sellableFundingEntries()) {
    if (selected.includes(entry.itemDefinitionId)) continue;
    const row = make("li", "auto-funding-row");
    const check = make("input");
    check.type = "checkbox";
    check.checked = false;
    check.disabled = workersBusy || selected.length >= MAX_FUNDING_ITEMS;
    check.addEventListener("change", () =>
      void setFundingPolicy(job, job.autoFundingEnabled, [...selected, entry.itemDefinitionId])
    );
    row.appendChild(check);
    row.appendChild(make("span", "auto-funding-name", displayName(state.language, entry.itemDisplayNameKey, entry.itemDefinitionId)));
    list.appendChild(row);
  }
  wrap.appendChild(list);
  return wrap;
}

function fundingMoveButton(job: JobDTO, selected: readonly string[], from: number, delta: number, label: string): HTMLButtonElement {
  const button = make("button", "compact auto-funding-move", label);
  button.type = "button";
  button.disabled = workersBusy || from + delta < 0 || from + delta >= selected.length;
  button.addEventListener("click", () => void setFundingPolicy(job, job.autoFundingEnabled, moved(selected, from, from + delta)));
  return button;
}

/** The same list with one element moved, for the priority arrows. */
function moved(items: readonly string[], from: number, to: number): readonly string[] {
  const next = [...items];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(to, 0, item);
  return next;
}

/**
 * What Auto may offer to sell: exactly the items the authoritative shop buys.
 *
 * Seeds carry a buy price, not a sell price, so the catalogue itself excludes them - the client never
 * decides what is sellable.
 */
function sellableFundingEntries(): readonly ShopEntryDTO[] {
  return state.shop.filter((entry) => entry.sellPrice !== null && entry.category !== "SEED");
}

async function setFundingPolicy(job: JobDTO, enabled: boolean, items: readonly string[]): Promise<void> {
  if (state.farmId === null) return;
  try {
    await api().setAssignmentPolicy(state.farmId, job.jobId, {
      requestId: newRequestId("job-funding"),
      autoPurchaseSupplies: job.autoPurchaseSupplies,
      expectedVersion: job.version,
      funding: { enabled, items: [...items] }
    });
    setStatus(message("workers.fundingSaved"));
  } catch (error: unknown) {
    setStatus(describe(error), true);
    return;
  }
  await loadWorkers();
}

async function setJobEnabled(job: JobDTO, enabled: boolean): Promise<void> {
  if (!requireEconomicState()) return;
  if (state.farmId === null) return;
  try {
    await api().setJobEnabled(state.farmId, job.jobId, {
      requestId: newRequestId("job-state"),
      enabled,
      expectedVersion: job.version
    });
    setStatus(message("workers.stateSaved"));
  } catch (error: unknown) {
    setStatus(describe(error), true);
    return;
  }
  await loadWorkers();
}

async function removeJob(job: JobDTO): Promise<void> {
  if (!requireEconomicState()) return;
  if (state.farmId === null) return;
  if (!window.confirm(t("workers.confirmRemove"))) return;
  try {
    await api().deleteJob(state.farmId, job.jobId, {
      requestId: newRequestId("job-remove"),
      expectedVersion: job.version
    });
    setStatus(message("workers.removed"));
  } catch (error: unknown) {
    setStatus(describe(error), true);
    return;
  }
  await loadWorkers();
}

/**
 * Moves one assignment and sends the whole resulting order.
 *
 * The server accepts the order only if it is exactly a permutation of the actor's jobs, which is what
 * keeps priorities dense and duplicate-free; the actor's version is the guard, so a second tab cannot
 * quietly rewrite the order underneath this one.
 */
async function moveJob(jobId: string, direction: -1 | 1): Promise<void> {
  if (!requireEconomicState()) return;
  if (state.farmId === null || state.workerActor === null) return;
  const ordered = moveJobInOrder(jobOrderOf(state.workers), jobId, direction);
  if (ordered === jobOrderOf(state.workers)) return;
  try {
    const result = await api().reorderJobs(state.farmId, {
      requestId: newRequestId("job-order"),
      orderedJobIds: ordered,
      expectedVersion: state.workerActor.version
    });
    state.workers = result.jobs;
    setStatus(message("workers.reordered"));
  } catch (error: unknown) {
    setStatus(describe(error), true);
    return;
  }
  await loadWorkers();
}

/* ------------------------------------------------------------------------------------------------
 * Auto execution: the browser drives the beat, the server owns the world.
 *
 * One step is one request and at most one authoritative settlement. The client never says "plant that
 * cell" or "I have arrived": it asks the server to advance, animates what comes back, and asks again
 * when the server said to. A walk is drawn from the server's own arrival time, a settlement is drawn
 * from the event that already happened, and stopping is a mode change that abandons the pending walk.
 * ---------------------------------------------------------------------------------------------- */

/**
 * How long the client plays a work gesture before asking for the next step. Presentation only.
 *
 * Calibrated in D2.3.2 from a measured hour per field size: the gesture is dead time in the server's
 * own timeline (the actor is idle while it plays), and it was 4-17% of the hour at 500 ms. Trimming
 * it to 350 ms keeps a visible work action while fitting materially more work into the same hour -
 * and it changes nothing authoritative: travel, growth, Cargo, settlements and offline
 * reconciliation are untouched.
 */
const AUTO_GESTURE_MS = 350;
/** The back-off after a lost race or a dropped request: one prompt retry, never a burst. */
const AUTO_RETRY_MS = 1500;

let autoStepBusy = false;
let autoStepTimer: number | null = null;

function autoIsDriving(): boolean {
  return state.farmId !== null && state.workerActor?.controlMode === "AUTO_CONTROLLED";
}

function cancelAutoStepTimer(): void {
  if (autoStepTimer !== null) {
    window.clearTimeout(autoStepTimer);
    autoStepTimer = null;
  }
}

/**
 * Ask for the next step, or wait for something to change.
 *
 * A wait with `retryAfterMs` of zero is the server saying "there is nothing to wake up for" - supply,
 * funds, storage and a full pair of hands all change because the *player* does something - so the loop
 * goes quiet and the panel's own actions wake it again.
 */
function scheduleAutoStep(delayMs: number): void {
  cancelAutoStepTimer();
  if (!autoIsDriving() || document.visibilityState !== "visible") return;
  if (delayMs <= 0) return;
  autoStepTimer = window.setTimeout(() => {
    autoStepTimer = null;
    void runAutoStep();
  }, delayMs);
}

/** Ask now, if there is not already a request in flight or a timer waiting. */
function kickAutoStep(): void {
  if (!economicStateReady() || autoStepBusy || autoStepTimer !== null || !autoIsDriving()) return;
  if (document.visibilityState !== "visible") return;
  void runAutoStep();
}

/** Stops the loop and abandons any walk the client was drawing. */
function stopAutoStepLoop(): void {
  cancelAutoStepTimer();
  playerRuntime.clearDestination();
  state.autoStep = null;
}

/**
 * The player moved while Auto was driving: hand the character back.
 *
 * This is the design's own transition (`AUTO_CONTROLLED --[player input]--> PLAYER_CONTROLLED`), asked
 * for once per press rather than once per frame. The movement itself is never blocked - the character
 * moves the instant the key goes down - and the mode change is what tells the server to stop planning.
 */
type AutoTakeoverTrigger = "PLAYER_MOVEMENT" | "GO_BUTTON";

/** Development-only breadcrumbs for the few client intents that may hand the actor back. */
function autoControlDiagnostic(reason: string, details: Record<string, unknown> = {}): void {
  if (!import.meta.env.DEV) return;
  console.debug("[auto-control]", {
    reason,
    at: new Date().toISOString(),
    actorId: state.workerActor?.actorId ?? null,
    jobId: state.autoStep?.jobId ?? null,
    ...details
  });
}

let takeoverInFlight = false;
function requestTakeoverFromInput(trigger: AutoTakeoverTrigger): void {
  if (takeoverInFlight) return;
  autoControlDiagnostic("PLAYER_TAKEOVER_REQUESTED", { trigger });
  takeoverInFlight = true;
  void (async () => {
    try {
      await toggleAuto();
    } finally {
      takeoverInFlight = false;
    }
  })();
}

async function runAutoStep(): Promise<void> {
  const farmId = state.farmId;
  if (!economicStateReady() || farmId === null || autoStepBusy || !autoIsDriving()) return;
  autoStepBusy = true;
  try {
    const result = await api().advanceAuto(farmId, { requestId: newRequestId("auto-step") });
    state.autoStep = result.step;
    // A WORKED step carries the settled container; older servers omit it and the refresh re-reads it.
    if (result.container !== undefined && result.container !== null) state.cargo = result.container;
    applyAutoStep(result.step);
    if (result.step.phase === "STOPPED") {
      autoControlDiagnostic("SERVER_STOPPED", {
        waitReason: result.step.waitReason,
        step: result.step.step,
        phase: result.step.phase
      });
      // The step response is authoritative: the server may have stopped Auto because its lease
      // expired while this request was in flight. Re-read the actor/cargo/plan once so the UI cannot
      // keep presenting the previous AUTO/MINE snapshot. This is bounded recovery, not a poll.
      cancelAutoStepTimer();
      playerRuntime.clearDestination();
      await loadWorkers();
    } else {
      await refreshAfterAutoStep(result.step, result.container !== undefined && result.container !== null);
      scheduleAutoStep(delayForAutoStep(result.step));
    }
  } catch (error: unknown) {
    state.autoStep = null;
    // A dropped request or a lost race is not a player-facing failure: the next step re-resolves from
    // the world. Anything else is worth saying once.
    if (!(error instanceof ApiError) || !["CONFLICT_STALE_STATE", "RATE_LIMITED"].includes(error.code)) {
      setStatus(describe(error), true);
    }
    scheduleAutoStep(AUTO_RETRY_MS);
  } finally {
    autoStepBusy = false;
    renderWorkers();
    renderResourcePanel();
  }
}

/** How long to wait before the next ask, from the step the server just answered. */
function delayForAutoStep(step: AutoStepDTO): number {
  if (step.phase === "STOPPED") return 0;
  if (step.phase === "RETRY") return AUTO_RETRY_MS;
  if (step.phase === "TRAVELLING") return Math.max(250, step.retryAfterMs);
  // Continuous labour (Mining) tells the client when its next beat is due; other work only needs
  // the gesture to finish before the next ask.
  if (step.phase === "WORKED") return Math.max(AUTO_GESTURE_MS, step.retryAfterMs);
  return step.retryAfterMs;
}

/** Where an anchor is in the world, so the character can visibly walk there. */
function worldForAutoAnchor(anchor: AutoAnchorDTO): { readonly worldX: number; readonly worldZ: number } | null {
  const tile =
    anchor.kind === "CELL"
      ? anchor.x === null || anchor.y === null
        ? null
        : { x: anchor.x, y: anchor.y }
      : anchor.kind === "WAREHOUSE"
        ? HOME_WAREHOUSE_ANCHOR_TILE
        : FARM_MARKET_ANCHOR_TILE;
  return tile === null ? null : tileToWorld(tile, worldFrame());
}

/** Draws one step: a walk, a gesture, or nothing at all. */
function applyAutoStep(step: AutoStepDTO): void {
  if (step.phase === "STOPPED") {
    playerRuntime.clearDestination();
    return;
  }
  if (step.phase === "TRAVELLING" && step.to !== null) {
    const destination = worldForAutoAnchor(step.to);
    if (destination !== null) playerRuntime.setDestination(destination);
    return;
  }
  if (step.phase === "WORKED") playAutoGesture(step);
}

/**
 * A short stylized work gesture, and the reward's own picture where there is one.
 *
 * The animation is presentation: it never grants anything. What the player sees arriving is the
 * *server's* answer - a settled harvest, with the reward the crop definition pays - and the character
 * breathes with it so the field does not look like it is being edited by a spreadsheet.
 */
function playAutoGesture(step: AutoStepDTO): void {
  playerRuntime.clearDestination();
  const pose = characterPose;
  if (pose !== null) {
    scene?.setPlayer({ ...pose, working: true });
    window.setTimeout(() => {
      const latest = characterPose;
      if (latest !== null) scene?.setPlayer({ ...latest, working: false });
    }, Math.min(AUTO_GESTURE_MS, 600));
  }
  if (step.step === "HARVEST" && step.itemDefinitionId !== null && step.quantity !== null) {
    showRewardPop(step.itemDefinitionId, step.quantity, step.cell);
  }
}

/**
 * Re-read what the step changed - and only that.
 *
 * A plant changes crops and the hands; a harvest changes crops, the hands and experience; a load, a
 * purchase or an unload change the hands and the store. The panel's plan is re-read only while it is
 * open, so a running Auto with the sheet closed costs the farm read and nothing else.
 */
async function refreshAfterAutoStep(step: AutoStepDTO, cargoIncluded = false): Promise<void> {
  const farmId = state.farmId;
  if (step.phase !== "WORKED" || farmId === null) return;
  const client = api();
  if (step.step === "PLANT") await refreshFarm(farmRefreshScopeFor("PLANT_CROP"));
  if (step.step === "HARVEST") await refreshFarm(farmRefreshScopeFor("HARVEST_CROP"));
  // What every settled step can move, and only that: the hands always, the store whenever a transfer
  // happened, the wallet when gold was spent, and experience when a crop was harvested.
  if (!cargoIncluded) state.cargo = (await client.getActorCargo(farmId)).cargo;
  if (step.step === "LOAD_INPUT" || step.step === "PURCHASE_INPUT" || step.step === "UNLOAD") {
    state.inventory = (await client.getInventory()).items;
  }
  if (step.step === "UNLOAD") {
    state.warehouse = (await client.getWarehouse()).warehouse;
    // Keep already-open account projections honest without refreshing the whole account on every
    // mining beat. Shop and Warehouse remain presentation surfaces; neither one owns Auto control.
    renderMarket();
    renderWarehouse();
  }
  if (step.step === "PURCHASE_INPUT") state.wallet = (await client.getWallet()).wallets;
  if (step.step === "HARVEST") state.progression = (await client.getProgression()).progression;
  // The plan is re-read only while the sheet is open: a running Auto with it closed costs the step.
  if (panels.active === "workers") state.autoPlan = (await client.getAutoPlan(farmId)).plan;
}

function renderMarket(): void {
  renderMarketTabs();
  const cards = marketCardsFor(shopDirection);
  // A card can leave the shelf while it is selected - the last carrot sold, the tab switched - and a
  // trade panel describing an item that is no longer there would be a lie.
  if (marketSelection !== null && marketCardFor(cards, marketSelection) === null) {
    marketSelection = null;
    marketQuantity = 1;
  }
  const gridSignature = JSON.stringify([
    state.language,
    shopDirection,
    cards.map((card) => [card.key, card.unitPrice, card.owned, card.plantingLevel]),
    marketSelection
  ]);
  if (gridSignature !== marketGridSignature) {
    marketGridSignature = gridSignature;
    const grid = element<HTMLElement>("market-grid");
    grid.replaceChildren();
    for (const card of cards) grid.appendChild(marketCardNode(card));
    grid.hidden = cards.length === 0;
    const empty = element<HTMLElement>("market-empty");
    empty.hidden = cards.length > 0;
    empty.textContent = t(shopDirection === "sell" ? "market.emptySell" : "market.noBuy");
  }
  renderMarketTrade(cards);
}

/**
 * One market card: the shared item card, with the market's own emphasis.
 *
 * The quantity badge is what the player owns (both directions need it: buying without knowing what you
 * have is how a player wastes gold), and the note is the unit price - or, for a seed they cannot plant
 * yet, the level that unlocks it, because that is the fact that decides whether buying now is useful.
 */
function marketCardNode(card: MarketCard): HTMLElement {
  const name = itemName(card.itemDefinitionId, card.nameKey ?? card.itemDefinitionId);
  const price = marketPriceText(card);
  const owned = t("market.owned", { quantity: card.owned });
  const level = state.progression?.level ?? null;
  const note =
    card.plantingLevel !== null && level !== null && level < card.plantingLevel
      ? t("market.plantingLevel", { level: card.plantingLevel })
      : price;
  const node = renderItemCard(
    {
      key: card.key,
      visual: card.visual,
      name,
      quantity: card.owned,
      quantityLabel: owned,
      note,
      state: marketSelection === card.key ? "SELECTED" : "NORMAL",
      disabled: false,
      ariaLabel: `${name} — ${owned}, ${price}`
    },
    itemCardDeps(),
    {
      onSelect: () => {
        selectMarketCard(card);
      }
    }
  );
  // Market-only decorative corners use independent alpha artwork. The card renderer keeps its own
  // thumbnail/fallback and every interactive behaviour; this layer is deliberately pointer-inert.
  node.classList.add("market-vibrant-product-card");
  const frame = document.createElement("span");
  frame.className = "market-vibrant-card-frame";
  frame.setAttribute("aria-hidden", "true");
  for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
    const ornament = document.createElement("span");
    ornament.className = `market-vibrant-card-corner is-${corner}`;
    frame.appendChild(ornament);
  }
  node.insertBefore(frame, node.firstChild);
  return node;
}

/** The catalogue's price for one unit, in the direction being browsed. */
function marketPriceText(card: MarketCard): string {
  const entry = state.shop.find((row) => row.shopEntryId === card.shopEntryId);
  const currency = currencyLabel(
    entry?.currencyId ?? "currency_gold",
    entry?.currencyDisplayNameKey ?? "currency.gold.name"
  );
  return t("market.priceEach", { price: card.unitPrice, currency });
}

function selectMarketCard(card: MarketCard): void {
  if (marketSelection === card.key) {
    marketSelection = null;
  } else {
    marketSelection = card.key;
    marketQuantity = 1;
  }
  renderMarket();
}

/**
 * The one transaction panel: what is selected, how many, what it totals, and the action.
 *
 * Rebuilt only when something it shows has changed. The total is arithmetic the player can check by
 * hand; the server settles its own number and the feedback quotes that one.
 */
function renderMarketTrade(cards: readonly MarketCard[]): void {
  const panel = element<HTMLElement>("market-trade");
  const card = marketCardFor(cards, marketSelection);
  if (card === null) {
    panel.hidden = true;
    marketTradeSignature = "";
    return;
  }
  const bounds = marketQuantityBounds(card, shopDirection, goldBalance());
  marketQuantity = clampMarketQuantity(marketQuantity, bounds);
  const canSubmit = marketCanSubmit(marketQuantity, bounds);
  const signature = JSON.stringify([
    state.language,
    shopDirection,
    card.key,
    card.unitPrice,
    card.owned,
    marketQuantity,
    bounds.max,
    canSubmit,
    marketTradePending,
    economicStateReady(),
    goldBalance()
  ]);
  if (signature === marketTradeSignature) return;
  marketTradeSignature = signature;
  panel.hidden = false;
  panel.replaceChildren();

  const name = itemName(card.itemDefinitionId, card.nameKey ?? card.itemDefinitionId);
  const head = make("div", "market-trade-head");
  const image = document.createElement("img");
  image.className = "market-trade-thumb";
  image.alt = "";
  itemThumbnails.apply(card.visual.request, image, (result) => {
    if (result.dataUrl === null) image.hidden = true;
  });
  head.appendChild(image);
  const headline = make("div", "market-trade-title");
  headline.appendChild(make("strong", undefined, name));
  headline.appendChild(
    make("span", "market-trade-sub", `${marketPriceText(card)} · ${t("market.owned", { quantity: card.owned })}`)
  );
  head.appendChild(headline);
  panel.appendChild(head);

  if (bounds.max < bounds.min) {
    panel.appendChild(make("p", "market-trade-note muted", t("market.notEnoughGold")));
  } else {
    const row = make("div", "market-quantity");
    row.appendChild(
      marketQuantityButton(
        "minus",
        t("market.decrease"),
        () => {
          marketQuantity = marketQuantityStep(marketQuantity, -1, bounds);
          renderMarketTrade(cards);
        }
      )
    );
    row.appendChild(make("span", "market-quantity-value", String(marketQuantity)));
    row.appendChild(
      marketQuantityButton(
        "plus",
        t("market.increase"),
        () => {
          marketQuantity = marketQuantityStep(marketQuantity, 1, bounds);
          renderMarketTrade(cards);
        }
      )
    );
    row.appendChild(marketQuantityText(t("market.max"), () => {
      marketQuantity = bounds.max;
      renderMarketTrade(cards);
    }));
    panel.appendChild(row);

    const total = make("div", "market-total");
    total.appendChild(make("span", undefined, t("market.total")));
    total.appendChild(
      make(
        "strong",
        undefined,
        `${String(marketTotal(card.unitPrice, marketQuantity))} ${marketCurrencyOf(card)}`
      )
    );
    panel.appendChild(total);
  }

  const submit = make("button", "primary market-submit");
  submit.type = "button";
  submit.textContent = t(shopDirection === "buy" ? "market.buyCount" : "market.sellCount", {
    quantity: marketQuantity
  });
  submit.disabled = !economicStateReady() || !canSubmit || marketTradePending;
  submit.addEventListener("click", () => {
    void run(submitMarketTrade);
  });
  panel.appendChild(submit);
}

/** A round stepper button: the one place in the HUD that only changes a number. */
function marketQuantityButton(icon: IconName, label: string, onClick: () => void): HTMLButtonElement {
  return createActionButton({
    icon: createIcon(icon, 16),
    className: "market-step",
    ariaLabel: label,
    title: label,
    onClick
  });
}

function marketQuantityText(label: string, onClick: () => void): HTMLButtonElement {
  const button = make("button", "market-max");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function marketCurrencyOf(card: MarketCard): string {
  const entry = state.shop.find((row) => row.shopEntryId === card.shopEntryId);
  return currencyLabel(entry?.currencyId ?? "currency_gold", entry?.currencyDisplayNameKey ?? "currency.gold.name");
}

/**
 * Settles one trade.
 *
 * The panel's bounds are a convenience, not a rule: this sends the item and the quantity and lets the
 * server decide, exactly as it did when the market was a list of rows. The feedback quotes the
 * settlement's own numbers.
 */
async function submitMarketTrade(): Promise<void> {
  if (!requireEconomicState() || marketTradePending) return;
  const card = marketCardFor(marketCardsFor(shopDirection), marketSelection);
  if (card === null) return;
  const bounds = marketQuantityBounds(card, shopDirection, goldBalance());
  const quantity = clampMarketQuantity(marketQuantity, bounds);
  if (!marketCanSubmit(quantity, bounds)) {
    setStatus(message("market.notEnoughGold"), true);
    return;
  }
  marketTradePending = true;
  marketTradeSignature = "";
  renderMarketTrade(marketCardsFor(shopDirection));
  try {
    await trade(shopDirection, card.shopEntryId, quantity);
    // One trade, one decision: the next one starts from a single unit.
    marketQuantity = 1;
  } finally {
    marketTradePending = false;
    marketTradeSignature = "";
  }
}

/**
 * Opens the Farm Market.
 *
 * The Estate rail opens it directly; the market stall opens it from character view with the tab a
 * player is most likely to want. Either way this is a *service overlay*: the camera mode, the
 * character's position and the world are untouched, and closing it puts the player back exactly
 * where they were.
 */
function openFarmMarket(request?: { readonly direction?: MarketDirection; readonly entryId?: string }): void {
  shopDirection = request?.direction ?? shopDirection;
  marketSelection = request?.entryId ?? null;
  marketQuantity = 1;
  marketGridSignature = "";
  marketTradeSignature = "";
  setActivePanel(openPanel(panels, "market"));
  renderMarket();
}

/** Walking up to the stall: sell if there is anything to sell, otherwise browse seeds. */
function openFarmMarketFromStall(): void {
  const direction = defaultMarketDirection({
    entries: state.shop,
    direction: "sell",
    inventory: state.inventory,
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions,
    playerLevel: state.progression?.level ?? null
  });
  openFarmMarket({ direction });
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
let buildCatalogStatus: "loading" | "ready" | "error" = "loading";
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
    case "AQUACULTURE":
      return "build.category.aquaculture";
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
      return "utility";
    case "WATERFRONT":
      return "water";
    case "AQUACULTURE":
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
  let view = currentShopView(categories);
  // Open on a complete shop composition. Selection remains inspection-only; this merely gives the
  // detail pane a useful first subject instead of presenting an empty third of the frame.
  if (shopSelection === null && view.visible.length > 0) {
    shopSelection = view.visible[0] ?? null;
    view = currentShopView(categories);
  }
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
    catalogStatus: buildCatalogStatus,
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
    goldText: goldText(),
    goldBalance: goldBalance()
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
      shopSelection = state.buildCatalog.find((entry) => entry.category === category) ?? null;
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
      if (!requireEconomicState()) return;
      if (shopSelection === null) return;
      if (entryAvailability(shopSelection, state.progression?.level ?? 1) !== "AVAILABLE") return;
      enterPlacement(shopSelection);
    }
  };
}

function shopContext(): ShopViewContext {
  return {
    t,
    icon: createIcon,
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
  const selectedPond = state.selectedObjectId === null
    ? null
    : state.aquaculturePonds.find((pond) => pond.pondId === state.selectedObjectId) ?? null;
  if (selectedPond !== null) {
    node.classList.remove("is-warning");
    node.textContent = `Aquaculture pond: ${selectedPond.status}`;
    return;
  }
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
  const forestryDefinition = construction.forestry === undefined
    ? null
    : forestryConstructionDefinition(construction.forestry.entryId);
  const modelId = construction.forestry?.status === "DEPLETED"
    ? (construction.entryId.includes("pine") ? "resource_pine_stump" : "resource_wildwood_stump")
    : presentation.modelId;
  const sizeWorld = construction.forestry?.status === "DEPLETED" && forestryDefinition !== null
    ? forestryDefinition.stumpSizeWorld
    : presentation.sizeWorld;
  return {
    id: construction.constructionId,
    modelId: modelId !== null && !modelId.startsWith("road.") ? modelId : null,
    landmarkKind: definition?.landmarkKind ?? null,
    sizeWorld,
    worldX: anchor.worldX,
    worldZ: anchor.worldZ,
    // The island's authored facing, plus however many quarter turns the player has applied since.
    rotationY: (visual?.baseYaw ?? 0) + (construction.rotation * Math.PI) / 2,
    widthCells: construction.footprint.widthCells,
    depthCells: construction.footprint.depthCells
  };
}

/**
 * A resource node, as the renderer wants it: which model, where, and whether it is ready.
 *
 * The position is the authored fractional tile converted with the one world frame, exactly as a
 * fishing spot is, so the drawn deposit and the interaction target cannot disagree about where it is.
 */
function toSceneResourceNode(node: ResourceNodeDTO): {
  readonly id: string;
  readonly definitionId: string;
  readonly modelId: string;
  readonly depletedModelId: string | null;
  readonly worldX: number;
  readonly worldZ: number;
  readonly available: boolean;
} {
  const at = tileToWorld(node.position, worldFrame());
  return {
    id: node.nodeId,
    definitionId: node.definitionId,
    modelId: node.modelId,
    depletedModelId: node.depletedModelId,
    worldX: at.worldX,
    worldZ: at.worldZ,
    available: node.available
  };
}

function toSceneFishingSpot(spot: FishingSpotDTO): {
  readonly id: string;
  readonly worldX: number;
  readonly worldZ: number;
  readonly pickRadiusWorld: number;
} {
  const at = tileToWorld(spot.position, worldFrame());
  return {
    id: spot.spotId,
    worldX: at.worldX,
    worldZ: at.worldZ,
    pickRadiusWorld: spot.interactionRadiusTiles * worldFrame().pitch
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
    isRoad: entry.category === "ROAD"
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
    rotationY: previewRotationY(entry),
    allowedTerrain: entry.allowedTerrain
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
  if (!requireEconomicState() || entry === null || placementPending) return;
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
let treeMoveSession: { readonly kind: "MOVE" | "RESTORE"; readonly treeInstanceId: string; readonly expectedVersion: number; turns: 0 | 1 | 2 | 3 } | null = null;
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
  renderAquaculturePanel();
  renderForestryConstructionPanel();
  renderTreeManagementPanel();
}

/** The player clicked one of their own objects: remember it and offer the asset's own actions. */
function selectObject(constructionId: string): void {
  const construction = state.constructions.find((candidate) => candidate.constructionId === constructionId);
  if (construction === undefined) return;
  clearResourceNodeSelection();
  // Picking a cell and picking an object are the same kind of act: only one of them is current.
  state.buildSelection = null;
  state.selectedTreeInstanceId = null;
  placementTurns = 0;
  scene?.setPlacementPreview(null);
  renderPlacementHud();
  state.selectedObjectId = construction.constructionId;
  deleteArmed = false;
  scene?.setObjectSelection(construction.constructionId);
  renderObjectPanel();
  renderAquaculturePanel();
  renderForestryConstructionPanel();
  renderField();
  renderSelection();
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
  scene?.setObjectPicking(true);
  document.body.classList.remove("is-placing");
  renderObjectPanel();
  renderAquaculturePanel();
  renderForestryConstructionPanel();
  renderSelection();
  renderGo();
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
  document.body.classList.remove("is-placing");
  renderObjectPanel();
  renderAquaculturePanel();
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
    rotationY: quarterTurnYaw(session.turns),
    allowedTerrain:
      state.worldObjects.get(session.construction.entryId)?.allowedTerrain ??
      constructionEntry(session.construction)?.allowedTerrain ??
      ["LAND"]
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
  if (!requireEconomicState()) return;
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
  if (!requireEconomicState()) return;
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
  const storedTrees = state.trees.filter((tree) => tree.storageState === "STORED");
  if (stacks.length === 0 && storedTrees.length === 0) {
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
  if (storedTrees.length > 0) {
    node.appendChild(make("h3", "build-storage-title", t("treeManagement.title")));
    const treeList = make("ul", "build-storage-list");
    for (const tree of storedTrees) {
      const item = make("li", "build-storage-item");
      item.appendChild(make("span", "build-storage-name", treeName(tree.definitionId)));
      const restore = make("button", "object-action", t("treeManagement.restore"));
      restore.type = "button";
      restore.disabled = objectPending || moveSession !== null || treeMoveSession !== null;
      restore.addEventListener("click", () => { beginTreeRestore(tree); });
      item.appendChild(restore);
      treeList.appendChild(item);
    }
    node.appendChild(treeList);
  }
}

async function rotateSelectedObject(): Promise<void> {
  if (!requireEconomicState()) return;
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
  if (!requireEconomicState()) return;
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
 * The countdown is a local projection of readyAt already received from the server. It only updates
 * text nodes; it never reloads the pond or changes the server-derived ready counts.
 */
function refreshAquacultureCountdowns(): void {
  const node = document.getElementById("aquaculture-panel");
  if (node === null || node.hidden) return;
  for (const countdown of node.querySelectorAll<HTMLElement>("[data-aquaculture-ready-at]")) {
    const readyAt = countdown.dataset.aquacultureReadyAt;
    if (readyAt === undefined) continue;
    const remaining = aquacultureRemainingSeconds(readyAt);
    countdown.textContent = remaining === 0
      ? t("aquaculture.readyNow")
      : t("aquaculture.remaining", { time: formatRemainingGrowth(remaining, t) });
  }
}

/** Local-only countdown projection from a server timestamp; it never reads or mutates the API. */
function forestryRemainingSeconds(readyAt: string | null, fallback: number): number {
  if (readyAt === null) return Math.max(0, fallback);
  const timestamp = Date.parse(readyAt);
  if (!Number.isFinite(timestamp)) return Math.max(0, fallback);
  return Math.max(0, Math.ceil((timestamp - Date.now()) / 1000));
}

function refreshForestryCountdowns(): void {
  const resource = document.getElementById("resource-panel");
  const construction = document.getElementById("forestry-construction-panel");
  if ((resource === null || resource.hidden) && (construction === null || construction.hidden)) return;
  renderResourcePanel();
  renderForestryConstructionPanel();
}

function ensureForestryCountdownTimer(): void {
  if (forestryCountdownTimer !== null) return;
  forestryCountdownTimer = window.setInterval(refreshForestryCountdowns, 1000);
}

function ensureAquacultureCountdownTimer(): void {
  if (aquacultureCountdownTimer !== null) return;
  aquacultureCountdownTimer = window.setInterval(refreshAquacultureCountdowns, 1000);
}

/**
 * The job panel for a selected fish cage. It is deliberately separate from the object-management
 * panel so stock/harvest cannot be confused with move, rotate, store, or delete.
 */
function renderAquaculturePanel(traceId: string | null = null): void {
  const node = element<HTMLElement>("aquaculture-panel");
  ensureAquacultureCountdownTimer();
  const construction = selectedConstruction();
  const reason = construction === null
    ? "NO_SELECTED_CONSTRUCTION"
    : !isAquacultureConstruction(construction)
      ? "NOT_AQUACULTURE_CONSTRUCTION"
      : "AQUACULTURE_CONSTRUCTION";
  if (construction === null || !isAquacultureConstruction(construction)) {
    node.hidden = true;
    node.replaceChildren();
    bootPerfInteractionTrace(traceId, "aquaculture_panel_render", {
      selectedObjectId: state.selectedObjectId,
      constructionFound: construction !== null,
      entryId: construction?.entryId ?? null,
      reason,
      domExists: true,
      domHidden: node.hidden,
      childCount: node.childElementCount
    });
    return;
  }

  node.hidden = false;
  node.replaceChildren();
  const panel = make("section", "aquaculture-panel");
  panel.setAttribute("aria-label", t("aquaculture.title"));
  panel.appendChild(make("h3", "aquaculture-title", t("aquaculture.title")));
  const pondView = selectedAquaculturePond(aquacultureLoadState, state.farmId, construction.constructionId);
  const retry = (): void => {
    if (state.farmId !== null) void loadAquaculturePonds(state.farmId);
  };
  if (pondView.kind === "LOADING") {
    panel.appendChild(make("p", "aquaculture-status", t("aquaculture.loading")));
  } else if (pondView.kind === "ERROR") {
    const errorText = describe(pondView.error)(t, state.language);
    panel.appendChild(make("p", "aquaculture-status is-warning", t("aquaculture.loadError", { error: errorText })));
    const button = make("button", "object-action aquaculture-action", t("aquaculture.retry"));
    button.type = "button";
    button.addEventListener("click", retry);
    panel.appendChild(button);
  } else if (pondView.kind === "NOT_FOUND") {
    panel.appendChild(make("p", "aquaculture-status is-warning", t("aquaculture.notFound")));
    const button = make("button", "object-action aquaculture-action", t("aquaculture.retry"));
    button.type = "button";
    button.addEventListener("click", retry);
    panel.appendChild(button);
  } else {
    const pond = pondView.pond;
    panel.appendChild(make("p", "aquaculture-status", t(`aquaculture.status.${pond.status}` as MessageKey)));
    const fishCount = inventoryQuantity("item_fish_tilapia");
    const view = aquaculturePanelState(pond, fishCount);
    const overview = make("div", "aquaculture-overview");
    if (view.readyCount > 0 && view.growingCount > 0) {
      overview.appendChild(make("p", "aquaculture-stock", t("aquaculture.summary.mixed", { ready: view.readyCount, growing: view.growingCount })));
    } else if (view.readyCount > 0) {
      overview.appendChild(make("p", "aquaculture-stock", t("aquaculture.summary.ready", { count: view.readyCount })));
    } else {
      overview.appendChild(make("p", "aquaculture-stock", t("aquaculture.summary.growing", { count: view.growingCount })));
    }
    overview.appendChild(make("p", "aquaculture-stock", t("aquaculture.summary.free", { free: view.availableCapacity, capacity: view.capacity })));
    panel.appendChild(overview);

    const cohorts = make("div", "aquaculture-cohorts");
    cohorts.setAttribute("aria-label", "Aquaculture batches");
    for (const cohort of view.cohorts) {
      const row = make("article", "aquaculture-cohort");
      row.dataset.aquacultureCohortId = cohort.cohortId;
      row.appendChild(make("h4", "aquaculture-cohort-title", t("aquaculture.cohort", { count: cohort.quantity })));
      row.appendChild(make("p", "aquaculture-cohort-time", t("aquaculture.stockedAt", { time: formatAquacultureTimestamp(cohort.stockedAt, state.language) })));
      row.appendChild(make("p", "aquaculture-cohort-time", t("aquaculture.readyAt", { time: formatAquacultureTimestamp(cohort.readyAt, state.language) })));
      const countdown = make("p", "aquaculture-cohort-remaining");
      countdown.dataset.aquacultureReadyAt = cohort.readyAt;
      const initialRemaining = aquacultureRemainingSeconds(cohort.readyAt);
      countdown.textContent = initialRemaining === 0
        ? t("aquaculture.readyNow")
        : t("aquaculture.remaining", { time: formatRemainingGrowth(initialRemaining, t) });
      row.appendChild(countdown);
      cohorts.appendChild(row);
    }
    if (view.cohorts.length > 0) panel.appendChild(cohorts);

    const quantityLabel = make("span", "aquaculture-quantity-label", t("aquaculture.quantity"));
    quantityLabel.id = "aquaculture-quantity-label";
    panel.appendChild(quantityLabel);
    const quantityMax = Math.max(view.stockingLimit, view.harvestLimit, view.withdrawLimit);
    const primaryLimit = view.action === "HARVEST"
      ? view.harvestLimit
      : view.action === "WITHDRAW"
        ? view.withdrawLimit
        : view.stockingLimit;
    let selectedQuantityValue = primaryLimit;
    const quantityControl = make("div", "aquaculture-quantity-control");
    quantityControl.setAttribute("role", "group");
    quantityControl.setAttribute("aria-labelledby", quantityLabel.id);
    const decrease = make("button", "aquaculture-quantity-step", "−");
    decrease.type = "button";
    decrease.setAttribute("aria-label", t("aquaculture.decreaseQuantity"));
    const quantityValue = make("output", "aquaculture-quantity-value", String(selectedQuantityValue));
    quantityValue.id = "aquaculture-quantity";
    quantityValue.setAttribute("aria-live", "polite");
    const increase = make("button", "aquaculture-quantity-step", "+");
    increase.type = "button";
    increase.setAttribute("aria-label", t("aquaculture.increaseQuantity"));
    quantityControl.appendChild(decrease);
    quantityControl.appendChild(quantityValue);
    quantityControl.appendChild(increase);
    panel.appendChild(quantityControl);
    const quantityButtons: { readonly button: HTMLButtonElement; readonly label: MessageKey; readonly limit: number }[] = [];
    const selectedQuantity = (limit: number): number => Math.max(1, Math.min(limit, selectedQuantityValue));
    const refreshQuantityButtons = (): void => {
      quantityValue.textContent = String(selectedQuantityValue);
      decrease.disabled = selectedQuantityValue <= 1;
      increase.disabled = selectedQuantityValue >= quantityMax;
      for (const entry of quantityButtons) entry.button.textContent = t(entry.label, { count: selectedQuantity(entry.limit) });
    };
    decrease.addEventListener("click", () => {
      selectedQuantityValue = Math.max(1, selectedQuantityValue - 1);
      refreshQuantityButtons();
    });
    increase.addEventListener("click", () => {
      selectedQuantityValue = Math.min(quantityMax, selectedQuantityValue + 1);
      refreshQuantityButtons();
    });
    if (view.isFull) panel.appendChild(make("p", "aquaculture-status is-warning", t("aquaculture.full")));
    if (view.kind === "EMPTY" || view.kind === "GROWING") {
      panel.appendChild(make("p", "aquaculture-stock", t("aquaculture.stockAvailable", { count: fishCount })));
      if (!view.isFull) panel.appendChild(make("p", "aquaculture-limit", t("aquaculture.stockLimit", { count: view.stockingLimit })));
      const button = make("button", "object-action aquaculture-action", t("aquaculture.stock"));
      button.type = "button";
      button.textContent = view.isFull ? t("aquaculture.full") : t("aquaculture.stockButton", { count: selectedQuantity(view.stockingLimit) });
      button.dataset.maxQuantity = String(view.stockingLimit);
      quantityButtons.push({ button, label: "aquaculture.stockButton", limit: view.stockingLimit });
      // Asset editing has its own flight guard. It must not disable the independent pond command;
      // only economic readiness, stocking inventory, and this panel's single-flight guard apply here.
      button.disabled = !economicStateReady() || fishCount < 1 || view.availableCapacity < 1 || interactionPending;
      button.addEventListener("click", () => {
        if (interactionPending) return;
        interactionPending = true;
        void run(async () => {
          try {
            await stockAquaculturePond(pond.pondId, pond.version, selectedQuantity(view.stockingLimit));
          } finally {
            interactionPending = false;
          }
        });
      });
      panel.appendChild(button);
      if (view.kind === "GROWING") {
        const withdraw = make("button", "object-action aquaculture-action", t("aquaculture.withdraw"));
        withdraw.type = "button";
        withdraw.textContent = t("aquaculture.withdrawButton", { count: selectedQuantity(view.withdrawLimit) });
        withdraw.dataset.maxQuantity = String(view.withdrawLimit);
        quantityButtons.push({ button: withdraw, label: "aquaculture.withdrawButton", limit: view.withdrawLimit });
        withdraw.disabled = interactionPending || view.growingCount < 1;
        panel.appendChild(make("p", "aquaculture-rule", t("aquaculture.withdrawRule")));
        withdraw.addEventListener("click", () => {
          if (interactionPending) return;
          interactionPending = true;
          void run(async () => {
            try { await withdrawAquaculturePond(pond.pondId, pond.version, selectedQuantity(view.withdrawLimit)); } finally { interactionPending = false; }
          });
        });
        panel.appendChild(withdraw);
        if (view.readyCount > 0) {
          panel.appendChild(make("p", "aquaculture-limit", t("aquaculture.harvestLimit", { count: view.harvestLimit })));
          panel.appendChild(make("p", "aquaculture-rule", t("aquaculture.harvestRule")));
          const harvest = make("button", "object-action aquaculture-action", t("aquaculture.harvest"));
          harvest.type = "button";
          harvest.textContent = t("aquaculture.harvestButton", { count: selectedQuantity(view.harvestLimit) });
          harvest.dataset.maxQuantity = String(view.harvestLimit);
          quantityButtons.push({ button: harvest, label: "aquaculture.harvestButton", limit: view.harvestLimit });
          harvest.disabled = interactionPending;
          harvest.addEventListener("click", () => {
            if (interactionPending) return;
            interactionPending = true;
            void run(async () => {
              try { await harvestAquaculturePond(pond.pondId, pond.version, selectedQuantity(view.harvestLimit)); } finally { interactionPending = false; }
            });
          });
          panel.appendChild(harvest);
        }
        const remaining = view.readyAt === null ? "" : formatRemainingGrowth(Math.max(0, Math.floor((Date.parse(view.readyAt) - Date.now()) / 1000)), t);
        panel.appendChild(make("p", "aquaculture-progress", `${t("aquaculture.progress")} · ${remaining}`));
      }
    // The final fallback keeps an older renderer shape safe if a new panel kind is added.
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    } else if (view.kind === "READY") {
      panel.appendChild(make("p", "aquaculture-limit", t("aquaculture.harvestLimit", { count: view.harvestLimit })));
      panel.appendChild(make("p", "aquaculture-rule", t("aquaculture.harvestRule")));
      const button = make("button", "object-action aquaculture-action", t("aquaculture.harvest"));
      button.type = "button";
      button.textContent = t("aquaculture.harvestButton", { count: selectedQuantity(view.harvestLimit) });
      button.dataset.maxQuantity = String(view.harvestLimit);
      quantityButtons.push({ button, label: "aquaculture.harvestButton", limit: view.harvestLimit });
      button.disabled = interactionPending;
      button.addEventListener("click", () => {
        if (interactionPending) return;
        interactionPending = true;
        void run(async () => {
          try {
            await harvestAquaculturePond(pond.pondId, pond.version, selectedQuantity(view.harvestLimit));
          } finally {
            interactionPending = false;
          }
        });
      });
      panel.appendChild(button);
    } else {
      const withdraw = make("button", "object-action aquaculture-action", t("aquaculture.withdraw"));
      withdraw.type = "button";
      withdraw.textContent = t("aquaculture.withdrawButton", { count: selectedQuantity(view.withdrawLimit) });
      withdraw.dataset.maxQuantity = String(view.withdrawLimit);
      quantityButtons.push({ button: withdraw, label: "aquaculture.withdrawButton", limit: view.withdrawLimit });
      withdraw.disabled = interactionPending || view.growingCount < 1;
      panel.appendChild(make("p", "aquaculture-limit", t("aquaculture.withdrawLimit", { count: view.withdrawLimit })));
      panel.appendChild(make("p", "aquaculture-rule", t("aquaculture.withdrawRule")));
      withdraw.addEventListener("click", () => {
        if (interactionPending) return;
        interactionPending = true;
        void run(async () => {
          try { await withdrawAquaculturePond(pond.pondId, pond.version, selectedQuantity(view.withdrawLimit)); } finally { interactionPending = false; }
        });
      });
      panel.appendChild(withdraw);
      const remaining = view.readyAt === null ? "" : formatRemainingGrowth(Math.max(0, Math.floor((Date.parse(view.readyAt) - Date.now()) / 1000)), t);
      panel.appendChild(make("p", "aquaculture-progress", `${t("aquaculture.progress")}${remaining === "" ? "" : ` · ${remaining}`}`));
    }
    const primaryLabel: MessageKey | null = view.action === "HARVEST"
      ? "aquaculture.harvestButton"
      : view.action === "WITHDRAW"
        ? "aquaculture.withdrawButton"
        : view.action === "STOCK"
          ? "aquaculture.stockButton"
          : null;
    if (primaryLabel !== null) {
      const primary = quantityButtons.find((entry) => entry.label === primaryLabel)?.button;
      if (primary !== undefined) {
        primary.classList.add("aquaculture-primary");
        const firstAction = panel.querySelector<HTMLButtonElement>(".aquaculture-action");
        if (firstAction !== null && firstAction !== primary) panel.insertBefore(primary, firstAction);
      }
    }
    refreshQuantityButtons();
  }
  node.appendChild(panel);
  refreshAquacultureCountdowns();
  bootPerfInteractionTrace(traceId, "aquaculture_panel_render", {
    selectedObjectId: state.selectedObjectId,
    constructionFound: true,
    entryId: construction.entryId,
    constructionId: construction.constructionId,
    reason,
    pondState: pondView.kind,
    domExists: true,
    domHidden: node.hidden,
    childCount: node.childElementCount,
    textLength: node.textContent.length
  });
}

/** Forestry capability for construction-backed pine/broadleaf trees, kept beside asset management. */
function renderForestryConstructionPanel(): void {
  ensureForestryCountdownTimer();
  const node = element<HTMLElement>("forestry-construction-panel");
  const construction = selectedConstruction();
  const forestry = construction?.forestry;
  if (construction === null || forestry === undefined) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }
  node.hidden = false;
  node.replaceChildren();
  const panel = make("section", "forestry-construction-panel forestry-tree-panel");
  panel.setAttribute("aria-label", t("forestry.title"));
  panel.appendChild(make("h3", "resource-panel-title forestry-tree-title", t("forestry.title")));
  const treeName = forestry.entryId.includes("pine") ? t("forestry.tree.pine") : t("forestry.tree.broad");
  const row = (label: string, value: string): void => {
    const item = make("p", "resource-panel-row");
    item.appendChild(make("span", "resource-panel-label", label));
    item.appendChild(make("span", "resource-panel-value", value));
    panel.appendChild(item);
  };
  row(t("forestry.origin"), t("forestry.origin.construction"));
  row(t("forestry.type"), treeName);
  const woodName = displayName(state.language, "item.wood.name", "Wood");
  const ready = forestry.status === "READY";
  const seconds = forestryRemainingSeconds(forestry.regenerationAt, 0);
  const statusText = construction.state === "STORED"
    ? t("forestry.status.stored")
    : ready
      ? t("forestry.status.ready")
      : t("forestry.status.regenerating", { time: formatRemainingGrowth(seconds, t) });
  row(t("forestry.status"), statusText);
  row(t("forestry.product"), woodName);
  row(t("forestry.yield"), `${String(forestry.dropQuantity)} ${woodName}`);
  const focused = interactionCandidate?.key === `object:${construction.constructionId}` ? interactionCandidate : null;
  const inRange = state.cameraMode === "CHARACTER" && focused !== null && focused.distanceWorld <= focused.rangeWorld;
  const note = construction.state === "STORED"
    ? t("forestry.status.storedHint")
    : !inRange
      ? t(state.cameraMode === "CHARACTER" ? "forestry.outOfRange" : "forestry.switchToCharacter")
      : "";
  if (note !== "") panel.appendChild(make("p", "resource-panel-note forestry-tree-countdown", note));
  const buttonLabel = ready
    ? t("forestry.chopButton", { quantity: forestry.dropQuantity })
    : t("forestry.regeneratingButton");
  const button = make("button", "object-action resource-panel-action forestry-tree-chop", buttonLabel);
  button.type = "button";
  button.disabled = construction.state !== "ACTIVE" || !ready || !inRange || interactionPending;
  button.setAttribute("aria-label", buttonLabel);
  button.addEventListener("click", () => {
    void chopSelectedForestryConstruction(construction.constructionId, forestry.version, button);
  });
  panel.appendChild(button);
  node.appendChild(panel);
}

async function chopSelectedForestryConstruction(
  constructionId: string,
  expectedForestryVersion: number,
  button?: HTMLButtonElement
): Promise<void> {
  if (state.farmId === null || interactionPending) return;
  interactionPending = true;
  if (button !== undefined) button.disabled = true;
  try {
    const result = await api().chopForestryConstruction(state.farmId, constructionId, {
      requestId: newRequestId("chop-forestry"),
      expectedForestryVersion
    });
    state.constructions = state.constructions.map((candidate) =>
      candidate.constructionId === constructionId ? { ...candidate, forestry: result.state } : candidate
    );
    refreshScene();
    renderForestryConstructionPanel();
    void refreshAccount();
    setStatus(() => `Đã chặt ${String(result.quantityAdded)} gỗ.`);
  } catch (error: unknown) {
    const text = error instanceof ApiError && error.code === "FORESTRY_CONSTRUCTION_NOT_READY"
      ? "Cây đang tái sinh, chưa thể chặt."
      : error instanceof ApiError && error.code === "INVENTORY_LIMIT_EXCEEDED"
        ? "Kho đồ không còn chỗ cho gỗ."
        : "Không thể chặt cây lúc này.";
    setStatus(() => text, true);
  } finally {
    interactionPending = false;
    renderForestryConstructionPanel();
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

function treeManagementRejectionFor(session: { readonly treeInstanceId: string }): MessageKey | null {
  if (state.selected === null) return "build.reason.noCell";
  const tree = state.trees.find((candidate) => candidate.treeInstanceId === session.treeInstanceId);
  const ignore = tree === undefined ? [] : [{ x: tree.tileX, y: tree.tileY }];
  const rejection = previewRejection(state.cellMap, state.selected, {
    allowedTerrain: ["LAND"],
    footprint: { widthCells: 1, depthCells: 1 },
    isRoad: false,
    ignore
  });
  return rejection === null ? null : rejectionMessageKey(rejection) as MessageKey;
}

function beginTreeMove(): void {
  const tree = selectedPlantedTree();
  if (tree === null || tree.storageState === "STORED" || tree.phase === "DEPLETED" || treeMoveSession !== null || objectPending) return;
  treeMoveSession = { kind: "MOVE", treeInstanceId: tree.treeInstanceId, expectedVersion: tree.version, turns: tree.rotation ?? 0 };
  setCameraMode("ESTATE");
  selectCell(tree.tileX, tree.tileY);
  scene?.setObjectPicking(false);
  document.body.classList.add("is-placing");
  renderTreeManagementPanel();
  setStatus(() => t("treeManagement.chooseDestination"));
}

function beginTreeRestore(tree: TreeStateDTO): void {
  if (tree.storageState !== "STORED" || treeMoveSession !== null || objectPending) return;
  state.selectedTreeInstanceId = tree.treeInstanceId;
  treeMoveSession = { kind: "RESTORE", treeInstanceId: tree.treeInstanceId, expectedVersion: tree.version, turns: tree.rotation ?? 0 };
  setCameraMode("ESTATE");
  const focus = state.selected ?? { x: tree.tileX, y: tree.tileY };
  selectCell(focus.x, focus.y);
  scene?.setObjectPicking(false);
  document.body.classList.add("is-placing");
  renderTreeManagementPanel();
  setStatus(() => t("treeManagement.chooseDestination"));
}

function cancelTreeMove(): void {
  treeMoveSession = null;
  scene?.setObjectPicking(true);
  document.body.classList.remove("is-placing");
  renderTreeManagementPanel();
}

function updateTreeMovePreview(): void {
  if (treeMoveSession === null) return;
  const rejection = treeManagementRejectionFor(treeMoveSession);
  scene?.setPlacementPreview({
    modelId: null,
    roadTierId: null,
    widthCells: 1,
    depthCells: 1,
    valid: rejection === null,
    rotationY: quarterTurnYaw(treeMoveSession.turns),
    allowedTerrain: ["LAND"]
  });
}

async function confirmTreeMove(): Promise<void> {
  if (state.farmId === null || treeMoveSession === null || state.selected === null || objectPending) return;
  const farmId = state.farmId;
  const session = treeMoveSession;
  const selected = state.selected;
  const rejection = treeManagementRejectionFor(session);
  if (rejection !== null) {
    setStatus((translate) => translate("build.cannotPlace", { reason: translate(rejection) }), true);
    return;
  }
  const tree = state.trees.find((candidate) => candidate.treeInstanceId === session.treeInstanceId);
  if (tree === undefined) return;
  objectPending = true;
  renderTreeManagementPanel();
  try {
    const targetTile = state.tiles.find((tile) => tile.x === selected.x && tile.y === selected.y);
    const body = {
      requestId: newRequestId(session.kind === "RESTORE" ? "restore-tree" : "move-tree"),
      expectedTreeVersion: session.expectedVersion,
      x: selected.x,
      y: selected.y,
      rotation: session.turns,
      ...(targetTile === undefined ? {} : { expectedTileVersion: targetTile.version })
    };
    if (session.kind === "RESTORE") {
      await api().restoreTree(farmId, tree.treeInstanceId, body);
    } else {
      await api().moveTree(farmId, tree.treeInstanceId, body);
    }
    treeMoveSession = null;
    scene?.setPlacementPreview(null);
    scene?.setObjectPicking(true);
    document.body.classList.remove("is-placing");
    await refreshFarm({ tiles: true, crops: false, trees: true, constructions: false });
    renderTreeManagementPanel();
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    objectPending = false;
    renderTreeManagementPanel();
  }
}

async function rotateSelectedTree(): Promise<void> {
  if (state.farmId === null || objectPending || treeMoveSession !== null) return;
  const tree = selectedPlantedTree();
  if (tree === null || tree.storageState === "STORED" && tree.phase === "DEPLETED") return;
  objectPending = true;
  renderTreeManagementPanel();
  try {
    await api().rotateTree(state.farmId, tree.treeInstanceId, {
      requestId: newRequestId("rotate-tree"),
      expectedTreeVersion: tree.version,
      rotation: (((tree.rotation ?? 0) + 1) % 4) as 0 | 1 | 2 | 3
    });
    await refreshFarm({ tiles: false, crops: false, trees: true, constructions: false });
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    objectPending = false;
    renderTreeManagementPanel();
  }
}

async function storeSelectedTree(): Promise<void> {
  if (state.farmId === null || objectPending || treeMoveSession !== null) return;
  const tree = selectedPlantedTree();
  if (tree === null || tree.storageState === "STORED") return;
  objectPending = true;
  renderTreeManagementPanel();
  try {
    await api().storeTree(state.farmId, tree.treeInstanceId, {
      requestId: newRequestId("store-tree"), expectedTreeVersion: tree.version
    });
    await refreshFarm({ tiles: true, crops: false, trees: true, constructions: false });
  } catch (error: unknown) {
    setStatus(describe(error), true);
  } finally {
    objectPending = false;
    renderTreeManagementPanel();
  }
}

function renderTreeManagementPanel(): void {
  const node = element<HTMLElement>("tree-management-panel");
  const tree = selectedPlantedTree();
  if (tree === null) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }
  node.hidden = false;
  node.replaceChildren();
  const panel = make("section", "tree-management-surface");
  panel.appendChild(make("h2", "resource-panel-title", t("treeManagement.title")));
  panel.appendChild(make("strong", "placement-name", treeName(tree.definitionId)));
  const stateText = tree.storageState === "STORED" ? t("forestry.status.stored") : t(`tree.state.${tree.phase}` as MessageKey);
  panel.appendChild(make("p", "tree-management-note", `${stateText} · (${String(tree.tileX)}, ${String(tree.tileY)})`));
  const actions = make("div", "tree-management-actions");
  if (treeMoveSession !== null) {
    const rejection = treeManagementRejectionFor(treeMoveSession);
    const note = make("p", rejection === null ? "placement-state is-valid" : "placement-state is-invalid");
    note.textContent = rejection === null ? t("treeManagement.chooseDestination") : t("build.cannotPlace", { reason: t(rejection) });
    panel.appendChild(note);
    const confirm = make("button", "primary", t("treeManagement.confirmMove"));
    confirm.type = "button"; confirm.disabled = rejection !== null || objectPending;
    confirm.addEventListener("click", () => { void confirmTreeMove(); });
    actions.appendChild(confirm);
    const cancel = make("button", "object-action", t("treeManagement.cancelMove"));
    cancel.type = "button"; cancel.addEventListener("click", cancelTreeMove); actions.appendChild(cancel);
  } else if (tree.storageState === "STORED") {
    panel.appendChild(make("p", "tree-management-note", t("treeManagement.storedNote")));
    const restore = make("button", "object-action", t("treeManagement.restore"));
    restore.type = "button"; restore.disabled = objectPending; restore.addEventListener("click", () => { beginTreeRestore(tree); });
    actions.appendChild(restore);
  } else if (tree.phase === "DEPLETED") {
    panel.appendChild(make("p", "tree-management-note", t("treeManagement.depletedNote")));
  } else {
    const move = make("button", "object-action", t("treeManagement.move"));
    move.type = "button"; move.disabled = objectPending; move.addEventListener("click", beginTreeMove); actions.appendChild(move);
    const rotate = make("button", "object-action", t("treeManagement.rotate"));
    rotate.type = "button"; rotate.disabled = objectPending; rotate.addEventListener("click", () => { void rotateSelectedTree(); }); actions.appendChild(rotate);
    const store = make("button", "object-action", t("treeManagement.store"));
    store.type = "button"; store.disabled = objectPending; store.addEventListener("click", () => { void storeSelectedTree(); }); actions.appendChild(store);
  }
  panel.appendChild(actions);
  node.appendChild(panel);
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
  element<HTMLElement>("build-title").replaceChildren(
    createIcon("build", 24),
    Object.assign(document.createElement("span"), { textContent: t("panel.build") })
  );
  element<HTMLElement>("build-rail").setAttribute("aria-label", t("build.categories"));
  element<HTMLElement>("build-search").setAttribute("aria-label", t("build.search"));
  element<HTMLElement>("market-title").textContent = t("panel.market");
  element<HTMLElement>("module-rail").setAttribute("aria-label", t("hud.modules"));
  renderMarketTabs();
  setLabel("plant", t("dock.plant"));
  setLabel("harvest", t("dock.harvest"));
  setLabel("uproot", t("dock.uproot"));
  setLabel("harvest-tree", t("dock.harvest"));
  setLabel("remove-tree", t("dock.removeTree"));
  const language = element<HTMLButtonElement>("language");
  language.title = t("language.label");
  language.setAttribute("aria-label", t("language.label"));
  element<HTMLButtonElement>("refresh").title = t("hud.refresh");
  renderBootRetry();
}

function renderPlantedForestryPanel(node: HTMLElement, tree: TreeStateDTO): void {
  const definition = state.treeDefinitions.find((candidate) => candidate.treeDefinitionId === tree.definitionId);
  if (definition === undefined) {
    node.hidden = true;
    node.replaceChildren();
    return;
  }
  const focused = interactionCandidate?.key === `tree:${tree.treeInstanceId}` ? interactionCandidate : null;
  const inRange = state.cameraMode === "CHARACTER" && focused !== null && focused.distanceWorld <= focused.rangeWorld;
  const view = plantedForestryPanelState(tree, definition, inRange);
  node.hidden = false;
  node.replaceChildren();
  const panel = make("section", "resource-panel forestry-planted-tree-panel");
  panel.setAttribute("aria-label", t("forestry.title"));
  panel.appendChild(make("h2", "resource-panel-title", t("forestry.title")));
  const close = make("button", "resource-panel-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", t("forestry.close"));
  close.addEventListener("click", () => {
    clearSelection();
  });
  panel.appendChild(close);
  const grid = make("div", "resource-panel-grid");
  const row = (label: string, value: string): void => {
    const item = make("div", "resource-panel-row");
    item.appendChild(make("span", "resource-panel-label", label));
    item.appendChild(make("span", "resource-panel-value", value));
    grid.appendChild(item);
  };
  row(t("forestry.origin"), t("forestry.origin.planted"));
  row(t("forestry.type"), displayName(state.language, view.displayNameKey, tree.definitionId));
  row(t("forestry.product"), displayName(state.language, view.productDisplayKey, view.productItemDefinitionId));
  row(t("forestry.yield"), `${String(definition.baseQuantity)} ${displayName(state.language, view.productDisplayKey, view.productItemDefinitionId)}`);
  row(t("forestry.level"), String(definition.requiredLevel));
  const seconds = forestryRemainingSeconds(view.readyAt, view.secondsUntilReady);
  row(
    t("forestry.status"),
    view.status === "READY"
      ? t("forestry.status.ready")
      : view.status === "DEPLETED"
        ? t("forestry.status.depleted")
        : view.status === "STORED"
          ? t("forestry.status.stored")
        : t("forestry.status.growing", { time: formatRemainingGrowth(seconds, t) })
  );
  panel.appendChild(grid);
  if (view.status === "STORED") panel.appendChild(make("p", "resource-panel-note", t("forestry.status.storedHint")));
  if (view.needsCleanup) {
    panel.appendChild(make("p", "resource-panel-note forestry-tree-countdown", t("forestry.cleanup")));
    const cleanup = make("button", "object-action", t("forestry.clearStump"));
    cleanup.type = "button";
    cleanup.disabled = interactionPending;
    cleanup.addEventListener("click", () => {
      void removeSelectedTree();
    });
    panel.appendChild(cleanup);
  } else if (view.action !== null) {
    const button = make("button", "object-action resource-panel-action forestry-tree-chop", t("forestry.chopButton", { quantity: definition.baseQuantity }));
    button.type = "button";
    button.disabled = !view.inRange || interactionPending;
    button.addEventListener("click", () => { void harvestSelectedWildwoodTree(); });
    panel.appendChild(button);
    if (!view.inRange) panel.appendChild(make("p", "resource-panel-note", t(state.cameraMode === "CHARACTER" ? "forestry.outOfRange" : "forestry.switchToCharacter")));
  }
  node.appendChild(panel);
}

/** Presentation-only yield text from the same static drop table the server uses for this node type. */
function resourceYieldLabel(definitionId: string, itemName: string): string {
  const definition = resourceDefinitionRegistry.get(definitionId);
  const table = definition === undefined ? undefined : resourceDropTableRegistry.get(definition.dropTableId);
  const entry = table?.entries.length === 1 ? table.entries[0] : undefined;
  if (entry === undefined) return itemName;
  const quantity = entry.minQuantity === entry.maxQuantity
    ? String(entry.minQuantity)
    : `${String(entry.minQuantity)}-${String(entry.maxQuantity)}`;
  return `${quantity} ${itemName}`;
}

/** The contextual profession surface for a wild resource node, kept separate from object editing. */
function clearResourceNodeSelection(): void {
  selectedResourceNodeId = null;
  if (interactionFocusKey?.startsWith("resource:")) interactionFocusKey = null;
  renderResourcePanel();
}

function miningStatusText(status: ReturnType<typeof miningPanelState>["status"]): string {
  switch (status) {
    case "AUTO_LOADING": return t("mining.status.loading");
    case "AUTO_ERROR": return t("mining.status.error");
    case "SETUP_REQUIRED": return t("mining.status.areaRequired");
    case "NO_ASSIGNMENT": return t("mining.status.noAssignment");
    case "DISABLED": return t("mining.status.disabled");
    case "READY": return t("mining.status.ready");
    case "STOPPED": return t("mining.status.stopped");
    case "TRAVELLING": return t("mining.status.travelling");
    case "CARRYING": return t("mining.status.carrying");
    case "MINING": return t("mining.status.mining");
    case "CARGO_FULL": return t("mining.status.cargoFull");
    case "WAITING": return t("mining.status.waiting");
  }
}

function openMiningWorkAreaSetup(nodeId: string): void {
  const node = state.resourceNodes.find((candidate) => candidate.nodeId === nodeId);
  if (node === undefined || state.farmId === null || !workersDataReady()) return;
  pendingMiningSetup = { nodeId };
  selectedResourceNodeId = nodeId;
  setActivePanel({ active: "workAreas" });
  setWorkAreaEditor("CREATE", undefined, {
    kind: "MINING",
    name: t("mining.workAreaDefaultName"),
    cells: [node.position]
  });
}

function openMiningAssignmentSetup(): void {
  if (!workersDataReady() || state.farmId === null) return;
  workersDraftKind = "MINING";
  workersDraftTarget = "resource_ore";
  workersDraftAreaId = state.workAreas.find((area) => area.kind === "MINING" && area.cellCount > 0)?.workAreaId ?? "";
  workersDraftPolicy = false;
  workersView = "ASSIGNMENT_EDITOR";
  setActivePanel({ active: "workers" });
  workersRenderSignature = "";
  renderWorkers();
}

function renderResourcePanel(): void {
  ensureForestryCountdownTimer();
  const panel = element<HTMLElement>("resource-panel");
  const plantedTree = selectedWildwoodTree();
  const node = selectedResourceNodeId === null
    ? null
    : state.resourceNodes.find((candidate) => candidate.nodeId === selectedResourceNodeId) ?? null;
  if (node === null) {
    if (plantedTree === null) {
      panel.hidden = true;
      panel.replaceChildren();
    } else {
      renderPlantedForestryPanel(panel, plantedTree);
    }
    return;
  }

  const focused = interactionCandidate?.key === `resource:${node.nodeId}` ? interactionCandidate : null;
  const view = resourcePanelState(
    node,
    state.resourceAction,
    focused !== null && focused.distanceWorld <= focused.rangeWorld
  );
  panel.hidden = false;
  panel.replaceChildren();
  const head = make("div", "resource-panel-head");
  head.appendChild(make("h2", "resource-panel-title", t(view.profession === "FORESTRY" ? "forestry.title" : "mining.title")));
  const close = make("button", "resource-panel-close", "×");
  close.type = "button";
  close.setAttribute("aria-label", t(node.definitionId === "resource_ore" ? "mining.close" : "forestry.close"));
  close.addEventListener("click", () => {
    clearResourceNodeSelection();
    renderSelection();
    refreshInteractionCandidate();
  });
  head.appendChild(close);
  panel.appendChild(head);

  const unifiedMining = node.definitionId === "resource_ore";
  if (unifiedMining) {
    const mining = miningPanelState({
      node,
      actor: state.workerActor,
      jobs: state.workers,
      workAreas: state.workAreas,
      autoPlan: state.autoPlan,
      autoStep: state.autoStep,
      dataReady: workersDataReady(),
      dataError: workersError !== null
    });
    const grid = make("div", "resource-panel-grid");
    const row = (label: string, value: string): void => {
      const item = make("div", "resource-panel-row");
      item.appendChild(make("span", "resource-panel-label", label));
      item.appendChild(make("span", "resource-panel-value", value));
      grid.appendChild(item);
    };
    const productName = displayName(state.language, view.productDisplayKey, view.productItemDefinitionId);
    row(t("mining.resourceType"), displayName(state.language, view.displayNameKey, view.definitionId));
    row(t("mining.product"), productName);
    row(t("mining.yield"), t("mining.yieldValue", {
      quantity: resourceYieldLabel(view.definitionId, productName),
      seconds: String(node.actionSeconds)
    }));
    row(t("mining.status"), miningStatusText(mining.status));
    if (workersDataReady() && state.cargo !== null) {
      row(t("mining.cargo"), t("mining.cargoValue", {
        used: state.cargo.used.toLocaleString(state.language),
        capacity: state.cargo.capacity.toLocaleString(state.language),
        item: productName
      }));
    }
    row(t("mining.requiredLevel"), String(view.requiredLevel));
    panel.appendChild(grid);

    const actions = make("div", "resource-panel-actions");
    if (mining.status === "AUTO_LOADING") {
      actions.appendChild(make("p", "resource-panel-note", t("mining.status.loading")));
    } else if (mining.status === "AUTO_ERROR") {
      actions.appendChild(make("p", "resource-panel-note", t("mining.status.error")));
    } else if (mining.action === "SETUP_AREA") {
      actions.appendChild(make("p", "resource-panel-note", t("mining.status.areaRequired")));
      const setup = make("button", "object-action primary", t("mining.setupArea"));
      setup.type = "button";
      setup.addEventListener("click", () => { openMiningWorkAreaSetup(node.nodeId); });
      actions.appendChild(setup);
    } else if (mining.action === "ASSIGN") {
      actions.appendChild(make("p", "resource-panel-note", t("mining.status.noAssignment")));
      const assign = make("button", "object-action primary", t("mining.assign"));
      assign.type = "button";
      assign.addEventListener("click", openMiningAssignmentSetup);
      actions.appendChild(assign);
    } else if (mining.action === "START" || mining.action === "STOP") {
      const control = make(
        "button",
        `object-action${mining.action === "STOP" ? " danger" : " primary"}`,
        t(mining.action === "STOP" ? "mining.stop" : "mining.start")
      );
      control.type = "button";
      control.disabled = workersBusy || !economicStateReady() || reconciliationPending;
      control.addEventListener("click", () => { void toggleAuto(); });
      actions.appendChild(control);
    } else if (mining.action === "OPEN_AUTO") {
      const open = make("button", "object-action", t("mining.openWorkers"));
      open.type = "button";
      open.addEventListener("click", () => { setActivePanel({ active: "workers" }); });
      actions.appendChild(open);
    }
    panel.appendChild(actions);
    return;
  }

  const grid = make("div", "resource-panel-grid");
  const row = (label: string, value: string): void => {
    const item = make("div", "resource-panel-row");
    item.appendChild(make("span", "resource-panel-label", label));
    item.appendChild(make("span", "resource-panel-value", value));
    grid.appendChild(item);
  };
  row(t("forestry.origin"), t("forestry.origin.natural"));
  row(t("forestry.type"), displayName(state.language, view.displayNameKey, view.definitionId));
  const productName = displayName(state.language, view.productDisplayKey, view.productItemDefinitionId);
  row(t("forestry.product"), productName);
  row(t("forestry.yield"), resourceYieldLabel(view.definitionId, productName));
  const seconds = forestryRemainingSeconds(view.readyAt, view.secondsUntilReady);
  row(t("forestry.status"), view.status === "READY"
    ? t("forestry.status.ready")
    : view.status === "WORKING"
      ? t("forestry.status.working", { time: formatRemainingGrowth(seconds, t) })
      : t("forestry.status.regenerating", { time: formatRemainingGrowth(seconds, t) }));
  row(t("forestry.level"), String(view.requiredLevel));
  panel.appendChild(grid);

  if (view.action !== null) {
    const actions = make("div", "resource-panel-actions");
    const action = make("button", "object-action", t(interactionActionKey(view.action)));
    action.type = "button";
    const anotherGatherIsActive = state.resourceAction?.status === "ACTIVE" && state.resourceAction.nodeId !== node.nodeId;
    action.disabled = !view.inRange || interactionPending || anotherGatherIsActive || !economicStateReady();
    action.addEventListener("click", () => { void runInteraction(); });
    actions.appendChild(action);
    if (anotherGatherIsActive) actions.appendChild(make("p", "resource-panel-note", t("mining.alreadyGathering")));
    if (!view.inRange) actions.appendChild(make("p", "resource-panel-note", t(state.cameraMode === "CHARACTER" ? "forestry.outOfRange" : "forestry.switchToCharacter")));
    panel.appendChild(actions);
  }

  const activeActionForNode = state.resourceAction?.status === "ACTIVE" && state.resourceAction.nodeId === node.nodeId
    ? state.resourceAction
    : null;
  if (activeActionForNode !== null && activeActionForNode.secondsUntilReady <= 0) {
    const actions = make("div", "resource-panel-actions");
    const retry = make("button", "object-action resource-panel-action", t("boot.retry"));
    retry.type = "button";
    retry.disabled = !economicStateReady() || gatherSettlementPending;
    retry.addEventListener("click", () => { void run(settleGathering); });
    actions.appendChild(retry);
    actions.appendChild(make("p", "resource-panel-note", gatherSettlementPending ? t("mining.mine", { seconds: 0 }) : t("mining.alreadyGathering")));
    panel.appendChild(actions);
  }
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
  renderPlantPicker();
  renderField();
  renderSelection();
  renderGo();
  renderInventory();
  renderWarehouse();
  renderWorkAreas();
  renderWorkers();
  renderMarket();
  // The shop's own render is driven by the panel: see `setActivePanel`.
  if (panels.active === "build") renderBuildPanel();
  renderObjectPanel();
  renderTreeManagementPanel();
  renderAquaculturePanel();
  renderResourcePanel();
  renderAreaHarvestPanel();
  renderAreaHarvestLauncher();
  renderStatus();
  renderNeighborPanel();
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
  // Naming a field is map work too: the work-area editor picks cells in the estate view, so opening
  // the panel brings the camera back up rather than asking for precision from behind a shoulder.
  if (panels.active === "workAreas") setCameraMode("ESTATE");
  renderPanels();
  // A panel owns the world while it is open: the movement controls go away with it, and whatever a
  // thumb was holding is released rather than left deflected behind the panel.
  syncTouchControls();
  syncLayoutMetrics();
  // The shop draws itself when it is opened, and only then: a session that never opens it never asks
  // for a thumbnail, and so never creates the offscreen renderer those thumbnails need.
  if (panels.active === "build") renderBuildPanel();
  // Work areas are read when the panel is opened and never otherwise: no boot read, no poll.
  if (panels.active === "workAreas") void loadWorkAreas();
  // Workers are read when the panel is opened and never otherwise: no boot read, no poll.
  if (panels.active === "workers") {
    void loadWorkers();
    // Opening the sheet is a state change Auto cares about: if the actor is already driving, ask the
    // server for the next step rather than waiting for the next scheduled one.
    kickAutoStep();
  }
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

function economicStateReady(): boolean {
  return state.farmId !== null && accountReady && !reconciliationPending;
}

function requireEconomicState(): boolean {
  if (economicStateReady()) return true;
  setStatus(message(state.farmId === null ? "status.loadFarm" : "status.syncing"), true);
  return false;
}

async function refreshAccount(): Promise<void> {
  if (accountRefreshInFlight !== null) return accountRefreshInFlight;
  const generation = accountRefreshGeneration;
  const current = (): boolean => generation === accountRefreshGeneration;
  const request = (async () => {
    const client = api();
    const reads = {
      getInventory: client.getInventory(),
      getWallet: client.getWallet(),
      // One bounded read with the rest of the account: the warehouse is refreshed on load and after
      // every action that could have changed what the island holds, never on a timer.
      getWarehouse: client.getWarehouse(),
      getShop: client.getShop(),
      getProgression: client.getProgression(),
      getCropDefinitions: client.getCropDefinitions(),
      getTreeDefinitions: client.getTreeDefinitions(),
      getBuildCatalog: client.getBuildCatalog(),
      getWorldObjects: client.getWorldObjects()
    };
    let firstFailure: unknown = null;
    await settleIndependentReads(reads, {
      getInventory: {
        onFulfilled: (result) => { if (current()) state.inventory = result.items; },
        onRejected: (reason) => { firstFailure ??= reason; }
      },
      getWallet: {
        onFulfilled: (result) => { if (current()) state.wallet = result.wallets; },
        onRejected: (reason) => { firstFailure ??= reason; }
      },
      getWarehouse: {
        onFulfilled: (result) => { if (current()) state.warehouse = result.warehouse; },
        onRejected: (reason) => { firstFailure ??= reason; }
      },
      getShop: {
        onFulfilled: (result) => { if (current()) state.shop = result.entries; },
        onRejected: (reason) => { firstFailure ??= reason; }
      },
      getProgression: {
        onFulfilled: (result) => { if (current()) state.progression = result.progression; },
        onRejected: (reason) => { firstFailure ??= reason; }
      },
      getCropDefinitions: {
        onFulfilled: (result) => { if (current()) state.cropDefinitions = result.definitions; },
        onRejected: (reason) => { firstFailure ??= reason; }
      },
      getTreeDefinitions: {
        onFulfilled: (result) => { if (current()) state.treeDefinitions = result.definitions; },
        onRejected: (reason) => { firstFailure ??= reason; }
      },
      getBuildCatalog: {
        onFulfilled: (result) => {
          if (!current()) return;
          state.buildCatalog = result.entries;
          buildCatalogStatus = "ready";
          if (panels.active === "build") renderBuildPanel();
        },
        onRejected: (reason) => {
          firstFailure ??= reason;
          if (!current()) return;
          buildCatalogStatus = "error";
          if (panels.active === "build") renderBuildPanel();
        }
      },
      getWorldObjects: {
        onFulfilled: (result) => { if (current()) state.worldObjects = indexWorldObjects(result.objects); },
        onRejected: (reason) => { firstFailure ??= reason; }
      }
    });
    if (!current()) return;
    ensurePlantableSelection();
    if (firstFailure !== null) {
      throw firstFailure instanceof Error ? firstFailure : new Error("Account bootstrap read failed");
    }
  })();
  accountRefreshInFlight = request;
  try {
    await request;
  } finally {
    if (accountRefreshInFlight === request) accountRefreshInFlight = null;
  }
}

function setSceneState(text: StatusText): void {
  sceneState = text;
  renderSceneState();
}

function renderSceneState(): void {
  element<HTMLSpanElement>("render-3d-state").textContent = sceneState(t, state.language);
}

function neighborStatusText(npc: NeighborSnapshotDTO["npc"]): string {
  if (npc.phase === "GROWING") return `Đang trồng · còn ${String(npc.secondsUntilNextMilestone)} giây`;
  if (npc.phase === "STOCKED") return `Đã thu hoạch ${String(npc.stockQuantity)} sản phẩm · đang dựng nhà`;
  return `Đã dựng công trình cấp ${String(npc.constructionLevel)}`;
}

function renderNeighborPanel(): void {
  const panel = element<HTMLElement>("neighbor-panel");
  const neighbor = state.neighbor;
  if (neighbor === null || (neighborSelectedTarget === null && neighbor.visit.currentPlace === "HOME_ISLAND")) {
    panel.hidden = true; panel.replaceChildren(); return;
  }
  panel.hidden = false; panel.classList.toggle("is-visit", neighbor.visit.currentPlace === "NEIGHBOR_ISLAND"); panel.replaceChildren();
  const head = make("div", "neighbor-head");
  head.appendChild(make("h2", undefined, neighbor.visit.currentPlace === "NEIGHBOR_ISLAND" ? "Đảo hàng xóm" : "Bến sang đảo"));
  const close = make("button", "secondary", "×"); close.setAttribute("aria-label", "Đóng");
  close.addEventListener("click", () => { neighborSelectedTarget = null; renderNeighborPanel(); }); head.appendChild(close); panel.appendChild(head);
  const npc = neighbor.npc;
  if (neighbor.visit.currentPlace === "NEIGHBOR_ISLAND") {
    panel.appendChild(make("p", "neighbor-status", `Mina · ${neighborStatusText(npc)}`));
    const talk = make("button", "secondary", "Nói chuyện"); talk.addEventListener("click", () => { void talkToNeighbor(); });
    const home = make("button", undefined, "Về HOME_ISLAND"); home.addEventListener("click", () => { void travelToNeighbor("HOME_ISLAND"); });
    const actions = make("div", "neighbor-actions"); actions.appendChild(talk); actions.appendChild(home); panel.appendChild(actions);
  } else {
    panel.appendChild(make("p", "neighbor-status", "Điểm cập đảo an toàn · không thay đổi farm của bạn"));
    const actions = make("div", "neighbor-actions");
    for (const island of neighbor.islands ?? [neighbor.island]) {
      const slot = "slot" in island && (island.slot === "KIM" || island.slot === "THUY" || island.slot === "MOC") ? island.slot : "MOC";
      const label = slot === "KIM" ? "Sang dao Kim" : slot === "THUY" ? "Sang dao Thuy" : "Sang dao Moc";
      const islandButton = make("button", undefined, label); islandButton.addEventListener("click", () => { void travelToNeighbor("NEIGHBOR_ISLAND", island.islandId); }); actions.appendChild(islandButton);
    }
    panel.appendChild(actions);
  }
}

function applyNeighborPresentation(teleport: boolean): void {
  const neighbor = state.neighbor;
  if (neighbor === null || scene === null) return;
  const active = neighbor.visit.currentPlace === "NEIGHBOR_ISLAND";
  for (const id of ["module-rail", "selection-panels", "action-dock", "area-harvest-panel", "area-harvest-progress-dock", "placement-hud"]) {
    const node = document.getElementById(id);
    if (node !== null) {
      node.hidden = active;
      node.style.display = active ? "none" : "";
    }
  }
  // Neighbour identities and their persisted coordinates stay in the snapshot. HOME gets only the
  // renderer's low-detail template preview; the full shell, models, collision and NPC are reserved
  // for the active visit.
  if (!active) {
    scene.setNeighborIsland(null);
    const previews: SceneNeighborIslandPreview[] = (neighbor.islands ?? [neighbor.island]).flatMap((island) => {
      const slot = "slot" in island && (island.slot === "KIM" || island.slot === "THUY" || island.slot === "MOC") ? island.slot : null;
      return slot === null ? [] : [{ islandId: island.islandId, center: island.center, slot, ...(("seed" in island && typeof island.seed === "number") ? { seed: island.seed } : {}) }];
    });
    scene.setNeighborIslandPreviews(previews);
    if (teleport) {
      playerRuntime.teleport(SPAWN_WORLD);
      // The persisted Mộc center remains its server coordinate. This is camera framing only: from
      // HOME, place the orbit between HOME and Mộc so the real template-derived preview reads as a
      // distant island across open water instead of silently sitting outside the viewport.
      const moc = previews.find((island) => island.slot === "MOC");
      if (moc !== undefined) scene.focusWorld(moc.center.x, moc.center.z, 75, Math.PI * 0.25);
    }
    return;
  }
  const activeIsland = neighbor.islands?.find((island) => island.islandId === neighbor.visit.currentIslandId) ?? neighbor.island;
  const activeSlot = "slot" in activeIsland && (activeIsland.slot === "KIM" || activeIsland.slot === "THUY" || activeIsland.slot === "MOC") ? activeIsland.slot : "MOC";
  const activeNpc = (neighbor.npcs ?? []).find((npc) => npc.islandId === activeIsland.islandId);
  const activeSeed = "seed" in activeIsland && typeof activeIsland.seed === "number" ? activeIsland.seed : 0;
  // The legacy singleton NPC owns the only construction milestone contract. The three-island
  // archipelago NPCs expose a recurring work phase instead, so never let the legacy Mộc phase leak
  // onto Kim/Thủy or make their background presentation claim a server-owned build milestone.
  const activeConstructionPhase = activeIsland.islandId === neighbor.island.islandId ? neighbor.npc.phase : undefined;
  // These are D1-owned world coordinates.  Travel changes which island is rendered, never the
  // coordinate system.  In particular, do not reintroduce a presentation moat/offset here.
  const center = activeIsland.center;
  const islandKind = activeSlot === "KIM" ? "KIM" : activeSlot === "THUY" ? "THUY" : "MOC";
  const template = neighborIslandTemplate(islandKind);
  const mocLayout = activeSlot === "MOC" ? MOC_PREVIEW_LAYOUT : null;
  const presentationDockLocal = mocLayout?.dock.land ?? template.dockLocal;
  const presentationDock = mocLayout === null ? { x: center.x + presentationDockLocal.x, z: center.z + presentationDockLocal.z } : mocPresentationDockWorld(center);
  const remotePreviews: SceneNeighborIslandPreview[] = [
    // HOME uses its authored world outline as a render-only LOD while a neighbour is active. It has
    // no collision, NPCs, picking, or state of its own in this layer.
    { islandId: "HOME_ISLAND", center: { x: WORLD_CENTER_WORLD.worldX, z: WORLD_CENTER_WORLD.worldZ }, slot: "HOME" },
    ...(neighbor.islands ?? [neighbor.island]).flatMap((island) => {
    if (island.islandId === activeIsland.islandId) return [];
    const slot: SceneNeighborIslandPreview["slot"] | null = "slot" in island && (island.slot === "KIM" || island.slot === "THUY" || island.slot === "MOC") ? island.slot : null;
    return slot === null ? [] : [{ islandId: island.islandId, center: island.center, slot, seed: "seed" in island && typeof island.seed === "number" ? island.seed : 0 }];
    })
  ];
  scene.setNeighborIslandPreviews(remotePreviews);
  const terrain = {
    heightAt: (worldX: number, worldZ: number) => GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, worldX - center.x, worldZ - center.z),
    maxSlope: PLAYER_MAX_SLOPE,
    maxStepWorld: PLAYER_MAX_STEP_WORLD,
    depthAt: (worldX: number, worldZ: number) => {
      const localX = worldX - center.x;
      const localZ = worldZ - center.z;
      return neighborTerrainCollisionDepth(template, localX, localZ);
    }
  };
  const localObstacle = (id: string, x: number, z: number, radiusWorld: number) => ({ id, centerWorldX: center.x + x, centerWorldZ: center.z + z, radiusWorld });
  const forestLayout = mocLayout === null ? neighborForestLayout(template, activeSeed) : mocPreviewForestPlacements();
  const forestObstacles = forestLayout.map((tree, index) => localObstacle(`neighbor-tree-${String(index)}`, tree.x, tree.z, 0.7 * tree.scale));
  const houseLocal = mocPreviewPlacement("farmhouse") ?? template.houseLocal;
  const storeLocal = mocPreviewPlacement("storage-barn-t1") ?? template.storeLocal;
  const workPlacement = mocPreviewPlacement("workbench");
  const work = workPlacement === undefined ? template.workLocal : { x: workPlacement.x, z: workPlacement.z };
  const localNpc = { x: activeIsland.npc.x - center.x, z: activeIsland.npc.z - center.z };
  const obstacles = [
    localObstacle("neighbor-npc", localNpc.x, localNpc.z, 0.7),
    localObstacle("neighbor-house", houseLocal.x, houseLocal.z, 2.2),
    localObstacle("neighbor-store", storeLocal.x, storeLocal.z, 1.6),
    localObstacle("neighbor-work-yard", work.x, work.z, 1.8),
    ...forestObstacles,
    ...template.supportLocal.flatMap((detail, index) => {
      if (activeSlot === "MOC" && detail.kind === "TREE") return [];
      if (detail.kind === "WATER") return [];
      const radius = detail.kind === "ROCK" ? 0.85 * detail.scale : detail.kind === "BUSH" ? 0.45 * detail.scale : 0.7 * detail.scale;
      return [localObstacle(`neighbor-support-${String(index)}`, detail.x, detail.z, radius)];
    }),
    ...template.oreLocal.map((ore, index) => localObstacle(`neighbor-ore-${String(index)}`, ore.x, ore.z, 0.7 * ore.scale))
  ];
  scene.setNeighborIsland({
    ...activeIsland,
    slot: activeSlot,
    seed: activeSeed,
    ...(activeNpc === undefined ? {} : {
      npcJobKey: activeNpc.jobKey,
      npcStartedAt: activeNpc.plantedAt,
      npcNextActionAt: activeNpc.nextActionAt,
      npcCycle: activeNpc.cycle,
      ...(activeConstructionPhase === undefined ? {} : { npcConstructionPhase: activeConstructionPhase })
    })
  });
  playerRuntime.setTiles([]);
  playerRuntime.setObstacles(obstacles);
  playerRuntime.setTerrain(terrain);
  if (teleport) {
    const spawn = mocLayout === null
      ? { worldX: presentationDock.x - 2, worldZ: presentationDock.z }
      : (() => {
        const point = mocPresentationSpawnWorld(center);
        return { worldX: point.x, worldZ: point.z };
      })();
    playerRuntime.teleport(spawn);
  }
  // Mộc's presentation dock is sampled from the same outline as terrain/collision. The persisted
  // server dock remains untouched; only the local arrival/camera anchor follows this layout.
  if (teleport) {
    const frameX = presentationDock.x * 0.35 + center.x * 0.65;
    const frameZ = presentationDock.z * 0.35 + center.z * 0.65;
    scene.focusWorld(frameX, frameZ, 86);
  }
}

/** Clears HOME-only presentation state before the active island changes. */
function clearSelectionsForIslandTravel(): void {
  interactionFocusKey = null;
  interactionCandidate = null;
  interactionSignature = "";
  selectedResourceNodeId = null;
  state.selected = null;
  state.selectedTreeInstanceId = null;
  state.selectedObjectId = null;
  moveSession = null;
  treeMoveSession = null;
  deleteArmed = false;
  scene?.setSelection(null);
  scene?.setObjectSelection(null);
  scene?.setPlacementPreview(null);
  scene?.setObjectPicking(true);
  document.body.classList.remove("is-placing");
  renderField();
  renderSelection();
  renderResourcePanel();
  renderObjectPanel();
  renderAquaculturePanel();
  renderForestryConstructionPanel();
  renderTreeManagementPanel();
  renderGo();
  renderInteraction();
}

async function travelToNeighbor(destination: "HOME_ISLAND" | "NEIGHBOR_ISLAND", islandId?: string): Promise<void> {
  if (state.neighbor === null) return;
  try {
    const result = await api().travelNeighbor({ requestId: newRequestId("neighbor-travel"), expectedVersion: state.neighbor.visit.version, destination, ...(islandId === undefined ? {} : { islandId }) });
    state.neighbor = result.neighbor;
    clearSelectionsForIslandTravel();
    neighborSelectedTarget = "DOCK";
    applyNeighborPresentation(true);
    if (destination === "HOME_ISLAND") refreshScene();
    render();
  } catch { setStatus(() => "Không thể sang đảo lúc này", true); }
}

async function talkToNeighbor(): Promise<void> {
  if (state.neighbor === null) return;
  try {
    const result = await api().talkNeighbor({ requestId: newRequestId("neighbor-talk"), expectedVersion: state.neighbor.visit.version });
    state.neighbor = result.neighbor; setStatus(() => "Mina: Cảm ơn bạn đã ghé thăm! Mình đang chăm luống cây và dựng kho nhỏ."); render();
  } catch { setStatus(() => "Không thể nói chuyện lúc này", true); }
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
let orchardVisualAdapter: OrchardActorVisualAdapter | null = null;

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
    // A panel owns the keyboard and the stick while it is open. Movement is not a background activity:
    // walking while the market is up would move the character out from under the trade they are making.
    if (panels.active !== null) return NEUTRAL_INPUT;
    const held = movement?.vector() ?? NEUTRAL_INPUT;
    // Auto is driving and the player has taken the controls: the design's rule is that the player's own
    // hand wins, so the movement is handed straight through and the mode change is asked for once.
    if (autoIsDriving() && (held.x !== 0 || held.z !== 0)) {
      requestTakeoverFromInput("PLAYER_MOVEMENT");
    }
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
    panels.active === null && state.cameraMode === "CHARACTER" && ((movement?.isRunning() ?? false) || runHeld),
  onPose: (pose) => {
    characterPose = pose === null ? null : toScenePlayer(pose);
    scene?.setPlayer(characterPose);
    // The character moved, so what is in reach may have changed. This is the pose stream, which only
    // ticks while they are moving, so a standing character costs no scans at all.
    refreshInteractionCandidate();
    // Walking away gives up the cast. Same stream, so this is one distance check per moving frame and
    // nothing at all while the player stands still and fishes.
    if (
      state.fishingAction !== null &&
      fishingAnchor !== null &&
      characterPose !== null &&
      Math.hypot(characterPose.worldX - fishingAnchor.worldX, characterPose.worldZ - fishingAnchor.worldZ) >
        FISHING_CANCEL_RADIUS_WORLD
    ) {
      void cancelFishing();
    }
    // The same rule for a gather: walk away and the swing is abandoned, leaving the node untouched.
    if (
      state.resourceAction !== null &&
      gatherAnchor !== null &&
      characterPose !== null &&
      Math.hypot(characterPose.worldX - gatherAnchor.worldX, characterPose.worldZ - gatherAnchor.worldZ) >
        GATHER_CANCEL_RADIUS_WORLD
    ) {
      void cancelGathering();
    }
  },
  onTick: (timestampMs) => {
    const assignment = state.orchardVisualAssignments.find((candidate) => candidate.actorId === state.workerActor?.actorId);
    if (orchardVisualAdapter === null || assignment === undefined || characterPose === null) return false;
    const targets = assignment.targets.map((target) => ({ treeInstanceId: target.treeId, tileX: target.tileX, tileY: target.tileY }));
    const snapshot = orchardVisualAdapter.update(timestampMs, document.visibilityState === "visible", true, targets);
    scene?.setPlayer({ ...characterPose, working: snapshot.state === "WORKING" });
    return snapshot.state === "WORKING";
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

orchardVisualAdapter = createOrchardActorVisualAdapter({
  get position() { return characterPose === null ? null : { worldX: characterPose.worldX, worldZ: characterPose.worldZ }; },
  get destination() { return playerRuntime.destination; },
  setDestination: (destination) => { playerRuntime.setDestination(destination); },
  clearDestination: () => { playerRuntime.clearDestination(); }
}, (target) => {
  const world = tileToWorld({ x: target.tileX, y: target.tileY }, worldFrame());
  return { worldX: world.worldX, worldZ: world.worldZ };
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
    // A manual walk queued with "Go" is cancelled rather than left to fight the movement keys. Auto's
    // server-directed destination is different: switching the camera must not erase its local route
    // or make the next server wake look like a player takeover.
    if (!autoIsDriving()) playerRuntime.clearDestination();
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
  // No movement controls while a panel is open: the market, the inventory and the build shop are
  // places the player is *doing something else*, and a stick left live underneath one would walk the
  // character away while they shop.
  const visible = showTouchControls(capability, state.cameraMode) && panels.active === null;
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
  if (areaHarvestSelection.active && !areaHarvestSelection.pending && !areaHarvestSelection.minimized) {
    setAreaHarvestCorner(cell);
    return;
  }
  const same = state.selected !== null && state.selected.x === cell.x && state.selected.y === cell.y;
  if (same) return;
  if (!groundTapOpensContext({ mode: state.cameraMode, hasContextAction: cellOffersContext(cell) })) {
    clearSelection();
    return;
  }
  selectCell(cell.x, cell.y);
}

/** Selects a directly tapped resource/fishing target without granting or starting its action. */
function onWorldTargetSelected(target: SceneWorldTarget): void {
  if (target.kind === "NEIGHBOR_DOCK" || target.kind === "NEIGHBOR_NPC") {
    neighborSelectedTarget = target.kind === "NEIGHBOR_DOCK" ? "DOCK" : "NPC";
    renderNeighborPanel();
    return;
  }
  const key = target.kind === "RESOURCE_NODE" ? `resource:${target.id}` : `fishing:${target.id}`;
  const resolved = interactionIndex.targets.find((candidate) => candidate.key === key);
  if (resolved === undefined) return;
  if (areaHarvestSelection.active && !areaHarvestSelection.pending && !areaHarvestSelection.minimized) {
    setAreaHarvestCorner({ x: resolved.tileX, y: resolved.tileY });
    return;
  }
  if (target.kind === "RESOURCE_NODE") {
    clearObjectSelection();
    selectedResourceNodeId = target.id;
    const selectedNode = state.resourceNodes.find((candidate) => candidate.nodeId === target.id);
    if (selectedNode?.definitionId === "resource_ore" && !workersBusy && !workersLoaded) {
      void loadWorkers();
    }
  } else {
    clearResourceNodeSelection();
  }
  interactionFocusKey = resolved.key;
  state.selected = { x: resolved.tileX, y: resolved.tileY };
  renderField();
  renderSelection();
  renderGo();
  scene?.setSelection(state.selected);

  if (state.cameraMode === "CHARACTER") {
    // Selecting a target is inspection/context, not a player movement intent. In particular, opening
    // the Mining panel while Auto is running must not silently call STOP_AUTO just because the target
    // is outside the character's current manual interaction range.
    if (autoIsDriving()) {
      autoControlDiagnostic("TARGET_SELECTED_WHILE_AUTO", { targetKind: target.kind, targetId: target.id });
    } else {
      const destination = walkDestinationFor(
        state.selected,
        characterPose === null ? null : { worldX: characterPose.worldX, worldZ: characterPose.worldZ }
      );
      if (destination !== null) playerRuntime.setDestination(destination);
      else setStatus(message("interaction.tooFar"), true);
    }
  }
  refreshInteractionCandidate();
  renderResourcePanel();
}

/** Exact open-ground movement target for an active neighbour; it does not use HOME's cell map. */
function onGroundPositionSelected(position: { readonly worldX: number; readonly worldZ: number }): void {
  if (state.neighbor?.visit.currentPlace !== "NEIGHBOR_ISLAND") return;
  const activeIsland = state.neighbor.islands?.find((island) => island.islandId === state.neighbor?.visit.currentIslandId) ?? state.neighbor.island;
  const activeSlot = "slot" in activeIsland && (activeIsland.slot === "KIM" || activeIsland.slot === "THUY" || activeIsland.slot === "MOC") ? activeIsland.slot : "MOC";
  const template = neighborIslandTemplate(activeSlot);
  const localX = position.worldX - activeIsland.center.x;
  const localZ = position.worldZ - activeIsland.center.z;
  const terrainDepth = neighborTerrainCollisionDepth(template, localX, localZ);
  const collisionDepth = selectionCollision.depth(position.worldX, position.worldZ);
  bootPerfInteractionDiagnostic("neighbor_movement_destination", {
    cameraMode: state.cameraMode,
    world: position,
    local: { x: localX, z: localZ },
    terrainDepth,
    collisionDepth,
    reachable: collisionDepth <= 0,
    reason: collisionDepth <= 0 ? "READY" : terrainDepth > 0 ? "NEIGHBOR_TERRAIN" : "OBSTACLE"
  });
  if (collisionDepth > 0) {
    playerRuntime.clearDestination();
    return;
  }
  playerRuntime.setDestination(position);
}

/** Selects a placed aquaculture cage as an interaction target in character view. */
function onObjectSelectedForCharacter(constructionId: string, traceId: string | null = null): boolean {
  bootPerfInteractionTrace(traceId, "character_object_selection_entered", {
    constructionId,
    cameraMode: state.cameraMode
  });
  if (areaHarvestSelection.active && !areaHarvestSelection.pending && !areaHarvestSelection.minimized) {
    const construction = state.constructions.find((candidate) => candidate.constructionId === constructionId);
    if (construction !== undefined) setAreaHarvestCorner({ x: Math.floor(construction.anchorX), y: Math.floor(construction.anchorY) });
    return true;
  }
  if (state.cameraMode !== "CHARACTER") {
    bootPerfInteractionTrace(traceId, "character_object_selection_rejected", { reason: "NOT_CHARACTER_MODE" });
    return false;
  }
  const construction = state.constructions.find((candidate) => candidate.constructionId === constructionId);
  bootPerfInteractionTrace(traceId, "selected_construction_lookup", {
    constructionFound: construction !== undefined,
    entryId: construction?.entryId ?? null,
    constructionId: construction?.constructionId ?? null
  });
  if (construction === undefined) {
    bootPerfInteractionTrace(traceId, "character_object_selection_rejected", { reason: "CONSTRUCTION_NOT_FOUND" });
    return false;
  }
  const resolved = interactionIndex.targets.find((candidate) => candidate.key === `object:${constructionId}`);
  // Selecting the cage is a UI action immediately. Pond state can settle after the construction row,
  // so a missing projection must not discard the click or fall through to ground selection.
  interactionFocusKey = resolved?.key ?? null;
  state.selectedObjectId = constructionId;
  state.selected = resolved === undefined
    ? { x: Math.floor(construction.anchorX), y: Math.floor(construction.anchorY) }
    : { x: resolved.tileX, y: resolved.tileY };
  scene?.setObjectSelection(constructionId);
  renderObjectPanel();
  renderAquaculturePanel(traceId);
  renderForestryConstructionPanel();
  renderField();
  renderSelection();
  renderGo();
  scene?.setSelection(state.selected);
  if (resolved !== undefined && !autoIsDriving()) {
    const destination = walkDestinationFor(
      state.selected,
      characterPose === null ? null : { worldX: characterPose.worldX, worldZ: characterPose.worldZ }
    );
    if (destination !== null) playerRuntime.setDestination(destination);
  } else if (resolved !== undefined) {
    autoControlDiagnostic("OBJECT_SELECTED_WHILE_AUTO", { targetKind: "CONSTRUCTION", targetId: constructionId });
  }
  refreshInteractionCandidate();
  return true;
}

/** Whether this cell has anything a player could do or inspect on it. */
function cellOffersContext(cell: SelectedTile): boolean {
  return availableActions(selectionCell(cell), selectionAt(cell)).length > 0;
}

/** Drops the selection and everything that hangs off it. */
function clearSelection(): void {
  interactionFocusKey = null;
  clearResourceNodeSelection();
  state.selectedTreeInstanceId = null;
  treeMoveSession = null;
  if (state.selected === null) {
    renderResourcePanel();
    return;
  }
  state.selected = null;
  dock = collapseDock();
  scene?.setSelection(null);
  renderField();
  renderSelection();
  renderGo();
  renderResourcePanel();
  refreshScene();
}

/** Applies a selection from either the 2D field or the 3D view; both read and write this one state. */
function selectCell(x: number, y: number): void {
  if (areaHarvestSelection.active && !areaHarvestSelection.pending && !areaHarvestSelection.minimized) {
    setAreaHarvestCorner({ x, y });
    return;
  }
  // While a work area is being drawn, a tap on the map is a cell in the draft rather than a normal
  // selection: the editor owns the click until it is saved or cancelled.
  if (workAreaEditor !== null && workAreaEditor.mode !== "RENAME") {
    editWorkAreaDraftAt(x, y);
    return;
  }
  interactionFocusKey = null;
  clearResourceNodeSelection();
  state.selected = { x, y };
  if (treeMoveSession === null) {
    const plantedTree = treeAt(x, y);
    state.selectedTreeInstanceId = plantedTree?.treeInstanceId ?? null;
  }
  renderField();
  renderSelection();
  renderResourcePanel();
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
  if (treeMoveSession !== null) {
    updateTreeMovePreview();
    renderTreeManagementPanel();
  }
  // Clicking the ground is also how a player says "walk there". The destination is offered only for
  // a cell a character can actually stand on, and it is never an *action*: planting and harvesting
  // stay on the dock's own buttons, so a mis-click cannot change the farm.
  //
  // While an object is being carried, the same clicks are *its* destination and nothing else: the
  // player is choosing where a barn goes, and setting off on foot to every cell they hover over
  // would be a second, unwanted answer to the same click.
  if (moveSession === null) {
    const destination = walkDestinationFor(
      state.selected,
      state.cameraMode === "CHARACTER" && characterPose !== null
        ? { worldX: characterPose.worldX, worldZ: characterPose.worldZ }
        : null
    );
    bootPerfInteractionDiagnostic("movement_destination", {
      cameraMode: state.cameraMode,
      target: state.selected,
      destination,
      reachable: destination !== null,
      reason: destination === null ? "BLOCKED_OR_UNWALKABLE" : "READY"
    });
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
function walkDestinationFor(
  coordinate: { readonly x: number; readonly y: number },
  from: { readonly worldX: number; readonly worldZ: number } | null = null
): { readonly worldX: number; readonly worldZ: number } | null {
  const cells = sceneInput().cells;
  const cell: WorldCell | undefined = cells.cells.get(cellKey(coordinate.x, coordinate.y));
  if (cell === undefined) return null;
  const blocked = (worldX: number, worldZ: number): boolean => selectionCollision.depth(worldX, worldZ) > 0;
  if (from === null) return movementDestination(cell, cells, blocked);
  return movementDestinationForTarget(cell, cells, from, blocked);
}

/** The renderer's view of the farm right now: one descriptor set for drawing and for collision. */
function sceneInput(): FarmSceneInput {
  return buildFarmSceneInput({
    tiles: state.tiles,
    crops: state.crops,
    trees: state.trees,
    plots: state.plots,
    constructions: state.constructions,
    resourceNodes: state.resourceNodes,
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
  // The deposits are drawn from the server's own availability, so a settled gather shrinks its node and
  // a regeneration restores it without either being a client decision.
  scene.setResourceNodes(state.resourceNodes.map(toSceneResourceNode));
  scene.setFishingSpots(state.fishingSpots.map(toSceneFishingSpot));
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
  // And a row that the refresh no longer reports takes its panel and its mark with it.
  reconcileObjectSelection();
  // Movement is blocked by the same rows the renderer draws, so a crop that grows under the
  // character starts blocking the next step without a second refresh path. Rebuilding the collision
  // world never moves the character: it only changes where the next step may go.
  playerRuntime.setTiles(input.tiles);
  // The island's own objects are solid too: a tree the player can select is a tree the character
  // walks around, and because the circles come from the rows, moving or storing one takes it away.
  const objectCircles = objectObstacles(state.constructions, worldFrame(), state.worldObjects);
  const resourceCircles = state.resourceNodes.flatMap((node) => {
    const at = tileToWorld(node.position, worldFrame());
    return resourceNodeCollisionObstacles({
      id: node.nodeId,
      definitionId: node.definitionId,
      worldX: at.worldX,
      worldZ: at.worldZ
    });
  });
  playerRuntime.setObstacles([...objectCircles, ...resourceCircles]);
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
  selectionCollision = createPlayerCollisionWorld(input.tiles, [...objectCircles, ...resourceCircles], terrain);
  try {
    scene.setState(input);
    if (state.neighbor !== null) applyNeighborPresentation(false);
    else scene.setNeighborIsland(null);
  } catch (error: unknown) {
    // The 3D view is a projection of state the rest of the page owns. A renderer problem must not
    // abort the authoritative refresh that called this, because the 2D field and the polling that
    // keeps it current do not depend on the 3D view working.
    const described = describe(error);
    setSceneState((translate, language) => translate("scene.error", { message: described(translate, language) }));
    return;
  }
  syncAreaHarvestOverlay();
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
    fishingSpots: state.fishingSpots,
    resourceNodes: state.resourceNodes,
    aquaculturePonds: state.aquaculturePonds,
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
  if (interactionFocusKey !== null && !interactionIndex.targets.some((target) => target.key === interactionFocusKey)) {
    interactionFocusKey = null;
  }
  if (pose === null || context === null || state.cameraMode !== "CHARACTER") {
    interactionCandidate = null;
  } else {
    const query = { worldX: pose.worldX, worldZ: pose.worldZ, facingYaw: pose.facingYaw };
    // A direct tap owns the target while walking; E/touch must use the same focus rather than
    // switching to whichever target became globally nearest during movement.
    const focused = interactionFocusKey === null
      ? null
      : interactionIndex.targets.find((target) => target.key === interactionFocusKey) ?? null;
    interactionCandidate = selectFocusedInteractionCandidate(interactionIndex, focused, query);
  }
  // The mark follows the same candidate the prompt does: one ring under the thing E would act on, so a
  // field of ripe crops does not leave the player guessing which one is meant.
  scene?.setInteractionTarget(
    interactionCandidate === null
      ? null
      : { x: interactionCandidate.tileX, y: interactionCandidate.tileY }
  );
  renderInteraction();
  renderResourcePanel();
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
  const focusedTarget =
    interactionFocusKey === null
      ? null
      : interactionIndex.targets.find((target) => target.key === interactionFocusKey) ?? null;
  const displayedTarget = candidate ?? focusedTarget;
  const inRange = candidate !== null;
  const economicReady = economicStateReady();
  const autoDriving = autoIsDriving();
  const signature =
    displayedTarget === null
      ? ""
      : `${String(capability.coarse)}|${String(economicReady)}|${String(autoDriving)}|${state.language}|${displayedTarget.key}|${displayedTarget.action}|${String(displayedTarget.version)}|${String(displayedTarget.readyInSeconds ?? "")}|${String(inRange)}`;
  if (signature === interactionSignature) return;
  interactionSignature = signature;

  bootPerfInteractionDiagnostic("candidate", {
    kind: displayedTarget?.kind ?? null,
    targetId: displayedTarget?.targetId ?? null,
    target: displayedTarget === null ? null : { worldX: displayedTarget.worldX, worldZ: displayedTarget.worldZ },
    character: characterPose === null ? null : { worldX: characterPose.worldX, worldZ: characterPose.worldZ },
    distanceWorld: candidate?.distanceWorld ?? null,
    allowedRangeWorld: displayedTarget?.rangeWorld ?? null,
    action: displayedTarget?.action ?? null,
    readyInSeconds: displayedTarget?.readyInSeconds ?? null,
    economicReady,
    autoDriving
  });

  const prompt = element<HTMLElement>("interaction-prompt");
  const button = element<HTMLButtonElement>("interact-button");
  // Auto owns the actor while it is driving. A manual prompt (especially "outside range") would
  // contradict the server-controlled travel/mining state, so the interaction surface stays quiet
  // until control returns to the player.
  const shows = displayedTarget !== null && economicReady && !autoDriving;
  prompt.hidden = !(shows && !capability.coarse);
  button.hidden = !(shows && inRange);
  if (!shows) return;

  const target = displayName(state.language, displayedTarget.nameKey ?? "", displayedTarget.nameFallback);
  const action = t(interactionActionKey(displayedTarget.action));
  element<HTMLElement>("interaction-action").textContent = action;
  element<HTMLElement>("interaction-target").textContent =
    displayedTarget.readyInSeconds === null
      ? inRange ? target : `${target} · ${t("interaction.tooFar")}`
      : `${target} · ${t("interaction.readyIn", { time: formatRemainingGrowth(displayedTarget.readyInSeconds, t) })}`;

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
  if (state.cameraMode !== "CHARACTER" || interactionPending || !requireEconomicState()) return;
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
      : selectFocusedInteractionCandidate(
          interactionIndex,
          interactionFocusKey === null
            ? null
            : interactionIndex.targets.find((target) => target.key === interactionFocusKey) ?? null,
          {
          worldX: pose.worldX,
          worldZ: pose.worldZ,
          facingYaw: pose.facingYaw
          }
        );
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
    case "TRADE":
      // A place that offers a service: opening the market is the whole action. No server call happens
      // here - the market's own commands are the only thing that trades.
      openFarmMarketFromStall();
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
    case "CHOP_FORESTRY_CONSTRUCTION":
      scene?.playHarvestGesture();
      await chopSelectedForestryConstruction(decision.constructionId, decision.expectedForestryVersion);
      return;
    case "FISH":
      // Fishing is one command and then a wait the server owns. The spot is the server's; the client
      // only said which water the player meant.
      await startFishing(decision.spotId, decision.target);
      return;
    case "GATHER":
      // Mining (and later chopping): one command, one wait, and a payout the server owns entirely.
      await gatherResource(decision.nodeId, decision.verb, decision.target);
      return;
    case "STOCK_AQUACULTURE":
      await stockAquaculturePond(decision.pondId, decision.expectedPondVersion);
      return;
    case "HARVEST_AQUACULTURE":
      await harvestAquaculturePond(decision.pondId, decision.expectedPondVersion);
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
    treeDefinitions: state.treeDefinitions,
    fish: state.fish,
    resourceNodes: state.resourceNodes
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

let levelUpTimer: number | null = null;

/**
 * Announces a level the server reported, and the catalogue content it opened.
 *
 * The level is the award's own, and the newly unlocked list is a diff of the catalogue the server
 * sent, between the level shown before the action and the level the award reports. Nothing here
 * decides what is unlocked: the planting picker and the market read the same level, so this can only
 * describe a state the server already enforces.
 */
function showLevelUp(previousLevel: number | null, level: number): void {
  const notices = unlockNotices({
    cropDefinitions: state.cropDefinitions,
    treeDefinitions: state.treeDefinitions,
    buildCatalog: state.buildCatalog,
    previousLevel,
    level
  });
  const names = notices.map((notice) => displayName(state.language, notice.labelKey, notice.fallback));
  const feedback = levelUpFeedback(level, names, t);
  const node = element<HTMLElement>("level-up");
  element<HTMLElement>("level-up-title").textContent = feedback.title;
  const detail = element<HTMLElement>("level-up-detail");
  detail.textContent = feedback.detail ?? "";
  detail.hidden = feedback.detail === null;
  node.hidden = false;
  // Restart the animation rather than trusting it to replay on a node that is already there.
  node.classList.remove("is-live");
  node.getBoundingClientRect();
  node.classList.add("is-live");
  if (levelUpTimer !== null) window.clearTimeout(levelUpTimer);
  levelUpTimer = window.setTimeout(() => {
    node.hidden = true;
    node.classList.remove("is-live");
    levelUpTimer = null;
  }, LEVEL_UP_DURATION_MS);
}

function enable3D(): void {
  if (scene === null) {
    bootPerfMark("renderer_init_started");
    try {
      scene = createFarmScene(element<HTMLCanvasElement>("scene"), {
        // The mobile profile is chosen by *capability*, never by a game rule: a coarse-pointer touch
        // device gets a conservative pixel ratio, a smaller shadow map and no micro-scenery. An
        // explicit `?quality=low` still wins, because that is a developer asking by name.
        quality: deviceQualityProfile(renderQualityRequested(), capability),
        onCellSelected: onGroundTap,
        // The work-area editor's hover and rectangle preview ride the renderer's own coalesced hover
        // callback, so moving the pointer costs the frame a redraw already costs - and no request at all.
        onCellHovered: (cell) => {
          if (areaHarvestSelection.active && !areaHarvestSelection.pending && !areaHarvestSelection.minimized && areaHarvestSelection.second !== null) {
            areaHarvestSelection = { ...areaHarvestSelection, focus: cell === null ? null : { x: cell.x, y: cell.y } };
            syncAreaHarvestOverlay();
            renderAreaHarvestPanel();
          } else {
            onWorkAreaHover(cell);
          }
        },
        onEstateFollowChange: (behaviour) => {
          // The renderer decides whether the estate camera is following; this is only how the
          // recenter control learns whether it would do anything.
          estateFollow = behaviour;
          renderCameraMode();
        },
        onObjectSelected: (constructionId, traceId) => {
          // While something is in hand or an object is being moved, a click belongs to that gesture -
          // the renderer only reports objects when the host has said they are pickable.
          const effectiveTraceId = traceId ?? bootPerfInteractionTraceId();
          bootPerfInteractionTrace(effectiveTraceId, "object_picker_returned", { constructionId });
          if (!onObjectSelectedForCharacter(constructionId, effectiveTraceId)) selectObject(constructionId);
        },
        onWorldTargetSelected: onWorldTargetSelected,
        onGroundPositionSelected: onGroundPositionSelected,
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
            hasCandidate: interactionCandidate !== null && economicStateReady(),
            uiOpen: panels.active !== null || state.buildSelection !== null || moveSession !== null
          });
          if (requested) void run(runInteraction);
          else if (
            (event.key === "e" || event.key === "E") &&
            !event.repeat &&
            !isTypingTarget(event.target) &&
            state.cameraMode === "CHARACTER" &&
            interactionFocusKey !== null &&
            panels.active === null &&
            state.buildSelection === null &&
            moveSession === null
          ) {
            // A directly selected cage/resource remains focused while the character walks. E must
            // explain that it is not in range yet instead of silently returning control to the camera.
            setStatus(message("interaction.tooFar"), true);
            return true;
          }
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
        },
        onFirstFrame: () => {
          bootPerfMark("first_3d_frame");
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
  if (state.neighbor?.visit.currentPlace === "NEIGHBOR_ISLAND") applyNeighborPresentation(true);
  renderGo();
  bootPerfMark("game_interactive");
  setStatus(message("scene.ready"));
}

/**
 * Re-reads the farm lists the caller names, and only those.
 *
 * The four lists are independent D1 full-list reads, so the default is deliberately *not* "all four"
 * everywhere: opening a farm passes `FULL_FARM_REFRESH`, an action passes `farmRefreshScopeFor(...)`
 * and the growth timer passes `GROWTH_REFRESH`. See `farm-refresh.ts` for why. A list the scope
 * leaves out keeps the page's last server-read copy - which is exact, because the action that
 * triggered the refresh cannot change it.
 */
async function refreshFarm(scope: FarmRefreshScope = FULL_FARM_REFRESH): Promise<void> {
  if (state.farmId === null) return;
  const farmId = state.farmId;
  const client = api();
  if (scope.constructions) void loadAquaculturePonds(farmId);
  const [tiles, crops, trees, constructions] = await Promise.all([
    scope.tiles ? client.getTiles(farmId) : null,
    scope.crops ? client.getCrops(farmId) : null,
    scope.trees ? client.getTrees(farmId) : null,
    scope.constructions ? client.getFarmConstructions(farmId) : null
  ]);
  if (state.farmId !== farmId) return;
  if (tiles !== null) state.tiles = tiles.tiles;
  if (crops !== null) state.crops = crops.crops;
  // V14.5.2: the plot catalogue is legacy. Nothing is locked - the natural island is the player's -
  // so the client neither reads plots nor draws locked land, which is also one D1 read fewer.
  state.plots = [];
  if (trees !== null) state.trees = trees.trees;
  if (crops !== null || trees !== null) scheduleGrowthRefresh();
  if (constructions !== null) state.constructions = constructions.constructions;
  if (scene === null && areaHarvestSelection.active) state.cellMap = sceneInput().cells;
  renderBuildStatus();
  if (panels.active === "build") renderBuildPanel();
  refreshScene();
  renderResourcePanel();
  renderTreeManagementPanel();
  renderAreaHarvestPanel();
  renderAreaHarvestLauncher();
}

/**
 * The lists a timer has to re-read: crops and trees mature on the server's clock.
 *
 * Land, plots and built objects change only when the player acts, and every action already calls
 * `refreshFarm`, so polling them bought nothing and cost a full-list D1 read every cycle. The V14.3.2
 * audit found those two queries were 91.8% of 5.83M rows read in a day. See
 * `docs/performance/D1_READ_AUDIT.md`.
 */
/** Local wall-clock instant (ms) at which the next growth read is due. Checking it costs no request. */
let growthRefreshDueAt = 0;

/** Recompute when the next growth read is worth a request, from the snapshot just received. */
function scheduleGrowthRefresh(): void {
  const durations = new Map(state.cropDefinitions.map((entry) => [entry.cropDefinitionId, entry.growthDurationSeconds]));
  growthRefreshDueAt = Date.now() + nextGrowthRefreshDelayMs({
    crops: state.crops.map((crop) => ({
      mature: crop.mature,
      growthProgress: crop.growthProgress,
      growthDurationSeconds: durations.get(crop.definitionId) ?? null
    })),
    trees: state.trees.map((tree) => ({
      ready: tree.ready,
      secondsUntilReady: tree.secondsUntilReady,
      stored: tree.storageState === "STORED"
    }))
  });
}

async function refreshGrowth(): Promise<void> {
  // Crops and production trees only: `GROWTH_REFRESH` reads no tiles and no built objects, so a
  // visible tab costs two small reads a tick and a hidden one costs nothing (see the gate below).
  await refreshFarm(GROWTH_REFRESH);
}

interface FarmBootContext {
  readonly previousActiveAt: number;
  readonly returnAt: number;
  readonly reconcile: boolean;
}

async function loadFarm(farmId: string): Promise<FarmBootContext> {
  const client = api();
  const result = await client.getFarm(farmId);
  accountRefreshGeneration += 1;
  state.farmId = result.farm.id;
  state.farmName = result.farm.name;
  state.neighbor = (await client.getNeighbor()).neighbor;
  neighborSelectedTarget = state.neighbor.visit.currentPlace === "NEIGHBOR_ISLAND" ? "NPC" : "DOCK";
  accountReady = false;
  reconciliationPending = true;
  returnPopupShown = false;
  // Visual assignments are optional presentation data and never belong on the renderer's critical
  // path. A late response is accepted only for the farm that requested it.
  void client.getOrchardVisualSnapshot(result.farm.id).then(
    (snapshot) => {
      if (state.farmId === result.farm.id) {
        state.orchardVisualAssignments = snapshot.assignments;
        render();
      }
    },
    () => {
      if (state.farmId === result.farm.id) state.orchardVisualAssignments = [];
    }
  );
  // A coordinate selected on the previous farm means nothing here, and clearing it matches what
  // creating a farm already does.
  state.selected = null;
  areaHarvestSelection = { active: false, operation: "HARVEST", plantOptionKey: null, first: null, second: null, pending: false, minimized: false, requestId: null, taskFarmId: null, taskGroups: null, syncing: false, focus: null, progress: null, lastResult: null };
  syncAreaHarvestOverlay();
  localStorage.setItem(FARM_KEY, result.farm.id);
  // These are the minimum world reads. They are independent of account settlement and can complete
  // while the renderer initializes.
  await Promise.all([refreshFishing(), refreshResources(), refreshFarm()]);
  playerRuntime.respawn();
  const returnAt = Date.now();
  const previousActiveAt = Number(localStorage.getItem("happyfarm.lastVisibleAt"));
  localStorage.setItem("happyfarm.lastVisibleAt", String(returnAt));
  return { previousActiveAt, returnAt, reconcile: true };
}

let productionReconcileInFlight: Promise<boolean> | null = null;
let autoReconcileInFlight: Promise<boolean> | null = null;
let lastProductionItems: readonly { readonly itemDefinitionId: string; readonly quantity: number }[] = [];
let lastProductionReconcileSucceeded = false;
function formatAway(ms: number): string {
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return t("return.lessThanMinute");
  if (minutes < 60) return `${String(minutes)} ${minutes === 1 ? t("return.minute") : t("return.minutes")}`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours < 24) return `${String(hours)} ${hours === 1 ? t("return.hour") : t("return.hours")}${remainder ? ` ${String(remainder)} ${t("return.minutes")}` : ""}`;
  const days = Math.floor(hours / 24);
  return `${String(days)} ${days === 1 ? t("return.day") : t("return.days")}${hours % 24 ? ` ${String(hours % 24)} ${t("return.hours")}` : ""}`;
}
function showReturnPopup(awayMs: number, producedItems: readonly { readonly itemDefinitionId: string; readonly quantity: number }[]): void {
  const popup = element<HTMLElement>("return-popup");
  element<HTMLElement>("return-popup-title").textContent = t("return.title");
  element<HTMLElement>("return-popup-away").textContent = t("return.away", { duration: formatAway(awayMs) });
  element<HTMLElement>("return-popup-produced").textContent = t("return.produced");
  const rows = producedItems.filter((item) => item.quantity > 0);
  const items = element<HTMLElement>("return-popup-items");
  items.replaceChildren(...rows.map((item) => { const row = document.createElement("p"); row.textContent = `${itemName(item.itemDefinitionId, item.itemDefinitionId)} +${String(item.quantity)}`; return row; }));
  element<HTMLElement>("return-popup-empty").hidden = rows.length > 0;
  element<HTMLElement>("return-popup-empty").textContent = t("return.none");
  element<HTMLButtonElement>("return-popup-close").textContent = t("return.continue");
  popup.hidden = false;
}

function showReturnPopupOnce(
  awayMs: number,
  producedItems: readonly { readonly itemDefinitionId: string; readonly quantity: number }[]
): void {
  if (returnPopupShown) return;
  returnPopupShown = true;
  showReturnPopup(awayMs, producedItems);
}

async function reconcileProductionOnce(): Promise<boolean> {
  if (state.farmId === null) return false;
  const farmId = state.farmId;
  if (productionReconcileInFlight !== null) return productionReconcileInFlight;
  bootPerfMark("reconcile_started");
  lastProductionReconcileSucceeded = false;
  productionReconcileInFlight = (async () => {
    try {
      const result = await api().reconcileProduction(farmId, newRequestId("production_reconcile"));
      lastProductionItems = result.producedItems;
      lastProductionReconcileSucceeded = true;
      const total = result.producedItems.reduce((sum, item) => sum + item.quantity, 0);
      if (total > 0) setStatus(message("status.productionAway", { items: result.producedItems.map((item) => `${item.itemDefinitionId} +${String(item.quantity)}`).join(", ") }));
      return total > 0;
    } catch {
      return false;
    } finally {
      productionReconcileInFlight = null;
      bootPerfMark("reconcile_finished");
    }
  })();
  return productionReconcileInFlight;
}

/**
 * One bounded reconciliation attempt, on entry or on resume.
 *
 * Best-effort by design: a farm with no Auto running answers `NOT_AUTO_CONTROLLED` and costs one
 * small request, and a failure here must never block the game from loading. This is the *only* place
 * the client asks for reconciliation - never the growth poll, and never a background timer.
 */
async function reconcileAutoOnce(): Promise<boolean> {
  if (state.farmId === null) return false;
  const farmId = state.farmId;
  if (autoReconcileInFlight !== null) return autoReconcileInFlight;
  const request = (async () => {
    try {
      const result = await api().reconcileAuto(farmId, { requestId: newRequestId("reconcile") });
      return result.reconciliation.transitionsProcessed > 0;
    } catch {
      return false;
    }
  })();
  autoReconcileInFlight = request;
  try {
    return await request;
  } finally {
    if (autoReconcileInFlight === request) autoReconcileInFlight = null;
  }
}

async function createFarm(): Promise<FarmBootContext> {
  const client = api();
  const created = await client.createFarm("Starter Farm");
  accountRefreshGeneration += 1;
  state.farmId = created.farm.id;
  state.farmName = created.farm.name;
  state.neighbor = (await client.getNeighbor()).neighbor;
  neighborSelectedTarget = "DOCK";
  accountReady = false;
  reconciliationPending = false;
  returnPopupShown = false;
  state.selected = null;
  localStorage.setItem(FARM_KEY, created.farm.id);
  localStorage.setItem("happyfarm.lastVisibleAt", String(Date.now()));
  await Promise.all([refreshFishing(), refreshResources(), refreshFarm()]);
  playerRuntime.respawn();
  setStatus(message("status.createdDetail", { name: created.farm.name, tiles: state.tiles.length }));
  return { previousActiveAt: 0, returnAt: Date.now(), reconcile: false };
}

/**
 * Completes account hydration and settlement after the first renderer work has started. Settlement
 * remains server-only; the one account read after it is the authoritative Warehouse/inventory state.
 */
function startInitialEconomicBootstrap(context: FarmBootContext): void {
  if (initialEconomicBootstrapInFlight !== null) return;
  reconciliationPending = context.reconcile;
  const request = (async () => {
    try {
      if (context.reconcile) {
        const autoChanged = await reconcileAutoOnce();
        if (autoChanged) await refreshFarm();
        await reconcileProductionOnce();
      }
      await refreshAccount();
      accountReady = true;
      bootPerfMark("warehouse_ready");
      scheduleFishingSettle();
      scheduleGatherSettle();
      rebuildInteractionIndex();
      refreshInteractionCandidate();
      refreshScene();
      render();
      if (
        context.reconcile &&
        lastProductionReconcileSucceeded &&
        Number.isFinite(context.previousActiveAt) &&
        context.previousActiveAt > 0
      ) {
        showReturnPopupOnce(Math.max(0, context.returnAt - context.previousActiveAt), lastProductionItems);
      }
      if (context.reconcile && !lastProductionReconcileSucceeded) {
        setStatus(message("status.syncFailed"), true);
      }
    } catch {
      accountReady = false;
      setStatus(message("status.syncFailed"), true);
    } finally {
      reconciliationPending = false;
      render();
    }
  })();
  initialEconomicBootstrapInFlight = request;
  void request.finally(() => {
    if (initialEconomicBootstrapInFlight === request) initialEconomicBootstrapInFlight = null;
  });
}

async function plant(): Promise<void> {
  if (!requireEconomicState() || state.farmId === null) return;
  const farmId = state.farmId;
  if (state.selected === null) {
    setStatus(message("status.selectTile"), true);
    return;
  }
  const target = state.selected;
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
  // V14.5.2: the natural Home Island is the player's land, so a cell with no tile row yet is simply
  // plantable - no quote, no purchase, no confirmation. The server writes the row it needs.
  const tile = selectedTile();
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
  if (cropAt(target.x, target.y) !== null) {
    setStatus(message("status.occupied"), true);
    return;
  }
  const client = api();
  const body: {
    requestId: string;
    cropDefinitionId: string;
    x: number;
    y: number;
    expectedTileVersion?: number;
  } = {
    requestId: newRequestId("plant"),
    cropDefinitionId,
    x: target.x,
    y: target.y
  };
  if (tile !== null) body.expectedTileVersion = tile.version;
  await client.plantCrop(farmId, body);
  // The seed the planting spent comes back with the inventory refresh; nothing is subtracted here.
  await refreshFarm(farmRefreshScopeFor("PLANT_CROP"));
  await refreshAccount();
  setStatus(
    (translate) =>
      translate("status.planted", { crop: cropName(cropDefinitionId), x: target.x, y: target.y })
  );
}

async function harvestCrop(cropInstanceId: string, expectedCropVersion: number): Promise<void> {
  if (!requireEconomicState() || state.farmId === null) return;
  const farmId = state.farmId;
  // The level to diff unlocks against: the page's authoritative read *before* the harvest, since the
  // refresh below replaces it with the level the award reached.
  const previousLevel = state.progression?.level ?? null;
  // Where the crop stands, read before the refresh removes it: the reward pop rises from the thing
  // that paid it, and after the settle there is no row left to ask.
  const standing = state.crops.find((row) => row.cropInstanceId === cropInstanceId);
  const tile = standing === undefined ? null : { x: standing.tileX, y: standing.tileY };
  const client = api();
  const result = await client.harvestCrop(farmId, cropInstanceId, {
    requestId: newRequestId("harvest"),
    expectedCropVersion
  });
  // Field, crops, plots, inventory, wallet, XP, level, and crop catalogue all come back from the
  // server, and the caller re-renders the dock from that refreshed state.
  await refreshFarm(farmRefreshScopeFor("HARVEST_CROP"));
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
  if (awarded.leveledUp) showLevelUp(previousLevel, awarded.progression.level);
}

/** Harvests whatever the dock is currently showing; only a server-mature crop can reach this. */
async function harvestSelected(): Promise<void> {
  if (!requireEconomicState()) return;
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
  if (!requireEconomicState()) return;
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
  await refreshFarm(farmRefreshScopeFor("UPROOT_CROP"));
  await refreshAccount();
  setStatus(
    (translate) =>
      translate("status.uprooted", { x: coordinate?.x ?? 0, y: coordinate?.y ?? 0 })
  );
}

/** Plants the chosen tree: the sapling comes from the definition, and the server spends exactly one. */
async function plantTree(tile: FarmTileDTO | null): Promise<void> {
  const definitionId = state.selectedTree;
  if (!requireEconomicState() || state.farmId === null || definitionId === null || state.selected === null) {
    setStatus(message("status.noCrop"), true);
    return;
  }
  const farmId = state.farmId;
  const target = state.selected;
  // Belt and braces: an occupied tile never reaches the network, whichever occupant holds it.
  if (cropAt(target.x, target.y) !== null || treeAt(target.x, target.y) !== null) {
    setStatus(message("status.occupied"), true);
    return;
  }
  // V14.5.2: a fresh natural cell has no tile row, and the plant simply has no version to send.
  const body: {
    requestId: string;
    treeDefinitionId: string;
    x: number;
    y: number;
    expectedTileVersion?: number;
  } = {
    requestId: newRequestId("plant-tree"),
    treeDefinitionId: definitionId,
    x: target.x,
    y: target.y
  };
  if (tile !== null) body.expectedTileVersion = tile.version;
  await api().plantTree(farmId, body);
  await refreshFarm(farmRefreshScopeFor("PLANT_TREE"));
  await refreshAccount();
  setStatus((translate) =>
    translate("status.plantedTree", { tree: treeName(definitionId), x: target.x, y: target.y })
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
  if (!requireEconomicState() || state.farmId === null) return;
  const farmId = state.farmId;
  // Same diff base as a crop harvest: the level read before the award replaced it.
  const previousLevel = state.progression?.level ?? null;
  const standing = state.trees.find((row) => row.treeInstanceId === treeInstanceId);
  const tile = standing === undefined ? null : { x: standing.tileX, y: standing.tileY };
  const result = await api().harvestTree(farmId, treeInstanceId, {
    requestId: newRequestId("harvest-tree"),
    expectedTreeVersion
  });
  await refreshFarm(farmRefreshScopeFor("HARVEST_TREE"));
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
  if (awarded.leveledUp) showLevelUp(previousLevel, awarded.progression.level);
}

/** Harvests the selected tree; only a cycle the server reported ready can reach this. */
async function harvestSelectedTree(): Promise<void> {
  if (!requireEconomicState()) return;
  if (state.farmId === null) {
    setStatus(message("status.loadFarm"), true);
    return;
  }
  const selection = currentSelection();
  if (selection.kind !== "tree" || selection.tree === null || !selection.canHarvestTree) {
    setStatus(message("status.selectReadyTree"), true);
    return;
  }
  if (state.cameraMode !== "CHARACTER") {
    setStatus(message("forestry.switchToCharacter"), true);
    return;
  }
  const focused = interactionCandidate?.key === `tree:${selection.tree.treeInstanceId}` ? interactionCandidate : null;
  if (focused === null || focused.distanceWorld > focused.rangeWorld) {
    setStatus(message("interaction.tooFar"), true);
    return;
  }
  element<HTMLButtonElement>("harvest-tree").disabled = true;
  await harvestTree(selection.tree.treeInstanceId, selection.tree.version);
}

/** Chops a selected planted Wildwood tree through the existing authoritative tree settlement. */
async function harvestSelectedWildwoodTree(): Promise<void> {
  if (!requireEconomicState()) return;
  const tree = selectedWildwoodTree();
  if (tree === null || !tree.ready) {
    setStatus(message("status.selectReadyTree"), true);
    return;
  }
  const focused = interactionCandidate?.key === `tree:${tree.treeInstanceId}` ? interactionCandidate : null;
  if (state.cameraMode !== "CHARACTER") {
    setStatus(message("forestry.switchToCharacter"), true);
    return;
  }
  if (focused === null || focused.distanceWorld > focused.rangeWorld) {
    setStatus(message("forestry.outOfRange"), true);
    return;
  }
  await harvestTree(tree.treeInstanceId, tree.version);
}

/** Stocks one placed pond using the server-owned fish item and pond version. */
async function stockAquaculturePond(pondId: string, expectedPondVersion: number, quantity = 1): Promise<void> {
  if (!requireEconomicState() || state.farmId === null) return;
  const result = await api().stockAquaculturePond(state.farmId, pondId, {
    requestId: newRequestId("aquaculture-stock"),
    expectedPondVersion,
    quantity
  });
  await Promise.all([
    refreshFarm({ tiles: false, crops: false, trees: false, constructions: true }),
    refreshAccount()
  ]);
  setStatus((translate) => `${translate("status.refreshed")} (${result.pond.status})`);
}

/** Harvests one ready pond; reward and warehouse state come only from the authoritative refresh. */
async function harvestAquaculturePond(pondId: string, expectedPondVersion: number, quantity = 1): Promise<void> {
  if (!requireEconomicState() || state.farmId === null) return;
  const result = await api().harvestAquaculturePond(state.farmId, pondId, {
    requestId: newRequestId("aquaculture-harvest"),
    expectedPondVersion,
    quantity
  });
  await Promise.all([
    refreshFarm({ tiles: false, crops: false, trees: false, constructions: true }),
    refreshAccount()
  ]);
  setStatus((translate) => `${translate("status.refreshed")} (${result.pond.status})`);
}

async function withdrawAquaculturePond(pondId: string, expectedPondVersion: number, quantity = 1): Promise<void> {
  if (!requireEconomicState() || state.farmId === null) return;
  const result = await api().withdrawAquaculturePond(state.farmId, pondId, {
    requestId: newRequestId("aquaculture-withdraw"),
    expectedPondVersion,
    quantity
  });
  await Promise.all([
    refreshFarm({ tiles: false, crops: false, trees: false, constructions: true }),
    refreshAccount()
  ]);
  setStatus((translate) => `${translate("status.refreshed")} (${result.pond.status})`);
}

/*
 * Fishing.
 *
 * One command starts an attempt; the server answers with the instant the catch becomes claimable. The
 * page then does nothing at all until that moment - no polling, no per-second request, no writes - and
 * sends exactly one settle, which the server validates against its own clock and its own catch table.
 * Walking away cancels the attempt, and a cancelled attempt can never be paid.
 */

/** The last attempt's timer, so a second start or a cancel cannot leave one running. */
let fishingTimer: number | null = null;
/** Where the player stood when they cast, so "walked away" is a distance and not an input check. */
let fishingAnchor: { readonly worldX: number; readonly worldZ: number } | null = null;
/** The spot's cell, so the catch rises from the water it came out of. */
let fishingAt: { readonly x: number; readonly y: number } | null = null;

/** How far the player may drift before the attempt is given up, in world metres. */
const FISHING_CANCEL_RADIUS_WORLD = 2.5;

function clearFishingTimer(): void {
  if (fishingTimer === null) return;
  window.clearTimeout(fishingTimer);
  fishingTimer = null;
}

async function startFishing(
  spotId: string,
  target: { readonly tileX: number; readonly tileY: number }
): Promise<void> {
  if (!requireEconomicState()) return;
  if (state.fishingAction !== null) {
    setStatus(message("fishing.alreadyFishing"), true);
    return;
  }
  const result = await api().startFishing({ requestId: newRequestId("fish"), spotId });
  state.fishingAction = result.action;
  fishingAt = { x: target.tileX, y: target.tileY };
  fishingAnchor = characterPose === null ? null : { worldX: characterPose.worldX, worldZ: characterPose.worldZ };
  // The cast: the same short bow the harvest uses, because it is the same gesture vocabulary and this
  // phase is foundation, not animation.
  scene?.playHarvestGesture();
  setStatus((translate) => translate("fishing.cast", { seconds: result.action.secondsUntilReady }));
  scheduleFishingSettle();
}

/**
 * Waits out the server's countdown, locally, and then settles once.
 *
 * The timer is the page's own, so it costs nothing and reads nothing; the server re-checks the clock
 * when the settle arrives, which is what makes it authoritative rather than this timeout. The extra
 * quarter second is slack for clock skew, not a rule.
 */
function scheduleFishingSettle(): void {
  clearFishingTimer();
  const action = state.fishingAction;
  if (action === null) return;
  const waitMs = Math.max(0, Date.parse(action.readyAt) - Date.now());
  fishingTimer = window.setTimeout(() => {
    void settleFishing();
  }, waitMs + 250);
}

async function settleFishing(): Promise<void> {
  const action = state.fishingAction;
  if (action === null) return;
  if (!economicStateReady()) {
    fishingTimer = null;
    return;
  }
  clearFishingTimer();
  const result = await api().settleFishing(action.actionId, {
    requestId: newRequestId("catch"),
    expectedActionVersion: action.version
  });
  state.fishingAction = null;
  const at = fishingAt;
  fishingAt = null;
  fishingAnchor = null;
  showRewardPop(result.catch.itemDefinitionId, result.catch.quantity, at);
  // The catch and the experience come back with the account refresh, which is also what redraws the
  // inventory card; the award is used for the message only.
  await refreshAccount();
  render();
  setStatus((translate) => {
    const base = translate("fishing.caught", {
      quantity: result.catch.quantity,
      item: itemLabel(result.catch.itemDefinitionId),
      xp: result.progression.xpAwarded
    });
    return result.progression.leveledUp
      ? `${base}${translate("status.levelUp", { level: result.progression.progression.level })}`
      : base;
  });
}

/**
 * Gives the attempt up. No fish, no experience: the server refuses to settle a cancelled action.
 *
 * Best-effort on purpose - if the cancel request fails, the attempt simply stays live until it is
 * settled or it is cancelled on the next walk - and never surfaces as an error, because walking away
 * is not a mistake.
 */
async function cancelFishing(): Promise<void> {
  const action = state.fishingAction;
  if (action === null) return;
  clearFishingTimer();
  state.fishingAction = null;
  fishingAnchor = null;
  fishingAt = null;
  try {
    await api().cancelFishing(action.actionId, {
      requestId: newRequestId("cancel-fish"),
      expectedActionVersion: action.version
    });
  } catch {
    // The attempt is already gone from this page; the server will refuse a late settle either way.
  }
  setStatus(message("fishing.cancelled"));
}

/**
 * The water and species, plus whichever attempt was already live.
 *
 * Read once at load, never polled: the catalogue is static game data and the active attempt is one
 * targeted row. A refresh therefore resumes a cast instead of losing it, and costs two requests.
 */
async function refreshFishing(): Promise<void> {
  const client = api();
  const [catalogue, active] = await Promise.all([client.getFishing(), client.getActiveFishing()]);
  state.fishingSpots = catalogue.spots;
  state.fish = catalogue.fish;
  state.fishingAction = active.action;
  if (active.action !== null) {
    setStatus((translate) => translate("fishing.cast", { seconds: active.action?.secondsUntilReady ?? 0 }));
    scheduleFishingSettle();
  }
}

/*
 * Resource nodes: wealth out of the ground.
 *
 * One command starts a gather, the server answers with the instant it finishes, and the page waits
 * locally and settles once. The node's *availability* is the server's: a depleted deposit is drawn as
 * rubble and refused by the start route, and it comes back by the server's clock alone - no polling,
 * no cron. Walking away cancels, and a cancelled gather leaves the node untouched.
 */

let gatherTimer: number | null = null;
let gatherAnchor: { readonly worldX: number; readonly worldZ: number } | null = null;
let gatherAt: { readonly x: number; readonly y: number } | null = null;
let gatherSettlementActionId: string | null = null;
let gatherSettlementRequestId: string | null = null;
let gatherSettlementPending = false;
let gatherCancelPending = false;

function currentResourceAction(): ResourceActionDTO | null {
  return state.resourceAction;
}

/** How far the player may drift before the gather is given up, in world metres. */
const GATHER_CANCEL_RADIUS_WORLD = 2.5;

function clearGatherTimer(): void {
  if (gatherTimer === null) return;
  window.clearTimeout(gatherTimer);
  gatherTimer = null;
}

async function gatherResource(
  nodeId: string,
  verb: "MINE" | "CHOP",
  target: { readonly tileX: number; readonly tileY: number }
): Promise<void> {
  const node = state.resourceNodes.find((candidate) => candidate.nodeId === nodeId);
  if (node?.definitionId === "resource_ore") {
    setActivePanel({ active: "workers" });
    setStatus(message("mining.autoNote"));
    return;
  }
  if (!requireEconomicState()) return;
  if (state.resourceAction !== null) {
    setStatus(message("mining.alreadyGathering"), true);
    return;
  }
  let result: Awaited<ReturnType<ReturnType<typeof api>["startResourceAction"]>>;
  try {
    result = await api().startResourceAction({ requestId: newRequestId("gather"), nodeId });
  } catch (error: unknown) {
    // A lost start response must reconcile the server's active row before the player can try again.
    // This avoids sending a fresh start blindly and keeps the server's idempotent action as the one
    // source of truth without adding a polling loop.
    try {
      await refreshResources();
    } catch {
      // Preserve the original start error when the reconciliation read is unavailable too.
    }
    const recoveredAction = currentResourceAction();
    if (recoveredAction?.status === "ACTIVE") {
      setStatus((translate) => translate(recoveredAction.verb === "CHOP" ? "mining.chop" : "mining.mine", {
        seconds: recoveredAction.secondsUntilReady
      }));
      return;
    }
    throw error;
  }
  state.resourceAction = result.action;
  gatherSettlementActionId = null;
  gatherSettlementRequestId = null;
  gatherAt = { x: target.tileX, y: target.tileY };
  gatherAnchor = characterPose === null ? null : { worldX: characterPose.worldX, worldZ: characterPose.worldZ };
  // The swing: the shared short gesture, because this phase is foundation rather than animation.
  scene?.playHarvestGesture();
  setStatus((translate) =>
    verb === "CHOP"
      ? translate("mining.chop", { seconds: result.action.secondsUntilReady })
      : translate("mining.mine", { seconds: result.action.secondsUntilReady })
  );
  scheduleGatherSettle();
}

function scheduleGatherSettle(): void {
  clearGatherTimer();
  const action = state.resourceAction;
  if (action === null) return;
  const waitMs = Math.max(0, Date.parse(action.readyAt) - Date.now());
  gatherTimer = window.setTimeout(() => {
    void settleGathering();
  }, waitMs + 250);
}

async function settleGathering(): Promise<void> {
  const action = state.resourceAction;
  if (action === null) return;
  if (gatherSettlementPending) return;
  if (!economicStateReady()) {
    gatherTimer = null;
    return;
  }
  if (Date.parse(action.readyAt) > Date.now()) {
    scheduleGatherSettle();
    return;
  }
  clearGatherTimer();
  gatherSettlementPending = true;
  if (gatherSettlementActionId !== action.actionId || gatherSettlementRequestId === null) {
    gatherSettlementActionId = action.actionId;
    gatherSettlementRequestId = newRequestId("gather-settle");
  }
  const chopped = action.verb === "CHOP";
  try {
    const result = await api().settleResourceAction(action.actionId, {
      requestId: gatherSettlementRequestId,
      expectedActionVersion: action.version
    });
    state.resourceAction = null;
    gatherSettlementActionId = null;
    gatherSettlementRequestId = null;
    const at = gatherAt;
    gatherAt = null;
    gatherAnchor = null;
    showRewardPop(result.drop.itemDefinitionId, result.drop.quantity, at);
    // The material and the experience come back with the account read; the node's new availability comes
    // from the node read. Both are semantic-event reads, never polled.
    await Promise.all([refreshResources(), refreshAccount()]);
    rebuildInteractionIndex();
    refreshInteractionCandidate();
    render();
    setStatus((translate) => {
      const base = translate(chopped ? "mining.chopped" : "mining.mined", {
        quantity: result.drop.quantity,
        item: itemLabel(result.drop.itemDefinitionId),
        xp: result.progression.xpAwarded
      });
      return result.progression.leveledUp
        ? `${base}${translate("status.levelUp", { level: result.progression.progression.level })}`
        : base;
    });
  } catch (error: unknown) {
    // Keep the active action visible so Warehouse-full, a transient network failure, or clock skew
    // can be retried with the same request id. A retry after a processed response is therefore a
    // replay, never a second inventory grant.
    if (state.resourceAction?.actionId === action.actionId) {
      setStatus(describe(error), true);
      if (error instanceof ApiError && error.code === "RESOURCE_NOT_READY") scheduleGatherSettle();
      renderResourcePanel();
    }
  } finally {
    gatherSettlementPending = false;
    renderResourcePanel();
  }
}

async function cancelGathering(): Promise<void> {
  const action = state.resourceAction;
  if (action === null || gatherCancelPending) return;
  clearGatherTimer();
  gatherCancelPending = true;
  try {
    await api().cancelResourceAction(action.actionId, {
      requestId: newRequestId("gather-cancel"),
      expectedActionVersion: action.version
    });
    if (state.resourceAction?.actionId === action.actionId) state.resourceAction = null;
    gatherSettlementActionId = null;
    gatherSettlementRequestId = null;
    gatherAnchor = null;
    gatherAt = null;
    setStatus(message("mining.cancelled"));
  } catch {
    // Reconcile a lost cancel response. If the server kept the action, it remains recoverable and
    // can settle; if it cancelled, the read clears it without inventing a local result.
    try {
      await refreshResources();
    } catch {
      setStatus(message("mining.alreadyGathering"), true);
    }
  } finally {
    gatherCancelPending = false;
  }
}

/**
 * The island's nodes and whichever gather was already live.
 *
 * Two bounded reads: the static placements plus the actor's zone's state rows, and one indexed lookup
 * for the active action. Read at load and after a gather; never polled.
 */
async function refreshResources(): Promise<void> {
  const client = api();
  const [nodes, active] = await Promise.all([client.getResourceNodes(), client.getActiveResourceAction()]);
  state.resourceNodes = nodes.nodes;
  state.resourceAction = active.action;
  if (selectedResourceNodeId !== null && !state.resourceNodes.some((node) => node.nodeId === selectedResourceNodeId)) {
    clearResourceNodeSelection();
  }
  renderResourcePanel();
  if (active.action !== null) {
    setStatus((translate) =>
      active.action?.verb === "CHOP"
        ? translate("mining.chop", { seconds: active.action.secondsUntilReady })
        : translate("mining.mine", { seconds: active.action?.secondsUntilReady ?? 0 })
    );
    scheduleGatherSettle();
  }
}

/**
 * Removes the selected tree after an explicit confirmation.
 *
 * The confirmation is the page's, not the server's: removing a tree destroys the sapling, so the
 * player is asked first. The command itself still goes through the server, which decides on its own
 * authority whether the tree exists, belongs to this farm, and is at the version last seen.
 */
async function removeSelectedTree(): Promise<void> {
  if (!requireEconomicState()) return;
  const selection = currentSelection();
  if (state.farmId === null) {
    setStatus(message("status.loadFarm"), true);
    return;
  }
  if (selection.tree === null) {
    setStatus(message("status.selectReadyTree"), true);
    return;
  }
  const depleted = selection.tree.phase === "DEPLETED";
  if (!window.confirm(t(depleted ? "dock.clearStump.confirm" : "dock.removeTree.confirm"))) return;
  const coordinate = selection.coordinate;
  await api().removeTree(state.farmId, selection.tree.treeInstanceId, {
    requestId: newRequestId("remove-tree"),
    expectedTreeVersion: selection.tree.version
  });
  await refreshFarm(farmRefreshScopeFor("REMOVE_TREE"));
  await refreshAccount();
  setStatus((translate) =>
    translate(depleted ? "status.clearedStump" : "status.removedTree", { x: coordinate?.x ?? 0, y: coordinate?.y ?? 0 })
  );
}

async function trade(direction: "buy" | "sell", shopEntryId: string, quantity: number): Promise<void> {
  if (!requireEconomicState()) return;
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
  element<HTMLButtonElement>("harvest-area").addEventListener("click", () => {
    if (areaHarvestSelection.pending) minimizeAreaHarvest();
    else if (areaHarvestSelection.active) cancelAreaHarvest();
    else startAreaHarvest();
  });
  element<HTMLButtonElement>("harvest-area-global").addEventListener("click", () => {
    if (areaHarvestSelection.pending) restoreAreaHarvest();
    else if (areaHarvestSelection.active) cancelAreaHarvest();
    else startAreaHarvest();
  });
  element<HTMLButtonElement>("area-harvest-progress-dock").addEventListener("click", restoreAreaHarvest);
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
      accountReady = true;
      reconciliationPending = false;
      bootPerfMark("warehouse_ready");
      scheduleFishingSettle();
      scheduleGatherSettle();
      rebuildInteractionIndex();
      refreshInteractionCandidate();
      refreshScene();
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
  element<HTMLButtonElement>("warehouse-upgrade").addEventListener("click", () => {
    void run(upgradeWarehouse);
  });
  element<HTMLButtonElement>("return-popup-close").addEventListener("click", () => { element<HTMLElement>("return-popup").hidden = true; });
  element<HTMLButtonElement>("go").addEventListener("click", () => {
    const selected = state.selected;
    if (selected === null) return;
    if (autoIsDriving()) requestTakeoverFromInput("GO_BUTTON");
    playerRuntime.setDestination(tileToWorld({ x: selected.x, y: selected.y }, worldFrame()));
    setStatus(message("status.going", { at: at(selected) }));
  });
  for (const module of MODULES) {
    const launcher = element<HTMLButtonElement>(module.launcherId);
    launcher.addEventListener("click", () => {
      setActivePanel(togglePanel(panels, module.id));
    });
    element<HTMLButtonElement>(module.closeId).addEventListener("click", () => {
      if (module.id === "workAreas") cancelWorkAreaEditor();
      setActivePanel(closePanel(panels));
      launcher.focus();
    });
  }
  element<HTMLButtonElement>("work-area-create").addEventListener("click", () => {
    setWorkAreaEditor("CREATE");
  });
  element<HTMLButtonElement>("workers-assign").addEventListener("click", () => {
    autoEditorDiagnostic("ADD_ASSIGNMENT_CLICKED");
    const sources = jobTargetSources();
    workersDraftKind = WORK_AREA_KINDS.find((kind) => kindIsAssignable(kind, sources)) ?? null;
    workersView = "ASSIGNMENT_EDITOR";
    autoEditorDiagnostic("EDITOR_OPEN_REQUESTED", `kind=${workersDraftKind ?? "NONE"}`);
    if (workersDraftKind === null) {
      setStatus(message("workers.noTargets"), true);
      workersError = new Error("No compatible work skill definitions are available");
      workersRenderSignature = "";
      renderWorkers();
      return;
    }
    workersDraftTarget = "";
    workersDraftAreaId = "";
    workersDraftPolicy = false;
    workersRenderSignature = "";
    renderWorkers();
    autoEditorDiagnostic("EDITOR_STATE_AFTER_OPEN", `view=${workersView}`);
  });
  element<HTMLButtonElement>("workers-auto-toggle").addEventListener("click", () => {
    void toggleAuto();
  });
  element<HTMLButtonElement>("workers-reorder").addEventListener("click", () => {
    toggleReorderMode();
  });
  element<HTMLButtonElement>("workers-cargo-unload").addEventListener("click", () => {
    void unloadCargoAtWarehouse();
  });
  for (const direction of ["buy", "sell"] as const) {
    element<HTMLButtonElement>(direction === "buy" ? "market-tab-buy" : "market-tab-sell").addEventListener(
      "click",
      () => {
        shopDirection = direction;
        renderMarketTabs();
        marketSelection = null;
        marketQuantity = 1;
        marketGridSignature = "";
        marketTradeSignature = "";
        renderMarket();
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
    if (areaHarvestSelection.active && !areaHarvestSelection.pending) {
      cancelAreaHarvest();
      return;
    }
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
   * load - used to let ticks stack: another pair of requests, another state push, another whole-page
   * re-render, all overlapping the tick before. That is a self-sustaining load
   * spiral, so a tick that arrives while the previous one is still running is dropped. The gap is
   * small next to how slowly crops grow, and the lost poll is indistinguishable from a slow response.
   */
  let farmRefreshInFlight = false;

  /**
   * One growth refresh, if the gate allows it.
   *
   * A hidden tab reads nothing: a phone in a pocket, a background tab, or a second window left open
   * overnight must not keep reading the database. Coming back to the foreground refreshes at once
   * rather than waiting out the interval.
   */
  function refreshGrowthOnce(): void {
    if (
      !shouldRefreshGrowth({
        farmLoaded: state.farmId !== null,
        visible: document.visibilityState === "visible",
        inFlight: farmRefreshInFlight
      })
    ) {
      return;
    }
    farmRefreshInFlight = true;
    void (async () => {
      try {
        await refreshGrowth();
        render();
      } catch {
        // Growth polling is best-effort; explicit actions surface their own errors.
      } finally {
        farmRefreshInFlight = false;
        // A failed read left the due instant in the past: back off rather than retrying every second.
        if (growthRefreshDueAt <= Date.now()) growthRefreshDueAt = Date.now() + GROWTH_REFRESH_MIN_MS;
      }
    })();
  }

  // A one-second local check of the due instant: it costs no request. The read itself happens only
  // when a crop or tree is due (see `nextGrowthRefreshDelayMs`), not on a fixed cadence.
  window.setInterval(() => {
    if (Date.now() >= growthRefreshDueAt) refreshGrowthOnce();
  }, 1_000);
  let hiddenSince: number | null = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      const awayMs = hiddenSince === null ? 0 : Date.now() - hiddenSince;
      hiddenSince = null;
      refreshGrowthOnce();
      // A real absence (not a glance at another window) is what the server reconciles; the read that
      // follows shows what actually happened while the tab was hidden.
      if (awayMs >= 60_000) {
        const previousActiveAt = Number(localStorage.getItem("happyfarm.lastVisibleAt"));
        localStorage.setItem("happyfarm.lastVisibleAt", String(Date.now()));
        reconciliationPending = true;
        void (async () => {
          try {
            const productionChanged = await reconcileProductionOnce();
            const autoChanged = await reconcileAutoOnce();
            if (autoChanged || productionChanged) await refreshFarm();
            if (lastProductionReconcileSucceeded || autoChanged) {
              await refreshAccount();
              accountReady = true;
              bootPerfMark("warehouse_ready");
              scheduleFishingSettle();
              scheduleGatherSettle();
              rebuildInteractionIndex();
              refreshInteractionCandidate();
              refreshScene();
              render();
            }
            if (
              lastProductionReconcileSucceeded &&
              Number.isFinite(previousActiveAt) &&
              previousActiveAt > 0
            ) {
              showReturnPopupOnce(Math.max(0, Date.now() - previousActiveAt), lastProductionItems);
            }
            if (!lastProductionReconcileSucceeded) setStatus(message("status.syncFailed"), true);
          } catch {
            setStatus(message("status.syncFailed"), true);
          } finally {
            reconciliationPending = false;
            render();
          }
        })();
      } else {
        // Returning to the tab is the bounded wake Auto has been waiting for: a hidden tab runs no
        // timers, so a running actor resumes from the world as it is rather than from a stale plan.
        kickAutoStep();
      }
    } else {
      hiddenSince = Date.now();
      returnPopupShown = false;
    }
  });
}

document.documentElement.lang = languageTag(state.language);
wire();
decorateGameUi();
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
  const sessionResolved = await startSession();
  if (sessionResolved) bootPerfMark("session_resolved");
  if (!sessionResolved) {
    bootFailed = true;
    setStatus(message("boot.sessionFailed"), true);
    renderBootRetry();
    return;
  }
  const storedFarm = localStorage.getItem(FARM_KEY);
  if (storedFarm !== null) {
    try {
      const context = await loadFarm(storedFarm);
      bootPerfMark("farm_loaded");
      enable3D();
      setStatus(message("status.loaded"));
      startInitialEconomicBootstrap(context);
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
  const context = await createFarm();
  bootPerfMark("farm_loaded");
  enable3D();
  setStatus(message("status.created"));
  startInitialEconomicBootstrap(context);
}

void run(boot);
