import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  Box3,
  BufferAttribute,
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
import { buildInteractionGrid } from "./interaction-grid";
import { worldToCell } from "./world-cell";
import {
  planCellOverlay,
  buildCellOutlines,
  buildDebugGrid,
  buildOwnedLandOverlay,
  buildSelectionQuad
} from "./world-cell-overlay";
import { CONSTRUCTION_ID_KEY, constructionIdFromHits, tapTargetFor } from "./object-picking";
import { CELL_OVERLAY_LIFT_WORLD } from "./world-cell-overlay";
import { CELL_OVERLAY_TILE_LIFT_WORLD } from "./world-cell-overlay";
import { SEA_SURFACE_Y } from "./world-cell-overlay";
import { cellKey } from "./world-cell";
import { worldFrame } from "./layout";
import { buildLockedPlotOverlay, buildTerrain, TILE_THICKNESS } from "./terrain";
import { GROUND_SURFACE_Y, terrainHeightAt } from "./terrain-height";
import type { FarmSceneInput, SceneTile, SceneTree } from "./view-model";
import { buildFarmWorld } from "./world";
import { EMPTY_WORLD_CELL_MAP } from "./world-cell";
import { STATIC_OBSTACLES } from "./world-config";
import {
  CAMERA_TRANSITION_SECONDS,
  cameraModeToggleRequested,
  createCameraTransition,
  type CameraMode,
  type CameraPose,
  type CameraTransition
} from "./camera-mode";
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
import { ROAD_PREVIEW_STYLES } from "./thumbnail";
import { buildRoadSpec, ROAD_LIFT_WORLD } from "./roads";
import { ROAD_SEGMENT_CELLS } from "@happy-farm/game-data";
import { ribbonSurface } from "./road-surface";
import { tileToWorld } from "./layout";

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
export { TILE_THICKNESS };
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
/** How far the avatar's shoulders rise on each step, for a walk that reads without an animation. */
const PLAYER_WALK_BOB = 0.035;
/** Steps per second at full walking speed, used only to phase the bob. */
const PLAYER_STEP_FREQUENCY = 9;
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

export interface PlacementPreview {
  /** The GLB to ghost, or null for a road - which is drawn as a segment of its own surface instead. */
  readonly modelId: string | null;
  /** The road tier to preview, or null for a model. */
  readonly roadTierId: string | null;
  readonly widthCells: number;
  readonly depthCells: number;
  /** Whether the cell the player has selected may hold this. Drives the footprint's colour only. */
  readonly valid: boolean;
  /** Which way the thing faces, in radians about Y. */
  readonly rotationY: number;
}

