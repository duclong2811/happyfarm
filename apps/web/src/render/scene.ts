import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  Box3,
  BufferAttribute,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  Fog,
  Group,
  LineBasicMaterial,
  LineSegments,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  Scene,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  BufferGeometry,
  type Material,
  type Object3D
} from "three";
import { cropModelId, type CropModelId } from "./assets";
import {
  createOrbitCamera,
  pointerRoleForButton,
  rotationForDrag,
  zoomDistanceRangeFor,
  CAMERA_FOV_DEGREES,
  DEFAULT_CAMERA_DISTANCE,
  DEFAULT_CAMERA_PITCH,
  DEFAULT_CAMERA_YAW,
  MAX_DISTANCE,
  MIN_DISTANCE
} from "./camera";
import { GENERATED_MODEL_URLS, type GeneratedModelId } from "./generated-model-urls";
import { layoutFarmTiles, type TileCoordinate } from "./layout";
import { createSharedAssets, tileColorFor, type SharedAssets } from "./materials";
import { createPointerGesture } from "./pointer-gesture";
import { buildInstancedObjects, buildScenery } from "./scenery";
import { buildLandmarkNode } from "./landmarks";
import { buildInteractionGrid, plantingHintCells } from "./interaction-grid";
import { worldToCell } from "./world-cell";
import { bootPerfInteractionTrace, bootPerfInteractionTraceId } from "../boot-performance";
import {
  planCellOverlay,
  buildCellOutlines,
  buildDebugGrid,
  buildSelectionQuad
} from "./world-cell-overlay";
import {
  CONSTRUCTION_ID_KEY,
  RESOURCE_NODE_ID_KEY,
  constructionIdFromHits,
  constructionIdFromWorldPoint,
  prioritizeWorldPick,
  tapTargetFor,
  worldTargetIdFromNode
} from "./object-picking";
import { CELL_OVERLAY_LIFT_WORLD } from "./world-cell-overlay";
import { CELL_OVERLAY_TILE_LIFT_WORLD } from "./world-cell-overlay";
import { SEA_SURFACE_Y } from "./world-cell-overlay";
import { cellKey } from "./world-cell";
import { worldFrame } from "./layout";
import { buildLockedPlotOverlay, buildTerrain, TILE_SURFACE_Y, TILE_THICKNESS } from "./terrain";
import { GROUND_SURFACE_Y, islandRimPoint, terrainHeightAt } from "./terrain-height";
import {
  resourceClusterPieces,
  resourceNodePickRadius
} from "./resource-cluster";
import { NEIGHBOR_PREVIEW_WATER_SCALE, neighborForestLayout, neighborGroundHeight, neighborIslandTemplate, neighborWorldPoint, type NeighborIslandKind } from "./neighbor-island-template";
import { MOC_PREVIEW_LAYOUT, mocPresentationDockWorld, mocPreviewForestPlacements, mocPreviewPlacement } from "../moc-island-preview-data";
import { tileDrawsSoil, type FarmSceneInput, type SceneTile, type SceneTree } from "./view-model";
import { buildFarmWorld } from "./world";
import { EMPTY_WORLD_CELL_MAP } from "./world-cell";
import { ISLAND_HALF_WIDTH_WORLD, ISLAND_SHAPE, LANDMARKS_WORLD, STATIC_OBSTACLES, WOODLANDS, WORLD_CENTER_WORLD } from "./world-config";
import {
  CAMERA_TRANSITION_SECONDS,
  cameraModeToggleRequested,
  createCameraTransition,
  type CameraMode,
  type CameraPose,
  type CameraTransition
} from "./camera-mode";
import {
  INITIAL_ESTATE_FOLLOW,
  estateFollowAfterFocus,
  estateFollowAfterManualInput,
  estateFollowForMovement,
  estateFollowRecenter,
  estateFollowsPlayer,
  type EstateFollowBehaviour,
  type EstateFollowState
} from "./estate-follow";
import {
  CHARACTER_FOV_DEGREES,
  DEFAULT_CHARACTER_DISTANCE,
  DEFAULT_CHARACTER_PITCH,
  ESTATE_FOV_DEGREES,
  characterTarget,
  createCharacterCameraRig
} from "./character-camera";
import { renderQualityPreset, type RenderQualityName } from "./render-quality";
import { sharedModelLibrary } from "./model-library";
import { isTypingTarget } from "../player/input";
import { createPlayerCharacterView } from "./player-character";
import { HARVEST_GESTURE_DURATION_MS, harvestGestureBend } from "../interaction/feedback";
import { ROAD_PREVIEW_STYLES } from "./thumbnail";
import { buildRoadSpec, ROAD_LIFT_WORLD } from "./roads";
import { ROAD_SEGMENT_CELLS } from "@happy-farm/game-data";
import { ribbonSurface } from "./road-surface";
import { tileToWorld } from "./layout";
import type { PreviewGround } from "./placement-preview";
import { resourceNodeLayerSignature } from "./resource-layer";

/**
 * Three.js view of the farm.
 *
 * This module owns rendering mechanics only: camera, lights, input, the static world group, one slab
 * per unlocked tile, one mesh per planted crop, markers for selection, hover, and ripe crops, the
 * model cache, sizing, and disposal. It never fetches and never decides anything about the game: it
 * draws descriptors that `view-model.ts` and `world.ts` derived from server state, so "what is
 * planted", "how grown it is", and "which land is locked" are decided by the server, not here.
 *
 * Rendering is still on demand: a frame is drawn when state changes, on resize, and when a model
 * arrives. Camera input redraws on its own events.
 */

/** Legacy margin kept for callers that framed the old flat ground plane. */
export const GROUND_MARGIN = 1.5;
export { TILE_SURFACE_Y, TILE_THICKNESS };
/** Height of a fully grown placeholder crop, in world units. */
export const CROP_MAX_HEIGHT = 0.95;
/** A just-planted crop still has to be visible, so growth never scales below this. */
export const MIN_CROP_HEIGHT = 0.14;

/** Near and far planes. The near plane is far enough out to keep the depth buffer quiet at zoom. */
const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 1400;
/** Radius of the sky dome. Inside the far plane, and far outside the island. */
const SKY_RADIUS = 600;
const MIN_FRAMED_EXTENT = 7;
const CROP_RADIUS_FACTOR = 0.32;
/** The horizon colour: the sky's bottom band, the fog, and the shallows all agree with it. */
const HORIZON_COLOR = 0xcfe9f7;
const SKY_ZENITH_COLOR = 0x69b4e8;
/** Where the sun stands relative to whatever the camera is framing, and how tall. */
const SUN_OFFSET = new Vector3(28, 46, 20);
/** Half-width of the sun's shadow box, in world metres: the island plus its beach. */
const SHADOW_EXTENT_WORLD = 30;
/** Warm tint applied to a loaded model once the server calls the crop mature. Placeholder art. */
const READY_EMISSIVE_COLOR = 0x4a3410;
/**
 * Height of the placeholder avatar, in world units.
 *
 * Deliberately taller than one tile (pitch 1.08) so the character reads as a character at the
 * follow distance rather than as another prop. Art replaces the look, not the scale contract.
 */
const PLAYER_HEIGHT = 1.6;
/** The same height, named for what the camera reads it for: where the shoulder is. */
const PLAYER_HEIGHT_WORLD = PLAYER_HEIGHT;
/**
 * How far the camera stands when placement mode frames a cell.
 *
 * Close enough that a one-cell tree, fence or lantern is an object rather than a speck, and far enough
 * that the ground around it - and whether the footprint fits - is still in the picture.
 */
const PLACEMENT_CAMERA_DISTANCE = 13;
/**
 * What the build shop is about to place, as the renderer needs to hear it.
 *
 * The host page decides what is being previewed and whether it is allowed there - it has the
 * catalogue, the player's level and the WorldCell map. The renderer is handed the answer and draws it:
 * a footprint on the ground, tinted by validity, and a ghost of the model above it.
 */
/**
 * One persisted construction, as the renderer needs it: which model, where, and which way round.
 *
 * Deliberately not the whole DTO: the scene draws what it is given and knows nothing about prices,
 * levels or collisions. The host page resolves the entry to a model id through the catalogue.
 */
export interface SceneConstruction {
  readonly id: string;
  readonly modelId: string | null;
  /**
   * The landmark builder this object draws, when it has no model of its own.
   *
   * The village and the quay are still assembled from primitives rather than a `.glb`, and they are
   * world objects like everything else now: the definition says which builder draws it, exactly as
   * `modelId` says which file does.
   */
  readonly landmarkKind: string | null;
  /** How large the model is drawn, in metres: every imported model is normalized to one unit. */
  readonly sizeWorld: number;
  readonly worldX: number;
  readonly worldZ: number;
  readonly rotationY: number;
  /** The ground it covers, in cells: what the editing mark is scaled to. */
  readonly widthCells: number;
  readonly depthCells: number;
}

/**
 * One resource node, as the renderer needs it: which model, where, and whether it is ready.
 *
 * A depleted node is not removed - it shrinks to a stub of rubble - so the place a player mined is
 * still legible when they come back for it. The shrink is the *server's* state drawn, never a client
 * decision: `available` comes from the node catalogue the server sent.
 */
export interface SceneResourceNode {
  readonly id: string;
  readonly definitionId: string;
  readonly modelId: string;
  /**
   * What a depleted node draws instead, when the definition has a better answer than shrinking.
   * A wild tree names its stump here; a rock leaves it null and the renderer shrinks the deposit.
   */
  readonly depletedModelId: string | null;
  readonly worldX: number;
  readonly worldZ: number;
  readonly available: boolean;
}

/** Read-only presentation proof used by the HUD's resource locator. */
export type ResourceNodePresentationResult =
  | {
      readonly status: "READY";
      readonly modelId: string;
      readonly worldX: number;
      readonly worldY: number;
      readonly worldZ: number;
    }
  | {
      readonly status: "NODE_MISSING" | "ASSET_UNAVAILABLE" | "MESH_MISSING" | "HIDDEN";
      readonly modelId: string | null;
    };

/** A fishing spot's authoritative place, used only to resolve a direct water tap. */
export interface SceneFishingSpot {
  readonly id: string;
  readonly worldX: number;
  readonly worldZ: number;
  readonly pickRadiusWorld: number;
}

export type SceneWorldTarget =
  | { readonly kind: "RESOURCE_NODE"; readonly id: string }
  | { readonly kind: "FISHING_SPOT"; readonly id: string }
  | { readonly kind: "NEIGHBOR_DOCK"; readonly id: string }
  | { readonly kind: "NEIGHBOR_NPC"; readonly id: string };

export interface SceneNeighborIsland {
  readonly islandId: string;
  readonly center: { readonly x: number; readonly z: number };
  readonly dock: { readonly x: number; readonly z: number };
  readonly npc: { readonly x: number; readonly z: number };
  readonly slot?: NeighborIslandKind;
  readonly seed?: number;
  readonly npcJobKey?: string;
  readonly npcStartedAt?: string;
  readonly npcNextActionAt?: string;
  readonly npcCycle?: number;
  /** Legacy authoritative construction phase used to decide whether a completed building is visible. */
  readonly npcConstructionPhase?: string;
}

/** HOME-only low-detail preview: presentation only, never a walkable or selectable island. */
export interface SceneNeighborIslandPreview {
  readonly islandId: string;
  readonly center: { readonly x: number; readonly z: number };
  /** HOME uses the authored home-island outline; neighbours use their persisted template slot. */
  readonly slot: NeighborIslandKind | "HOME";
  readonly seed?: number;
}

/** A distant HOME-only marker. It has no pick target, actor, or collision contribution. */

export interface PlacementPreview {
  /** The GLB to ghost, or null for a road - which is drawn as a segment of its own surface instead. */
  readonly modelId: string | null;
  /** The road tier to preview, or null for a model. */
  readonly roadTierId: string | null;
  readonly widthCells: number;
  readonly depthCells: number;
  /** Whether the cell the player has selected may hold this. Drives the footprint's colour only. */
  readonly valid: boolean;
  /** Terrain classes accepted by the authoritative placement rule, used only for visual guidance. */
  readonly allowedTerrain: readonly PreviewGround[];
  /** Which way the thing faces, in radians about Y. */
  readonly rotationY: number;
}

/**
 * Where the estate camera should look when the host switches to it.
 *
 * The plain switch (`Estate` on the HUD, or the F key) passes no focus: the estate view returns to
 * whatever the player left, which is the "two ways to look at one island" rule. A *precision* action
 * passes one, because a player who asked to plant something should be looking at the thing they
 * asked to plant - not at a corner of the map they were inspecting ten minutes ago.
 */
export type EstateCameraFocus =
  | { readonly kind: "PLAYER" }
  | { readonly kind: "CELL"; readonly cell: TileCoordinate };

/** Thrown when the browser cannot give the page a WebGL context. */
export class FarmRendererUnavailableError extends Error {
  constructor(cause: unknown) {
    super("WebGL is not available in this browser session");
    this.name = "FarmRendererUnavailableError";
    this.cause = cause;
  }
}

/**
 * Everything the work-area editor draws, as one value.
 *
 * A `null` state means "not editing": no lattice, no marks, nothing left on the island. Every list is
 * a cell list because the durable model is cells - the rectangle never reaches this layer.
 */
export interface WorkAreaEditState {
  /** Cells already in the draft: the committed membership plus anything picked this session. */
  readonly draft: readonly TileCoordinate[];
  /** The rectangle between the armed corner and the pointer, as cells that would be added. */
  readonly preview: readonly TileCoordinate[];
  /** Cells inside the preview's rectangle that this kind of area cannot be worked on. */
  readonly invalid: readonly TileCoordinate[];
  /** The cell under the pointer, or null. */
  readonly hover: TileCoordinate | null;
  /** The first corner already taken, or null when the editor is waiting for one. */
  readonly corner: TileCoordinate | null;
}

/** The two-corner estate-harvest selection, kept separate from work-area editing. */
export interface AreaHarvestEditState {
  readonly first: TileCoordinate | null;
  readonly second: TileCoordinate | null;
  readonly cells: readonly TileCoordinate[];
  /** Optional refused cells, drawn over the preview so area tools can distinguish skips. */
  readonly invalid?: readonly TileCoordinate[];
  /** Valid cells beyond the current seed/sapling budget, drawn separately from invalid terrain. */
  readonly shortage?: readonly TileCoordinate[];
  /** Harvest cells that exist but are not ready yet. */
  readonly waiting?: readonly TileCoordinate[];
  /** Cell under the pointer/touch, used for the compact reason hint. */
  readonly focus?: TileCoordinate | null;
}

export interface FarmSceneOptions {
  /**
   * How expensive the view is allowed to be. Presentation only - see `render-quality.ts`.
   *
   * A development switch, not a player setting: the host page resolves it (from `?quality=low`) and
   * hands it in, so nothing in the renderer reads a URL or a stored preference.
   */
  readonly quality?: RenderQualityName;
  /**
   * Where the camera looks when the first world arrives, if the host already knows.
   *
   * The scene's own opening frame is the island's middle at the default bearing and distance. A host
   * page that remembers a view - a returning session, a preferred angle, a screenshot of a named place
   * - can hand one in instead. Everything is clamped to what the island allows (pitch to the rig's own
   * limits, the target to the pan limit), so a bad value is a bad frame rather than a broken camera.
   */
  readonly initialCamera?: {
    readonly yaw?: number;
    readonly pitch?: number;
    readonly distance?: number;
    readonly targetX?: number;
    readonly targetZ?: number;
  };
  /**
   * Called with the island cell the player clicked. The renderer reports the coordinate only;
   * selecting it, walking to it, and what it means stay with the caller.
   */
  readonly onCellSelected?: (cell: TileCoordinate) => void;
  /**
   * Called with the island cell under the pointer, or null when it leaves the ground.
   *
   * Already coalesced to one call per frame and only when the cell *changes*, exactly like the
   * renderer's own hover marker. The host uses it for purely local feedback - the work-area editor's
   * hover and rectangle preview - so it must stay free of network or database work.
   */
  readonly onCellHovered?: (cell: TileCoordinate | null) => void;
  /**
   * Called when the player clicked one of their own built things, by that thing's id.
   *
   * Only fires while object picking is enabled (see `setObjectPicking`): while something is in hand
   * for placement or a move, a click belongs to the placement, not to the thing under the pointer.
   * The renderer reports the id and decides nothing - what may be done to an object is the server's
   * rule, and the panel that offers it is the caller's.
   */
  readonly onObjectSelected?: (constructionId: string, traceId?: string | null) => void;
  /** Called for a direct tap on a resource mesh or authoritative fishing-spot water region. */
  readonly onWorldTargetSelected?: (target: SceneWorldTarget) => void;
  /** Called with an exact open-ground hit while an active neighbour island is being visited. */
  readonly onGroundPositionSelected?: (position: { readonly worldX: number; readonly worldZ: number }) => void;
  /**
   * Called when the player pressed the camera-mode shortcut.
   *
   * The mode itself belongs to the host - it draws the switch and knows when a panel needs the
   * estate view - so the renderer reports the keystroke and decides nothing. It is only reported
   * while the player is not typing: a farm name is not a camera command.
   */
  readonly onCameraModeToggle?: () => void;
  /**
   * Asked before `E` becomes a camera orbit, because the host may want it for an interaction.
   *
   * `E` is the character camera's orbit-right key and the natural interaction key, so the two claims
   * are arbitrated by the host - which is the only thing that knows whether something is in reach. The
   * renderer asks first and consumes the keystroke when the answer is yes; the host's rule is pure and
   * lives in `apps/web/src/interaction/selection.ts`.
   */
  readonly onInteractionKeyRequested?: (event: {
    readonly key: string;
    readonly target: unknown;
    /** Whether the key is auto-repeating: a held `E` must not machine-gun the server. */
    readonly repeat: boolean;
  }) => boolean;
  /**
   * Called when the estate camera starts or stops following the player.
   *
   * The behaviour is the renderer's to decide - it is the one that sees the player move and the one
   * that knows whether the player has just taken the camera by hand - but it is the *host* that draws
   * the recenter control, so the host has to be told when it would do something. Reported only when
   * the behaviour actually changes.
   */
  readonly onEstateFollowChange?: (behaviour: EstateFollowBehaviour) => void;
  /**
   * Called when a crop model could not be loaded. The scene keeps drawing that crop's placeholder,
   * so this is a diagnosis for the caller to report, not a failure the caller has to recover from.
   */
  readonly onAssetProblem?: (assetId: string, error: unknown) => void;
  /** Development-only boot measurement: called after the first renderer frame completes. */
  readonly onFirstFrame?: () => void;
}

export interface FarmSceneHandle {
  readonly canvas: HTMLCanvasElement;
  /** Replaces the rendered farm state and redraws. Safe to call repeatedly. */
  setState(input: FarmSceneInput): void;
  /**
   * Draws the local character at this pose, or removes it with `null`. The pose is client-local and
   * never authoritative: the renderer copies the numbers it is given and decides nothing itself.
   */
  setPlayer(player: FarmScenePlayer | null): void;
  /**
   * Switches the camera between the estate and character viewpoints.
   *
   * One camera and two rigs: the estate orbit is left exactly as the player left it, the character
   * camera takes over behind the player, and the camera *flies* between them rather than cutting.
   * Nothing about the world, the objects or the character changes - which is the whole point of the
   * two modes being two ways to look at one island.
   */
  setCameraMode(mode: CameraMode, focus?: EstateCameraFocus): void;
  /** Which mode the camera is in. Read-only mirror of what the host last set. */
  cameraMode(): CameraMode;
  /**
   * Puts the estate camera back on the player and resumes following them.
   *
   * The recenter control. A glide, never a cut, and a no-op when the camera is already following: it
   * is the one control that must never make the view worse for being pressed.
   */
  recenterEstateCamera(): void;
  /** Whether the estate camera is currently following the player or has been moved by hand. */
  estateFollowBehaviour(): EstateFollowBehaviour;
  /** Marks the object the interaction prompt is offering, or clears the mark with null. */
  setInteractionTarget(cell: TileCoordinate | null): void;
  /**
   * The work-area editor's whole view: enables the subtle lattice, and draws the draft, the rectangle
   * preview, the cells that cannot be worked, the hovered cell and the first corner.
   *
   * One call for one state, because these are one picture and a caller should not be able to leave
   * half of it behind. `null` leaves edit mode: the lattice and every mark are removed. Rebuilt only
   * when the state actually changes, so a pointer resting on a cell costs nothing.
   */
  setWorkAreaEdit(state: WorkAreaEditState | null): void;
  /** Draws the two selected corners and local harvest rectangle without participating in picking. */
  setAreaHarvestEdit(state: AreaHarvestEditState | null): void;
  /** Plays the short harvest bow: a cosmetic beat, started when an interaction is accepted. */
  playHarvestGesture(): void;
  /** Where a cell's ground lands on the canvas, for HUD that belongs to a place. */
  projectCellToScreen(cell: TileCoordinate): {
    readonly x: number;
    readonly y: number;
    readonly visible: boolean;
  };
  /**
   * Where the third-person camera is looking, in the estate camera's own convention.
   *
   * The host needs this one number to make WASD camera-relative: forward is where the camera faces.
   * It is the character rig's bearing while in character mode and the estate rig's otherwise, so the
   * input rule and the camera can never disagree about which way is "away from the camera".
   */
  cameraBearing(): number;
  /**
   * Shows or hides the planting grid.
   *
   * `PLANT` draws a quiet outline over every tile the server reported plantable, and `NONE` removes
   * it. It is a presentation state: showing the grid names no tile, sends nothing, and changes no
   * rule - it is there so a player can see where a seed may go, which is the one thing the 3D view
   * could not say before this pass.
   */
  setInteraction(mode: FarmInteractionMode): void;
  /**
   * Draws the island's cell overlay for the selected cell, or nothing when the selection is null.
   *
   * Normal play shows *one* cell: the one the player pointed at, lifted onto the ground it lies on,
   * plus a faint hint of its neighbours. The island's whole grid is never drawn unless debug mode is
   * on, and even then it is this same call that draws it.
   */
  setSelection(cell: TileCoordinate | null): void;
  /**
   * What the player is about to place, drawn as a ghost on the selected cell.
   *
   * Null clears it. This is *preview only*: nothing here spends gold, persists anything, or tells the
   * server anything. It exists so the build shop can answer "what would this look like here, and may
   * it go here at all" before the authoritative placement command exists to accept a real one.
   */
  setPlacementPreview(preview: PlacementPreview | null): void;
  /**
   * Frames a cell for placement: the camera glides to it and comes closer, so a one-cell item reads as
   * an object rather than a speck while the player decides where it goes.
   *
   * A glide, never a cut, and only a request: the player's own drag and wheel still win, exactly as
   * they do over the recenter key.
   */
  focusOnCell(cell: TileCoordinate): void;
  /**
   * Draws the things the player has built.
   *
   * A separate call from `setState` on purpose: construction is the one layer whose *identity* comes
   * from the server's own rows rather than from the farm projection, and it changes on a different
   * cadence. The models come from the shared library, so a farm with forty fences downloads one fence.
   */
  setConstructions(constructions: readonly SceneConstruction[]): void;
  /**
   * Draws the island's resource nodes, available and depleted alike.
   *
   * A separate call from `setState` for the same reason constructions have one: node availability comes
   * from the server's own rows and changes on its own cadence (a gather settles, a regeneration
   * completes). A depleted deposit is drawn as a smaller rubble stub, so the place stays legible.
   */
  setResourceNodes(nodes: readonly SceneResourceNode[]): void;
  /** Ensures a server-reported node has loaded art and a visible pick root before the camera moves. */
  prepareResourceNode(nodeId: string): Promise<ResourceNodePresentationResult>;
  /** Supplies authoritative fishing places for direct water hit-testing. */
  setFishingSpots(spots: readonly SceneFishingSpot[]): void;
  /** Draws the server-identified neighbour island, or clears it when returning home. */
  setNeighborIsland(island: SceneNeighborIsland | null): void;
  /** Draws low-detail silhouettes on HOME without adding collision, actors, or pick targets. */
  setNeighborIslandPreviews(islands: readonly SceneNeighborIslandPreview[]): void;
  /** Moves the estate camera to a world-space place without inventing a cell coordinate. */
  focusWorld(worldX: number, worldZ: number, distance?: number, yaw?: number): void;
  /**
   * Whether a click on a built thing selects it.
   *
   * Off while the player is placing or moving something: in those modes a click means "put it here",
   * and a click that quietly selected the barn under the pointer instead would make placement feel
   * broken. The host owns the mode, so the host owns this switch.
   */
  setObjectPicking(enabled: boolean): void;
  /** Marks one built thing as the object the player is editing, or clears the mark with null. */
  setObjectSelection(constructionId: string | null): void;
  /**
   * Turns the developer overlay on or off: every cell, colour-coded by land use.
   *
   * Off by default, and there is no gameplay path that turns it on - it is a development tool, and
   * the brief for this pass is that the grid the engine thinks in is invisible to a player.
   */
  setDebugMode(on: boolean): void;
  /** Re-measures the canvas and redraws. */
  resize(): void;
  /**
   * The camera's own frame: which way it faces, how far away it is, and what it orbits.
   *
   * Read-only, and the scene still owns the camera: this hands out five numbers and takes none. It is
   * here so a host page (a screenshot harness, a future minimap, a "remember my view" setting) can ask
   * where the camera is rather than having to infer it from the picture, and so "the world refreshed
   * and the view did not move" is a comparison rather than a promise.
   */
  cameraFrame(): {
    readonly yaw: number;
    readonly pitch: number;
    readonly distance: number;
    readonly targetX: number;
    readonly targetZ: number;
  };
  /** Releases GPU resources, detaches observers and listeners, and leaves the canvas unusable. */
  dispose(): void;
}

/**
 * Where to draw the character and how it is moving.
 *
 * Deliberately its own small shape rather than the controller's state: the renderer only needs a
 * pose, so the player module stays free to change without dragging the view along.
 */
export interface FarmScenePlayer {
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  /** Radians about Y, where 0 faces world +Z. Matches the controller's `facingYaw`. */
  readonly facingYaw: number;
  readonly movementState: "IDLE" | "WALKING";
  /** Seconds spent walking, for the step bob. Never a gameplay quantity. */
  readonly elapsedWalk: number;
  /**
   * Whether the player is holding the run key.
   *
   * Presentation only, and optional because it is: the runtime has already applied the run speed by
   * the time a pose is published, so this only tells the character which clip to play. A view that
   * ignores it still draws the right position; a character with no run clip borrows the walk one.
   */
  readonly running?: boolean;
  /**
   * Whether the character is mid-gesture on a job.
   *
   * Presentation only, and deliberately separate from `movementState`: an Auto-driven character
   * planting or harvesting is standing still and doing something, which is neither "idle" nor
   * "walking". The view answers it with a small steady stoop, because no shipped model has a work clip
   * yet - and a gesture that cannot be drawn is better than a character that looks switched off.
   */
  readonly working?: boolean;
}

/** Whether the scene is showing the planting grid. Presentation only; the server owns the rules. */
export type FarmInteractionMode = "NONE" | "PLANT";

interface ModelVariants {
  readonly growing: Group;
  readonly ready: Group;
}

interface MeshLike extends Object3D {
  geometry: BufferGeometry;
  material: Material | Material[];
}

function isMeshLike(object: Object3D): object is MeshLike {
  return object instanceof Mesh;
}

/** Whether a model id is one of the generated pipeline's, whose arrival fills `generatedModels`. */
function isGeneratedModelId(modelId: string): modelId is GeneratedModelId {
  return modelId in GENERATED_MODEL_URLS;
}