/** Thrown when the browser cannot give the page a WebGL context. */
export class FarmRendererUnavailableError extends Error {
  constructor(cause: unknown) {
    super("WebGL is not available in this browser session");
    this.name = "FarmRendererUnavailableError";
    this.cause = cause;
  }
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
   * Called when the player clicked one of their own built things, by that thing's id.
   *
   * Only fires while object picking is enabled (see `setObjectPicking`): while something is in hand
   * for placement or a move, a click belongs to the placement, not to the thing under the pointer.
   * The renderer reports the id and decides nothing - what may be done to an object is the server's
   * rule, and the panel that offers it is the caller's.
   */
  readonly onObjectSelected?: (constructionId: string) => void;
  /**
   * Called when the player pressed the camera-mode shortcut.
   *
   * The mode itself belongs to the host - it draws the switch and knows when a panel needs the
   * estate view - so the renderer reports the keystroke and decides nothing. It is only reported
   * while the player is not typing: a farm name is not a camera command.
   */
  readonly onCameraModeToggle?: () => void;
  /**
   * Called when a crop model could not be loaded. The scene keeps drawing that crop's placeholder,
   * so this is a diagnosis for the caller to report, not a failure the caller has to recover from.
   */
  readonly onAssetProblem?: (assetId: string, error: unknown) => void;
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
  setCameraMode(mode: CameraMode): void;
  /** Which mode the camera is in. Read-only mirror of what the host last set. */
  cameraMode(): CameraMode;
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
   * Draws the cells the player owns, or clears the mark with null.
   *
   * The host decides *when*: while something is in hand for placement or a move, and nowhere else.
   * The renderer decides *how*: one instanced quad per cell, one draw call for the parcel, rebuilt
   * only when the cell list actually changes - never per frame, and never per pointer event.
   */
  setOwnershipOverlay(cells: readonly TileCoordinate[] | null): void;
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
  plant.position.set(tile.worldX, TILE_THICKNESS, tile.worldZ);
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
    for (const offset of FRUIT_OFFSETS) {
      const fruit = new Mesh(assets.octa, assets.cropMature);
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
  playerGroup.add(buildPlayerAvatar(assets, generatedModels.character_farmer));
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
  /**
   * The ownership mark: the cells the player actually owns, drawn only while they are using the land.
   *
   * Its own group because it is a *mode*, not a layer: placement and a move turn it on, finishing
   * either turns it off, and normal play never sees it.
   */
  const ownershipGroup = new Group();
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
    overlayGroup,
    overlayDetailGroup,
    interactionGroup,
    cellOverlayGroup,
    ownershipGroup,
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
    if (modelId === "character_farmer") rebuildAvatar();
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

  /** Rebuilds the avatar group from whatever models are available now. */
  function rebuildAvatar(): void {
    playerGroup.clear();
    playerGroup.add(buildPlayerAvatar(assets, generatedModels.character_farmer));
    updatePlayer();
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

  function draw(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  /**
   * How far out the camera may be before small scenery stops being worth drawing.
   *
   * Roughly the estate view: past it, a flower is a fraction of a pixel and a hundred of them are a
   * haze over the fields. One comparison per camera update, and the group toggles with it.
   */
  const DETAIL_DISTANCE_LIMIT = 55;

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

  function updatePlayer(): void {
    if (playerPose === null) {
      playerGroup.visible = false;
      return;
    }
    playerGroup.visible = true;
    const bob =
      playerPose.movementState === "WALKING"
        ? Math.abs(Math.sin(playerPose.elapsedWalk * PLAYER_STEP_FREQUENCY)) * PLAYER_WALK_BOB
        : 0;
    playerGroup.position.set(playerPose.worldX, playerPose.worldY + bob, playerPose.worldZ);
    playerGroup.rotation.y = playerPose.facingYaw;
  }

  /**
   * Rebuilds the planting grid from the tiles on screen.
   *
   * Called when the mode changes and when the farm state does, never per frame: the grid is a
   * function of which tiles are plantable and where they are, and both of those only move when the
   * server says so.
   */
  function rebuildInteractionGrid(): void {
    interactionGroup.clear();
    interactionGeometry?.dispose();
    interactionGeometry = null;
    if (interactionMode === "NONE") return;
    const plantable = state.tiles.filter((tile) => tile.plantable);
    interactionGeometry = buildInteractionGrid(
      interactionGroup,
      plantable,
      state.layout.tileSize,
      TILE_THICKNESS + 0.015,
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
    // The farm's own tiles are a layer of ground nine centimetres thick, so a cell the player owns
    // has to be marked on top of them rather than inside them.
    const owned = state.world.inner;
    const liftFor = (x: number, z: number): number =>
      owned !== null && x >= owned.minX && x <= owned.maxX && z >= owned.minY && z <= owned.maxY
        ? CELL_OVERLAY_TILE_LIFT_WORLD
        : CELL_OVERLAY_LIFT_WORLD;
    const overlayHeightAt = (worldX: number, worldZ: number): number => {
      const cell = worldToCell({ worldX, worldZ }, state.cells.frame);
      const onSea = state.cells.cells.get(cellKey(cell.x, cell.y))?.terrain === "WATER";
      // Open water has its own surface: a selected aquaculture cell is marked on the sea the cages
      // float in rather than at the height of the ground six tenths of a metre beneath it.
      const base = onSea ? SEA_SURFACE_Y : GROUND_SURFACE_Y + terrainHeightAt(worldX, worldZ, state.world.terrain);
      return base + liftFor(cell.x, cell.y);
    };
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

  function updateMarkers(): void {
    const selected = state.tiles.find((tile) => tile.selected);
    selectionMarker.visible = selected !== undefined;
    if (selected !== undefined) {
      selectionMarker.position.set(selected.worldX, TILE_THICKNESS + 0.02, selected.worldZ);
      selectionMarker.scale.set(state.layout.tileSize * 0.62, state.layout.tileSize * 0.62, 1);
    }
    if (hoverMarker !== null) {
      const hovered = state.tiles.find((tile) => coordinateEquals(tile, hoveredCoordinate));
      hoverMarker.visible = hovered !== undefined;
      if (hovered !== undefined) {
        hoverMarker.position.set(hovered.worldX, TILE_THICKNESS + 0.025, hovered.worldZ);
        hoverMarker.scale.set(state.layout.tileSize * 0.56, state.layout.tileSize * 0.56, 1);
      }
    }
  }

  function coordinateEquals(tile: SceneTile, coordinate: TileCoordinate | null): boolean {
    return coordinate !== null && tile.tileX === coordinate.x && tile.tileY === coordinate.y;
  }

  /**
   * Every unlocked tile slab, as one `InstancedMesh`.
   *
   * A mature farm owns more than a thousand tiles, and one mesh each was a thousand draw calls a
   * frame - twice over, once for the camera and once for the shadow map. Instancing collapses that to
   * one, and colour-per-instance keeps the soil variation that per-tile meshes used to carry. The
   * instance order is the same order `state.tiles` arrived in, which is what lets a click resolve
   * back to the authoritative coordinate.
   */
  function buildTileSlabs(tiles: readonly SceneTile[]): void {
    if (tiles.length === 0) return;
    const slabs = new InstancedMesh(assets.box, assets.tileSurface, tiles.length);
    const matrix = new Matrix4();
    const position = new Vector3();
    const scale = new Vector3();
    const rotation = new Quaternion();
    const colour = new Color();
    const coordinates: TileCoordinate[] = [];
    tiles.forEach((tile, index) => {
      coordinates.push({ x: tile.tileX, y: tile.tileY });
      position.set(tile.worldX, TILE_THICKNESS / 2, tile.worldZ);
      // The tiles meet, exactly. The 8% gap that used to separate them was what made the farm read
      // as a board of squares from the estate camera: a field is one surface, and the rows in it are
      // drawn as furrows rather than as the seams between two hundred little plates. The footprint is
      // the *pitch*, so two neighbours touch rather than leaving a sliver of the bed showing.
      const footprint = state.layout.tileSize + state.layout.tileGap;
      scale.set(footprint, TILE_THICKNESS, footprint);
      matrix.compose(position, rotation, scale);
      slabs.setMatrixAt(index, matrix);
      slabs.setColorAt(
        index,
        colour.setHex(tileColorFor(tile.terrainType, tile.crop !== null, tile.tileX, tile.tileY))
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
    plant.position.set(tile.worldX, TILE_THICKNESS, tile.worldZ);
    plant.scale.setScalar(height);
    plant.traverse((child) => {
      child.castShadow = true;
    });
    return plant;
  }

  /** Placeholder crop for a definition with no shipped model: a cone on the tile centre. */
  function placeholderCrop(tile: SceneTile, material: Material, height: number): Mesh {
    const mesh = new Mesh(assets.cone, material);
    mesh.position.set(tile.worldX, TILE_THICKNESS + height / 2, tile.worldZ);
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
    // Progression first: the locked ring, the apron and the field blocks follow the plots the player
    // owns, so a purchase changes this layer without changing the island. The bounds and the counts
    // are enough to tell every state apart without walking the scenery.
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
            : `,r${tree.definitionId},${tree.visualStage},${Math.round(tree.growthProgress * 100).toString()}`)
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
      // Fog the colour of the sky's horizon band, starting well past the field: the far shore and the
      // hills dissolve into the sky instead of ending against a hard edge.
      scene.fog = new Fog(HORIZON_COLOR, worldExtent * 2, worldExtent * 5);
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
        const treePlantNode = treePlant(tile, assets, sceneryModel("tree_broad_3"), tree);
        treeGroup.add(treePlantNode);
        pickTargets.set(treePlantNode, coordinate);
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
        ring.position.set(tile.worldX, TILE_THICKNESS + 0.03, tile.worldZ);
        ring.scale.set(state.layout.tileSize * 0.42, state.layout.tileSize * 0.42, 1);
        cropGroup.add(ring);
        const spark = new Mesh(assets.octa, assets.ready);
        spark.rotation.y = Math.PI / 4;
        spark.position.set(tile.worldX, TILE_THICKNESS + height + 0.28, tile.worldZ);
        spark.scale.setScalar(0.13);
        cropGroup.add(spark);
      }
    }

    updateMarkers();
    updateCamera();
    rebuildCellOverlay();
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
  let constructionSignature = "";
  let constructionToken = 0;
  /** The built thing the player is editing, and whether a click may select one at all. */
  let selectedObjectId: string | null = null;
  let objectPickingEnabled = true;
  /** Where each drawn construction stands, so the marker can be placed without touching the scene. */
  const constructionSites = new Map<string, SceneConstruction>();
  /** The ownership mark's own geometry and the list it was built from, so a repeat costs nothing. */
  let ownershipGeometry: BufferGeometry | null = null;
  let ownershipSignature = "";

  function rebuildOwnership(cells: readonly TileCoordinate[] | null): void {
    const signature = cells === null ? "" : `${String(cells.length)}:${cells.map((cell) => `${String(cell.x)},${String(cell.y)}`).join(";")}`;
    if (signature === ownershipSignature) return;
    ownershipSignature = signature;
    ownershipGroup.clear();
    ownershipGeometry?.dispose();
    ownershipGeometry = null;
    if (cells === null || cells.length === 0) {
      draw();
      return;
    }
    const base = GROUND_SURFACE_Y + 0.02;
    ownershipGeometry = buildOwnedLandOverlay(
      ownershipGroup,
      cells,
      state.cells.frame,
      assets.cellOwned,
      (worldX, worldZ) => base + terrainHeightAt(worldX, worldZ, state.world.terrain)
    );
    draw();
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
    const groundY = GROUND_SURFACE_Y + terrainHeightAt(centre.worldX, centre.worldZ, state.world.terrain);

    // The footprint: a translucent patch of ground the size of the cells the thing would take, with a
    // lip around it. The lip is what makes the answer visible at all: a ghost scaled to its own
    // footprint hides the patch underneath it, and then the valid/invalid colour is a colour nobody
    // can see.
    const width = preview.widthCells * pitch;
    const depth = preview.depthCells * pitch;
    const footprintGeometry = new PlaneGeometry(width + pitch * 0.4, depth + pitch * 0.4);
    const footprintMaterial = new MeshBasicMaterial({
      color: preview.valid ? 0x63b354 : 0xc4553f,
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
      color: preview.valid ? 0x2f7d33 : 0x9b2f1c,
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
  function raycastConstructionAt(clientX: number, clientY: number): string | null {
    if (!objectPickingEnabled || constructionGroup.children.length === 0) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(
      ((clientX - bounds.left) / bounds.width) * 2 - 1,
      -((clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    // Recursive, against the whole group: a construction is a tree of cloned meshes, and the hit is
    // usually a leaf several levels below the node that carries the id.
    return constructionIdFromHits(raycaster.intersectObjects(constructionGroup.children, true));
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
    updateCamera();
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
    else cameraRig.rotate(deltaYaw, deltaPitch);
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
    cameraRig.update(deltaMs);
    characterCamera.update(deltaMs);
    if (cameraTransition !== null) {
      cameraTransition.advance(deltaMs / 1000);
      if (!cameraTransition.isActive()) cameraTransition = null;
    }
    updateCamera();
    draw();
    if (cameraTransition !== null || cameraRig.isSettling() || characterCamera.isSettling()) scheduleCameraFrame();
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
        // A finger drag pans; a mouse's left drag belongs to selection, so it never moves the view.
        if (event.pointerType !== "mouse" && cameraMode === "ESTATE" && cameraInputEnabled()) {
          panByScreen(intent.deltaX, intent.deltaY);
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
    // A tap on one of the player's own objects selects the object; anything else selects the cell. The
    // priority is one decision, in one place (`tapTargetFor`), so "placement wins over picking" cannot
    // drift between the raycasts and the callback.
    const pickedObject = raycastConstructionAt(event.clientX, event.clientY);
    if (tapTargetFor({ objectPickingEnabled, constructionId: pickedObject }) === "OBJECT") {
      options.onObjectSelected?.(pickedObject as string);
      return;
    }
    // Character view has no click-to-move: the character is steered with the movement keys, and a
    // stray click on the ground setting up a walk would fight them (see the design doc, and V13.4's
    // brief: ground click-to-move is estated-view behaviour).
    if (cameraMode === "CHARACTER") return;
    const coordinate = raycastTileAt(event.clientX, event.clientY);
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
  scene.add(selectionMarker, hoverMarker);

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

  return {
    canvas,
    setState(next: FarmSceneInput): void {
      applyState(next);
      draw();
    },
    setPlayer(next: FarmScenePlayer | null): void {
      playerPose = next;
      updatePlayer();
      updateCamera();
      draw();
    },
    setCameraMode(mode: CameraMode): void {
      if (mode === cameraMode) return;
      // Where the camera is *now* - including part-way through an earlier flight, so pressing the
      // switch twice in quick succession turns around from where the camera actually is.
      const from = cameraTransition === null ? activePose() : cameraTransition.pose();
      cameraMode = mode;
      if (mode === "CHARACTER") {
        // Take the estate camera's bearing and fly down behind the character: a descent, not a spin.
        // The character camera keeps its own pitch and distance, which are shoulder-scale.
        characterCamera.reset({ yaw: cameraRig.state.yaw });
      }
      cameraTransition = createCameraTransition(from, activePose(), CAMERA_TRANSITION_SECONDS);
      scheduleCameraFrame();
      updateCamera();
      draw();
    },
    cameraMode(): CameraMode {
      return cameraMode;
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
      // A ghost follows the selection: moving the click moves what the player is about to place.
      rebuildPreview();
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
    setObjectPicking(enabled: boolean): void {
      objectPickingEnabled = enabled;
    },
    setObjectSelection(constructionId: string | null): void {
      if (selectedObjectId === constructionId) return;
      selectedObjectId = constructionId;
      updateObjectMarker();
      draw();
    },
    setOwnershipOverlay(cells: readonly TileCoordinate[] | null): void {
      rebuildOwnership(cells);
    },
    focusOnCell(cell: TileCoordinate): void {
      const centre = tileToWorld(cell, worldFrame(state.layout.pitch));
      cameraRig.recenterTo(centre.worldX, centre.worldZ);
      const wanted = Math.min(PLACEMENT_CAMERA_DISTANCE, cameraRig.distanceRange.max);
      const current = Math.max(cameraRig.requestedDistance, 0.001);
      cameraRig.zoomByScale(wanted / current);
      scheduleCameraFrame();
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
      worldGroup.clear();
      tileGroup.clear();
      cropGroup.clear();
      treeGroup.clear();
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
      ownershipGroup.clear();
      ownershipGeometry?.dispose();
      ownershipGeometry = null;
      for (const dispose of previewDisposers) dispose();
      previewDisposers = [];
      placementPreview = null;
      assets.dispose();
      renderer.dispose();
    }
  };
}