function toReadyMaterial(material: Material, cache: Map<Material, Material>): Material {
  const cached = cache.get(material);
  if (cached !== undefined) return cached;
  const ready = material.clone();
  if (ready instanceof MeshStandardMaterial) ready.emissive.setHex(READY_EMISSIVE_COLOR);
  cache.set(material, ready);
  return ready;
}

function toReadyMaterials(material: Material | Material[], cache: Map<Material, Material>): Material | Material[] {
  return Array.isArray(material)
    ? material.map((entry) => toReadyMaterial(entry, cache))
    : toReadyMaterial(material, cache);
}

/**
 * The sky dome: one inside-out sphere with the gradient baked into its vertex colours.
 *
 * A flat background colour is what makes a 3D scene read as a viewport rather than as a place. This
 * costs one draw call and no texture, and it gives the fog something to dissolve into: the horizon
 * band of the dome is the same colour the fog is, so the island's far edge melts into the sky
 * instead of ending against a hard line.
 */
function createSkyDome(): Mesh {
  const geometry = new SphereGeometry(1, 24, 16);
  const position = geometry.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const horizon = new Color(HORIZON_COLOR);
  const zenith = new Color(SKY_ZENITH_COLOR);
  const colour = new Color();
  for (let index = 0; index < position.count; index += 1) {
    const height = Math.min(1, Math.max(0, position.getY(index) * 0.5 + 0.5));
    colour.copy(horizon).lerp(zenith, Math.pow(height, 0.85));
    colors[index * 3] = colour.r;
    colors[index * 3 + 1] = colour.g;
    colors[index * 3 + 2] = colour.b;
  }
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const material = new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false });
  const mesh = new Mesh(geometry, material);
  mesh.scale.setScalar(SKY_RADIUS);
  // Never culled: it always surrounds the camera, whatever direction it is looking.
  mesh.frustumCulled = false;
  mesh.renderOrder = -1;
  return mesh;
}

/**
 * Scale of the shared tree model, matching the normalization the scenery applies to the same file.
 *
 * One model serves every tree: the visual stage is a scale and a decoration, not another asset, so a
 * farm with many trees loads and caches exactly one tree model.
 */
/**
 * How tall a fully grown gameplay tree is drawn, in world metres.
 *
 * The player is 1.6 and the world's scenery is authored in metres, so a tree the player plants has to
 * stand above them the way the ones around it do. The curated model is normalized to one world unit\n * across its largest dimension, so the factor is the tree's height in metres.
 */
const TREE_MODEL_SCALE = 2.6 / 1.708;

/** Mộc's mature canopy envelope; the authored placement scale still supplies per-tree variation. */
const MOC_MATURE_TREE_HEIGHT = 3.8;

function mocTreeWorldScale(model: Object3D, placementScale: number): number {
  model.updateMatrixWorld(true);
  const rawHeight = new Box3().setFromObject(model).getSize(new Vector3()).y;
  return rawHeight > 0.001
    ? placementScale * Math.max(1, MOC_MATURE_TREE_HEIGHT / rawHeight)
    : placementScale;
}

/** How tall a resource deposit is drawn, in world metres: a lump of rock, not a mountain. */
const RESOURCE_NODE_MODEL_SCALE = 1.2;
/** What is left of a depleted deposit: the same model, shrunk to rubble so the place stays legible. */
const RESOURCE_NODE_DEPLETED_SCALE = 0.35;

/** Fruit positions on a ready tree, in the model's own units. Decoration, never a reward count. */
const FRUIT_OFFSETS: readonly (readonly [number, number, number])[] = [
  [0.2, 0.86, 0.12],
  [-0.18, 0.72, -0.1],
  [0.04, 1.0, -0.2]
];

/** How tall a tree of each visual stage is drawn, as a fraction of a full-grown one. */
function treeStageScale(tree: SceneTree): number {
  switch (tree.visualStage) {
    case "SAPLING":
      return 0.35;
    case "GROWING":
      return 0.55 + 0.35 * tree.growthProgress;
    case "REGROWING":
    case "READY":
      return 1;
    case "DEPLETED":
      return 1;
  }
}

/**
 * The fruit colour of a ready tree, by orchard species.
 *
 * Every planted tree shares one canopy model, so the fruit is what tells an apple from an orange at a
 * glance; the interaction prompt and the harvested item are the authoritative names. A species this
 * build has no colour for draws the neutral mature-crop fruit, exactly as an unknown crop falls back
 * to placeholder geometry.
 */
function treeFruitMaterial(assets: SharedAssets, definitionId: string): MeshStandardMaterial {
  switch (definitionId) {
    case "tree_apple":
      return assets.fruitApple;
    case "tree_orange":
      return assets.fruitOrange;
    case "tree_peach":
      return assets.fruitPeach;
    default:
      return assets.cropMature;
  }
}

/**
 * One tree on its tile.
 *
 * The model is cloned from the cache the scenery already fills; a build with no model, or one whose
 * file has not arrived yet, falls back to a trunk-and-canopy placeholder so the tile is never bare.
 * A ready tree gains fruit meshes, which are the visual signal and nothing more: the server decided
 * the reward before the page drew anything.
 */
function treePlant(
  tile: SceneTile,
  assets: SharedAssets,
  model: Object3D | undefined,
  tree: SceneTree
): Group {
  const plant = new Group();
  // A production tree stands on grass, so its base is the island's ground, not a soil pad.
  plant.position.set(tile.worldX, GROUND_SURFACE_Y, tile.worldZ);
  plant.rotation.y = (tree.rotation ?? 0) * (Math.PI / 2);
  plant.scale.setScalar(TREE_MODEL_SCALE * treeStageScale(tree));
  if (model === undefined) {
    const trunk = new Mesh(assets.cylinder, assets.wood);
    trunk.position.y = 0.3;
    trunk.scale.set(0.09, 0.6, 0.09);
    const canopy = new Mesh(assets.sphere, assets.foliage);
    canopy.position.y = 0.86;
    canopy.scale.set(0.5, 0.56, 0.5);
    plant.add(trunk, canopy);
  } else {
    plant.add(model.clone(true));
  }
  if (tree.visualStage === "READY") {
    const fruitMaterial = treeFruitMaterial(assets, tree.definitionId);
    for (const offset of FRUIT_OFFSETS) {
      const fruit = new Mesh(assets.octa, fruitMaterial);
      fruit.position.set(offset[0], offset[1], offset[2]);
      fruit.scale.setScalar(0.09);
      plant.add(fruit);
    }
  }
  plant.traverse((child) => {
    child.castShadow = true;
  });
  return plant;
}

/**
 * The placeholder avatar: a handful of shared primitives standing in for the real model.
 *
 * The group's local +Z is the direction the character faces, which is the same convention the
 * controller's `facingYaw` uses, so the renderer only has to copy one rotation. The visor and the
 * hat brim make that facing readable from the isometric camera; neither is a gameplay marker.
 */
function buildPlayerAvatar(assets: SharedAssets, farmer: Object3D | undefined): Group {
  const avatar = new Group();

  if (farmer !== undefined) {
    // The generated farmer is the avatar; cloning is enough because the model is one node tree with
    // no per-instance state. Collision, speed, feet height and camera behaviour stay in the player
    // modules and never read this mesh.
    avatar.add(farmer.clone(true));
    const modelMarker = new Mesh(assets.ring, assets.playerMarker);
    modelMarker.rotation.x = -Math.PI / 2;
    modelMarker.position.y = 0.01;
    modelMarker.scale.setScalar(PLAYER_HEIGHT * 0.34);
    avatar.add(modelMarker);
    avatar.traverse((child) => {
      if (child !== modelMarker) child.castShadow = true;
    });
    return avatar;
  }

  const legs = new Mesh(assets.box, assets.playerLegs);
  legs.scale.set(0.36, PLAYER_HEIGHT * 0.32, 0.3);
  legs.position.y = PLAYER_HEIGHT * 0.16;

  const body = new Mesh(assets.cylinder, assets.playerBody);
  body.scale.set(0.24, PLAYER_HEIGHT * 0.4, 0.24);
  body.position.y = PLAYER_HEIGHT * 0.52;

  const head = new Mesh(assets.sphere, assets.playerSkin);
  head.scale.setScalar(PLAYER_HEIGHT * 0.17);
  head.position.y = PLAYER_HEIGHT * 0.79;

  const brim = new Mesh(assets.cylinder, assets.playerHat);
  brim.scale.set(PLAYER_HEIGHT * 0.27, PLAYER_HEIGHT * 0.02, PLAYER_HEIGHT * 0.27);
  brim.position.y = PLAYER_HEIGHT * 0.85;

  const hat = new Mesh(assets.cone, assets.playerHat);
  hat.scale.set(PLAYER_HEIGHT * 0.16, PLAYER_HEIGHT * 0.14, PLAYER_HEIGHT * 0.16);
  hat.position.y = PLAYER_HEIGHT * 0.93;

  const visor = new Mesh(assets.box, assets.playerHat);
  visor.scale.set(PLAYER_HEIGHT * 0.22, PLAYER_HEIGHT * 0.03, PLAYER_HEIGHT * 0.06);
  visor.position.set(0, PLAYER_HEIGHT * 0.76, PLAYER_HEIGHT * 0.16);

  // A flat marker under the feet. It is what makes the avatar findable against a field of crops and
  // a brown path, and it is part of the same group, so it can never drift away from the character.
  const marker = new Mesh(assets.ring, assets.playerMarker);
  marker.rotation.x = -Math.PI / 2;
  marker.position.y = 0.01;
  marker.scale.setScalar(PLAYER_HEIGHT * 0.34);

  avatar.add(legs, body, head, brim, hat, visor, marker);
  // Everything but the ground marker casts; the marker is a decal-ish ring that would only darken
  // the ground under the feet twice.
  avatar.traverse((child) => {
    if (child !== marker) child.castShadow = true;
  });
  return avatar;
}

function neighborTerrainGeometry(
  template: ReturnType<typeof neighborIslandTemplate>,
  center: { readonly x: number; readonly z: number },
  scale: number,
  topBase: number,
  bottomY: number,
  reliefScale: number
): BufferGeometry {
  const sectors = 72;
  const rings = 12;
  const positions: number[] = [];
  const indices: number[] = [];
  const point = (angle: number, fraction: number): { x: number; z: number } => {
    const p = neighborWorldPoint(template, center, angle, fraction);
    return { x: center.x + (p.x - center.x) * scale, z: center.z + (p.z - center.z) * scale };
  };
  const height = (x: number, z: number): number => {
    const sourceX = (x - center.x) / Math.max(scale, 0.0001);
    const sourceZ = (z - center.z) / Math.max(scale, 0.0001);
    return topBase + neighborGroundHeight(template, sourceX, sourceZ) * reliefScale;
  };
  positions.push(center.x, height(center.x, center.z), center.z);
  for (let ring = 1; ring <= rings; ring += 1) {
    const fraction = ring / rings;
    for (let sector = 0; sector < sectors; sector += 1) {
      const angle = (sector / sectors) * Math.PI * 2;
      const p = point(angle, fraction);
      positions.push(p.x, height(p.x, p.z), p.z);
    }
  }
  const topIndex = (ring: number, sector: number): number => 1 + (ring - 1) * sectors + (sector % sectors);
  for (let sector = 0; sector < sectors; sector += 1) indices.push(0, topIndex(1, sector + 1), topIndex(1, sector));
  for (let ring = 1; ring < rings; ring += 1) {
    for (let sector = 0; sector < sectors; sector += 1) {
      const next = (sector + 1) % sectors;
      indices.push(topIndex(ring, sector), topIndex(ring + 1, next), topIndex(ring + 1, sector));
      indices.push(topIndex(ring, sector), topIndex(ring, next), topIndex(ring + 1, next));
    }
  }
  const sideStart = positions.length / 3;
  for (let sector = 0; sector < sectors; sector += 1) {
    const p = point((sector / sectors) * Math.PI * 2, 1);
    positions.push(p.x, height(p.x, p.z), p.z, p.x, bottomY, p.z);
  }
  for (let sector = 0; sector < sectors; sector += 1) {
    const next = (sector + 1) % sectors;
    const a = sideStart + sector * 2;
    const b = sideStart + next * 2;
    indices.push(a, b + 1, a + 1, a, b, b + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Shore only: unlike the former filled beach disc it cannot cover an interior water channel. */
function neighborShoreRingGeometry(
  template: ReturnType<typeof neighborIslandTemplate>,
  center: { readonly x: number; readonly z: number },
  innerScale: number,
  outerScale: number,
  topY: number,
  bottomY: number
): BufferGeometry {
  const sectors = 72;
  const positions: number[] = [];
  const indices: number[] = [];
  const point = (angle: number, scale: number): { x: number; z: number } => {
    const p = neighborWorldPoint(template, center, angle, 1);
    return { x: center.x + (p.x - center.x) * scale, z: center.z + (p.z - center.z) * scale };
  };
  for (let index = 0; index < sectors; index += 1) {
    const angle = index / sectors * Math.PI * 2;
    const inner = point(angle, innerScale);
    const outer = point(angle, outerScale);
    positions.push(inner.x, topY, inner.z, outer.x, topY, outer.z, outer.x, bottomY, outer.z);
  }
  for (let index = 0; index < sectors; index += 1) {
    const next = (index + 1) % sectors;
    const a = index * 3;
    const b = next * 3;
    // Up-facing ring, then the outer skirt.
    indices.push(a, b + 1, a + 1, a, b, b + 1, a + 1, b + 1, b + 2, a + 1, b + 2, a + 2);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * Presentation geometry for an inland lagoon/pond. The analytic water mask in the template uses
 * the same ellipse, so the visible edge, terrain cut and movement collision cannot disagree.
 */
function neighborWaterBodyGeometry(
  water: ReturnType<typeof neighborIslandTemplate>["waterChannels"][number],
  center: { readonly x: number; readonly z: number },
  scale: number,
  y: number
): BufferGeometry {
  const segments = 40;
  const positions: number[] = [center.x + water.x * scale, y, center.z + water.z * scale];
  const cosine = Math.cos(water.rotation);
  const sine = Math.sin(water.rotation);
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const along = Math.cos(angle) * water.length;
    const across = Math.sin(angle) * water.width;
    positions.push(
      center.x + (water.x + along * cosine - across * sine) * scale,
      y,
      center.z + (water.z + along * sine + across * cosine) * scale
    );
  }
  const indices: number[] = [];
  for (let index = 0; index < segments; index += 1) {
    indices.push(0, index + 1, ((index + 1) % segments) + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Wet-sand bank around the same water ellipse; it is not a gameplay pond instance. */
function neighborWaterBankGeometry(
  water: ReturnType<typeof neighborIslandTemplate>["waterChannels"][number],
  center: { readonly x: number; readonly z: number },
  scale: number,
  y: number
): BufferGeometry {
  const segments = 40;
  const positions: number[] = [];
  const indices: number[] = [];
  const cosine = Math.cos(water.rotation);
  const sine = Math.sin(water.rotation);
  const point = (angle: number, multiplier: number): [number, number] => {
    const along = Math.cos(angle) * water.length * multiplier;
    const across = Math.sin(angle) * water.width * multiplier;
    return [
      center.x + (water.x + along * cosine - across * sine) * scale,
      center.z + (water.z + along * sine + across * cosine) * scale
    ];
  };
  for (let index = 0; index < segments; index += 1) {
    const angle = index / segments * Math.PI * 2;
    const [innerX, innerZ] = point(angle, 1.0);
    const [outerX, outerZ] = point(angle, 1.18);
    positions.push(innerX, y, innerZ, outerX, y, outerZ);
  }
  for (let index = 0; index < segments; index += 1) {
    const next = (index + 1) % segments;
    const a = index * 2;
    const b = next * 2;
    indices.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** A low-poly ridge surface with a rounded footprint, not a stretched rock primitive. */
function neighborRidgeGeometry(
  ridge: ReturnType<typeof neighborIslandTemplate>["ridgeLines"][number],
  horizontalScale: number,
  verticalScale: number,
  baseY: number
): BufferGeometry {
  const lengthSegments = 10;
  const widthSegments = 4;
  const positions: number[] = [];
  const indices: number[] = [];
  const crossSection = [0, 0.56, 1, 0.56, 0];
  for (let lengthIndex = 0; lengthIndex <= lengthSegments; lengthIndex += 1) {
    const along = lengthIndex / lengthSegments * 2 - 1;
    const endTaper = Math.pow(Math.max(0, 1 - Math.abs(along)), 0.72);
    const wave = 0.92 + 0.08 * Math.cos(lengthIndex * 1.7 + ridge.rotation);
    for (let widthIndex = 0; widthIndex <= widthSegments; widthIndex += 1) {
      const across = widthIndex / widthSegments * 2 - 1;
      const profile = crossSection[widthIndex] ?? 0;
      const shoulder = ridge.width * 0.5 * across * horizontalScale;
      const ridgeHeight = ridge.height * verticalScale * endTaper * wave * profile;
      positions.push(shoulder, baseY + ridgeHeight, ridge.length * 0.5 * along * horizontalScale);
    }
  }
  const rowWidth = widthSegments + 1;
  for (let lengthIndex = 0; lengthIndex < lengthSegments; lengthIndex += 1) {
    for (let widthIndex = 0; widthIndex < widthSegments; widthIndex += 1) {
      const a = lengthIndex * rowWidth + widthIndex;
      const b = a + 1;
      const c = a + rowWidth;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Low-detail HOME projection from the same authored home outline/terrain, never a guessed oval. */
function homeIslandLodGeometry(
  center: { readonly x: number; readonly z: number },
  scale: number,
  topBase: number,
  bottomY: number,
  heightAt: (worldX: number, worldZ: number) => number
): BufferGeometry {
  const sectors = 96;
  const rings = 16;
  const positions: number[] = [];
  const indices: number[] = [];
  const point = (angle: number, fraction: number): { x: number; z: number; sourceX: number; sourceZ: number } => {
    const source = islandRimPoint(angle, ISLAND_SHAPE);
    const sourceX = WORLD_CENTER_WORLD.worldX + (source.worldX - WORLD_CENTER_WORLD.worldX) * fraction;
    const sourceZ = WORLD_CENTER_WORLD.worldZ + (source.worldZ - WORLD_CENTER_WORLD.worldZ) * fraction;
    return { x: center.x + (sourceX - WORLD_CENTER_WORLD.worldX) * scale, z: center.z + (sourceZ - WORLD_CENTER_WORLD.worldZ) * scale, sourceX, sourceZ };
  };
  positions.push(center.x, topBase + heightAt(WORLD_CENTER_WORLD.worldX, WORLD_CENTER_WORLD.worldZ) * scale, center.z);
  for (let ring = 1; ring <= rings; ring += 1) {
    for (let sector = 0; sector < sectors; sector += 1) {
      const p = point(sector / sectors * Math.PI * 2, ring / rings);
      positions.push(p.x, topBase + heightAt(p.sourceX, p.sourceZ) * scale, p.z);
    }
  }
  const topIndex = (ring: number, sector: number): number => 1 + (ring - 1) * sectors + (sector % sectors);
  for (let sector = 0; sector < sectors; sector += 1) indices.push(0, topIndex(1, sector + 1), topIndex(1, sector));
  for (let ring = 1; ring < rings; ring += 1) {
    for (let sector = 0; sector < sectors; sector += 1) {
      const next = (sector + 1) % sectors;
      indices.push(topIndex(ring, sector), topIndex(ring + 1, next), topIndex(ring + 1, sector));
      indices.push(topIndex(ring, sector), topIndex(ring, next), topIndex(ring + 1, next));
    }
  }
  const sideStart = positions.length / 3;
  for (let sector = 0; sector < sectors; sector += 1) {
    const p = point(sector / sectors * Math.PI * 2, 1);
    positions.push(p.x, topBase + heightAt(p.sourceX, p.sourceZ) * scale, p.z, p.x, bottomY, p.z);
  }
  for (let sector = 0; sector < sectors; sector += 1) {
    const next = (sector + 1) % sectors;
    const a = sideStart + sector * 2;
    const b = sideStart + next * 2;
    indices.push(a, b + 1, a + 1, a, b, b + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createFarmScene(canvas: HTMLCanvasElement, options: FarmSceneOptions = {}): FarmSceneHandle {
  /**
   * The quality the host asked for, resolved once.
   *
   * Every use of it is a rendering decision - the pixel ratio, the shadow map, whether the small
   * scenery is built - and none of them is read by gameplay. See `render-quality.ts`.
   */
  const quality = renderQualityPreset(options.quality ?? "NORMAL");
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: quality.antialias });
  } catch (error: unknown) {
    throw new FarmRendererUnavailableError(error);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatioCap));
  // A filmic curve keeps the sunlit grass and the shaded sides of a building from clipping to flat
  // colour, which is most of what separated the alpha's look from a stylised one. It is a few lines of
  // shader work, not a post-processing pass.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = quality.shadows;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(HORIZON_COLOR);
  const camera = new PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR);

  const assets = createSharedAssets();
  const worldGroup = new Group();
  const tileGroup = new Group();
  const cropGroup = new Group();
  const treeGroup = new Group();
  // The island's resource nodes: a handful of deposits drawn from their own models, rebuilt when the
  // server reports a depletion or a regeneration rather than every frame.
  const resourceGroup = new Group();
  const neighborGroup = new Group();
  const neighborGeometries: BufferGeometry[] = [];
  const neighborCollisionDebugGroup = new Group();
  const neighborCollisionDebugGeometries: BufferGeometry[] = [];
  const neighborCollisionDebugMaterial = new LineBasicMaterial({ color: 0x86e8ff, transparent: true, opacity: 0.92, depthTest: false });
  const neighborPreviewGroup = new Group();
  const neighborPreviewGeometries: BufferGeometry[] = [];
  const islandDebugEnabled = import.meta.env.DEV && new URLSearchParams(window.location.search).get("debug") === "1";
  type IslandDebugIdentity = {
    readonly islandId: string;
    readonly templateId: string;
    readonly center: { readonly x: number; readonly z: number };
    readonly lod: "FULL" | "LOD";
  };
  const islandDebugEntries: { readonly root: Object3D; readonly sprite: Sprite; readonly context: CanvasRenderingContext2D; readonly texture: CanvasTexture; readonly identity: IslandDebugIdentity }[] = [];

  function attachIslandDebugLabel(root: Object3D, identity: IslandDebugIdentity, height: number): void {
    (root.userData as Record<string, unknown>).islandDebug = identity;
    if (!islandDebugEnabled) return;
    const canvas = document.createElement("canvas");
    canvas.width = 640; canvas.height = 176;
    const context = canvas.getContext("2d");
    if (context === null) return;
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = renderer.outputColorSpace;
    const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, depthWrite: false, transparent: true }));
    sprite.scale.set(30, 8.25, 1);
    sprite.position.set(identity.center.x, height, identity.center.z);
    root.add(sprite);
    islandDebugEntries.push({ root, sprite, context, texture, identity });
  }

  function clearIslandDebugLabels(root: Object3D): void {
    for (let index = islandDebugEntries.length - 1; index >= 0; index -= 1) {
      const entry = islandDebugEntries[index];
      if (entry === undefined || entry.root !== root) continue;
      entry.texture.dispose();
      entry.sprite.material.dispose();
      islandDebugEntries.splice(index, 1);
    }
  }

  function refreshIslandDebugLabels(): void {
    if (!islandDebugEnabled) return;
    const currentIslandId = neighborIsland?.islandId ?? "HOME_ISLAND";
    const rows: Record<string, unknown>[] = [];
    for (const entry of islandDebugEntries) {
      const distance = camera.position.distanceTo(entry.sprite.position);
      const { context, identity } = entry;
      context.clearRect(0, 0, 640, 176);
      context.fillStyle = "rgba(8, 22, 34, 0.82)";
      context.fillRect(0, 0, 640, 176);
      context.strokeStyle = identity.lod === "FULL" ? "#ffd66b" : "#93dcff";
      context.lineWidth = 4; context.strokeRect(2, 2, 636, 172);
      context.fillStyle = "#ffffff"; context.font = "bold 24px monospace";
      context.fillText(`${identity.lod} ${identity.templateId}  ${identity.islandId}`, 14, 34);
      context.font = "20px monospace";
      context.fillText(`center=(${identity.center.x.toFixed(1)},${identity.center.z.toFixed(1)})  distance=${distance.toFixed(1)}`, 14, 72);
      context.fillText(`currentIslandId=${currentIslandId}`, 14, 110);
      context.fillText("hover/click identity is renderer metadata", 14, 148);
      entry.texture.needsUpdate = true;
      rows.push({ ...identity, distanceToCamera: Number(distance.toFixed(3)), currentIslandId });
    }
    (window as unknown as { __happyFarmIslandDebug?: readonly Record<string, unknown>[] }).__happyFarmIslandDebug = rows;
  }

  /** Dev-only runtime inventory of render groups; it never enters the production UI or game state. */
  function refreshIslandRuntimeStats(): void {
    if (!islandDebugEnabled) return;
    const bounds = (center: { readonly x: number; readonly z: number }, halfX: number, halfZ: number) => ({
      minX: Number((center.x - halfX).toFixed(2)),
      maxX: Number((center.x + halfX).toFixed(2)),
      minZ: Number((center.z - halfZ).toFixed(2)),
      maxZ: Number((center.z + halfZ).toFixed(2))
    });
    const rows: Record<string, unknown>[] = [];
    const homeCenter = { x: WORLD_CENTER_WORLD.worldX, z: WORLD_CENTER_WORLD.worldZ };
    const homeTrees = state.world.scenery.filter((item) => item.kind === "tree" || item.kind === "pine").length;
    rows.push({
      islandId: "HOME_ISLAND",
      element: neighborIsland === null ? "worldGroup" : "neighborPreviewGroup",
      source: "HOME_STATE",
      center: homeCenter,
      bounds: bounds(homeCenter, state.world.islandHalfWidthWorld, state.world.islandHalfDepthWorld),
      lod: neighborIsland === null ? "ACTIVE" : "LOD",
      terrainGroups: 2,
      trees: homeTrees,
      buildings: constructions.length,
      props: state.world.compositions.props.length,
      renderChildren: neighborIsland === null ? worldGroup.children.length : neighborPreviewGroup.children.length
    });
    for (const preview of neighborPreviews) {
      if (preview.slot === "HOME") continue;
      const template = neighborIslandTemplate(preview.slot);
      const forest = template.kind === "MOC" ? mocPreviewForestPlacements() : neighborForestLayout(template, preview.seed ?? 0);
      const trees = forest.length + (template.kind === "MOC" ? 0 : template.supportLocal.filter((item) => item.kind === "TREE").length);
      const props = template.presentationProps.length
        + template.supportLocal.filter((item) => item.kind === "ROCK" || item.kind === "BUSH").length
        + template.oreLocal.length + template.landmarks.length + 7;
      const root = neighborPreviewGroup.children.find((child) => (child.userData as Record<string, unknown>).islandDebug !== undefined && ((child.userData as Record<string, unknown>).islandDebug as { islandId?: string }).islandId === preview.islandId);
      rows.push({
        islandId: preview.islandId,
        element: "neighborPreviewGroup",
        source: template.kind === "MOC" ? "MOC_PREVIEW_LAYOUT" : "SNAPSHOT_TEMPLATE",
        center: preview.center,
        bounds: bounds(preview.center, template.radiusX * NEIGHBOR_PREVIEW_WATER_SCALE * 1.2, template.radiusZ * NEIGHBOR_PREVIEW_WATER_SCALE * 1.2),
        lod: "LOD",
        terrainGroups: 7 + template.ridgeLines.length + template.waterChannels.length * 2 + (template.kind === "THUY" ? 3 : 0),
        trees,
        buildings: 2,
        props,
        renderChildren: root?.children.length ?? 0
      });
    }
    if (neighborIsland !== null) {
      const template = neighborIslandTemplate(neighborIsland.slot ?? "MOC");
      const forest = template.kind === "MOC" ? mocPreviewForestPlacements() : neighborForestLayout(template, neighborIsland.seed ?? 0);
      const trees = forest.length + (template.kind === "MOC" ? 0 : template.supportLocal.filter((item) => item.kind === "TREE").length);
      const props = template.presentationProps.length
        + template.supportLocal.filter((item) => item.kind === "ROCK" || item.kind === "BUSH").length
        + template.oreLocal.length + template.landmarks.length + 7;
      rows.push({
        islandId: neighborIsland.islandId,
        element: "neighborGroup",
        source: template.kind === "MOC" ? "MOC_PREVIEW_LAYOUT" : "SNAPSHOT_TEMPLATE",
        center: neighborIsland.center,
        bounds: bounds(neighborIsland.center, template.radiusX * 1.2, template.radiusZ * 1.2),
        lod: "ACTIVE",
        terrainGroups: 7 + template.ridgeLines.length + template.waterChannels.length * 2 + (template.kind === "THUY" ? 3 : 0),
        trees,
        buildings: neighborIsland.npcConstructionPhase === "BUILT" || neighborIsland.npcConstructionPhase === undefined ? 2 : 0,
        props,
        renderChildren: neighborGroup.children.length
      });
    }
    const renderedIdentityRows = rows.map((row) => ({
      islandId: row.islandId,
      element: row.element,
      lod: row.lod,
      source: row.source
    }));
    (window as unknown as {
      __happyFarmIslandIdentityAudit?: Record<string, unknown>
    }).__happyFarmIslandIdentityAudit = {
      rendered: renderedIdentityRows,
      duplicateIslandIds: neighborIdentityAudit.removedDuplicateIslandIds,
      removedActiveIslandIds: neighborIdentityAudit.removedActiveIslandIds,
      inputIslandIds: neighborIdentityAudit.inputIslandIds,
      visibleIslandIds: neighborIdentityAudit.visibleIslandIds,
      activeIslandId: neighborIsland?.islandId ?? "HOME_ISLAND",
      duplicateRender: renderedIdentityRows.some((row, index) => renderedIdentityRows.some((other, otherIndex) => index !== otherIndex && row.islandId === other.islandId))
    };
    (window as unknown as { __happyFarmIslandRuntime?: readonly Record<string, unknown>[] }).__happyFarmIslandRuntime = rows;
  }
  // The overlay follows progression (locked land changes when a plot is bought), so it is rebuilt
  // with the dynamic layer instead of living in the static cache.
  const overlayGroup = new Group();
  // The character is its own group: it is rebuilt never and repainted every walking frame, so it
  // must not be cleared with the farm state.
  // Generated models arrive from `tools/asset-pipeline`: the barn replaces the primitive building and
  // the farmer replaces the primitive avatar, each falling back to the primitive until it loads.
  const generatedModels: Partial<Record<GeneratedModelId, Object3D>> = {};
  const playerGroup = new Group();
  playerGroup.visible = false;
  /**
   * The avatar the island draws until the imported character arrives - and whenever it cannot.
   *
   * Its own group so the character view can point at it for the life of the scene while the *scene*
   * stays free to rebuild its contents (the generated model replacing the primitives, say) without
   * the view having to know.
   */
  const fallbackAvatar = new Group();
  fallbackAvatar.add(buildPlayerAvatar(assets, generatedModels.character_farmer));
  /**
   * The player, as presentation: a replaceable model, its animation, and the fallback rule.
   *
   * Gameplay knows nothing about any of it. The pose this draws is the one the player runtime
   * produced - position, facing and movement state are all *read* here, never written back - so a
   * different character model changes how the player looks and nothing about how they work.
   *
   * Constructed with the fallback and *nothing else*: the model library does not exist yet at this
   * point in the scene's own setup, and a cosmetic asset must not be able to reach into boot at all.
   * The load is asked for at the end of `createFarmScene`, and its result is never awaited.
   */
  const characterView = createPlayerCharacterView({
    fallback: fallbackAvatar,
    onProblem: (assetId, message) => {
      // A failed model is a report, not a failure: the fallback is already on screen, and the console
      // says which asset failed and what is being used instead.
      options.onAssetProblem?.(assetId, new Error(message));
    }
  });
  playerGroup.add(characterView.root);
  /**
   * Small scenery - flowers, tufts of grass - lives in its own pair of groups.
   *
   * At estate zoom these are noise: a thousand of them hide the fields, the roads, and the forest
   * masses that the world plan is actually made of. Switched off as a group, the estate view costs
   * less and reads better, and nothing has to be recomputed per frame to do it.
   */
  const detailGroup = new Group();
  const overlayDetailGroup = new Group();
  // The planting grid is its own group: it follows the tiles, the mode, and nothing else.
  const interactionGroup = new Group();
  // The cell overlay: the island's own selection feedback, and the debug lattice when asked for.
  const cellOverlayGroup = new Group();
  // The editor's subtle lattice: one instanced outline per workable cell of the island.
  const workAreaGridGroup = new Group();
  // The editor's marks: draft cells, the rectangle preview, refused cells, hover and the first corner.
  const workAreaMarkGroup = new Group();
  // The harvest rectangle has its own visual layer and is never part of the picker candidates.
  const areaHarvestMarkGroup = new Group();
  /**
   * The placement ghost: what the build shop says the player is about to put down.
   *
   * Its own group because it is the one thing on screen that is neither world nor farm state: it is a
   * picture of an intention, rebuilt when the intention or the selected cell changes and empty the
   * rest of the time.
   */
  const previewGroup = new Group();
  /**
   * The things the player has built.
   *
   * Their own group because they are the only layer whose contents come from the construction rows
   * rather than from the farm projection, and because a rebuild has to be able to drop every instance
   * without touching the world, the crops, or anything the shop owns.
   */
  const constructionGroup = new Group();
  scene.add(
    worldGroup,
    detailGroup,
    tileGroup,
    cropGroup,
    treeGroup,
    resourceGroup,
    neighborPreviewGroup,
    neighborGroup,
    neighborCollisionDebugGroup,
    overlayGroup,
    overlayDetailGroup,
    interactionGroup,
    cellOverlayGroup,
    workAreaGridGroup,
    workAreaMarkGroup,
    areaHarvestMarkGroup,
    previewGroup,
    constructionGroup,
    playerGroup
  );

  /**
   * The sky: one inside-out sphere that fades from a warm horizon to a deeper zenith.
   *
   * A flat background colour was most of why the alpha read as a viewport rather than as a place.
   * The dome costs one draw call, carries no texture, and gives the fog something to dissolve into.
   * It neither receives nor casts anything, and it is excluded from fog because it *is* the horizon.
   */
  const sky = createSkyDome();
  scene.add(sky);

  // Sky light, ground bounce, and one warm sun. The hemisphere carries the colour that makes shade
  // read as shade rather than as darkness: cool from above, green from the ground.
  scene.add(new HemisphereLight(0xdcf0ff, 0x6d8f52, 0.9));
  scene.add(new AmbientLight(0xffffff, 0.16));
  const sun = new DirectionalLight(0xfff0cd, 2.3);
  sun.castShadow = quality.shadows;
  sun.shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
  sun.shadow.camera.left = -SHADOW_EXTENT_WORLD;
  sun.shadow.camera.right = SHADOW_EXTENT_WORLD;
  sun.shadow.camera.top = SHADOW_EXTENT_WORLD;
  sun.shadow.camera.bottom = -SHADOW_EXTENT_WORLD;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 190;
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.08;
  sun.shadow.camera.updateProjectionMatrix();
  scene.add(sun, sun.target);

  const selectionMarker = new Mesh(assets.ring, assets.selection);
  selectionMarker.rotation.x = -Math.PI / 2;
  selectionMarker.visible = false;
  /**
   * The mark around the built thing the player is editing.
   *
   * Two meshes rather than a recolour of the tile ring: an object is not a cell, and a player who has
   * selected a barn should see the barn marked, at the barn's own *footprint*, while the cell under
   * the pointer stays whatever it was. The wash says which ground would move; the ring says which
   * object is selected. Both are hidden unless something is selected.
   */
  const objectFootprintMarker = new Mesh(assets.circle, assets.cellSelection);
  objectFootprintMarker.rotation.x = -Math.PI / 2;
  objectFootprintMarker.visible = false;
  const objectMarker = new Mesh(assets.ring, assets.selection);
  objectMarker.rotation.x = -Math.PI / 2;
  objectMarker.visible = false;
  scene.add(objectFootprintMarker, objectMarker);
  let hoverMarker: Mesh | null = null;
  /** The cell the interaction ring is under, so a repeated call with the same cell draws nothing. */
  let interactionMarkerCell: TileCoordinate | null = null;

  const pickTargets = new Map<Object3D, TileCoordinate>();
  /**
   * The instanced meshes and the coordinate each of their instances stands for.
   *
   * A raycast against an `InstancedMesh` reports the instance index rather than an object, so the
   * mapping from index to authoritative tile coordinate lives beside the mapping from object to
   * coordinate rather than inside the renderer's geometry.
   */
  const pickedInstances = new Map<Object3D, readonly TileCoordinate[]>();
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let neighborIsland: SceneNeighborIsland | null = null;
  let neighborNpcNode: Group | null = null;
  let neighborNpcTool: Object3D | null = null;
  let neighborNpcPhase: string | null = null;
  let neighborPreviews: readonly SceneNeighborIslandPreview[] = [];
  let neighborIdentityAudit: {
    readonly inputIslandIds: readonly string[];
    readonly visibleIslandIds: readonly string[];
    readonly removedDuplicateIslandIds: readonly string[];
    readonly removedActiveIslandIds: readonly string[];
  } = { inputIslandIds: [], visibleIslandIds: [], removedDuplicateIslandIds: [], removedActiveIslandIds: [] };
  const neighborPreviewDetailRoots = new Map<Group, {
    readonly center: { readonly x: number; readonly z: number };
    readonly radius: number;
    readonly details: Group;
    rootVisible: boolean;
    detailsVisible: boolean;
  }>();
  const emptyLayout = layoutFarmTiles([]);
  let state: FarmSceneInput = {
    layout: emptyLayout,
    world: buildFarmWorld({ layout: emptyLayout, tiles: [], plots: [] }),
    tiles: [],
    cells: EMPTY_WORLD_CELL_MAP
  };
  let worldSignature = "";
  /** The dynamic layer's own key: what the last rebuild drew, so an unchanged farm draws nothing. */
  let dynamicWorldSignature = "";
  /**
   * How far the camera may drift from the world's centre, and how far the fog starts.
   *
   * The whole island, so a player who zooms out can look at the orchard, the pond, and the yard -
   * not just the field.
   */
  let worldExtent = MIN_FRAMED_EXTENT;
  /**
   * The camera, and where it is looking.
   *
   * The rig is created once and `applyState` never rebuilds it: yaw, pitch, distance and the panned
   * target all survive a farm refresh, which is what the brief asks for and what a player expects
   * when land arrives while they are looking at something.
   */
  const cameraRig = createOrbitCamera({
    yaw: options.initialCamera?.yaw ?? DEFAULT_CAMERA_YAW,
    pitch: options.initialCamera?.pitch ?? DEFAULT_CAMERA_PITCH,
    distance: options.initialCamera?.distance ?? DEFAULT_CAMERA_DISTANCE,
    targetX: 0,
    targetZ: 0,
    panLimit: 140,
    minDistance: MIN_DISTANCE,
    maxDistance: MAX_DISTANCE
  });
  /** The point the camera orbits when the world has not been framed yet. */
  let cameraHomeX = 0;
  let cameraHomeZ = 0;
  /**
   * Whether the island's centre has been handed to the camera yet.
   *
   * Only the first world frames anything. Every later refresh - a plot bought, a scene rebuilt
   * because a model arrived - leaves the yaw, the pitch, the distance and the panned target exactly
   * where the player put them, which is the whole point of the rig being created once.
   */
  let cameraFramed = false;
  /**
   * Circles the camera may not sit inside: the geography, plus the *buildings* the player has.
   *
   * Rebuilt with the rows rather than listed in the world config, because a building the player moved
   * has to take its silhouette with it - and filtered to the multi-cell rows, so the several hundred
   * trees, rocks and props the island owns are never tested: a bush is not an occluder, and a camera
   * that pulled in for one would feel broken. See the performance rule in the design doc.
   */
  let cameraBlockers: readonly { readonly centerWorldX: number; readonly centerWorldZ: number; readonly radiusWorld: number }[] = [];
  /** Which way the island is looked at: the estate orbit, or the character follow. */
  let cameraMode: CameraMode = "ESTATE";
  /**
   * Whether the estate camera is attached to the player or has been left where the player put it.
   *
   * The rule lives in `estate-follow.ts`; this is only where it is kept. It is read and written by
   * the estate camera paths alone, so the character rig can never be pulled along by it.
   */
  let estateFollow: EstateFollowState = INITIAL_ESTATE_FOLLOW;
  /**
   * The third-person rig.
   *
   * Created once, like the estate rig, and re-aimed rather than rebuilt: switching modes twenty times
   * must not leave twenty cameras behind.
   */
  const characterCamera = createCharacterCameraRig({
    yaw: options.initialCamera?.yaw ?? DEFAULT_CAMERA_YAW,
    pitch: DEFAULT_CHARACTER_PITCH,
    distance: DEFAULT_CHARACTER_DISTANCE
  });
  /** The flight between the two viewpoints, or null when the camera is settled where it belongs. */
  let cameraTransition: CameraTransition | null = null;
  /** The last field of view written to the camera, so a projection is rebuilt only when it changes. */
  let appliedFov = ESTATE_FOV_DEGREES;
  let playerPose: FarmScenePlayer | null = null;
  /** The island's ground surface: what a click on open ground lands on. */
  let groundMesh: Object3D | null = null;
  /** The cell the player has selected, or null. Presentation only; it is never sent anywhere. */
  let selectedCell: TileCoordinate | null = null;
  // The work-area editor's whole picture, or null outside edit mode.
  let workAreaEdit: WorkAreaEditState | null = null;
  let workAreaEditSignature = "off";
  let areaHarvestEdit: AreaHarvestEditState | null = null;
  let areaHarvestEditSignature = "off";
  let workAreaGridGeometry: BufferGeometry | null = null;
  /** Developer overlay. Off in every shipped path. */
  let debugMode = false;
  /** The overlay's own instanced geometry, kept so a rebuild can release the one it replaces. */
  let cellOverlayGeometry: BufferGeometry | null = null;
/** Whether the planting grid is showing. Client presentation state; it decides no rule. */
let interactionMode: FarmInteractionMode = "NONE";
/** The geometry of the current grid, kept so a rebuild can release the one it replaces. */
let interactionGeometry: BufferGeometry | null = null;

  /**
   * One model library for the whole client.
   *
   * It used to live here: four caches, four loaders, and a URL table consulted in each of them. The
   * shop needs to draw the *same* barns and trees as thumbnails, and a model must never be downloaded
   * twice, so the cache moved to `model-library.ts` and this scene is now one of its three callers -
   * the other two being the thumbnail renderer and the placement ghost.
   */
  const library = sharedModelLibrary({ onProblem: (modelId, error) => options.onAssetProblem?.(modelId, error) });
  const models = new Map<CropModelId, ModelVariants>();
  const unavailableModels = new Set<CropModelId>();
  /**
   * What to do when a model finally arrives.
   *
   * The scene is one of three callers of the library, so the library cannot know that a barn landing
   * means "rebuild the static layer once" and a farmer landing means "rebuild the avatar". It says
   * what arrived; this decides what that means for the picture.
   */
  const stopListening = library.onArrive((modelId) => {
    if (disposed) return;
    // A construction may have been waiting for exactly this model, so the layer is rebuilt when one
    // lands rather than left with a hole where a barn should be.
    constructionSignature = "";
    rebuildConstructions();
    if (isGeneratedModelId(modelId)) {
      const model = library.get(modelId);
      if (model !== undefined) generatedModels[modelId] = model;
    }
    if (modelId === "building_barn") {
      // The static layer is cached behind the world signature; invalidating it once is what replaces
      // the primitive fallback with the model - and never moves the camera.
      worldSignature = "";
    }
    // Resource nodes request their model lazily. If the first rebuild ran before the GLB arrived,
    // `library.get()` intentionally returned undefined and left that node out; rebuild the resource
    // layer when the shared model lands so a transient loading race cannot hide the node until the
    // next resource refresh.
    rebuildResourceNodes();
    if (modelId === "character_farmer") rebuildAvatar();
    if (neighborIsland !== null) rebuildNeighborIsland();
    if (neighborPreviews.length > 0) rebuildNeighborIslandPreviews();
    applyState(state);
    draw();
  });
  let disposed = false;

  /** The loaded model for an id, starting its download the first time something asks for it. */
  function sceneryModel(id: string): Object3D | undefined {
    return library.get(id);
  }

  /** The loaded building model for an id, starting its download the first time one is asked for. */
  function buildingModel(id: string): Object3D | undefined {
    return library.get(id);
  }

  /**
   * Loads the generated structure and character models once each.
   *
   * The barn lands behind the same world signature as the scenery, so its arrival rebuilds the
   * static layer a single time; the farmer rebuilds only the avatar group. Neither is fetched per
   * instance, and neither is refetched on a farm refresh.
   */
  function requestGeneratedModels(): void {
    for (const id of Object.keys(GENERATED_MODEL_URLS) as GeneratedModelId[]) {
      const model = library.get(id);
      if (model !== undefined) generatedModels[id] = model;
    }
  }

  /**
   * Rebuilds the *fallback* avatar from whatever models are available now.
   *
   * Only the placeholder is rebuilt: the imported character is loaded once by the character view and
   * is never re-fetched, re-cloned or re-instantiated - not on a farm refresh, and not when the
   * camera changes between estate and character view.
   */
  function rebuildAvatar(): void {
    fallbackAvatar.clear();
    fallbackAvatar.add(buildPlayerAvatar(assets, generatedModels.character_farmer));
    updatePlayer(0);
  }

  function modelVariants(definitionId: string): ModelVariants | undefined {
    const modelId = cropModelId(definitionId);
    if (modelId === null) return undefined;
    const variants = models.get(modelId);
    if (variants !== undefined) return variants;
    requestModel(modelId);
    return undefined;
  }

  function requestModel(modelId: CropModelId): void {
    if (disposed || unavailableModels.has(modelId)) return;
    void library.load(modelId).then((model) => {
      if (model === null) {
        unavailableModels.add(modelId);
        return;
      }
      if (disposed) return;
      // A crop is the one family with *variants* - the same file drawn young and ripe - so the file
      // comes from the shared library and the two looks are this scene's own business.
      models.set(modelId, prepareVariants(model));
      applyState(state);
      draw();
    });
  }

  function prepareVariants(source: Object3D): ModelVariants {
    const growing = new Group();
    growing.add(source);
    const readyMaterials = new Map<Material, Material>();
    const readySource = source.clone(true);
    readySource.traverse((child) => {
      if (isMeshLike(child)) child.material = toReadyMaterials(child.material, readyMaterials);
    });
    const ready = new Group();
    ready.add(readySource);
    return { growing, ready };
  }

  let firstFrameReported = false;

  function draw(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    updateNeighborPreviewLod();
    refreshIslandDebugLabels();
    refreshIslandRuntimeStats();
    renderer.render(scene, camera);
    // Dev-only observability for browser acceptance evidence; it does not drive gameplay or polling.
    const cameraStats = cameraRig.state;
    (window as unknown as { __happyFarmRenderStats?: Record<string, number | boolean | string | null> }).__happyFarmRenderStats = {
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      neighborPreviewVisible: neighborPreviewGroup.visible,
      neighborPreviewChildren: neighborPreviewGroup.children.length,
      neighborFullVisible: neighborGroup.visible,
      neighborFullChildren: neighborGroup.children.length,
      neighborNpcX: neighborNpcNode?.position.x ?? null,
      neighborNpcZ: neighborNpcNode?.position.z ?? null,
      neighborNpcPhase,
      cameraYaw: cameraStats.yaw,
      cameraDistance: cameraStats.distance,
      cameraTargetX: cameraStats.targetX,
      cameraTargetZ: cameraStats.targetZ
    };
    if (!firstFrameReported) {
      firstFrameReported = true;
      options.onFirstFrame?.();
    }
  }

  /**
   * How far out the camera may be before small scenery stops being worth drawing.
   *
   * Roughly the estate view: past it, a flower is a fraction of a pixel and a hundred of them are a
   * haze over the fields. One comparison per camera update, and the group toggles with it.
   */
  const DETAIL_DISTANCE_LIMIT = 55;

  /**
   * Distant islands use a bounded medium-detail layer, but its detail is still chosen from the
   * camera's actual distance.  This prevents a nearby island from collapsing to a flat marker while
   * keeping small props out of the far horizon.  The island identity and authored outline stay in the
   * base layer at every distance.
   */
  function updateNeighborPreviewLod(): void {
    if (neighborPreviewDetailRoots.size === 0) return;
    const viewportHeight = Math.max(1, canvas.clientHeight);
    const halfFov = (camera.fov * Math.PI) / 360;
    for (const [root, entry] of neighborPreviewDetailRoots) {
      const dx = camera.position.x - entry.center.x;
      const dz = camera.position.z - entry.center.z;
      const distance = Math.max(1, Math.hypot(dx, dz));
      const projectedRadius = (entry.radius / distance) * (viewportHeight / Math.max(0.01, Math.tan(halfFov)));
      const rootEnter = distance < CAMERA_FAR && projectedRadius > 8;
      const rootExit = distance < CAMERA_FAR && projectedRadius > 6;
      const detailEnter = projectedRadius > 16;
      const detailExit = projectedRadius > 13;
      entry.rootVisible = entry.rootVisible ? rootExit : rootEnter;
      entry.detailsVisible = entry.detailsVisible ? detailExit : detailEnter;
      root.visible = entry.rootVisible;
      entry.details.visible = entry.detailsVisible && entry.rootVisible;
    }
  }

  function updateDetailVisibility(): void {
    // The active camera's own distance: the estate view switches the small scenery off as it pulls
    // back, and the character view is always close enough to want it.
    const distance = cameraMode === "CHARACTER" ? characterCamera.state.distance : cameraRig.state.distance;
    const visible = distance <= DETAIL_DISTANCE_LIMIT;
    detailGroup.visible = visible;
    overlayDetailGroup.visible = visible;
  }

  /** The ground under a world position, in the same terms the props and the roads use. */
  function groundHeightAt(worldX: number, worldZ: number): number {
    if (neighborIsland !== null) {
      const template = neighborIslandTemplate(neighborIsland.slot ?? "MOC");
      const localX = worldX - neighborIsland.center.x;
      const localZ = worldZ - neighborIsland.center.z;
      if (Math.hypot(localX / template.radiusX, localZ / template.radiusZ) <= 1.08) {
        return GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, localX, localZ);
      }
    }
    return GROUND_SURFACE_Y + terrainHeightAt(worldX, worldZ, state.world.terrain);
  }

  /** Whether something solid stands at a world position: what the camera must not sit inside. */
  function cameraBlockedAt(worldX: number, worldZ: number): boolean {
    return cameraBlockers.some(
      (blocker) =>
        Math.hypot(worldX - blocker.centerWorldX, worldZ - blocker.centerWorldZ) < blocker.radiusWorld
    );
  }

  /**
   * The buildings the camera must not sit inside, from the rows the player owns.
   *
   * A row is a candidate when it covers more than one cell: the island's trees, rocks, bushes and
   * props are all one cell, and testing them would be both expensive and wrong (a camera that jumps
   * in behind every shrub). The nine-odd buildings are the occluders that matter, and the list is
   * rebuilt with the rows so a barn that walked away takes its silhouette with it.
   */
  function rebuildCameraBlockers(): void {
    const pitch = state.layout.pitch;
    cameraBlockers = [
      ...STATIC_OBSTACLES,
      ...constructions
        .filter((item) => item.widthCells >= 2 || item.depthCells >= 2)
        .map((item) => ({
          centerWorldX:
            item.worldX + ((item.widthCells - 1) / 2 - Math.floor((item.widthCells - 1) / 2)) * pitch,
          centerWorldZ:
            item.worldZ + ((item.depthCells - 1) / 2 - Math.floor((item.depthCells - 1) / 2)) * pitch,
          radiusWorld: (Math.min(item.widthCells, item.depthCells) / 2) * pitch + 0.25
        }))
    ];
  }

  /** The estate camera as a value: where its eye is and what it looks at. */
  function estatePose(): CameraPose {
    const orbit = cameraRig.state;
    const eye = cameraRig.eye(groundHeightAt, cameraBlockedAt);
    return {
      eyeX: eye.x,
      eyeY: eye.y,
      eyeZ: eye.z,
      targetX: orbit.targetX,
      targetY: groundHeightAt(orbit.targetX, orbit.targetZ) + 0.8,
      targetZ: orbit.targetZ,
      fov: ESTATE_FOV_DEGREES
    };
  }

  /** The third-person camera as a value, aimed at the character the world last drew. */
  function characterPose(): CameraPose {
    const player = playerPose;
    if (player === null) {
      // No character yet - a farm that has not finished starting. The camera stays where the estate
      // left it rather than flying to the coordinate origin to look at nobody.
      return estatePose();
    }
    const target = characterTarget(
      { worldX: player.worldX, worldY: player.worldY, worldZ: player.worldZ },
      PLAYER_HEIGHT_WORLD
    );
    const eye = characterCamera.eye(target, groundHeightAt, cameraBlockedAt);
    return {
      eyeX: eye.x,
      eyeY: eye.y,
      eyeZ: eye.z,
      targetX: target.x,
      targetY: target.y,
      targetZ: target.z,
      fov: CHARACTER_FOV_DEGREES
    };
  }

  /** The pose the active mode wants right now. */
  function activePose(): CameraPose {
    return cameraMode === "CHARACTER" ? characterPose() : estatePose();
  }

  /** Points the one camera at a pose, rebuilding the projection only when the lens actually changed. */
  function applyPose(pose: CameraPose): void {
    camera.position.set(pose.eyeX, pose.eyeY, pose.eyeZ);
    camera.lookAt(pose.targetX, pose.targetY, pose.targetZ);
    if (Math.abs(pose.fov - appliedFov) > 0.01) {
      appliedFov = pose.fov;
      camera.fov = pose.fov;
      camera.updateProjectionMatrix();
    }
  }

  function updateCamera(): void {
    // Three cases, in order: a flight between the two viewpoints, the character follow, and the
    // estate orbit. The estate rig is never written to by the other two, which is what "the estate
    // view is preserved exactly" means in practice.
    if (cameraTransition !== null) {
      // Re-aim at the live destination every frame: the player may be walking while the camera lands.
      cameraTransition.retarget(activePose());
      applyPose(cameraTransition.pose());
    } else {
      applyPose(activePose());
    }
    updateDetailVisibility();
  }

  /**
   * How long the last character frame took, in milliseconds.
   *
   * The character is animated against the same wall clock the player runtime uses, but it is drawn on
   * the pose events rather than on its own frame loop: a character who is standing still costs no
   * frames at all, and one who is walking gets one update per pose - which is exactly the rate at
   * which its position can have changed.
   */
  let lastPlayerFrameMs = 0;
  /**
   * The longest gap between poses a frame will believe in.
   *
   * Poses arrive at frame rate while the character moves and stop when they stop, so the first pose
   * after a pause - a tab left in the background, a long conversation - would otherwise carry the
   * whole pause as its delta and lurch both the walk cycle and the camera follow.
   */
  const MAX_POSE_DELTA_MS = 100;
  /** Milliseconds into the harvest bow, or -1 when there is none. */
  let gestureElapsedMs = -1;

  function updateHarvestGesture(deltaMs: number): void {
    if (gestureElapsedMs < 0) return;
    gestureElapsedMs += Math.max(0, deltaMs);
    if (gestureElapsedMs >= HARVEST_GESTURE_DURATION_MS) {
      gestureElapsedMs = -1;
      playerGroup.rotation.x = 0;
      return;
    }
    // Applied to the avatar's outer group, so the character view keeps owning the model's own transform
    // - and to nothing else, so the walk cycle and the mixer never learn about a harvest.
    playerGroup.rotation.x = harvestGestureBend(gestureElapsedMs);
  }

  /**
   * Draws the player at the pose the runtime produced.
   *
   * Everything gameplay owns - where the character is, which way they face, whether they are walking
   * - arrives in `playerPose`; this function only tells the presentation layer about it. The model is
   * never asked where it is, and nothing here can move the player.
   */
  function updatePlayer(deltaMs: number): void {
    playerGroup.visible = playerPose !== null;
    characterView.update(playerPose, Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs / 1000 : 0);
    updateHarvestGesture(deltaMs);
    updateNeighborNpcPose(Date.now());
  }

  /**
   * Rebuilds the planting hint: one outline on the cell the player is pointing at.
   *
   * V14.5.1B: the old version outlined *every* plantable tile, which painted the whole owned parcel
   * as a grid and read as "you may only farm here". The candidate is one cell, so the hint is one
   * cell - the selected one, when the server's own rows say a seed may go there. Called on a mode or
   * selection change, never per frame.
   */
  function rebuildInteractionGrid(): void {
    interactionGroup.clear();
    interactionGeometry?.dispose();
    interactionGeometry = null;
    if (interactionMode === "NONE") return;
    const selected = selectedCell;
    if (selected === null) return;
    const plantable = plantingHintCells(state.tiles, selected);
    interactionGeometry = buildInteractionGrid(
      interactionGroup,
      plantable,
      state.layout.tileSize,
      TILE_SURFACE_Y + 0.015,
      assets.interactionGrid
    );
  }

  /**
   * Rebuilds the island's cell overlay.
   *
   * Called when the selection changes, when debug mode changes, and when the farm state does - never
   * per frame. With nothing selected and debug off the group is empty, which is the whole point: the
   * island does not show a grid in normal play, and this function is the only thing that could.
   */
  function rebuildCellOverlay(): void {
    cellOverlayGroup.clear();
    cellOverlayGeometry?.dispose();
    cellOverlayGeometry = null;
    const plan = planCellOverlay(state.cells, selectedCell === null ? null : { cell: selectedCell }, debugMode);
    const overlayHeightAt = cellOverlayHeightAt;
    if (plan.debugCells.length > 0) {
      cellOverlayGeometry = buildDebugGrid(cellOverlayGroup, plan.debugCells, state.layout.pitch, assets.cellDebug, overlayHeightAt);
      return;
    }
    if (plan.selection === null) return;
    cellOverlayGroup.add(
      buildSelectionQuad(plan.selection, state.cells, assets.cellSelection, overlayHeightAt)
    );
    cellOverlayGeometry = buildCellOutlines(
      cellOverlayGroup,
      plan.neighbourhood,
      state.layout.pitch,
      assets.cellNeighbour,
      overlayHeightAt
    );
  }

  /**
   * Where a cell mark lies, for every overlay layer.
   *
   * The farm's own tiles are a layer of ground nine centimetres thick, so a cell the player owns has
   * to be marked on top of them rather than inside them; open water has its own surface, so a cell
   * marked on the sea sits on the water the cages float in rather than six tenths of a metre below.
   * One function because the selection and the work-area draft must agree about where the ground is.
   */
  function cellOverlayHeightAt(worldX: number, worldZ: number): number {
    const cell = worldToCell({ worldX, worldZ }, state.cells.frame);
    const onSea = state.cells.cells.get(cellKey(cell.x, cell.y))?.terrain === "WATER";
    const owned = state.world.inner;
    const onFarmLayer =
      owned !== null && cell.x >= owned.minX && cell.x <= owned.maxX && cell.y >= owned.minY && cell.y <= owned.maxY;
    const base = onSea ? SEA_SURFACE_Y : GROUND_SURFACE_Y + terrainHeightAt(worldX, worldZ, state.world.terrain);
    return base + (onFarmLayer ? CELL_OVERLAY_TILE_LIFT_WORLD : CELL_OVERLAY_LIFT_WORLD);
  }

  /** Drops the editor's lattice and the geometry behind it. */
  function disposeWorkAreaGrid(): void {
    workAreaGridGroup.clear();
    workAreaGridGeometry?.dispose();
    workAreaGridGeometry = null;
  }

  /**
   * The editor's lattice: one faint outline per cell the island actually is.
   *
   * Built once when the editor opens and thrown away when it closes, so normal play still shows no
   * grid at all. It covers the land, not the open sea, because a rectangle on water is never valid
   * for any kind that the land supplies and drawing it would be the spreadsheet the brief refuses.
   */
  function rebuildWorkAreaGrid(): void {
    disposeWorkAreaGrid();
    const cells = [...state.cells.cells.values()]
      .filter((cell) => cell.terrain !== "WATER")
      .map((cell) => ({ x: cell.x, y: cell.z }));
    workAreaGridGeometry = buildCellOutlines(
      workAreaGridGroup,
      cells,
      state.layout.pitch,
      assets.cellWorkAreaGrid,
      cellOverlayHeightAt
    );
  }

  /**
   * The editor's marks, drawn in a fixed order so each state reads over the one below it.
   *
   * Refused ground first, then the rectangle preview, then the committed draft, then the hovered cell
   * and finally the first corner. Each layer is lifted a hair above the one below it, because two
   * translucent squares at exactly the same height flicker against each other.
   */
  function rebuildWorkAreaMarks(): void {
    workAreaMarkGroup.clear();
    const edit = workAreaEdit;
    if (edit === null) return;
    const draw = (cells: readonly TileCoordinate[], material: MeshBasicMaterial, layer: number): void => {
      if (cells.length === 0) return;
      const height = (worldX: number, worldZ: number): number => cellOverlayHeightAt(worldX, worldZ) + layer * 0.006;
      for (const cell of cells) {
        const world = state.cells.cells.get(cellKey(cell.x, cell.y));
        if (world === undefined) continue;
        const quad = buildSelectionQuad(world, state.cells, material, height);
        quad.renderOrder = layer;
        workAreaMarkGroup.add(quad);
      }
    };
    draw(edit.invalid, assets.cellWorkAreaInvalid, 1);
    draw(edit.preview, assets.cellWorkAreaPreview, 2);
    draw(edit.draft, assets.cellWorkArea, 3);
    draw(edit.hover === null ? [] : [edit.hover], assets.cellWorkAreaHover, 4);
    draw(edit.corner === null ? [] : [edit.corner], assets.cellWorkAreaCorner, 5);
  }

  /** Draws the harvest rectangle as a local presentation layer; raycast candidates never include it. */
  function rebuildAreaHarvestMarks(): void {
    areaHarvestMarkGroup.clear();
    const edit = areaHarvestEdit;
    if (edit === null) return;
    const draw = (cells: readonly TileCoordinate[], material: MeshBasicMaterial, layer: number): void => {
      const height = (worldX: number, worldZ: number): number => cellOverlayHeightAt(worldX, worldZ) + layer * 0.008;
      for (const cell of cells) {
        const world = state.cells.cells.get(cellKey(cell.x, cell.y));
        if (world === undefined) continue;
        const quad = buildSelectionQuad(world, state.cells, material, height);
        quad.renderOrder = layer;
        areaHarvestMarkGroup.add(quad);
      }
    };
    draw(edit.cells, assets.cellWorkAreaPreview, 1);
    draw([...(edit.shortage ?? []), ...(edit.waiting ?? [])], assets.cellWorkAreaShortage, 2);
    draw(edit.invalid ?? [], assets.cellWorkAreaInvalid, 3);
    if (edit.focus !== null && edit.focus !== undefined) draw([edit.focus], assets.cellWorkAreaHover, 4);
    draw([edit.first, edit.second].filter((cell): cell is TileCoordinate => cell !== null), assets.cellWorkAreaCorner, 5);
  }

  function updateMarkers(): void {
    const selected = state.tiles.find((tile) => tile.selected);
    selectionMarker.visible = selected !== undefined;
    if (selected !== undefined) {
      selectionMarker.position.set(selected.worldX, TILE_SURFACE_Y + 0.02, selected.worldZ);
      selectionMarker.scale.set(state.layout.tileSize * 0.62, state.layout.tileSize * 0.62, 1);
    }
    if (hoverMarker !== null) {
      const hovered = state.tiles.find((tile) => coordinateEquals(tile, hoveredCoordinate));
      hoverMarker.visible = hovered !== undefined;
      if (hovered !== undefined) {
        hoverMarker.position.set(hovered.worldX, TILE_SURFACE_Y + 0.025, hovered.worldZ);
        hoverMarker.scale.set(state.layout.tileSize * 0.56, state.layout.tileSize * 0.56, 1);
      }
    }
  }

  function coordinateEquals(tile: SceneTile, coordinate: TileCoordinate | null): boolean {
    return coordinate !== null && tile.tileX === coordinate.x && tile.tileY === coordinate.y;
  }

  /**
   * The soil pad under every *cultivated* tile, as one `InstancedMesh`.
   *
   * Ownership is not terrain: an owned cell that carries nothing is plain grass and draws nothing at
   * all, so buying land never turns the island brown. Only a cell with a crop on it gets a pad, whose
   * top is `TILE_SURFACE_Y` - the height the crop itself stands on. A mature farm owns more than a
   * thousand tiles but plants far fewer, so this is also a smaller batch than the old all-tiles pass.
   *
   * The instance order is the order `state.tiles` arrived in, which is what lets a click resolve back
   * to the authoritative coordinate.
   */
  function buildTileSlabs(tiles: readonly SceneTile[]): void {
    const cultivated = tiles.filter(tileDrawsSoil);
    if (cultivated.length === 0) return;
    const slabs = new InstancedMesh(assets.box, assets.tileSurface, cultivated.length);
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    const colour = new Color();
    const coordinates: TileCoordinate[] = [];
    cultivated.forEach((tile, index) => {
      coordinates.push({ x: tile.tileX, y: tile.tileY });
      // The pad stands on the ground, so its top - not its centre - is the surface a crop reads.
      position.set(tile.worldX, GROUND_SURFACE_Y + TILE_THICKNESS / 2, tile.worldZ);
      // The footprint is the *pitch*, so two cultivated neighbours touch rather than leaving a sliver
      // of grass between two tilled patches.
      const footprint = state.layout.tileSize + state.layout.tileGap;
      scale.set(footprint, TILE_THICKNESS, footprint);
      matrix.compose(position, rotation, scale);
      slabs.setMatrixAt(index, matrix);
      slabs.setColorAt(
        index,
        colour.setHex(tileColorFor(tile.terrainType, true, tile.tileX, tile.tileY))
      );
    });
    slabs.instanceMatrix.needsUpdate = true;
    if (slabs.instanceColor !== null) slabs.instanceColor.needsUpdate = true;
    slabs.receiveShadow = true;
    slabs.computeBoundingSphere();
    tileGroup.add(slabs);
    pickedInstances.set(slabs, coordinates);
  }

  function modelPlant(tile: SceneTile, variants: ModelVariants, mature: boolean, height: number): Group {
    const plant = new Group();
    plant.add((mature ? variants.ready : variants.growing).clone(true));
    plant.position.set(tile.worldX, TILE_SURFACE_Y, tile.worldZ);
    plant.scale.setScalar(height);
    plant.traverse((child) => {
      child.castShadow = true;
    });
    return plant;
  }

  /** Placeholder crop for a definition with no shipped model: a cone on the tile centre. */
  function placeholderCrop(tile: SceneTile, material: Material, height: number): Mesh {
    const mesh = new Mesh(assets.cone, material);
    mesh.position.set(tile.worldX, TILE_SURFACE_Y + height / 2, tile.worldZ);
    mesh.scale.set(state.layout.tileSize * CROP_RADIUS_FACTOR, height, state.layout.tileSize * CROP_RADIUS_FACTOR);
    mesh.castShadow = true;
    return mesh;
  }

  function signatureOf(input: FarmSceneInput): string {
    const world = input.world;
    // Only the static world's own identity belongs here. Locked plots and the land bounds follow
    // progression, so they are drawn in their own overlay group: buying a plot must not rebuild the
    // island, the pond, the yard, or a single rock.
    return [
      world.islandHalfWidthWorld.toFixed(3),
      world.islandHalfDepthWorld.toFixed(3),
      world.centerWorldX.toFixed(3),
      world.centerWorldZ.toFixed(3)
    ].join(";");
  }

  /**
   * Everything the *dynamic* layer draws, as one comparison key.
   *
   * The host page polls the farm so that a crop that ripens while nobody is looking appears without a
   * reload, and most polls find the farm exactly as it was. Rebuilding the tile slabs, every crop
   * instance, the locked-land overlay and the selection overlay for an unchanged farm is the single
   * largest piece of avoidable work in the client, so an unchanged key skips all of it.
   *
   * Growth is quantised to the same whole percentage the panels display: a crop is redrawn when its
   * height would visibly change, not for every fraction of a percent the server's clock produces.
   * Nothing authoritative is involved - the server still owns maturity, and a maturity flip changes
   * `mature`, which is compared exactly.
   */
  function dynamicSignatureOf(input: FarmSceneInput): string {
    // Progression first: the locked ring and the field blocks follow the plots the player owns, so a
    // purchase changes this layer without changing the island. The bounds and the counts are enough to
    // tell every state apart without walking the scenery.
    const inner = input.world.inner;
    const outer = input.world.outer;
    const bounds = (value: typeof inner): string =>
      value === null ? "-" : `${String(value.minX)},${String(value.maxX)},${String(value.minY)},${String(value.maxY)}`;
    const parts: string[] = [
      input.layout.pitch.toFixed(4),
      input.layout.tileSize.toFixed(4),
      input.layout.tileGap.toFixed(4),
      `in:${bounds(inner)}`,
      `out:${bounds(outer)}`,
      `ls:${String(input.world.lockedScenery.length)}`,
      `lp:${String(input.world.lockedPlots.length)}`,
      selectedCell === null ? "-" : `${String(selectedCell.x)},${String(selectedCell.y)}`
    ];
    for (const tile of input.tiles) {
      const crop = tile.crop;
      const tree = tile.tree;
      parts.push(
        `t${String(tile.tileX)},${String(tile.tileY)},${tile.terrainType},${tile.selected ? "1" : "0"}` +
          (crop === null
            ? ""
            : `,c${crop.definitionId},${Math.round(crop.heightFraction * 100).toString()},${crop.mature ? "1" : "0"}`) +
          (tree === null
            ? ""
            : `,r${tree.definitionId},${tree.visualStage},${Math.round(tree.growthProgress * 100).toString()},${String(tree.rotation ?? 0)}`)
      );
    }
    return parts.join(";");
  }

  function applyState(next: FarmSceneInput): void {
    state = next;
    const signature = signatureOf(next);
    const dynamicSignature = dynamicSignatureOf(next);
    /**
     * Whether this state describes any world at all.
     *
     * A scene is created before it has been handed a farm, and the empty world it holds meanwhile has
     * no land, no centre and no extent. Framing it would point the camera at the coordinate origin
     * and clamping the zoom to a world seven metres across would quietly *shrink* the opening view -
     * so neither happens until there is something to look at.
     */
    const hasWorld = next.world.outer !== null;
    if (signature !== worldSignature) {
      worldSignature = signature;
      worldGroup.clear();
      groundMesh = buildTerrain(worldGroup, assets, next.world, next.layout);
      // The island's mass scenery - the forest, the scrub, the boulders - is *not* drawn here any
      // more. V13.3.1 made every one of those an ordinary world object, and they are drawn from their
      // rows by the construction layer, so drawing the generator's copy as well would put two trees
      // on every cell. Only the ambient detail (flowers, tufts of grass) still comes from the world
      // model, into the group the camera switches off when it pulls back.
      // A new static world means new scenery for the detail groups and the overlay to draw, so the
      // dynamic layer cannot be considered up to date.
      dynamicWorldSignature = "";
      worldExtent = Math.max(next.world.islandHalfWidthWorld, next.world.islandHalfDepthWorld, MIN_FRAMED_EXTENT);
      // The occluders are rebuilt with the rows (see `rebuildCameraBlockers`), so a newly framed world
      // starts from the geography and fills in as the constructions arrive.
      rebuildCameraBlockers();
      if (hasWorld && !cameraFramed) {
        // The very first world frames the island's middle. After that the camera is the player's:
        // buying land, or a model arriving, must never move where somebody is looking.
        cameraHomeX = options.initialCamera?.targetX ?? next.world.centerWorldX;
        cameraHomeZ = options.initialCamera?.targetZ ?? next.world.centerWorldZ;
        cameraRig.moveTargetTo(cameraHomeX, cameraHomeZ);
        cameraFramed = true;
      }
      // Fog is measured in camera-to-surface distance by Three.js, not by island identity. The near
      // edge stays crisp, while a neighbour at the edge of the archipelago loses contrast naturally;
      // no fixed opacity is assigned to an inactive island.
      scene.fog = new Fog(HORIZON_COLOR, worldExtent * 1.25, worldExtent * 3.4);
      sky.position.set(next.world.centerWorldX, 0, next.world.centerWorldZ);
      // The sun and its shadow box follow the island rather than sitting at the coordinate origin.
      sun.position.set(
        next.world.centerWorldX + SUN_OFFSET.x,
        SUN_OFFSET.y,
        next.world.centerWorldZ + SUN_OFFSET.z
      );
      sun.target.position.set(next.world.centerWorldX, 0, next.world.centerWorldZ);
      sun.target.updateMatrixWorld();
    }
    // How far the camera may pull back is a property of the island: the estate view has to reach all
    // of it, on an island of any size, and the range is derived from the island's own extent.
    if (hasWorld) {
      const range = zoomDistanceRangeFor(worldExtent);
      cameraRig.setDistanceRange(range.min, range.max);
    }

    // The dynamic layer: the farm's own land, its rows, its locked ring, and the selection. Skipped
    // entirely when the farm is exactly what was drawn last time - see `dynamicSignatureOf`.
    if (dynamicSignature === dynamicWorldSignature) return;
    dynamicWorldSignature = dynamicSignature;
    tileGroup.clear();
    cropGroup.clear();
    treeGroup.clear();
    overlayGroup.clear();
    detailGroup.clear();
    overlayDetailGroup.clear();
    buildScenery(
      detailGroup,
      assets,
      quality.detailScenery ? next.world.scenery.filter((entry) => entry.detail) : [],
      sceneryModel,
      false
    );
    buildLockedPlotOverlay(
      overlayGroup,
      assets,
      { ...next.world, lockedScenery: next.world.lockedScenery.filter((entry) => !entry.detail) },
      next.layout,
      sceneryModel
    );
    buildScenery(
      overlayDetailGroup,
      assets,
      quality.detailScenery ? next.world.lockedScenery.filter((entry) => entry.detail) : [],
      sceneryModel,
      false
    );
    pickTargets.clear();
    pickedInstances.clear();
    buildTileSlabs(state.tiles);
    rebuildInteractionGrid();

    for (const tile of state.tiles) {
      const coordinate = { x: tile.tileX, y: tile.tileY };

      const crop = tile.crop;
      const tree = tile.tree;
      if (tree !== null) {
        // A tree keeps its tile, so it is drawn in its own group and never as a crop. Selection maps
        // to the tile coordinate the authoritative tree row is looked up by, never to a mesh, a
        // display name, or an array index.
        // A tree the player planted is looked at from arm's length, so it draws the curated
        // broadleaf rather than anything cheap: one model for every planted tree, cached like the
        // rest, and the per-instance cost is a clone of a scene the world already loaded.
        // Wildwood is a player-owned forestry tree, so use the existing Wildwood asset. Static
        // environment tree_broad remains a world object and never enters this tree-instance path.
        const treeModelId = tree.phase === "DEPLETED" && tree.definitionId === "tree_wildwood"
          ? "resource_wildwood_stump"
          : tree.definitionId === "tree_wildwood" ? "resource_wildwood" : "tree_broad_3";
        const treePlantNode = treePlant(tile, assets, sceneryModel(treeModelId), tree);
        treeGroup.add(treePlantNode);
        pickTargets.set(treePlantNode, coordinate);
        // A production tree whose cycle is ready says so the same way a mature crop does: the same ring
        // and the same small spark, so "come back to this one" is one visual language across the farm
        // rather than two. Still one mark per ready tile, and none at all on a growing field.
        if (tree.ready) {
          const ring = new Mesh(assets.ring, assets.ready);
          ring.rotation.x = -Math.PI / 2;
          ring.position.set(tile.worldX, TILE_SURFACE_Y + 0.03, tile.worldZ);
          ring.scale.set(state.layout.tileSize * 0.46, state.layout.tileSize * 0.46, 1);
          treeGroup.add(ring);
          const spark = new Mesh(assets.octa, assets.ready);
          spark.rotation.y = Math.PI / 4;
          spark.position.set(tile.worldX, TILE_SURFACE_Y + 1.9, tile.worldZ);
          spark.scale.setScalar(0.13);
          treeGroup.add(spark);
        }
      }
      if (crop === null) continue;
      const height = Math.max(crop.heightFraction * CROP_MAX_HEIGHT, MIN_CROP_HEIGHT);
      const variants = modelVariants(crop.definitionId);
      const plant: Object3D =
        variants === undefined
          ? placeholderCrop(tile, crop.mature ? assets.cropMature : assets.cropGrowing, height)
          : modelPlant(tile, variants, crop.mature, height);
      cropGroup.add(plant);
      pickTargets.set(plant, coordinate);

      if (crop.mature) {
        const ring = new Mesh(assets.ring, assets.ready);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(tile.worldX, TILE_SURFACE_Y + 0.03, tile.worldZ);
        ring.scale.set(state.layout.tileSize * 0.42, state.layout.tileSize * 0.42, 1);
        cropGroup.add(ring);
        const spark = new Mesh(assets.octa, assets.ready);
        spark.rotation.y = Math.PI / 4;
        spark.position.set(tile.worldX, TILE_SURFACE_Y + height + 0.28, tile.worldZ);
        spark.scale.setScalar(0.13);
        cropGroup.add(spark);
      }
    }

    updateMarkers();
    updateCamera();
    rebuildCellOverlay();
    // The work-area editor draws on the same ground, so both its lattice and its marks move with it.
    if (workAreaGridGeometry !== null) rebuildWorkAreaGrid();
    rebuildWorkAreaMarks();
    // The ground under a preview changes with the world - a plot bought, a model arriving - so the
    // ghost is rebuilt with the layer it stands on rather than left where it was.
    rebuildPreview();
  }

  let hoveredCoordinate: TileCoordinate | null = null;

  /**
   * The build shop's intention, and everything drawn for it.
   *
   * `previewDisposers` holds the release of whatever the last rebuild allocated - cloned ghost
   * materials, the road preview's geometry - so replacing or cancelling a preview cannot leak them,
   * and so a cached world model is never disposed along with its ghost.
   */
  let placementPreview: PlacementPreview | null = null;
  let previewDisposers: (() => void)[] = [];
  let previewLoadToken = 0;

  /** What the player has built, and the last signature drawn, so a poll that changed nothing is free. */
  let constructions: readonly SceneConstruction[] = [];
  let resourceNodes: readonly SceneResourceNode[] = [];
  let fishingSpots: readonly SceneFishingSpot[] = [];
  let resourceNodeSignature: string | null = null;
  let constructionSignature = "";
  let constructionToken = 0;
  /** The built thing the player is editing, and whether a click may select one at all. */
  let selectedObjectId: string | null = null;
  let objectPickingEnabled = true;
  /** Where each drawn construction stands, so the marker can be placed without touching the scene. */
  const constructionSites = new Map<string, SceneConstruction>();
  /**
   * Draws the island's deposits.
   *
   * Each node is one clone of its own small model, placed on the terrain like any other world object.
   * A depleted node is drawn the same way at a third of the size, which reads as rubble and keeps the
   * spot legible; the *state* is the server's, so this only ever draws what it was told. Few enough
   * nodes that a signature gate and a rebuild per change is cheaper than any cleverness.
   */
  function rebuildResourceNodes(): void {
    // Resolve once for both the signature and the draw. A row may already be in the farm response
    // while its GLB is still in flight; readiness is therefore part of the presentation signature.
    // When the shared library announces the late model, pending -> ready invalidates this gate and
    // the node is added without another farm/resource response.
    const resolved = resourceNodes.map((node) => {
      const depleted = !node.available && node.depletedModelId !== null;
      const modelId = depleted ? node.depletedModelId : node.modelId;
      return { node, depleted, modelId, model: library.get(modelId) };
    });
    const signature = resourceNodeLayerSignature(
      resolved.map(({ node }) => node),
      (modelId) => resolved.some((entry) => entry.modelId === modelId && entry.model !== undefined)
    );
    if (signature === resourceNodeSignature) return;
    resourceNodeSignature = signature;
    resourceGroup.clear();
    for (const { node, depleted, model } of resolved) {
      // A tree names its stump; a rock has nothing better than a smaller rock, so it shrinks. The
      // marker remains drawable while the GLB is pending, so a late asset cannot make a valid node
      // disappear from the world or force the player to guess where to click.
      const plant = new Group();
      (plant.userData as Record<string, unknown>)[RESOURCE_NODE_ID_KEY] = node.id;
      const scale =
        RESOURCE_NODE_MODEL_SCALE * (node.available || depleted ? 1 : RESOURCE_NODE_DEPLETED_SCALE);
      plant.scale.setScalar(scale);
      plant.position.set(
        node.worldX,
        GROUND_SURFACE_Y + terrainHeightAt(node.worldX, node.worldZ, state.world.terrain),
        node.worldZ
      );
      const pieces = resourceClusterPieces(node);
      for (const piece of pieces) {
        const pieceRoot = model?.clone(true) ?? new Group();
        (pieceRoot.userData as Record<string, unknown>)[RESOURCE_NODE_ID_KEY] = node.id;
        const pieceTerrainY = terrainHeightAt(
          node.worldX + piece.offsetX,
          node.worldZ + piece.offsetZ,
          state.world.terrain
        );
        pieceRoot.position.set(
          piece.offsetX,
          pieceTerrainY - terrainHeightAt(node.worldX, node.worldZ, state.world.terrain),
          piece.offsetZ
        );
        pieceRoot.rotation.y = piece.rotationY;
        pieceRoot.scale.setScalar(piece.scale);
        pieceRoot.traverse((child) => {
          child.castShadow = node.available;
        });
        plant.add(pieceRoot);
      }
      // The small gold ring is the resource affordance: it distinguishes a harvestable node from
      // decorative world trees even when the Wildwood GLB is still arriving or is visually occluded.
      // It is a child of the tagged root, so it remains part of the same RESOURCE_NODE pick target.
      const resourceMarker = new Mesh(assets.ring, assets.ready);
      resourceMarker.rotation.x = -Math.PI / 2;
      resourceMarker.position.y = 0.025;
      resourceMarker.scale.setScalar(node.definitionId === "resource_ore" ? 0.82 : 0.34);
      resourceMarker.renderOrder = 2;
      resourceMarker.castShadow = false;
      resourceMarker.receiveShadow = false;
      plant.add(resourceMarker);
      resourceGroup.add(plant);
    }
  }

  function setFishingSpotMetadata(spots: readonly SceneFishingSpot[]): void {
    fishingSpots = spots;
  }

  const NEIGHBOR_DOCK_ID = "neighbor-dock";
  const NEIGHBOR_NPC_ID = "neighbor-npc";
  function tagNeighbor(object: Object3D, kind: "NEIGHBOR_DOCK" | "NEIGHBOR_NPC", id: string): void {
    (object.userData as Record<string, unknown>).neighborTarget = { kind, id };
  }
  function neighborTargetFromNode(node: Object3D): SceneWorldTarget | null {
    let current: Object3D | null = node;
    while (current !== null) {
      const value = (current.userData as Record<string, unknown>).neighborTarget;
      if (typeof value === "object" && value !== null) {
        const target = value as { kind?: string; id?: string };
        if ((target.kind === "NEIGHBOR_DOCK" || target.kind === "NEIGHBOR_NPC") && typeof target.id === "string") {
          return { kind: target.kind, id: target.id };
        }
      }
      current = current.parent;
    }
    return null;
  }
  function rebuildNeighborCollisionDebug(
    template: ReturnType<typeof neighborIslandTemplate>,
    center: { readonly x: number; readonly z: number }
  ): void {
    neighborCollisionDebugGroup.visible = islandDebugEnabled;
    if (!islandDebugEnabled) return;
    const segments: number[] = [];
    const addSegment = (ax: number, az: number, bx: number, bz: number, y: number): void => {
      segments.push(ax, y, az, bx, y, bz);
    };
    const boundarySamples = 96;
    for (let index = 0; index < boundarySamples; index += 1) {
      const angle = index / boundarySamples * Math.PI * 2;
      const nextAngle = (index + 1) / boundarySamples * Math.PI * 2;
      const start = neighborWorldPoint(template, center, angle, 1);
      const end = neighborWorldPoint(template, center, nextAngle, 1);
      addSegment(start.x, start.z, end.x, end.z, GROUND_SURFACE_Y + 0.34);
    }
    for (const channel of template.waterChannels) {
      const cosine = Math.cos(channel.rotation);
      const sine = Math.sin(channel.rotation);
      const edge: { x: number; z: number }[] = [];
      for (let index = 0; index < 32; index += 1) {
        const angle = index / 32 * Math.PI * 2;
        const along = Math.cos(angle) * channel.length;
        const across = Math.sin(angle) * channel.width;
        edge.push({
          x: center.x + channel.x + along * cosine - across * sine,
          z: center.z + channel.z + along * sine + across * cosine
        });
      }
      for (let index = 0; index < edge.length; index += 1) {
        const start = edge[index];
        const end = edge[(index + 1) % edge.length];
        if (start === undefined || end === undefined) continue;
        addSegment(start.x, start.z, end.x, end.z, SEA_SURFACE_Y + 0.02);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(segments), 3));
    neighborCollisionDebugGeometries.push(geometry);
    neighborCollisionDebugGroup.add(new LineSegments(geometry, neighborCollisionDebugMaterial));
  }
  function rebuildNeighborIsland(): void {
    clearIslandDebugLabels(neighborGroup);
    neighborGroup.clear();
    for (const geometry of neighborGeometries) geometry.dispose();
    neighborGeometries.length = 0;
    neighborNpcNode = null;
    neighborNpcTool = null;
    neighborNpcPhase = null;
    neighborCollisionDebugGroup.clear();
    for (const geometry of neighborCollisionDebugGeometries) geometry.dispose();
    neighborCollisionDebugGeometries.length = 0;
    if (neighborIsland === null) {
      neighborGroup.visible = false;
      neighborCollisionDebugGroup.visible = false;
      return;
    }
    const { center } = neighborIsland;
    const template = neighborIslandTemplate(neighborIsland.slot ?? "MOC");
    const mocLayout = template.kind === "MOC" ? MOC_PREVIEW_LAYOUT : null;
    rebuildNeighborCollisionDebug(template, center);
    attachIslandDebugLabel(neighborGroup, {
      islandId: neighborIsland.islandId,
      templateId: template.kind,
      center,
      lod: "FULL"
    }, GROUND_SURFACE_Y + template.relief * 2 + 14);
    const addLoadedModel = (modelId: string, parent: Object3D, position: { readonly x: number; readonly y: number; readonly z: number }, scale: number, rotationY = 0): Object3D | null => {
      const source = library.get(modelId);
      if (source === undefined) {
        void library.load(modelId);
        return null;
      }
      const model = source.clone(true);
      model.position.set(position.x, position.y, position.z);
      model.scale.setScalar(scale);
      model.rotation.y = rotationY;
      model.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
      parent.add(model);
      return model;
    };
    // A broad render-only ocean prevents the custom island shell from ending in a hard blue ring.
    // It has no collision, pick target, terrain sample, or network/state representation.
    const oceanGeometry = new PlaneGeometry(720, 720, 1, 1);
    oceanGeometry.rotateX(-Math.PI / 2);
    const ocean = new Mesh(oceanGeometry, assets.waterDeep);
    ocean.position.set(center.x, SEA_SURFACE_Y, center.z);
    ocean.renderOrder = -2;
    neighborGeometries.push(oceanGeometry);
    neighborGroup.add(ocean);
    const waterGeometry = neighborTerrainGeometry(template, center, 1.20, GROUND_SURFACE_Y - 0.28, GROUND_SURFACE_Y - 0.5, 0);
    const water = new Mesh(waterGeometry, assets.waterDeep);
    neighborGeometries.push(waterGeometry);
    neighborGroup.add(water);
    const beachGeometry = neighborShoreRingGeometry(template, center, 1, 1.09, GROUND_SURFACE_Y + 0.01, GROUND_SURFACE_Y - 0.35);
    const beach = new Mesh(beachGeometry, assets.wetSand);
    neighborGeometries.push(beachGeometry);
    neighborGroup.add(beach);
    // Do not use terrainGrass here: it requires vertex colours, while this custom island geometry
    // intentionally uses analytic normals only. A vertex-colour material without a colour attribute
    // is the direct cause of the former black island surface.
    const landGeometry = neighborTerrainGeometry(template, center, 1, GROUND_SURFACE_Y + 0.18, GROUND_SURFACE_Y - 0.2, 1);
    const land = new Mesh(landGeometry, assets.meadow);
    neighborGeometries.push(landGeometry);
    neighborGroup.add(land);
    // The HOME ground remains in worldGroup while visiting; picking must follow the active island.
    groundMesh = land;
    // Profession terrain is part of the island, not a prop laid over a flat field. Ridges use a
    // shallow, faceted landform mesh; a stretched octahedron here reads as a paper triangle. Thủy's
    // channels sit in the cuts made by neighborGroundHeight so water never becomes a blue decal on
    // solid land.
    for (const ridge of template.ridgeLines) {
      const ridgeGeometry = neighborRidgeGeometry(
        ridge,
        1,
        template.kind === "KIM" ? 0.46 : 0.36,
        0
      );
      const ridgeNode = new Mesh(ridgeGeometry, assets.stone);
      ridgeNode.rotation.y = ridge.rotation;
      ridgeNode.position.set(
        center.x + ridge.x,
        GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, ridge.x, ridge.z),
        center.z + ridge.z
      );
      ridgeNode.castShadow = true;
      neighborGeometries.push(ridgeGeometry);
      neighborGroup.add(ridgeNode);
    }
    for (const channel of template.waterChannels) {
      const bankGeometry = neighborWaterBankGeometry(channel, center, 1, SEA_SURFACE_Y + 0.005);
      const bank = new Mesh(bankGeometry, assets.wetSand);
      neighborGeometries.push(bankGeometry);
      neighborGroup.add(bank);
      const channelGeometry = neighborWaterBodyGeometry(channel, center, 1, SEA_SURFACE_Y - 0.035);
      const channelWater = new Mesh(channelGeometry, assets.water);
      channelWater.renderOrder = 1;
      neighborGeometries.push(channelGeometry);
      neighborGroup.add(channelWater);
    }
    const localDock = mocLayout?.dock.land ?? template.dockLocal;
    const localNpc = template.npcLocal;
    const localHouse = mocPreviewPlacement("farmhouse") ?? template.houseLocal;
    const localStore = mocPreviewPlacement("storage-barn-t1") ?? template.storeLocal;
    const localWork = mocPreviewPlacement("workbench") ?? template.workLocal;
    const presentationDock = mocLayout === null ? { x: center.x + localDock.x, z: center.z + localDock.z } : mocPresentationDockWorld(center);
    const presentationNpc = { x: center.x + localNpc.x, z: center.z + localNpc.z };
    const path = new Mesh(assets.box, assets.dirt);
    path.scale.set(Math.hypot(localNpc.x - localDock.x, localNpc.z - localDock.z) * 0.5, 0.08, 0.9);
    path.position.set(
      (presentationDock.x + presentationNpc.x) / 2,
      GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, (presentationDock.x + presentationNpc.x) / 2 - center.x, (presentationDock.z + presentationNpc.z) / 2 - center.z),
      (presentationDock.z + presentationNpc.z) / 2
    );
    path.rotation.y = Math.atan2(presentationNpc.z - presentationDock.z, presentationNpc.x - presentationDock.x);
    if (template.kind !== "MOC") neighborGroup.add(path);
    const housePath = new Mesh(assets.box, assets.dirt);
    housePath.scale.set(Math.hypot(localHouse.x - localNpc.x, localHouse.z - localNpc.z) * 0.5, 0.06, 0.82);
    housePath.position.set(
      center.x + (localHouse.x + localNpc.x) / 2,
      GROUND_SURFACE_Y + 0.62 + neighborGroundHeight(template, (localHouse.x + localNpc.x) / 2, (localHouse.z + localNpc.z) / 2),
      center.z + (localHouse.z + localNpc.z) / 2
    );
    housePath.rotation.y = Math.atan2(localHouse.z - localNpc.z, localHouse.x - localNpc.x);
    if (template.kind !== "MOC") neighborGroup.add(housePath);
    const dockNode = new Group();
    const dockMesh = new Mesh(assets.box, assets.stakeWood);
    dockMesh.scale.set(3.2, 0.25, 1.2);
    dockMesh.position.y = 0.55;
    dockNode.add(dockMesh);
    const dockMark = new Mesh(assets.ring, assets.ready);
    dockMark.rotation.x = -Math.PI / 2; dockMark.position.y = 0.03; dockMark.scale.setScalar(1.35);
    dockNode.add(dockMark);
    if (mocLayout !== null) {
      const bridgeAngle = Math.atan2(mocLayout.dock.water.z - mocLayout.dock.land.z, mocLayout.dock.water.x - mocLayout.dock.land.x);
      const bridgeLength = Math.hypot(mocLayout.dock.water.x - mocLayout.dock.land.x, mocLayout.dock.water.z - mocLayout.dock.land.z);
      const bridge = new Mesh(assets.box, assets.stakeWood);
      bridge.scale.set(bridgeLength * 0.5, 0.18, 0.95);
      bridge.position.set(bridgeLength * 0.5, 0.08, 0);
      dockNode.add(bridge);
      // Keep the bridge's local +X axis aligned with the shoreline normal. The old code rotated
      // both the bridge and its parent, rotating the offset twice and pushing the bridge inland.
      dockNode.rotation.y = bridgeAngle;
      for (const fraction of [0.35, 0.72]) {
        const post = new Mesh(assets.cylinder, assets.stakeWood);
        post.scale.set(0.12, 0.46, 0.12);
        post.position.set(bridgeLength * fraction, -0.22, 0);
        dockNode.add(post);
      }
    }
    dockNode.position.set(presentationDock.x, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, localDock.x, localDock.z), presentationDock.z);
    tagNeighbor(dockNode, "NEIGHBOR_DOCK", NEIGHBOR_DOCK_ID);
    neighborGroup.add(dockNode);
    const constructionBuilt = neighborIsland.npcConstructionPhase === undefined || neighborIsland.npcConstructionPhase === "BUILT";
    const house = new Group();
    const walls = new Mesh(assets.box, assets.barnWall); walls.scale.set(3.2, 2.2, 2.8); walls.position.y = 1.45;
    const roof = new Mesh(assets.roof, assets.barnRoof); roof.scale.set(2.4, 1.3, 2.4); roof.position.y = 4.0;
    const facade = new Mesh(assets.box, assets.barnWall); facade.scale.set(2.7, 1.7, 0.35); facade.position.set(0, 1.55, 1.5);
    const door = new Mesh(assets.box, assets.stakeWood); door.scale.set(0.58, 1.1, 0.12); door.position.set(0, 1.1, 1.88);
    house.add(walls, roof, facade, door); house.position.set(center.x + localHouse.x, GROUND_SURFACE_Y + 0.45 + neighborGroundHeight(template, localHouse.x, localHouse.z), center.z + localHouse.z);
    const plot = new Mesh(assets.box, assets.bareEarth); plot.scale.set(4.8, 0.08, 3.0); plot.position.set(center.x + localHouse.x, GROUND_SURFACE_Y + 0.48 + neighborGroundHeight(template, localHouse.x, localHouse.z), center.z + localHouse.z); neighborGroup.add(plot);
    if (constructionBuilt) {
      const houseModel = addLoadedModel(template.kind === "MOC" ? "farm.barn.t2" : "farm.barn.t1", neighborGroup, { x: center.x + localHouse.x, y: GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, localHouse.x, localHouse.z), z: center.z + localHouse.z }, template.kind === "MOC" ? 6.4 : 4.9);
      // The primitive is a loading fallback only; once the authored building arrives it must not
      // double the silhouette and make the island look like two tiny houses on a lawn.
      if (houseModel === null) neighborGroup.add(house);
    } else {
      const foundation = new Mesh(assets.box, assets.stakeWood);
      foundation.scale.set(4.6, 0.18, 2.8);
      foundation.position.set(center.x + localHouse.x, GROUND_SURFACE_Y + 0.62 + neighborGroundHeight(template, localHouse.x, localHouse.z), center.z + localHouse.z);
      neighborGroup.add(foundation);
    }
    const treeSources = ["tree_broad_1", "tree_broad_2", "tree_broad_3", "tree_broad_4", "tree_pine_1", "tree_pine_2", "tree_pine_3"]
      .map((modelId) => {
        const source = library.get(modelId);
        if (source === undefined) void library.load(modelId);
        return source;
      })
      .filter((model): model is Object3D => model !== undefined);
    const treeSource = treeSources[0] ?? library.get("resource_wildwood") ?? sceneryModel("tree_broad_1");
    const forestLayout = template.kind === "MOC"
      ? mocPreviewForestPlacements().map((placement) => ({ ...placement, modelId: placement.modelId }))
      : neighborForestLayout(template, neighborIsland.seed ?? 0).map((tree) => ({ ...tree, modelId: undefined as string | undefined, rotationY: 0 }));
    for (const [index, tree] of forestLayout.entries()) {
      const authoredTreeSource = tree.modelId === undefined ? undefined : library.get(tree.modelId);
      if (tree.modelId !== undefined && authoredTreeSource === undefined) void library.load(tree.modelId);
      const selectedTreeSource = authoredTreeSource ?? (tree.modelId === undefined ? treeSources[index % Math.max(1, treeSources.length)] ?? treeSource : undefined);
      const treeNode = selectedTreeSource?.clone(true) ?? new Group();
      if (selectedTreeSource === undefined) {
        const trunk = new Mesh(assets.cylinder, assets.wood);
        trunk.scale.set(0.16 * tree.scale, 0.9 * tree.scale, 0.16 * tree.scale);
        trunk.position.y = 0.62;
        const canopy = new Mesh(assets.cone, assets.foliage);
        canopy.scale.set(0.9 * tree.scale, 1.8 * tree.scale, 0.9 * tree.scale);
        canopy.position.y = 1.87 * tree.scale;
        treeNode.add(trunk, canopy);
      }
      treeNode.scale.setScalar(selectedTreeSource === undefined ? 1 : mocTreeWorldScale(treeNode, tree.scale));
      treeNode.rotation.y = tree.rotationY;
      treeNode.position.set(center.x + tree.x, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, tree.x, tree.z), center.z + tree.z);
      treeNode.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
      neighborGroup.add(treeNode);
    }
    for (const ore of template.oreLocal) {
      const modelId = ore.kind === "IRON" ? "resource_iron" : ore.kind === "COPPER" ? "resource_copper" : "resource_stone";
      const model = addLoadedModel(modelId, neighborGroup, {
        x: center.x + ore.x,
        y: GROUND_SURFACE_Y + 0.22 + neighborGroundHeight(template, ore.x, ore.z),
        z: center.z + ore.z
      }, 1.45 * ore.scale);
      if (model === null) {
        const outcrop = new Mesh(assets.octa, assets.stone);
        outcrop.scale.set(ore.scale * 1.2, ore.scale * 1.8, ore.scale * 1.2);
        outcrop.position.set(center.x + ore.x, GROUND_SURFACE_Y + 0.45 + neighborGroundHeight(template, ore.x, ore.z), center.z + ore.z);
        neighborGroup.add(outcrop);
      }
    }
    for (const landmark of template.landmarks) {
      if (landmark.kind === "GROVE") {
        const grove = new Mesh(assets.torus, assets.forestFloor);
        grove.scale.set(4.2, 0.18, 3.2); grove.rotation.x = Math.PI / 2;
        grove.position.set(center.x + landmark.x, GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, landmark.x, landmark.z), center.z + landmark.z);
        neighborGroup.add(grove);
      } else if (landmark.kind === "LOOKOUT") {
        const lookout = new Mesh(assets.octa, assets.stone);
        lookout.scale.set(1.5, 0.8, 1.2);
        lookout.position.set(center.x + landmark.x, GROUND_SURFACE_Y + 0.5 + neighborGroundHeight(template, landmark.x, landmark.z), center.z + landmark.z);
        neighborGroup.add(lookout);
      } else {
        const marker = new Mesh(assets.box, assets.stone);
        marker.scale.set(1.3, 0.7, 0.9);
        marker.position.set(center.x + landmark.x, GROUND_SURFACE_Y + 0.45 + neighborGroundHeight(template, landmark.x, landmark.z), center.z + landmark.z);
        neighborGroup.add(marker);
      }
    }
    // A lived-in working yard: the dock path continues to a visible workplace and a small store.
    const work = template.kind === "MOC" ? { x: localWork.x, z: localWork.z } : template.workLocal;
    const workPath = new Mesh(assets.box, assets.dirt);
    workPath.scale.set(Math.hypot(work.x - localNpc.x, work.z - localNpc.z) * 0.5, 0.06, 0.72);
    workPath.position.set(
      center.x + (work.x + localNpc.x) / 2,
      GROUND_SURFACE_Y + 0.62 + neighborGroundHeight(template, (work.x + localNpc.x) / 2, (work.z + localNpc.z) / 2),
      center.z + (work.z + localNpc.z) / 2
    );
    workPath.rotation.y = Math.atan2(work.z - localNpc.z, work.x - localNpc.x);
    if (template.kind === "MOC") {
      const addMocPath = (start: { readonly x: number; readonly z: number }, end: { readonly x: number; readonly z: number }, width: number): void => {
        const segment = new Mesh(assets.box, assets.dirt);
        segment.scale.set(Math.hypot(end.x - start.x, end.z - start.z) * 0.5, 0.055, width);
        segment.position.set(
          center.x + (start.x + end.x) * 0.5,
          GROUND_SURFACE_Y + 0.61 + neighborGroundHeight(template, (start.x + end.x) * 0.5, (start.z + end.z) * 0.5),
          center.z + (start.z + end.z) * 0.5
        );
        segment.rotation.y = Math.atan2(end.z - start.z, end.x - start.x);
        neighborGroup.add(segment);
      };
      for (const route of MOC_PREVIEW_LAYOUT.routes) {
        for (let index = 1; index < route.points.length; index += 1) {
          const start = route.points[index - 1];
          const end = route.points[index];
          if (start !== undefined && end !== undefined) addMocPath(start, end, 0.82);
        }
      }
    }
    if (template.kind !== "MOC") neighborGroup.add(workPath);
    const workPad = new Mesh(assets.cylinder, assets.bareEarth);
    workPad.scale.set(3.4, 0.08, 2.4); workPad.rotation.x = 0; workPad.position.set(center.x + work.x, GROUND_SURFACE_Y + 0.61 + neighborGroundHeight(template, work.x, work.z), center.z + work.z);
    neighborGroup.add(workPad);
    const woodYardPlacement = template.kind === "MOC" ? mocPreviewPlacement("woodYard") : undefined;
    const woodYardCenter = woodYardPlacement === undefined ? { x: work.x + 3.1, z: work.z + 0.4 } : { x: woodYardPlacement.x, z: woodYardPlacement.z };
    const woodYard = new Mesh(assets.box, assets.bareEarth);
    woodYard.scale.set(5.2, 0.08, 3.6);
    woodYard.position.set(center.x + woodYardCenter.x, GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, woodYardCenter.x, woodYardCenter.z), center.z + woodYardCenter.z);
    neighborGroup.add(woodYard);
    const store = new Group();
    const storeBody = new Mesh(assets.box, assets.barnWall); storeBody.scale.set(2.6, 1.65, 2.2); storeBody.position.y = 1.2;
    const storeRoof = new Mesh(assets.roof, assets.barnRoof); storeRoof.scale.set(2.0, 1.0, 2.0); storeRoof.position.y = 3.0;
    store.add(storeBody, storeRoof); store.position.set(center.x + localStore.x, GROUND_SURFACE_Y + 0.45 + neighborGroundHeight(template, localStore.x, localStore.z), center.z + localStore.z);
    if (constructionBuilt) {
      const storeModel = addLoadedModel(template.kind === "KIM" ? "farm.silo_house.t2" : "farm.barn.t1", neighborGroup, { x: center.x + localStore.x, y: GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, localStore.x, localStore.z), z: center.z + localStore.z }, template.kind === "KIM" ? 5.6 : 3.7);
      if (storeModel === null) neighborGroup.add(store);
    } else {
      const storePad = new Mesh(assets.box, assets.bareEarth);
      storePad.scale.set(2.8, 0.08, 2.2);
      storePad.position.set(center.x + localStore.x, GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, localStore.x, localStore.z), center.z + localStore.z);
      neighborGroup.add(storePad);
    }
    const storePath = new Mesh(assets.box, assets.dirt);
    storePath.scale.set(Math.hypot(localStore.x - localNpc.x, localStore.z - localNpc.z) * 0.5, 0.06, 0.7);
    storePath.position.set(center.x + (localStore.x + localNpc.x) / 2, GROUND_SURFACE_Y + 0.62 + neighborGroundHeight(template, (localStore.x + localNpc.x) / 2, (localStore.z + localNpc.z) / 2), center.z + (localStore.z + localNpc.z) / 2);
    storePath.rotation.y = Math.atan2(localStore.z - localNpc.z, localStore.x - localNpc.x);
    if (template.kind !== "MOC") neighborGroup.add(storePath);
    if (template.kind === "THUY") {
      const pondAccessStarts = [work, localStore, localHouse];
      for (const [index, pond] of template.waterChannels.entries()) {
        const start = pondAccessStarts[index] ?? localStore;
        const end = { x: pond.x, z: pond.z - pond.length * 0.92 };
        const servicePath = new Mesh(assets.box, assets.dirt);
        servicePath.scale.set(Math.hypot(end.x - start.x, end.z - start.z) * 0.5, 0.045, 0.52);
        servicePath.position.set(
          center.x + (start.x + end.x) / 2,
          GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, (start.x + end.x) / 2, (start.z + end.z) / 2),
          center.z + (start.z + end.z) / 2
        );
        servicePath.rotation.y = Math.atan2(end.z - start.z, end.x - start.x);
        neighborGroup.add(servicePath);
      }
    }
    if (template.kind === "MOC") {
      for (const placement of MOC_PREVIEW_LAYOUT.placements) {
        if (placement.group === "FOREST_BACK" || placement.group === "FOREST_LEFT" || placement.group === "FOREST_RIGHT" || placement.id === "storage-barn-t1" || placement.group === "DOCK" || placement.modelId.startsWith("__procedural:")) continue;
        addLoadedModel(placement.modelId, neighborGroup, {
          x: center.x + placement.x,
          y: GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, placement.x, placement.z),
          z: center.z + placement.z
        }, placement.scale, placement.rotationY);
      }
    } else {
      addLoadedModel("prop_workbench", neighborGroup, { x: center.x + work.x, y: GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, work.x, work.z), z: center.z + work.z }, 1.25);
      addLoadedModel("prop_anvil_log", neighborGroup, { x: center.x + work.x + 1.1, y: GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, work.x, work.z), z: center.z + work.z + 0.4 }, 1.05);
      addLoadedModel("prop_crate_wooden", neighborGroup, { x: center.x + work.x - 1.1, y: GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, work.x, work.z), z: center.z + work.z - 0.45 }, 1.15);
      for (const prop of template.presentationProps) {
        addLoadedModel(prop.id, neighborGroup, {
          x: center.x + prop.x,
          y: GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, prop.x, prop.z),
          z: center.z + prop.z
        }, prop.scale);
      }
    }
    const logStack = new Group();
    for (let index = 0; index < 4; index += 1) {
      const log = new Mesh(assets.cylinder, assets.wood);
      log.rotation.z = Math.PI / 2;
      log.scale.set(0.34, 1.35, 0.34);
      log.position.set(center.x + work.x + 4.4 + (index % 2) * 0.72, GROUND_SURFACE_Y + 0.9 + neighborGroundHeight(template, work.x + 4.4 + (index % 2) * 0.72, work.z + 0.3) + Math.floor(index / 2) * 0.48, center.z + work.z + 0.3);
      logStack.add(log);
    }
    neighborGroup.add(logStack);
    for (const [detailIndex, detail] of template.supportLocal.entries()) {
      if (template.kind === "MOC" && detail.kind === "TREE") continue;
      const y = GROUND_SURFACE_Y + 0.5 + neighborGroundHeight(template, detail.x, detail.z);
      if (detail.kind === "ROCK") {
        const rockModelId = `rock_boulder_${String((detailIndex % 3) + 1)}`;
        const rockModel = addLoadedModel(rockModelId, neighborGroup, { x: center.x + detail.x, y, z: center.z + detail.z }, 1.35 * detail.scale);
        if (rockModel === null) {
          const rock = new Mesh(assets.octa, assets.stone); rock.scale.setScalar(detail.scale); rock.position.set(center.x + detail.x, y, center.z + detail.z); neighborGroup.add(rock);
        }
      } else if (detail.kind === "WATER" && template.terrainKind !== "COAST") {
        const pool = new Mesh(assets.cylinder, assets.water); pool.scale.set(detail.scale * 1.7, 0.04, detail.scale); pool.position.set(center.x + detail.x, y - 0.2, center.z + detail.z); neighborGroup.add(pool);
      } else if (detail.kind === "WATER") {
        // Coast channels are drawn from template.waterChannels; support water never becomes a
        // central decorative pool on Thủy.
      } else if (detail.kind === "BUSH") {
        const bushModelId = detailIndex % 2 === 0 ? "bush_leafy" : "bush_flowering";
        const bushSource = library.get(bushModelId);
        if (bushSource === undefined) void library.load(bushModelId);
        if (bushSource !== undefined) {
          const bush = bushSource.clone(true);
          bush.scale.setScalar(1.7 * detail.scale);
          bush.position.set(center.x + detail.x, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, detail.x, detail.z), center.z + detail.z);
          bush.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
          neighborGroup.add(bush);
        } else {
          const bush = new Mesh(assets.cone, assets.foliage);
          bush.scale.set(0.85 * detail.scale, 0.65 * detail.scale, 0.85 * detail.scale);
          bush.position.set(center.x + detail.x, y + 0.35 * detail.scale, center.z + detail.z);
          neighborGroup.add(bush);
        }
      } else {
        const source = treeSources[detailIndex % Math.max(1, treeSources.length)] ?? treeSource ?? sceneryModel("tree_broad_1");
        if (source !== undefined) {
          const treeNode = source.clone(true);
          treeNode.scale.setScalar((template.kind === "MOC" ? 3.8 : 3.15) * detail.scale);
          treeNode.position.set(center.x + detail.x, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, detail.x, detail.z), center.z + detail.z);
          treeNode.traverse((child) => { child.castShadow = true; child.receiveShadow = true; });
          neighborGroup.add(treeNode);
          continue;
        }
        const trunk = new Mesh(assets.cylinder, assets.wood); trunk.scale.set(0.18 * detail.scale, 1.0 * detail.scale, 0.18 * detail.scale); trunk.position.set(center.x + detail.x, y + 0.55 * detail.scale, center.z + detail.z);
        const crown = new Mesh(assets.cone, assets.foliage); crown.scale.set(0.95 * detail.scale, 1.9 * detail.scale, 0.95 * detail.scale); crown.position.set(center.x + detail.x, trunk.position.y + 1.15 * detail.scale, center.z + detail.z); neighborGroup.add(trunk, crown);
      }
    }
    const npcNode = new Group();
    const body = new Mesh(assets.cylinder, assets.playerBody); body.scale.set(0.28, 0.75, 0.28); body.position.y = 0.75;
    const head = new Mesh(assets.sphere, assets.playerSkin); head.scale.setScalar(0.27); head.position.y = 1.45;
    const marker = new Mesh(assets.ring, assets.selection); marker.rotation.x = -Math.PI / 2; marker.scale.setScalar(0.55); marker.position.y = 0.03;
    if (addLoadedModel("character.player_farmer", npcNode, { x: 0, y: 0, z: 0 }, 1.05) === null) npcNode.add(body, head, marker);
    const tool = addLoadedModel("prop_axe", npcNode, { x: 0.42, y: 0.9, z: 0.16 }, 1.15);
    if (tool !== null) neighborNpcTool = tool;
    else {
      const fallbackTool = new Group();
      const handle = new Mesh(assets.cylinder, assets.wood);
      handle.scale.set(0.07, 0.62, 0.07); handle.position.y = 0.35;
      const blade = new Mesh(assets.box, assets.stone);
      blade.scale.set(0.22, 0.18, 0.06); blade.position.set(0.12, 0.68, 0);
      fallbackTool.add(handle, blade); fallbackTool.position.set(0.42, 0.2, 0.16);
      neighborNpcTool = fallbackTool; npcNode.add(fallbackTool);
    }
    neighborNpcNode = npcNode;
    updateNeighborNpcPose(Date.now());
    tagNeighbor(npcNode, "NEIGHBOR_NPC", NEIGHBOR_NPC_ID); neighborGroup.add(npcNode);
    neighborGroup.visible = true;
  }

  /** HOME-only low-detail preview: presentation only, never a walkable or selectable island. */
  function rebuildNeighborIslandPreviews(): void {
    clearIslandDebugLabels(neighborPreviewGroup);
    neighborPreviewGroup.clear();
    neighborPreviewDetailRoots.clear();
    for (const geometry of neighborPreviewGeometries) geometry.dispose();
    neighborPreviewGeometries.length = 0;
    neighborPreviewGroup.visible = neighborPreviews.length > 0;
    if (!neighborPreviewGroup.visible) return;

    const previewScale = NEIGHBOR_PREVIEW_WATER_SCALE;
    const addPreviewModel = (
      parent: Group,
      modelId: string,
      center: { readonly x: number; readonly z: number },
      localX: number,
      localZ: number,
      scale: number,
      y = GROUND_SURFACE_Y + 0.2,
      rotationY = 0
    ): boolean => {
      const source = library.get(modelId);
      if (source === undefined) {
        void library.load(modelId);
        return false;
      }
      const model = source.clone(true);
      model.position.set(center.x + localX * previewScale, y, center.z + localZ * previewScale);
      model.scale.setScalar((modelId.startsWith("tree_") ? mocTreeWorldScale(model, scale) : scale) * previewScale);
      model.rotation.y = rotationY;
      model.traverse((child) => { child.castShadow = false; child.receiveShadow = true; });
      parent.add(model);
      return true;
    };

    const addPreviewTree = (
      parent: Group,
      center: { readonly x: number; readonly z: number },
      localX: number,
      localZ: number,
      scale: number,
      modelId = "tree_broad_2",
      groundY = GROUND_SURFACE_Y + 0.18,
      rotationY = 0
    ): void => {
      // Use the same measured model envelope as the active scene. The placement scale is seeded per
      // tree, so mature canopies vary while remaining visibly taller than the player.
      if (addPreviewModel(parent, modelId, center, localX, localZ, scale, groundY, rotationY)) return;
      const trunk = new Mesh(assets.cylinder, assets.wood);
      trunk.scale.set(0.1 * scale * previewScale, 0.5 * scale * previewScale, 0.1 * scale * previewScale);
      trunk.position.set(center.x + localX * previewScale, groundY + 0.52 * scale * previewScale, center.z + localZ * previewScale);
      const crown = new Mesh(assets.cone, assets.foliage);
      crown.scale.set(0.55 * scale * previewScale, 1.0 * scale * previewScale, 0.55 * scale * previewScale);
      crown.position.set(center.x + localX * previewScale, groundY + 1.2 * scale * previewScale, center.z + localZ * previewScale);
      parent.add(trunk, crown);
    };

    for (const preview of neighborPreviews) {
      const root = new Group();
      const details = new Group();
      root.add(details);
      neighborPreviewGroup.add(root);
      if (preview.slot === "HOME") {
        const waterGeometry = homeIslandLodGeometry(preview.center, previewScale * 1.14, GROUND_SURFACE_Y - 0.28, GROUND_SURFACE_Y - 0.5, () => 0);
        const water = new Mesh(waterGeometry, assets.waterDeep);
        const landGeometry = homeIslandLodGeometry(preview.center, previewScale, GROUND_SURFACE_Y + 0.18, GROUND_SURFACE_Y - 0.2, (x, z) => terrainHeightAt(x, z, state.world.terrain));
        const land = new Mesh(landGeometry, assets.meadow);
        neighborPreviewGeometries.push(waterGeometry, landGeometry);
        root.add(water, land);
        // HOME uses its actual authored landmark layout and building builders, transformed into the
        // same preview frame. This keeps the distant silhouette recognisable without rendering crops,
        // actors or player-owned detail.
        for (const landmark of LANDMARKS_WORLD) {
          const node = buildLandmarkNode(assets, landmark.kind, null, buildingModel);
          if (node === null) continue;
          node.position.set(
            preview.center.x + (landmark.worldX - WORLD_CENTER_WORLD.worldX) * previewScale,
            GROUND_SURFACE_Y + terrainHeightAt(landmark.worldX, landmark.worldZ, state.world.terrain) * previewScale,
            preview.center.z + (landmark.worldZ - WORLD_CENTER_WORLD.worldZ) * previewScale
          );
          node.rotation.y = landmark.rotationY;
          node.scale.multiplyScalar(previewScale);
          root.add(node);
        }
        for (const woodland of WOODLANDS) {
          for (let index = 0; index < 8; index += 1) {
            const angle = (index / 8) * Math.PI * 2 + woodland.rotationY;
            const localX = woodland.center.x - WORLD_CENTER_WORLD.worldX + Math.cos(angle) * woodland.radiusX * 0.72;
            const localZ = woodland.center.y - WORLD_CENTER_WORLD.worldZ + Math.sin(angle) * woodland.radiusY * 0.72;
            addPreviewTree(
              details,
              preview.center,
              localX,
              localZ,
              0.8 + (index % 3) * 0.1,
              index % 2 === 0 ? "tree_broad_3" : "tree_pine_2",
              GROUND_SURFACE_Y + terrainHeightAt(
                WORLD_CENTER_WORLD.worldX + localX,
                WORLD_CENTER_WORLD.worldZ + localZ,
                state.world.terrain
              ) * previewScale
            );
          }
        }
        neighborPreviewDetailRoots.set(root, { center: preview.center, radius: ISLAND_HALF_WIDTH_WORLD * previewScale, details, rootVisible: true, detailsVisible: true });
        attachIslandDebugLabel(root, { islandId: preview.islandId, templateId: "HOME_WORLD_V5", center: preview.center, lod: "LOD" }, GROUND_SURFACE_Y + 12);
        continue;
      }
      const template = neighborIslandTemplate(preview.slot);
      const center = preview.center;
      const mocLayout = template.kind === "MOC" ? MOC_PREVIEW_LAYOUT : null;
      const localHouse = mocPreviewPlacement("farmhouse") ?? template.houseLocal;
      const localStore = mocPreviewPlacement("storage-barn-t1") ?? template.storeLocal;
      const waterGeometry = neighborTerrainGeometry(template, center, previewScale * 1.12, GROUND_SURFACE_Y - 0.28, GROUND_SURFACE_Y - 0.5, 0);
      const water = new Mesh(waterGeometry, assets.waterDeep);
      neighborPreviewGeometries.push(waterGeometry);
      root.add(water);

      const beachGeometry = neighborShoreRingGeometry(template, center, previewScale * 0.94, previewScale * 1.08, GROUND_SURFACE_Y + 0.01, GROUND_SURFACE_Y - 0.35);
      const beach = new Mesh(beachGeometry, assets.wetSand);
      neighborPreviewGeometries.push(beachGeometry);
      root.add(beach);

      const landGeometry = neighborTerrainGeometry(template, center, previewScale, GROUND_SURFACE_Y + 0.18, GROUND_SURFACE_Y - 0.2, previewScale);
      const land = new Mesh(landGeometry, assets.meadow);
      neighborPreviewGeometries.push(landGeometry);
      root.add(land);

      for (const ridge of template.ridgeLines) {
        const ridgeGeometry = neighborRidgeGeometry(ridge, previewScale, previewScale * 0.46, 0);
        const ridgeNode = new Mesh(ridgeGeometry, assets.stone);
        ridgeNode.rotation.y = ridge.rotation;
        ridgeNode.position.set(
          center.x + ridge.x * previewScale,
          GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, ridge.x, ridge.z) * previewScale,
          center.z + ridge.z * previewScale
        );
        root.add(ridgeNode);
        neighborPreviewGeometries.push(ridgeGeometry);
      }
      for (const channel of template.waterChannels) {
        const bankGeometry = neighborWaterBankGeometry(channel, center, previewScale, SEA_SURFACE_Y + 0.005);
        const bank = new Mesh(bankGeometry, assets.wetSand);
        root.add(bank);
        neighborPreviewGeometries.push(bankGeometry);
        const channelGeometry = neighborWaterBodyGeometry(channel, center, previewScale, SEA_SURFACE_Y - 0.04);
        const channelWater = new Mesh(channelGeometry, assets.water);
        root.add(channelWater);
        neighborPreviewGeometries.push(channelGeometry);
      }

      const addPreviewPath = (start: { readonly x: number; readonly z: number }, end: { readonly x: number; readonly z: number }, width: number): void => {
        const path = new Mesh(assets.box, assets.dirt);
        path.scale.set(Math.hypot(end.x - start.x, end.z - start.z) * 0.5 * previewScale, 0.045 * previewScale, width * previewScale);
        path.position.set(
          center.x + (start.x + end.x) * 0.5 * previewScale,
          GROUND_SURFACE_Y + 0.58 + neighborGroundHeight(template, (start.x + end.x) / 2, (start.z + end.z) / 2) * previewScale,
          center.z + (start.z + end.z) * 0.5 * previewScale
        );
        path.rotation.y = Math.atan2(end.z - start.z, end.x - start.x);
        root.add(path);
      };
      if (mocLayout !== null) {
        for (const route of mocLayout.routes) {
          for (let index = 1; index < route.points.length; index += 1) {
            const start = route.points[index - 1];
            const end = route.points[index];
            if (start !== undefined && end !== undefined) addPreviewPath(start, end, 0.82);
          }
        }
        const dockNode = new Mesh(assets.box, assets.stakeWood);
        dockNode.scale.set(3.2 * previewScale, 0.2 * previewScale, 1.1 * previewScale);
        dockNode.position.set(center.x + mocLayout.dock.land.x * previewScale, GROUND_SURFACE_Y + 0.44, center.z + mocLayout.dock.land.z * previewScale);
        dockNode.rotation.y = Math.atan2(mocLayout.dock.water.z - mocLayout.dock.land.z, mocLayout.dock.water.x - mocLayout.dock.land.x);
        root.add(dockNode);
        const bridge = new Mesh(assets.box, assets.stakeWood);
        bridge.scale.set(Math.hypot(mocLayout.dock.water.x - mocLayout.dock.land.x, mocLayout.dock.water.z - mocLayout.dock.land.z) * 0.5 * previewScale, 0.12 * previewScale, 0.8 * previewScale);
        bridge.position.set(
          center.x + (mocLayout.dock.land.x + mocLayout.dock.water.x) * 0.5 * previewScale,
          GROUND_SURFACE_Y + 0.3,
          center.z + (mocLayout.dock.land.z + mocLayout.dock.water.z) * 0.5 * previewScale
        );
        bridge.rotation.y = dockNode.rotation.y;
        root.add(bridge);
        for (const fraction of [0.35, 0.72]) {
          const post = new Mesh(assets.cylinder, assets.stakeWood);
          post.scale.set(0.08 * previewScale, 0.32 * previewScale, 0.08 * previewScale);
          post.position.set(
            center.x + (mocLayout.dock.land.x + (mocLayout.dock.water.x - mocLayout.dock.land.x) * fraction) * previewScale,
            GROUND_SURFACE_Y - 0.02,
            center.z + (mocLayout.dock.land.z + (mocLayout.dock.water.z - mocLayout.dock.land.z) * fraction) * previewScale
          );
          root.add(post);
        }
      } else {
        addPreviewPath(template.dockLocal, template.npcLocal, 0.9);
        addPreviewPath(template.npcLocal, localHouse, 0.82);
        addPreviewPath(template.npcLocal, template.workLocal, 0.72);
        addPreviewPath(template.npcLocal, localStore, 0.7);
      }
      if (template.kind === "THUY") {
        const pondAccessStarts = [template.workLocal, localStore, localHouse];
        for (const [index, pond] of template.waterChannels.entries()) {
          const start = pondAccessStarts[index] ?? localStore;
          addPreviewPath(start, { x: pond.x, z: pond.z - pond.length * 0.92 }, 0.52);
        }
      }

      // These details come from the same authored support and forest layout as the full island.
      for (const detail of template.supportLocal.filter((item) => item.kind !== "WATER" && (template.kind !== "MOC" || item.kind !== "TREE"))) {
        const localX = detail.x;
        const localZ = detail.z;
        const y = GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, localX, localZ) * previewScale;
        if (detail.kind === "ROCK") {
          const rockModelId = `rock_boulder_${String((template.supportLocal.indexOf(detail) % 3) + 1)}`;
          if (!addPreviewModel(details, rockModelId, center, localX, localZ, 1.35 * detail.scale, y)) {
            const rock = new Mesh(assets.octa, assets.stone);
            rock.scale.set(0.75 * detail.scale * previewScale, 1.35 * detail.scale * previewScale, 0.75 * detail.scale * previewScale);
            rock.position.set(center.x + localX * previewScale, y, center.z + localZ * previewScale);
            details.add(rock);
          }
        } else if (detail.kind === "BUSH") {
          const bushModelId = template.supportLocal.indexOf(detail) % 2 === 0 ? "bush_leafy" : "bush_flowering";
          if (!addPreviewModel(details, bushModelId, center, localX, localZ, 1.7 * detail.scale, y)) {
            const bush = new Mesh(assets.cone, assets.foliage);
            bush.scale.set(0.45 * detail.scale, 0.36 * detail.scale, 0.45 * detail.scale);
            bush.position.set(center.x + localX * previewScale, y + 0.42 * detail.scale * previewScale, center.z + localZ * previewScale);
            details.add(bush);
          }
        } else {
          addPreviewTree(details, center, localX, localZ, detail.scale, "tree_broad_2", y);
        }
      }
      const forestLayout = template.kind === "MOC"
        ? mocPreviewForestPlacements()
        : neighborForestLayout(template, preview.seed ?? 0).map((tree, index) => ({ ...tree, modelId: index % 3 === 0 ? "tree_pine_2" : "tree_broad_2", rotationY: 0 }));
      for (const tree of forestLayout) {
        addPreviewTree(details, center, tree.x, tree.z, tree.scale, tree.modelId, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, tree.x, tree.z) * previewScale, tree.rotationY);
      }
      for (const ore of template.oreLocal) {
        const outcrop = new Mesh(assets.octa, assets.stone);
        outcrop.scale.set(0.55 * ore.scale * previewScale, 0.9 * ore.scale * previewScale, 0.55 * ore.scale * previewScale);
        outcrop.position.set(center.x + ore.x * previewScale, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, ore.x, ore.z) * previewScale, center.z + ore.z * previewScale);
        details.add(outcrop);
      }
      if (mocLayout !== null) {
        for (const placement of mocLayout.placements) {
          if (placement.group === "FOREST_BACK" || placement.group === "FOREST_LEFT" || placement.group === "FOREST_RIGHT" || placement.id === "storage-barn-t1" || placement.group === "DOCK" || placement.modelId.startsWith("__procedural:")) continue;
          addPreviewModel(details, placement.modelId, center, placement.x, placement.z, placement.scale, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, placement.x, placement.z) * previewScale, placement.rotationY);
        }
      } else {
        for (const prop of template.presentationProps) {
          addPreviewModel(
            details,
            prop.id,
            center,
            prop.x,
            prop.z,
            prop.scale,
            GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, prop.x, prop.z) * previewScale
          );
        }
      }
      for (const landmark of template.landmarks) {
        if (landmark.kind === "GROVE") {
          for (let index = 0; index < 5; index += 1) {
            const treeX = landmark.x + (index - 2) * 2.2;
            const treeZ = landmark.z + (index % 2) * 1.7;
            addPreviewTree(details, center, treeX, treeZ, 0.9, "tree_broad_3", GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, treeX, treeZ) * previewScale);
          }
        } else if (landmark.kind === "LOOKOUT") {
          const lookout = new Mesh(assets.octa, assets.stone);
          lookout.scale.set(1.8 * previewScale, 3.0 * previewScale, 1.8 * previewScale);
          lookout.position.set(center.x + landmark.x * previewScale, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, landmark.x, landmark.z) * previewScale + 1.5 * previewScale, center.z + landmark.z * previewScale);
          root.add(lookout);
        } else {
          const stone = new Mesh(assets.octa, assets.stone);
          stone.scale.set(1.4 * previewScale, 1.1 * previewScale, 1.4 * previewScale);
          stone.position.set(center.x + landmark.x * previewScale, GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, landmark.x, landmark.z) * previewScale + 0.55 * previewScale, center.z + landmark.z * previewScale);
          root.add(stone);
        }
      }
      const buildingId = preview.slot === "MOC" ? "farm.barn.t2" : preview.slot === "KIM" ? "farm.silo_house.t2" : "farm.openbarn.t1";
      const houseY = GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, localHouse.x, localHouse.z) * previewScale;
      if (!addPreviewModel(root, buildingId, center, localHouse.x, localHouse.z, preview.slot === "MOC" ? 6.4 : 5.4, houseY)) {
        const silhouetteHouse = new Group();
        const silhouetteBody = new Mesh(assets.box, assets.barnWall);
        silhouetteBody.scale.set(1.5 * previewScale, 1.0 * previewScale, 1.2 * previewScale); silhouetteBody.position.y = 0.65 * previewScale;
        const silhouetteRoof = new Mesh(assets.roof, assets.barnRoof);
        silhouetteRoof.scale.set(1.2 * previewScale, 0.6 * previewScale, 1.1 * previewScale); silhouetteRoof.position.y = 1.55 * previewScale;
        silhouetteHouse.add(silhouetteBody, silhouetteRoof);
        silhouetteHouse.position.set(center.x + localHouse.x * previewScale, houseY, center.z + localHouse.z * previewScale);
        root.add(silhouetteHouse);
      }
      const storeId = preview.slot === "KIM" ? "farm.silo_house.t2" : "farm.barn.t1";
      const storeY = GROUND_SURFACE_Y + 0.18 + neighborGroundHeight(template, localStore.x, localStore.z) * previewScale;
      if (!addPreviewModel(root, storeId, center, localStore.x, localStore.z, preview.slot === "KIM" ? 4.3 : 3.4, storeY)) {
        const storeSilhouette = new Group();
        const storeBody = new Mesh(assets.box, assets.barnWall);
        storeBody.scale.set(0.92 * previewScale, 0.68 * previewScale, 0.82 * previewScale);
        storeBody.position.y = 0.5 * previewScale;
        const storeRoof = new Mesh(assets.roof, assets.barnRoof);
        storeRoof.scale.set(0.8 * previewScale, 0.42 * previewScale, 0.78 * previewScale);
        storeRoof.position.y = 1.1 * previewScale;
        storeSilhouette.add(storeBody, storeRoof);
        storeSilhouette.position.set(center.x + localStore.x * previewScale, storeY, center.z + localStore.z * previewScale);
        root.add(storeSilhouette);
      }
      neighborPreviewDetailRoots.set(root, { center, radius: template.radiusX * previewScale, details, rootVisible: true, detailsVisible: true });
      attachIslandDebugLabel(root, { islandId: preview.islandId, templateId: template.kind, center, lod: "LOD" }, GROUND_SURFACE_Y + template.relief * 1.2 + 10);
    }
    updateNeighborPreviewLod();
  }

  /** Client-only projection of the server schedule; it never writes phase, stock or rewards. */
  function updateNeighborNpcPose(nowMs: number): void {
    if (neighborIsland === null || neighborNpcNode === null) return;
    const template = neighborIslandTemplate(neighborIsland.slot ?? "MOC");
    const center = neighborIsland.center;
    const home = { x: neighborIsland.npc.x - center.x, z: neighborIsland.npc.z - center.z };
    const workPlacement = mocPreviewPlacement("workbench");
    const storePlacement = mocPreviewPlacement("storage-barn-t1");
    const work = template.kind === "MOC" && workPlacement !== undefined ? { x: workPlacement.x, z: workPlacement.z } : template.workLocal;
    const store = template.kind === "MOC" && storePlacement !== undefined ? { x: storePlacement.x, z: storePlacement.z } : template.storeLocal;
    const phases = ["preparing", "working", "waiting", "stocked"] as const;
    const durationMs = (phase: typeof phases[number]): number => phase === "preparing" ? 10_000 : phase === "working" ? 20_000 : phase === "waiting" ? 30_000 : 10_000;
    const nextPhase = (phase: typeof phases[number]): typeof phases[number] => {
      const next = phases[(phases.indexOf(phase) + 1) % phases.length];
      return next === undefined ? "preparing" : next;
    };
    let phase = (neighborIsland.npcJobKey?.split(".").pop() ?? "preparing") as typeof phases[number];
    if (!phases.includes(phase)) phase = "preparing";
    let end = Date.parse(neighborIsland.npcNextActionAt ?? "");
    // The server timestamp is authoritative for where the cycle currently is. Once it has passed,
    // the client may continue the already-known four-step presentation locally; it never changes
    // stock/cycle or sends a write, and the next authoritative snapshot re-aligns this projection.
    if (Number.isFinite(end)) {
      let guard = 0;
      // A closed tab may return with a stale-but-valid timestamp. Continue only the known local
      // presentation schedule; no phase, stock, or cycle is written back to the server.
      while (nowMs >= end && guard++ < 10000) {
        phase = nextPhase(phase);
        end += durationMs(phase);
      }
    }
    const start = Number.isFinite(end) ? end - durationMs(phase) : Number.NaN;
    const from = phase === "preparing" ? store : phase === "stocked" ? store : phase === "waiting" ? work : home;
    const to = phase === "preparing" ? home : phase === "stocked" ? store : phase === "waiting" ? store : work;
    const progress = Number.isFinite(start) && Number.isFinite(end) && end > start
      ? Math.max(0, Math.min(1, (nowMs - start) / (end - start)))
      : phase === "working" || phase === "waiting" ? 1 : 0;
    const eased = progress * progress * (3 - 2 * progress);
    const localX = from.x + (to.x - from.x) * eased;
    const localZ = from.z + (to.z - from.z) * eased;
    neighborNpcNode.position.set(center.x + localX, GROUND_SURFACE_Y + 0.45 + neighborGroundHeight(template, localX, localZ), center.z + localZ);
    neighborNpcNode.rotation.y = phase === "working" ? Math.sin(nowMs / 180) * 0.18 : Math.atan2(to.z - from.z, to.x - from.x);
    neighborNpcPhase = phase;
    if (neighborNpcTool !== null) {
      neighborNpcTool.visible = phase === "working";
      neighborNpcTool.rotation.z = phase === "working" ? -0.85 + Math.sin(nowMs / 150) * 0.9 : -0.35;
      neighborNpcTool.rotation.x = phase === "working" ? Math.sin(nowMs / 150) * 0.25 : 0;
    }
  }

  function raycastNeighborTargetAt(clientX: number, clientY: number): SceneWorldTarget | null {
    const bounds = canvas.getBoundingClientRect(); if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    // HOME uses the already-authored quay/construction layers as the travel affordance. The full
    // neighbor scene remains the only source of neighbor terrain/collision/NPC geometry after travel.
    const roots = neighborIsland === null ? [worldGroup, constructionGroup] : [neighborGroup];
    for (const hit of raycaster.intersectObjects(roots, true)) {
      const target = neighborTargetFromNode(hit.object); if (target !== null) return target;
    }
    return null;
  }

  function raycastGroundPositionAt(clientX: number, clientY: number): { readonly worldX: number; readonly worldZ: number } | null {
    if (groundMesh === null) return null;
    const bounds = canvas.getBoundingClientRect(); if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(((clientX - bounds.left) / bounds.width) * 2 - 1, -((clientY - bounds.top) / bounds.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(groundMesh, true)[0];
    return hit === undefined ? null : { worldX: hit.point.x, worldZ: hit.point.z };
  }

  /** A cheap identity for the construction layer: ids, models, places, and turns. */
  function constructionSignatureOf(list: readonly SceneConstruction[]): string {
    return list
      .map(
        (item) =>
          `${item.id}:${item.modelId ?? "-"}:${item.worldX.toFixed(2)},${item.worldZ.toFixed(2)}` +
          `:${item.rotationY.toFixed(3)}:${String(item.widthCells)}x${String(item.depthCells)}` +
          `:${item.sizeWorld.toFixed(2)}:${item.landmarkKind ?? "-"}`
      )
      .join("|");
  }

  /**
   * Draws every built thing, once - instanced, and by model.
   *
   * V13.3.1 hands the player the whole island: a few hundred trees, rocks, bushes and props as well as
   * the buildings. A clone per row would be a draw call per tree, which is exactly the regression the
   * performance rule forbids - so rows are grouped by the model they draw and each group becomes one
   * instanced batch, with the instance-to-object mapping written onto the batch so a click still
   * resolves to a row. Landmark-kind rows (the village and the quay) are primitives with no model to
   * instance, and there are a handful of them, so each is built on its own.
   *
   * A model that is still arriving is drawn when it lands - see the library listener.
   */
  function rebuildConstructions(): void {
    // The camera's occluders come from the same rows, so they are refreshed whenever the rows are -
    // before the early return, because a *moved* building changes the occluders without changing the
    // picture's signature in a way that matters here.
    rebuildCameraBlockers();
    const signature = constructionSignatureOf(constructions);
    if (signature === constructionSignature) return;
    constructionSignature = signature;
    constructionGroup.clear();
    constructionSites.clear();
    for (const item of constructions) constructionSites.set(item.id, item);
    updateObjectMarker();
    if (constructions.length === 0) return;
    const token = ++constructionToken;

    // The primitives first: a building is placed, not batched, and there is one of each.
    for (const item of constructions) {
      if (item.landmarkKind === null) continue;
      const node = buildLandmarkNode(assets, item.landmarkKind, null, buildingModel);
      if (node === null) continue;
      node.position.set(
        item.worldX,
        GROUND_SURFACE_Y + terrainHeightAt(item.worldX, item.worldZ, state.world.terrain),
        item.worldZ
      );
      node.rotation.y = item.rotationY;
      node.traverse((child) => {
        child.castShadow = true;
      });
      // What a click on the model resolves to, through the one key constant the picker reads.
      (node.userData as Record<string, unknown>)[CONSTRUCTION_ID_KEY] = item.id;
      // The player's existing harbor is the HOME travel affordance. It is only an interaction tag:
      // no remote island geometry, collision, or NPC is attached to HOME by this marker.
      if (item.landmarkKind === "HARBOR") tagNeighbor(node, "NEIGHBOR_DOCK", NEIGHBOR_DOCK_ID);
      constructionGroup.add(node);
    }

    // Then the model rows, bucketed by model so a forest is a handful of draws rather than hundreds.
    const buckets = new Map<string, SceneConstruction[]>();
    for (const item of constructions) {
      if (item.modelId === null) continue;
      const bucket = buckets.get(item.modelId);
      if (bucket === undefined) buckets.set(item.modelId, [item]);
      else bucket.push(item);
    }
    for (const [modelId, rows] of buckets) {
      void library.load(modelId).then((model) => {
        if (disposed || token !== constructionToken || model === null) return;
        const placements = rows.map((row) => ({
          worldX: row.worldX,
          // Every object stands on the ground under it, so the batch needs no per-row y from the row.
          worldY: GROUND_SURFACE_Y + terrainHeightAt(row.worldX, row.worldZ, state.world.terrain),
          worldZ: row.worldZ,
          rotationY: row.rotationY,
          // Every imported model is normalized to one world unit, so this number *is* the object's
          // size: without it a placed tree would be a metre tall beside the island's own three-metre
          // ones, which is what V13.2 shipped.
          sizeWorld: row.sizeWorld
        }));
        buildInstancedObjects(constructionGroup, model, placements, true, rows.map((row) => row.id));
        draw();
      });
    }
  }

  /** Puts the editing mark under the selected object, or hides it when nothing is selected. */
  function updateObjectMarker(): void {
    const item = selectedObjectId === null ? undefined : constructionSites.get(selectedObjectId);
    if (item === undefined) {
      objectMarker.visible = false;
      objectFootprintMarker.visible = false;
      return;
    }
    objectMarker.visible = true;
    objectFootprintMarker.visible = true;
    const pitch = state.layout.pitch;
    // The anchor carries the extra cell of an even side on +x/+z, so the footprint's own centre is a
    // fraction of a cell away from it. Both markers sit on that centre, which is what makes the wash
    // cover the ground a move would actually take.
    const centreX = item.worldX + ((item.widthCells - 1) / 2 - Math.floor((item.widthCells - 1) / 2)) * pitch;
    const centreZ = item.worldZ + ((item.depthCells - 1) / 2 - Math.floor((item.depthCells - 1) / 2)) * pitch;
    const groundY = GROUND_SURFACE_Y + terrainHeightAt(centreX, centreZ, state.world.terrain);
    objectFootprintMarker.position.set(centreX, groundY + 0.018, centreZ);
    objectFootprintMarker.scale.set(
      Math.max(state.layout.tileSize, item.widthCells * pitch * 0.62),
      Math.max(state.layout.tileSize, item.depthCells * pitch * 0.62),
      1
    );
    objectMarker.position.set(centreX, groundY + 0.026, centreZ);
    objectMarker.scale.set(
      Math.max(state.layout.tileSize * 0.9, item.widthCells * pitch * 0.72),
      Math.max(state.layout.tileSize * 0.9, item.depthCells * pitch * 0.72),
      1
    );
  }

  function rebuildPreview(): void {
    previewGroup.clear();
    for (const dispose of previewDisposers) dispose();
    previewDisposers = [];
    const preview = placementPreview;
    if (preview === null || selectedCell === null) {
      draw();
      return;
    }

    const pitch = state.layout.pitch;
    const centre = tileToWorld(selectedCell, worldFrame(pitch));
    const selectedWorldCell = state.cells.cells.get(cellKey(selectedCell.x, selectedCell.y));
    const onWater = selectedWorldCell?.terrain === "WATER";
    const groundY = onWater
      ? SEA_SURFACE_Y
      : GROUND_SURFACE_Y + terrainHeightAt(centre.worldX, centre.worldZ, state.world.terrain);

    // Aquaculture placement is the one placement mode where the valid area is not land. Draw the
    // already-classified shallow shelf once when the preview changes, so players can distinguish it
    // from open water without changing terrain, collision, or server eligibility.
    if (preview.allowedTerrain.includes("SHALLOW_WATER")) {
      const shallowCells = [...state.cells.cells.values()]
        .filter((cell) => cell.shallowWater)
        .map((cell) => ({ x: cell.x, y: cell.z }));
      const shallowGeometry = buildCellOutlines(
        previewGroup,
        shallowCells,
        pitch,
        assets.shallowWaterPreview,
        () => {
          return SEA_SURFACE_Y + 0.018;
        }
      );
      if (shallowGeometry !== null) {
        previewDisposers.push(() => {
          shallowGeometry.dispose();
        });
      }
    }

    // The footprint: a translucent patch of ground the size of the cells the thing would take, with a
    // lip around it. The lip is what makes the answer visible at all: a ghost scaled to its own
    // footprint hides the patch underneath it, and then the valid/invalid colour is a colour nobody
    // can see.
    const width = preview.widthCells * pitch;
    const depth = preview.depthCells * pitch;
    const footprintGeometry = new PlaneGeometry(width + pitch * 0.4, depth + pitch * 0.4);
    const footprintMaterial = new MeshBasicMaterial({
      // Valid is green; invalid is red. There is no land-purchase state (V14.5.2).
      color: preview.valid
        ? preview.allowedTerrain.includes("SHALLOW_WATER")
          ? 0x39b8c7
          : 0x63b354
        : 0xc4553f,
      transparent: true,
      // A fill you can see through and a perimeter you cannot miss: the V12.4 patch was legible in the
      // screenshot and nearly invisible in play, which is the wrong way round.
      opacity: 0.3,
      depthWrite: false,
      side: DoubleSide
    });
    const footprint = new Mesh(footprintGeometry, footprintMaterial);
    footprint.rotation.x = -Math.PI / 2;
    footprint.rotation.z = -preview.rotationY;
    footprint.position.set(centre.worldX, groundY + 0.035, centre.worldZ);
    footprint.renderOrder = 2;
    previewGroup.add(footprint);
    // The perimeter is its own geometry rather than a thicker fill, so the interior stays transparent
    // and the world underneath is still readable while a player decides.
    const perimeterGeometry = new EdgesGeometry(footprintGeometry);
    const perimeterMaterial = new LineBasicMaterial({
      color: preview.valid
        ? preview.allowedTerrain.includes("SHALLOW_WATER")
          ? 0x147b88
          : 0x2f7d33
        : 0x9b2f1c,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const perimeter = new LineSegments(perimeterGeometry, perimeterMaterial);
    perimeter.rotation.copy(footprint.rotation);
    perimeter.position.set(centre.worldX, groundY + 0.05, centre.worldZ);
    perimeter.renderOrder = 3;
    previewGroup.add(perimeter);
    previewDisposers.push(() => {
      footprintGeometry.dispose();
      footprintMaterial.dispose();
      perimeterGeometry.dispose();
      perimeterMaterial.dispose();
    });

    if (preview.roadTierId !== null) {
      addRoadPreview(preview, selectedCell, groundY);
      draw();
      return;
    }
    if (preview.modelId === null) {
      draw();
      return;
    }

    // The ghost itself. The model is cached and shared, so it is cloned and given its own translucent
    // materials; the clone's geometry belongs to the cache and is never disposed here.
    const token = ++previewLoadToken;
    void library.load(preview.modelId).then((loaded) => {
      // A preview that has been replaced, cancelled or moved on while the model was downloading is
      // dropped rather than drawn - which is also what stops a cancelled ghost appearing later.
      if (disposed || token !== previewLoadToken || placementPreview !== preview) return;
      if (loaded === null) return;
      const model = loaded;
      const ghost = model.clone(true);
      const box = new Box3().setFromObject(ghost);
      const size = box.getSize(new Vector3());
      const cloneMaterials: Material[] = [];
      ghost.traverse((child) => {
        if (!(child instanceof Mesh)) return;
        const source = child.material as Material | Material[];
        const asGhost = (material: Material): MeshStandardMaterial => {
          const copy = (material as MeshStandardMaterial).clone();
          copy.transparent = true;
          copy.opacity = 0.55;
          copy.depthWrite = false;
          cloneMaterials.push(copy);
          return copy;
        };
        child.material = Array.isArray(source) ? source.map(asGhost) : asGhost(source);
      });
      // Fill the footprint the catalogue declares: the preview shows the ground it takes, not a guess
      // at the art department's chosen scale.
      const span = Math.max(size.x, size.z, 0.001);
      const scale = Math.max(width, depth) / span;
      ghost.scale.setScalar(scale);
      ghost.position.set(
        centre.worldX - ((box.min.x + box.max.x) / 2) * scale,
        groundY - box.min.y * scale,
        centre.worldZ - ((box.min.z + box.max.z) / 2) * scale
      );
      // The ghost faces the way the footprint does: a rotated barn that still draws square to the world
      // would be a preview that lies about the thing being placed.
      ghost.rotation.y = preview.rotationY;
      previewGroup.add(ghost);
      previewDisposers.push(() => {
        ghost.clear();
        for (const material of cloneMaterials) material.dispose();
      });
      draw();
    });
  }

  /**
   * A four-cell road segment, in the tier's own surface.
   *
   * The geometry is the runtime one - the same centreline builder and the same ribbon - so a preview
   * of a dirt road is a dirt road rather than a picture of one.
   */
  function addRoadPreview(
    preview: PlacementPreview,
    cell: TileCoordinate,
    groundY: number
  ): void {
    const tier = preview.roadTierId;
    if (tier === null) return;
    if (!(tier in ROAD_PREVIEW_STYLES)) return;
    const style = ROAD_PREVIEW_STYLES[tier as keyof typeof ROAD_PREVIEW_STYLES];
    /** Half the four-cell segment, in cells: what a centred preview reaches either side of the cursor. */
    const halfCells = ROAD_SEGMENT_CELLS / 2;
    const along = preview.rotationY;
    const stepX = Math.cos(along);
    const stepZ = Math.sin(along);
    // Centred on the selected cell, so the drawn segment and the footprint patch agree about where the
    // four cells are: a road that ran forward from the cursor would sit half a segment off its own
    // highlight, which is exactly the kind of preview that teaches a player something false.
    const spec = buildRoadSpec(
      {
        id: "preview",
        kind: style.cobbled ? "PRIMARY" : "SECONDARY",
        connects: [],
        points: [
          { x: cell.x - stepX * halfCells, y: cell.y - stepZ * halfCells },
          { x: cell.x + stepX * halfCells, y: cell.y + stepZ * halfCells }
        ]
      },
      state.layout,
      state.world.terrain
    );
    const material = new MeshStandardMaterial({
      color: style.surface,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      vertexColors: true
    });
    const surface = ribbonSurface([spec], [style.cobbled ? "PRIMARY" : "SECONDARY"]);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new BufferAttribute(surface.positions, 3));
    if (surface.colors !== null) geometry.setAttribute("color", new BufferAttribute(surface.colors, 3));
    geometry.setIndex(new BufferAttribute(surface.indices, 1));
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, material);
    const origin = spec.samples[0];
    if (origin === undefined) return;
    // The geometry is already in world coordinates, because the road builder took the world's own
    // layout. Only the height needs nudging: the segment sits on the ground under the cursor, not on
    // the terrain its own endpoints happen to be over.
    const middle = spec.samples[Math.floor(spec.samples.length / 2)] ?? origin;
    mesh.position.set(
      0,
      groundY + 0.02 + ROAD_LIFT_WORLD - middle.worldY,
      0
    );
    previewGroup.add(mesh);
    previewDisposers.push(() => {
      geometry.dispose();
      material.dispose();
    });
  }

  /**
   * The last hover position, and the frame that will act on it.
   *
   * A mouse reports positions far faster than the screen refreshes, and every one of them used to
   * raycast the whole scene and redraw it. Only the last position before a frame can be seen, so the
   * work is scheduled instead of done inline - and a frame that finds the same cell under the pointer
   * as the one already marked redraws nothing at all. That is the difference between hovering costing
   * a redraw per hardware event and costing nothing at all while the pointer rests.
   */
  let pendingHover: { readonly clientX: number; readonly clientY: number } | null = null;
  let hoverHandle: number | null = null;

  function scheduleHover(clientX: number, clientY: number): void {
    pendingHover = { clientX, clientY };
    if (hoverHandle !== null || disposed) return;
    hoverHandle = window.requestAnimationFrame(() => {
      hoverHandle = null;
      const point = pendingHover;
      pendingHover = null;
      if (point === null || disposed) return;
      const coordinate = raycastTileAt(point.clientX, point.clientY);
      const unchanged =
        coordinate === hoveredCoordinate ||
        (coordinate !== null &&
          hoveredCoordinate !== null &&
          coordinate.x === hoveredCoordinate.x &&
          coordinate.y === hoveredCoordinate.y);
      if (unchanged) return;
      hoveredCoordinate = coordinate;
      canvas.style.cursor = coordinate === null ? "grab" : "pointer";
      // The host's own hover feedback (the work-area editor's preview) rides the same coalesced call,
      // so it can never cost more than the renderer's own marker already does.
      options.onCellHovered?.(coordinate);
      updateMarkers();
      draw();
    });
  }

  const gesture = createPointerGesture();

  function raycastTileAt(clientX: number, clientY: number): TileCoordinate | null {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    // Crops, trees and tile slabs first: a click on something standing on the ground selects the
    // cell that thing stands on, not the ground behind it. The island itself is the last candidate,
    // which is what makes *any* cell on the island selectable rather than only the farm's own tiles.
    const candidates: Object3D[] = [...pickTargets.keys(), ...pickedInstances.keys()];
    if (groundMesh !== null) candidates.push(groundMesh);
    for (const intersection of raycaster.intersectObjects(candidates, true)) {
      const instanced = pickedInstances.get(intersection.object);
      if (instanced !== undefined) {
        const index = intersection.instanceId;
        if (index === undefined) continue;
        return instanced[index] ?? null;
      }
      let node: Object3D | null = intersection.object;
      while (node !== null) {
        const coordinate = pickTargets.get(node);
        if (coordinate !== undefined) return coordinate;
        node = node.parent;
      }
      if (intersection.object === groundMesh) {
        // Open ground: the cell the hit point falls in, through the one conversion.
        return worldToCell(
          { worldX: intersection.point.x, worldZ: intersection.point.z },
          worldFrame(state.layout.pitch)
        );
      }
    }
    return null;
  }

  /**
   * The id of the built thing under the pointer, or null.
   *
   * A separate raycast from the cell one, and only run when the host says objects are pickable: while
   * something is in hand a click means "put it here", so the thing under the pointer must not swallow
   * it. The nearest hit wins, in the same way the cell raycast takes the nearest intersection.
   */
  function raycastConstructionAt(clientX: number, clientY: number, includeGroundFallback = true): string | null {
    if (!objectPickingEnabled) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    // Recursive, against the whole group: a construction is a tree of cloned meshes, and the hit is
    // usually a leaf several levels below the node that carries the id.
    const direct = constructionIdFromHits(raycaster.intersectObjects(constructionGroup.children, true));
    if (direct !== null) return direct;
    if (!includeGroundFallback) return null;
    const groundHit = groundMesh === null ? undefined : raycaster.intersectObject(groundMesh, true)[0];
    if (groundHit === undefined) return null;
    return constructionIdFromWorldPoint(
      { worldX: groundHit.point.x, worldZ: groundHit.point.z },
      [...constructionSites.values()],
      worldFrame(state.layout.pitch).pitch
    );
  }

  /**
   * Resolves direct world-resource taps without scanning the world every frame.
   *
   * GLB hits use stable metadata on the cloned resource root. The positional fallback is only used
   * for a ground/water hit, which keeps a temporarily unloaded resource selectable without inventing
   * a second render object or changing the server's target identity.
   */
  function raycastWorldTargetAt(
    clientX: number,
    clientY: number,
    includeGroundFallback = true
  ): { readonly kind: "RESOURCE_NODE" | "FISHING_SPOT"; readonly id: string } | null {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const resourceHits = raycaster.intersectObjects(resourceGroup.children, true);
    for (const hit of resourceHits) {
      const id = worldTargetIdFromNode(hit.object, RESOURCE_NODE_ID_KEY);
      if (id !== null) return { kind: "RESOURCE_NODE", id };
    }
    if (!includeGroundFallback) return null;

    const terrainHit = groundMesh === null ? undefined : raycaster.intersectObject(groundMesh, true)[0];
    const point = terrainHit?.point;
    if (point === undefined) return null;

    let nearestResource: { readonly id: string; readonly distance: number } | null = null;
    for (const node of resourceNodes) {
      const distance = Math.hypot(point.x - node.worldX, point.z - node.worldZ);
      if (distance > resourceNodePickRadius(node)) continue;
      if (nearestResource === null || distance < nearestResource.distance) {
        nearestResource = { id: node.id, distance };
      }
    }
    if (nearestResource !== null) return { kind: "RESOURCE_NODE", id: nearestResource.id };

    let nearestSpot: { readonly id: string; readonly distance: number } | null = null;
    for (const spot of fishingSpots) {
      const distance = Math.hypot(point.x - spot.worldX, point.z - spot.worldZ);
      if (distance > spot.pickRadiusWorld) continue;
      if (nearestSpot === null || distance < nearestSpot.distance) {
        nearestSpot = { id: spot.id, distance };
      }
    }
    return nearestSpot === null ? null : { kind: "FISHING_SPOT", id: nearestSpot.id };
  }

  /**
   * What the camera is doing while a pointer is down.
   *
   * Kept beside the rig rather than inside the gesture module: the gesture answers "was this a tap",
   * and the camera answers "which button is dragging it". A later touch layer can feed the rig the
   * same two operations without a mouse ever entering the game logic.
   */
  let viewDrag: "none" | "rotate" | "pan" = "none";
  let dragPointerId = -1;
  let dragX = 0;
  let dragY = 0;

  /** Middle-drag: the target moves across the ground, in the camera's own frame rather than north. */
  function panByScreen(deltaX: number, deltaY: number): void {
    cameraRig.panByScreen(deltaX, deltaY, canvas.clientHeight);
    noteManualEstateInput();
    updateCamera();
  }

  /** A monotonic clock for the follow state. `performance` is absent in some embedders. */
  function clockNow(): number {
    return typeof performance === "undefined" ? 0 : performance.now();
  }

  /**
   * Records a change of estate-follow behaviour, and tells the host when it actually changed.
   *
   * The state machine hands back its own argument when nothing changed, so this is free in the common
   * case and the HUD is written only when the recenter control's meaning changes.
   */
  function setEstateFollow(next: EstateFollowState): void {
    if (next === estateFollow) return;
    const changed = next.behaviour !== estateFollow.behaviour;
    estateFollow = next;
    if (changed) options.onEstateFollowChange?.(next.behaviour);
  }

  /**
   * The player has taken the estate camera by hand: it stays where they put it.
   *
   * Zoom is deliberately not routed through here - see `estate-follow.ts`.
   */
  function noteManualEstateInput(): void {
    if (cameraMode !== "ESTATE") return;
    setEstateFollow(estateFollowAfterManualInput(estateFollow, clockNow()));
  }

  /**
   * Re-arms the estate camera on the player for this frame.
   *
   * Called from a player pose and from a camera frame, and it only *aims* the rig: the caller steps it
   * with the frame's own delta, so the follow costs one vector subtraction per frame and never a
   * second animation loop.
   */
  function armEstateFollow(playerMoving: boolean): void {
    if (cameraMode !== "ESTATE") return;
    setEstateFollow(estateFollowForMovement(estateFollow, clockNow(), playerMoving));
    const player = playerPose;
    if (player === null || !estateFollowsPlayer(estateFollow)) return;
    cameraRig.followTo(player.worldX, player.worldZ);
  }

  /**
   * Aims the estate camera at one cell, close enough that a single cell reads as an object.
   *
   * Shared by the two ways the game places the camera - entering placement, and a precision action
   * pulling the player out of character view - so both land the same way. It is a deliberate
   * placement, so it also leaves the camera FREE: the player's next step must not drag the view off
   * the cell they are working on.
   */
  function aimEstateAtCell(cell: TileCoordinate): void {
    const centre = tileToWorld(cell, worldFrame(state.layout.pitch));
    cameraRig.recenterTo(centre.worldX, centre.worldZ);
    const wanted = Math.min(PLACEMENT_CAMERA_DISTANCE, cameraRig.distanceRange.max);
    const current = Math.max(cameraRig.requestedDistance, 0.001);
    cameraRig.zoomByScale(wanted / current);
    setEstateFollow(estateFollowAfterFocus(estateFollow, clockNow()));
    scheduleCameraFrame();
  }

  /**
   * The recenter control: back on the player, and following again.
   *
   * A session with no character yet - a farm that has not finished starting - recentres on the
   * island's own home rather than aiming the camera at the coordinate origin.
   */
  function recenterEstateCamera(): void {
    setEstateFollow(estateFollowRecenter(estateFollow));
    const player = playerPose;
    cameraRig.recenterTo(
      player === null ? cameraHomeX : player.worldX,
      player === null ? cameraHomeZ : player.worldZ
    );
    scheduleCameraFrame();
    updateCamera();
    draw();
  }

  /**
   * Whether the player may steer the camera right now.
   *
   * Never during a mode flight: the two rigs are being interpolated, and a drag that moved one of them
   * underneath the blend would fight it for the half-second it lasts. The flight is short, so
   * suppressing input is honest rather than clever.
   */
  function cameraInputEnabled(): boolean {
    return cameraTransition === null;
  }

  /** Orbits whichever camera is active. */
  function orbitActive(deltaYaw: number, deltaPitch: number): void {
    if (!cameraInputEnabled()) return;
    if (cameraMode === "CHARACTER") characterCamera.rotate(deltaYaw, deltaPitch);
    else {
      cameraRig.rotate(deltaYaw, deltaPitch);
      // Turning the estate camera by hand is the player taking control: the view stays where they
      // leave it instead of being pulled back to the character on the next step.
      noteManualEstateInput();
    }
    updateCamera();
    draw();
  }

  /** One wheel event, on the active camera. */
  function zoomActiveByWheel(deltaY: number): void {
    if (!cameraInputEnabled()) return;
    if (cameraMode === "CHARACTER") characterCamera.zoomByWheel(deltaY);
    else cameraRig.zoomByWheel(deltaY);
    scheduleCameraFrame();
  }

  /** A pinch, on the active camera. */
  function zoomActiveByScale(scale: number): void {
    if (!cameraInputEnabled()) return;
    if (cameraMode === "CHARACTER") characterCamera.zoomByScale(scale);
    else cameraRig.zoomByScale(scale);
    scheduleCameraFrame();
  }

  /**
   * The camera's own animation: the glide between where it is and where it was asked to be.
   *
   * Nothing runs while nothing moves. A wheel step, a pinch or a recenter starts a short run of
   * frames, and the loop stops itself the moment the rig reports it has settled - which is what makes
   * a zoom smooth instead of a snap, and why it costs nothing at rest.
   */
  let frameHandle: number | null = null;
  let lastFrameTime = 0;

  function cameraFrame(time: number): void {
    frameHandle = null;
    if (disposed) return;
    const deltaMs = lastFrameTime === 0 ? 16 : time - lastFrameTime;
    lastFrameTime = time;
    // Re-armed every frame: a follow that is still closing on a moving player keeps its aim current,
    // and a follow aimed at a player who has stopped settles, which lets this loop end.
    armEstateFollow(playerPose?.movementState === "WALKING");
    cameraRig.update(deltaMs);
    characterCamera.update(deltaMs);
    // The bow is the one animation that needs frames while the character stands still; the same loop
    // that carries the camera keeps it alive, and it ends with the gesture.
    updateHarvestGesture(deltaMs);
    if (cameraTransition !== null) {
      cameraTransition.advance(deltaMs / 1000);
      if (!cameraTransition.isActive()) cameraTransition = null;
    }
    // The NPC schedule is a presentation projection of server timestamps. This keeps its route and
    // working pose moving while visited without adding a network timer or a D1 read to the frame loop.
    updateNeighborNpcPose(Date.now());
    updateCamera();
    draw();
    if (cameraTransition !== null || cameraRig.isSettling() || characterCamera.isSettling() || gestureElapsedMs >= 0 || neighborIsland !== null) {
      scheduleCameraFrame();
    }
    else lastFrameTime = 0;
  }

  function scheduleCameraFrame(): void {
    if (frameHandle !== null || disposed) return;
    frameHandle = window.requestAnimationFrame(cameraFrame);
  }

  /**
   * A redraw, at most once per frame.
   *
   * A pointer moving at a thousand events a second used to call `draw()` a thousand times, which is
   * a thousand renders of the whole island for the sixty frames the screen can actually show. The
   * camera's state is applied the moment the event arrives; only the *drawing* waits for the frame,
   * so a drag still tracks the pointer exactly and costs one render per frame.
   */
  let drawHandle: number | null = null;
  let pointerTraceId: string | null = null;

  function scheduleDraw(): void {
    if (drawHandle !== null || disposed) return;
    drawHandle = window.requestAnimationFrame(() => {
      drawHandle = null;
      if (disposed) return;
      updateCamera();
      draw();
    });
  }

  function onPointerDown(event: PointerEvent): void {
    // Capture keeps a drag or a pinch alive when it wanders off the canvas, which is also what keeps
    // the browser from handing the rest of the gesture to the page underneath.
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // A pointer the browser no longer considers active - released around a cancel, or synthetic -
      // cannot be captured; the gesture still works, it just stops at the canvas edge.
    }
    // A mouse or a stylus steers the view with its buttons; a finger keeps the touch language, which
    // is a tap to select and two fingers to zoom.
    if (event.pointerType === "mouse" || event.pointerType === "pen") {
      const role = pointerRoleForButton(event.button);
      if (role === "ROTATE" || role === "PAN") {
        event.preventDefault();
        viewDrag = role === "ROTATE" ? "rotate" : "pan";
        dragPointerId = event.pointerId;
        dragX = event.clientX;
        dragY = event.clientY;
        canvas.style.cursor = role === "ROTATE" ? "grabbing" : "move";
        return;
      }
      if (role === "IGNORE") return;
    }
    pointerTraceId = bootPerfInteractionTraceId();
    bootPerfInteractionTrace(pointerTraceId, "pointer_received", {
      pointerType: event.pointerType,
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY
    });
    gesture.down({ id: event.pointerId, x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: PointerEvent): void {
    if (viewDrag !== "none" && event.pointerId === dragPointerId) {
      const deltaX = event.clientX - dragX;
      const deltaY = event.clientY - dragY;
      dragX = event.clientX;
      dragY = event.clientY;
      if (viewDrag === "rotate") {
        if (cameraMode === "CHARACTER") {
          // A third-person camera is steered by a *drag*, not by two independent axes: right drags
          // turn the view, and the pitch moves a little slower than the estate camera's so a short
          // flick does not swing the camera from the ground to overhead.
          if (cameraInputEnabled()) {
            characterCamera.rotateByDrag(deltaX, deltaY);
            updateCamera();
          }
        } else {
          const turn = rotationForDrag(deltaX, deltaY);
          orbitActive(turn.yaw, turn.pitch);
        }
      } else {
        // Panning is the estate camera's: a third-person camera follows a character, and sliding the
        // target away from them would mean looking at a place they are not standing.
        if (cameraMode === "ESTATE" && cameraInputEnabled()) panByScreen(deltaX, deltaY);
      }
      scheduleDraw();
      return;
    }

    const intent = gesture.move({ id: event.pointerId, x: event.clientX, y: event.clientY });
    switch (intent.kind) {
      case "pan":
        // A finger drag *orbits*, in either view. A phone has no right button, so the desktop's
        // "right-drag rotates, middle-drag pans" cannot be the touch language: the brief's priority
        // is selection, orbit and zoom, and panning stays a mouse gesture (V13.5 deliberately does
        // not add a two-finger pan, which would compete with the pinch for the same two fingers).
        // A mouse's left drag still belongs to selection, so nothing changes on the desktop.
        if (event.pointerType !== "mouse" && cameraInputEnabled()) {
          if (cameraMode === "CHARACTER") characterCamera.rotateByDrag(intent.deltaX, intent.deltaY);
          else {
            const turn = rotationForDrag(intent.deltaX, intent.deltaY);
            cameraRig.rotate(turn.yaw, turn.pitch);
            noteManualEstateInput();
          }
          updateCamera();
          scheduleDraw();
        }
        return;
      case "pinch":
        zoomActiveByScale(intent.scale);
        return;
      case "none":
        break;
    }
    // Only a pointer that can hover gets a hover marker: a finger has no hover, and lighting the
    // tile up under it would read as a selection.
    if (event.pointerType !== "touch") {
      scheduleHover(event.clientX, event.clientY);
    }
  }

  function onPointerUp(event: PointerEvent): void {
    const wasDragging = viewDrag !== "none" && event.pointerId === dragPointerId;
    if (wasDragging) {
      viewDrag = "none";
      dragPointerId = -1;
      canvas.style.cursor = "grab";
    }
    const tap = wasDragging ? false : gesture.up({ id: event.pointerId, x: event.clientX, y: event.clientY });
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!tap) return;
    // Resolve direct mesh hits before ground fallbacks. A resource mesh is an explicit interaction
    // affordance and must not be swallowed by a nearby construction footprint; a direct construction
    // hit still keeps its management capability, and only the final construction branch uses
    // tapTargetFor so placement mode remains authoritative.
    const traceId = pointerTraceId;
    pointerTraceId = null;
    const neighborTarget = raycastNeighborTargetAt(event.clientX, event.clientY);
    if (neighborTarget !== null) {
      options.onWorldTargetSelected?.(neighborTarget);
      return;
    }
    // A visited neighbour has no HOME resource or construction map. Do this before the HOME
    // world/construction fallbacks: their world-space footprints can overlap the neighbour's
    // coordinates and would otherwise expose actions such as Move/Rotate/Delete for a HOME object
    // while the player is standing on Mộc. Remote LODs are intentionally not in this raycast path.
    if (neighborIsland !== null) {
      const ground = raycastGroundPositionAt(event.clientX, event.clientY);
      if (ground !== null) options.onGroundPositionSelected?.(ground);
      return;
    }
    const directWorldTarget = raycastWorldTargetAt(event.clientX, event.clientY, false);
    const directConstructionId = raycastConstructionAt(event.clientX, event.clientY, false);
    const fallbackWorldTarget = raycastWorldTargetAt(event.clientX, event.clientY, true);
    const fallbackConstructionId = raycastConstructionAt(event.clientX, event.clientY, true);
    const picked = prioritizeWorldPick({
      directWorldTarget,
      directConstructionId,
      fallbackWorldTarget,
      fallbackConstructionId
    });
    bootPerfInteractionTrace(traceId, "object_picker_result", {
      constructionId: picked?.kind === "CONSTRUCTION" ? picked.id : null,
      targetFound: picked !== null && picked.kind === "CONSTRUCTION"
    });
    bootPerfInteractionTrace(traceId, "world_picker_result", {
      targetFound: picked !== null && picked.kind !== "CONSTRUCTION",
      targetKind: picked !== null && picked.kind !== "CONSTRUCTION" ? picked.kind : null
    });
    if (picked?.kind === "CONSTRUCTION" && tapTargetFor({ objectPickingEnabled, constructionId: picked.id }) === "OBJECT") {
      options.onObjectSelected?.(picked.id, traceId);
      return;
    }
    if (picked !== null && picked.kind !== "CONSTRUCTION") {
      options.onWorldTargetSelected?.(picked);
      return;
    }
    // Both views report the cell that was tapped, and the host decides what it means: estate view
    // selects whatever is pointed at, while character view is usually just pointing at the world and
    // only opens the contextual surface for a cell that offers something (see
    // `groundTapOpensContext`). Neither is click-to-move - walking to a cell is the Go control's job.
    const coordinate = raycastTileAt(event.clientX, event.clientY);
    bootPerfInteractionTrace(traceId, "cell_raycast_result", {
      tileX: coordinate?.x ?? null,
      tileY: coordinate?.y ?? null
    });
    if (coordinate !== null) options.onCellSelected?.(coordinate);
  }

  function onPointerCancel(event: PointerEvent): void {
    if (viewDrag !== "none" && event.pointerId === dragPointerId) {
      viewDrag = "none";
      dragPointerId = -1;
      canvas.style.cursor = "grab";
    }
    gesture.cancel(event.pointerId);
  }

  function onPointerLeave(): void {
    pendingHover = null;
    hoveredCoordinate = null;
    if (hoverMarker !== null) hoverMarker.visible = false;
    draw();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    zoomActiveByWheel(event.deltaY);
  }

  /** The context menu belongs to the game's own right-drag, not to the browser's. */
  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  /** How far one press of Q or E turns the camera. */
  const KEY_ROTATION_STEP = Math.PI / 30;

  /**
   * Keyboard camera shortcuts: Q/E orbit, F switches viewpoint.
   *
   * WASD is deliberately not among them. The brief allows WASD to pan the camera, but WASD already
   * walks the avatar in this client, and silently repurposing a shipped movement key would be exactly
   * the kind of takeover the brief's left-click rule forbids. Panning is the middle button, and F -
   * which used to recenter the estate camera - now switches between the estate and character views,
   * because the brief gives the mode switch the shortcut and the switch is the more useful of the
   * two. Recentring is what entering the character view *does*.
   */
  function onKeyDown(event: KeyboardEvent): void {
    // The mode shortcut is decided by the shared rule rather than by a second copy of it, so "a farm
    // name is not a camera command" cannot drift between the two.
    if (cameraModeToggleRequested({ key: event.key, target: event.target })) {
      event.preventDefault();
      options.onCameraModeToggle?.();
      return;
    }
    // `E` is claimed by an interaction when one is in reach, and stays the camera's own key when one
    // is not. Asked before the typing guard on purpose: the host's rule already refuses a keystroke
    // that landed in a field, so "is the player typing" is answered in one place rather than two.
    if (
      (event.key === "e" || event.key === "E") &&
      options.onInteractionKeyRequested?.({
        key: event.key,
        target: event.target,
        repeat: event.repeat
      }) === true
    ) {
      event.preventDefault();
      return;
    }
    if (isTypingTarget(event.target)) return;
    switch (event.key) {
      case "q":
      case "Q":
        orbitActive(-KEY_ROTATION_STEP, 0);
        break;
      case "e":
      case "E":
        orbitActive(KEY_ROTATION_STEP, 0);
        break;
      default:
        return;
    }
  }

  hoverMarker = new Mesh(assets.ring, assets.hover);
  hoverMarker.rotation.x = -Math.PI / 2;
  hoverMarker.visible = false;
  // The interaction mark: one ring under whatever the character view is offering, drawn from the
  // candidate the HUD already computed. Separate from the estate selection and from the mouse hover,
  // because it means something else again - "this is what E would do".
  const interactionMarker = new Mesh(assets.ring, assets.selection);
  interactionMarker.rotation.x = -Math.PI / 2;
  interactionMarker.visible = false;
  scene.add(selectionMarker, hoverMarker, interactionMarker);

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { draw(); });
  observer?.observe(canvas);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("contextmenu", onContextMenu);
  window.addEventListener("keydown", onKeyDown);
  canvas.style.cursor = "grab";

  applyState(state);
  // Environment models are requested lazily by `sceneryModel`, so only the ones this world actually
  // places are ever downloaded.
  requestGeneratedModels();
  /**
   * The cosmetic character, asked for last and never awaited.
   *
   * The order matters and is the point of this hotfix: the world is already built, the fallback avatar
   * is already in the scene, and the library exists by now. `load` returns nothing, so there is no
   * promise for boot to wait on - a slow, missing or broken character asset leaves a playable island
   * with the placeholder on it and one line in the console.
   */
  characterView.load({
    loadModel: (modelId) => library.load(modelId),
    animationsOf: (modelId) => library.animations(modelId)
  });

  return {
    canvas,
    setState(next: FarmSceneInput): void {
      applyState(next);
      draw();
    },
    setPlayer(next: FarmScenePlayer | null): void {
      const now = clockNow();
      const deltaMs = lastPlayerFrameMs === 0 ? 16 : Math.min(now - lastPlayerFrameMs, MAX_POSE_DELTA_MS);
      lastPlayerFrameMs = next === null ? 0 : now;
      playerPose = next;
      // Following is driven by the pose stream, which is exactly the set of frames on which the
      // camera can have something new to chase - so a walking player costs no extra frames at all.
      armEstateFollow(next !== null && next.movementState === "WALKING");
      cameraRig.update(deltaMs);
      updatePlayer(deltaMs);
      updateCamera();
      draw();
      // The pose stream stops the moment the player does, so the last stretch of the approach is
      // finished by the camera's own short frame run - which ends as soon as it has arrived.
      if ((next === null || next.movementState !== "WALKING") && cameraRig.isSettling()) {
        scheduleCameraFrame();
      }
    },
    setCameraMode(mode: CameraMode, focus?: EstateCameraFocus): void {
      if (mode === cameraMode) {
        // A precision action can ask for the view the session is already in; the camera still has to
        // go to the thing that was asked for.
        if (focus?.kind === "CELL") aimEstateAtCell(focus.cell);
        else if (focus?.kind === "PLAYER") recenterEstateCamera();
        return;
      }
      // Where the camera is *now* - including part-way through an earlier flight, so pressing the
      // switch twice in quick succession turns around from where the camera actually is.
      const from = cameraTransition === null ? activePose() : cameraTransition.pose();
      cameraMode = mode;
      if (mode === "CHARACTER") {
        // Take the estate camera's bearing and fly down behind the character: a descent, not a spin.
        // The character camera keeps its own pitch and distance, which are shoulder-scale.
        characterCamera.reset({ yaw: cameraRig.state.yaw });
      } else if (focus?.kind === "CELL") {
        // A precision action asked for a particular cell: land on it rather than on wherever the map
        // was last being inspected.
        aimEstateAtCell(focus.cell);
      } else if (focus?.kind === "PLAYER" || estateFollowsPlayer(estateFollow)) {
        // Coming back up while following: the player has been walking where this camera could not
        // see, so it attaches to them again. A camera the player had placed by hand is restored
        // exactly where they left it, which is the other half of the same rule.
        setEstateFollow(estateFollowRecenter(estateFollow));
        if (playerPose !== null) cameraRig.recenterTo(playerPose.worldX, playerPose.worldZ);
      }
      cameraTransition = createCameraTransition(from, activePose(), CAMERA_TRANSITION_SECONDS);
      scheduleCameraFrame();
      updateCamera();
      draw();
    },
    cameraMode(): CameraMode {
      return cameraMode;
    },
    recenterEstateCamera,
    estateFollowBehaviour(): EstateFollowBehaviour {
      return estateFollow.behaviour;
    },
    setInteractionTarget(cell: TileCoordinate | null): void {
      const marker = interactionMarker;
      const same =
        (cell === null && interactionMarkerCell === null) ||
        (cell !== null && interactionMarkerCell !== null && cell.x === interactionMarkerCell.x && cell.y === interactionMarkerCell.y);
      if (same) return;
      interactionMarkerCell = cell === null ? null : { x: cell.x, y: cell.y };
      marker.visible = interactionMarkerCell !== null;
      if (interactionMarkerCell !== null) {
        const position = tileToWorld(interactionMarkerCell, worldFrame(state.layout.pitch));
        const ground = GROUND_SURFACE_Y + terrainHeightAt(position.worldX, position.worldZ, state.world.terrain);
        marker.position.set(position.worldX, ground + 0.06, position.worldZ);
        marker.scale.set(state.layout.tileSize * 0.52, state.layout.tileSize * 0.52, 1);
      }
      draw();
    },
    playHarvestGesture(): void {
      gestureElapsedMs = 0;
      scheduleCameraFrame();
    },
    projectCellToScreen(cell: TileCoordinate) {
      const bounds = canvas.getBoundingClientRect();
      const position = tileToWorld(cell, worldFrame(state.layout.pitch));
      const ground = GROUND_SURFACE_Y + terrainHeightAt(position.worldX, position.worldZ, state.world.terrain);
      // A little above the ground: the pop names the crop, not the soil it stands on.
      const projected = new Vector3(position.worldX, ground + 0.7, position.worldZ).project(camera);
      return {
        x: (projected.x * 0.5 + 0.5) * bounds.width,
        y: (-projected.y * 0.5 + 0.5) * bounds.height,
        // Behind the camera is not "off screen", it is "you cannot see it", and the caller must not
        // draw a label pinned to a place that is behind them.
        visible: projected.z > -1 && projected.z < 1
      };
    },
    cameraBearing(): number {
      return cameraMode === "CHARACTER" ? characterCamera.state.yaw : cameraRig.state.yaw;
    },
    setInteraction(mode: FarmInteractionMode): void {
      if (mode === interactionMode) return;
      interactionMode = mode;
      rebuildInteractionGrid();
      draw();
    },
    setSelection(cell: TileCoordinate | null): void {
      const same =
        (cell === null && selectedCell === null) ||
        (cell !== null && selectedCell !== null && cell.x === selectedCell.x && cell.y === selectedCell.y);
      if (same) return;
      selectedCell = cell === null ? null : { x: cell.x, y: cell.y };
      rebuildCellOverlay();
      // The planting hint is about one cell now, so it follows the selection.
      rebuildInteractionGrid();
      // A ghost follows the selection: moving the click moves what the player is about to place.
      rebuildPreview();
      draw();
    },
    setWorkAreaEdit(state: WorkAreaEditState | null): void {
      const next =
        state === null
          ? null
          : {
              draft: state.draft.map((cell) => ({ x: cell.x, y: cell.y })),
              preview: state.preview.map((cell) => ({ x: cell.x, y: cell.y })),
              invalid: state.invalid.map((cell) => ({ x: cell.x, y: cell.y })),
              hover: state.hover === null ? null : { x: state.hover.x, y: state.hover.y },
              corner: state.corner === null ? null : { x: state.corner.x, y: state.corner.y }
            };
      const key = (cells: readonly TileCoordinate[]): string =>
        cells.map((cell) => `${String(cell.x)},${String(cell.y)}`).join(";");
      const signature =
        next === null
          ? "off"
          : [
              key(next.draft),
              key(next.preview),
              key(next.invalid),
              next.hover === null ? "" : `${String(next.hover.x)},${String(next.hover.y)}`,
              next.corner === null ? "" : `${String(next.corner.x)},${String(next.corner.y)}`
            ].join("|");
      // A pointer resting on one cell, or a redraw for any other reason, costs nothing here.
      if (signature === workAreaEditSignature) return;
      workAreaEditSignature = signature;
      workAreaEdit = next;
      const editing = next !== null;
      workAreaGridGroup.visible = editing;
      workAreaMarkGroup.visible = editing;
      if (editing) {
        if (workAreaGridGeometry === null) rebuildWorkAreaGrid();
      } else {
        disposeWorkAreaGrid();
      }
      rebuildWorkAreaMarks();
      draw();
    },
    setAreaHarvestEdit(state: AreaHarvestEditState | null): void {
      const next =
        state === null
          ? null
          : {
              first: state.first === null ? null : { x: state.first.x, y: state.first.y },
              second: state.second === null ? null : { x: state.second.x, y: state.second.y },
              cells: state.cells.map((cell) => ({ x: cell.x, y: cell.y })),
              invalid: (state.invalid ?? []).map((cell) => ({ x: cell.x, y: cell.y })),
              shortage: (state.shortage ?? []).map((cell) => ({ x: cell.x, y: cell.y })),
              waiting: (state.waiting ?? []).map((cell) => ({ x: cell.x, y: cell.y })),
              focus: state.focus === null || state.focus === undefined ? null : { x: state.focus.x, y: state.focus.y }
            };
      const key = (cell: TileCoordinate | null): string => cell === null ? "" : `${String(cell.x)},${String(cell.y)}`;
      const cellsKey = (cells: readonly TileCoordinate[]): string => cells.map((cell) => key(cell)).join(";");
      const signature = next === null
        ? "off"
        : `${key(next.first)}|${key(next.second)}|${cellsKey(next.cells)}|${cellsKey(next.invalid)}|${cellsKey(next.shortage)}|${cellsKey(next.waiting)}|${key(next.focus)}`;
      if (signature === areaHarvestEditSignature) return;
      areaHarvestEditSignature = signature;
      areaHarvestEdit = next;
      areaHarvestMarkGroup.visible = next !== null;
      rebuildAreaHarvestMarks();
      draw();
    },
    setPlacementPreview(next: PlacementPreview | null): void {
      placementPreview = next;
      rebuildPreview();
      draw();
    },
    setConstructions(next: readonly SceneConstruction[]): void {
      constructions = next;
      rebuildConstructions();
      draw();
    },
    setResourceNodes(next: readonly SceneResourceNode[]): void {
      resourceNodes = next;
      rebuildResourceNodes();
      draw();
    },
    async prepareResourceNode(nodeId: string): Promise<ResourceNodePresentationResult> {
      const node = resourceNodes.find((candidate) => candidate.id === nodeId);
      if (node === undefined) return { status: "NODE_MISSING", modelId: null };
      const modelId = !node.available && node.depletedModelId !== null
        ? node.depletedModelId
        : node.modelId;
      const model = await library.load(modelId);
      if (model === null || disposed) return { status: "ASSET_UNAVAILABLE", modelId };
      if (model.getObjectByProperty("isMesh", true) === undefined) {
        return { status: "MESH_MISSING", modelId };
      }

      // `onArrive` normally rebuilt this layer already. Repeating the signature-gated call here makes
      // the locator deterministic even when the promise and the arrival listener resolve in the same
      // microtask: success is reported only after the real pick root exists.
      rebuildResourceNodes();
      const root = resourceGroup.children.find(
        (child) => (child.userData as Record<string, unknown>)[RESOURCE_NODE_ID_KEY] === nodeId
      );
      if (root === undefined) return { status: "MESH_MISSING", modelId };
      root.updateMatrixWorld(true);
      const mesh = root.getObjectByProperty("isMesh", true);
      const bounds = new Box3().setFromObject(root);
      const size = bounds.getSize(new Vector3());
      if (mesh === undefined || !size.x || !size.y || !size.z) {
        return { status: "MESH_MISSING", modelId };
      }
      let visibleParent: Object3D | null = root;
      while (visibleParent !== null) {
        if (!visibleParent.visible) return { status: "HIDDEN", modelId };
        visibleParent = visibleParent.parent;
      }
      // This proves that a real mesh with non-zero bounds is attached to the visible scene graph. It
      // deliberately does not claim camera visibility: occlusion is a runtime visual concern, not a
      // GLB HTTP/root.visible shortcut.
      draw();
      return {
        status: "READY",
        modelId,
        worldX: root.position.x,
        worldY: root.position.y,
        worldZ: root.position.z
      };
    },
    setFishingSpots(next: readonly SceneFishingSpot[]): void {
      setFishingSpotMetadata(next);
    },
    setNeighborIsland(next: SceneNeighborIsland | null): void {
      const previousId = neighborIsland?.islandId ?? null;
      const nextId = next?.islandId ?? null;
      if (previousId === nextId && next !== null && neighborIsland !== null &&
        neighborIsland.center.x === next.center.x && neighborIsland.center.z === next.center.z &&
        neighborIsland.npc.x === next.npc.x && neighborIsland.npc.z === next.npc.z &&
        neighborIsland.slot === next.slot && neighborIsland.seed === next.seed && neighborIsland.npcJobKey === next.npcJobKey &&
        neighborIsland.npcStartedAt === next.npcStartedAt && neighborIsland.npcNextActionAt === next.npcNextActionAt &&
        neighborIsland.npcCycle === next.npcCycle &&
        neighborIsland.npcConstructionPhase === next.npcConstructionPhase) return;
      neighborIsland = next === null ? null : {
        islandId: next.islandId,
        center: { x: next.center.x, z: next.center.z },
        dock: { x: next.dock.x, z: next.dock.z },
        npc: { x: next.npc.x, z: next.npc.z },
        ...(next.slot === undefined ? {} : { slot: next.slot }),
        ...(next.seed === undefined ? {} : { seed: next.seed }),
        ...(next.npcJobKey === undefined ? {} : { npcJobKey: next.npcJobKey }),
        ...(next.npcStartedAt === undefined ? {} : { npcStartedAt: next.npcStartedAt }),
        ...(next.npcNextActionAt === undefined ? {} : { npcNextActionAt: next.npcNextActionAt }),
        ...(next.npcCycle === undefined ? {} : { npcCycle: next.npcCycle }),
        ...(next.npcConstructionPhase === undefined ? {} : { npcConstructionPhase: next.npcConstructionPhase })
      };
      const homeVisible = next === null;
      for (const group of [
        worldGroup, detailGroup, tileGroup, cropGroup, treeGroup, resourceGroup,
        overlayGroup, overlayDetailGroup, interactionGroup, cellOverlayGroup,
        workAreaGridGroup, workAreaMarkGroup, areaHarvestMarkGroup, previewGroup,
        constructionGroup
      ]) group.visible = homeVisible;
      rebuildNeighborIsland();
      neighborPreviewGroup.visible = neighborPreviews.length > 0;
      scheduleCameraFrame(); draw();
    },
    setNeighborIslandPreviews(next: readonly SceneNeighborIslandPreview[]): void {
      const inputIslandIds = next.map((item) => item.islandId);
      const seenIslandIds = new Set<string>();
      const removedDuplicateIslandIds: string[] = [];
      const removedActiveIslandIds: string[] = [];
      const normalized = next.filter((item) => {
        if (item.islandId === neighborIsland?.islandId) {
          removedActiveIslandIds.push(item.islandId);
          return false;
        }
        if (seenIslandIds.has(item.islandId)) {
          removedDuplicateIslandIds.push(item.islandId);
          return false;
        }
        seenIslandIds.add(item.islandId);
        return true;
      });
      neighborIdentityAudit = {
        inputIslandIds,
        visibleIslandIds: normalized.map((item) => item.islandId),
        removedDuplicateIslandIds,
        removedActiveIslandIds
      };
      const signature = normalized.map((item) => `${item.islandId}:${item.slot}:${String(item.seed ?? 0)}:${String(item.center.x)}:${String(item.center.z)}`).join("|");
      const previousSignature = neighborPreviews.map((item) => `${item.islandId}:${item.slot}:${String(item.seed ?? 0)}:${String(item.center.x)}:${String(item.center.z)}`).join("|");
      if (signature === previousSignature) {
        refreshIslandRuntimeStats();
        return;
      }
      neighborPreviews = normalized.map((item) => ({ islandId: item.islandId, center: { x: item.center.x, z: item.center.z }, slot: item.slot, ...(item.seed === undefined ? {} : { seed: item.seed }) }));
      rebuildNeighborIslandPreviews();
      draw();
    },
    focusWorld(worldX: number, worldZ: number, distance?: number, yaw?: number): void {
      if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) return;
      // Travel focus is an arrival state, not a loose recenter hint: land on the persisted dock now so
      // the first frame after a visit (and after F5) is visibly the dock rather than the island centre.
      setEstateFollow(estateFollowAfterFocus(estateFollow, clockNow()));
      cameraRig.moveTargetTo(worldX, worldZ);
      if (distance !== undefined) cameraRig.setDistance(distance);
      if (yaw !== undefined) cameraRig.setYaw(yaw);
      scheduleCameraFrame(); updateCamera(); draw();
    },
    setObjectPicking(enabled: boolean): void {
      objectPickingEnabled = enabled;
    },
    setObjectSelection(constructionId: string | null): void {
      if (selectedObjectId === constructionId) return;
      selectedObjectId = constructionId;
      updateObjectMarker();
      draw();
    },
    focusOnCell(cell: TileCoordinate): void {
      aimEstateAtCell(cell);
    },
    setDebugMode(on: boolean): void {
      if (on === debugMode) return;
      debugMode = on;
      rebuildCellOverlay();
      draw();
    },
    resize: draw,
    cameraFrame: () => cameraRig.state,
    dispose(): void {
      disposed = true;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("contextmenu", onContextMenu);
      window.removeEventListener("keydown", onKeyDown);
      if (frameHandle !== null) window.cancelAnimationFrame(frameHandle);
      frameHandle = null;
      if (hoverHandle !== null) window.cancelAnimationFrame(hoverHandle);
      hoverHandle = null;
      if (drawHandle !== null) window.cancelAnimationFrame(drawHandle);
      drawHandle = null;
      pendingHover = null;
      observer?.disconnect();
      characterView.dispose();
      worldGroup.clear();
      tileGroup.clear();
      cropGroup.clear();
      treeGroup.clear();
      resourceGroup.clear();
      neighborPreviewGroup.clear();
      neighborPreviewDetailRoots.clear();
      for (const geometry of neighborPreviewGeometries) geometry.dispose();
      neighborPreviewGeometries.length = 0;
      neighborGroup.clear();
      for (const geometry of neighborGeometries) geometry.dispose();
      neighborGeometries.length = 0;
      neighborCollisionDebugGroup.clear();
      for (const geometry of neighborCollisionDebugGeometries) geometry.dispose();
      neighborCollisionDebugGeometries.length = 0;
      neighborCollisionDebugMaterial.dispose();
      overlayGroup.clear();
      interactionGroup.clear();
      interactionGeometry?.dispose();
      interactionGeometry = null;
      playerGroup.clear();
      pickTargets.clear();
      pickedInstances.clear();
      sky.geometry.dispose();
      const skyMaterial = sky.material;
      if (Array.isArray(skyMaterial)) {
        for (const item of skyMaterial) item.dispose();
      } else {
        skyMaterial.dispose();
      }
      for (const variants of models.values()) {
        // The variants share geometry with the cached model, which the shared library owns and other
        // callers (the shop's thumbnails) may still be using: dropping the references is this scene's
        // business, disposing them is not.
        variants.growing.clear();
        variants.ready.clear();
      }
      models.clear();
      stopListening();
      previewGroup.clear();
      constructionGroup.clear();
      for (const dispose of previewDisposers) dispose();
      previewDisposers = [];
      placementPreview = null;
      assets.dispose();
      renderer.dispose();
    }
  };
}
