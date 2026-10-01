import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  Color,
  DirectionalLight,
  Float32BufferAttribute,
  Fog,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PCFShadowMap,
  PerspectiveCamera,
  Quaternion,
  Raycaster,
  Scene,
  SphereGeometry,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
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
import { CROP_MODEL_URLS } from "./model-urls";
import { createPointerGesture } from "./pointer-gesture";
import { ENVIRONMENT_MODEL_URL_BY_ID } from "./environment-model-urls";
import { PROP_MODEL_URL_BY_ID } from "./prop-model-urls";
import { BUILDING_MODELS } from "./building-model-urls";
import { buildScenery } from "./scenery";
import { buildInteractionGrid } from "./interaction-grid";
import { worldToCell } from "./world-cell";
import { planCellOverlay, buildCellOutlines, buildDebugGrid, buildSelectionQuad } from "./world-cell-overlay";
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
import { renderQualityPreset, type RenderQualityName } from "./render-quality";

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
/** How far the avatar's shoulders rise on each step, for a walk that reads without an animation. */
const PLAYER_WALK_BOB = 0.035;
/** Steps per second at full walking speed, used only to phase the bob. */
const PLAYER_STEP_FREQUENCY = 9;
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

function disposeModelResources(root: Object3D): void {
  root.traverse((child) => {
    if (!isMeshLike(child)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
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
  const loadingGenerated = new Set<GeneratedModelId>();
  const unavailableGenerated = new Set<GeneratedModelId>();
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
  /** Circles the camera may not sit inside: the buildings the world config already declares. */
  let cameraBlockers: readonly { readonly centerWorldX: number; readonly centerWorldZ: number; readonly radiusWorld: number }[] = [];
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

  const loader = new GLTFLoader();
  const models = new Map<CropModelId, ModelVariants>();
  const loadingModels = new Set<CropModelId>();
  const unavailableModels = new Set<CropModelId>();
  /**
   * Loaded environment models, by provenance id.
   *
   * The world model names an id and a tier; the manifest resolves the id to a file. Loading is lazy,
   * so a world that places no flowers never downloads one - and when a model does arrive the static
   * layer is rebuilt once, which is what turns the fallback primitives into a frame of scaffolding
   * rather than a permanent look.
   */
  const sceneryModels = new Map<string, Object3D>();
  const loadingScenery = new Set<string>();
  const unavailableScenery = new Set<string>();
  /**
   * Building models, loaded the same lazy way as scenery and keyed by the same kind of asset id.
   *
   * A building that has not arrived draws its primitive, and the static layer rebuilds once when the
   * model lands - so the fallback is a frame of scaffolding rather than a second look.
   */
  const buildingModels = new Map<string, Object3D>();
  const loadingBuildings = new Set<string>();
  const unavailableBuildings = new Set<string>();
  let disposed = false;

  /** The loaded model for an id, starting its download the first time something asks for it. */
  function sceneryModel(id: string): Object3D | undefined {
    const model = sceneryModels.get(id);
    if (model !== undefined) return model;
    requestSceneryModel(id);
    return undefined;
  }

  /**
   * The loaded model for a set-dressing prop.
   *
   * Deliberately the same cache and the same loader as scenery: a prop and a tree are both "a GLB
   * this scene may need", and a second cache would be a second place for a model to be loaded twice.
   */
  function propModel(id: string): Object3D | undefined {
    const model = sceneryModels.get(id);
    if (model !== undefined) return model;
    requestSceneryModel(id);
    return undefined;
  }

  function requestSceneryModel(id: string): void {
    if (loadingScenery.has(id) || unavailableScenery.has(id)) return;
    const url = ENVIRONMENT_MODEL_URL_BY_ID.get(id) ?? PROP_MODEL_URL_BY_ID.get(id);
    if (url === undefined) return;
    loadingScenery.add(id);
    loader.load(
      url,
      (gltf) => {
        loadingScenery.delete(id);
        if (disposed) {
          disposeModelResources(gltf.scene);
          return;
        }
        sceneryModels.set(id, gltf.scene);
        // Static scenery is cached behind the world signature. Invalidate that cache once when each
        // asset arrives so primitive fallbacks are replaced without changing world state - and
        // without touching the camera, because a download must never move where the player is looking.
        worldSignature = "";
        applyState(state);
        draw();
      },
      undefined,
      (error: unknown) => {
        loadingScenery.delete(id);
        unavailableScenery.add(id);
        if (!disposed) options.onAssetProblem?.(id, error);
      }
    );
  }

  /** The loaded building model for an id, starting its download the first time one is asked for. */
  function buildingModel(id: string): Object3D | undefined {
    const model = buildingModels.get(id);
    if (model !== undefined) return model;
    if (loadingBuildings.has(id) || unavailableBuildings.has(id)) return undefined;
    const entry = BUILDING_MODELS.get(id);
    if (entry === undefined) return undefined;
    loadingBuildings.add(id);
    loader.load(
      entry.url,
      (gltf) => {
        loadingBuildings.delete(id);
        if (disposed) {
          disposeModelResources(gltf.scene);
          return;
        }
        buildingModels.set(id, gltf.scene);
        worldSignature = "";
        applyState(state);
        draw();
      },
      undefined,
      (error: unknown) => {
        loadingBuildings.delete(id);
        unavailableBuildings.add(id);
        if (!disposed) options.onAssetProblem?.(id, error);
      }
    );
    return undefined;
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
      if (loadingGenerated.has(id) || unavailableGenerated.has(id) || generatedModels[id] !== undefined) continue;
      loadingGenerated.add(id);
      loader.load(
        GENERATED_MODEL_URLS[id],
        (gltf) => {
          loadingGenerated.delete(id);
          if (disposed) {
            disposeModelResources(gltf.scene);
            return;
          }
          generatedModels[id] = gltf.scene;
          if (id === "building_barn") {
            worldSignature = "";
          }
          if (id === "character_farmer") rebuildAvatar();
          applyState(state);
          draw();
        },
        undefined,
        (error: unknown) => {
          loadingGenerated.delete(id);
          unavailableGenerated.add(id);
          if (!disposed) options.onAssetProblem?.(id, error);
        }
      );
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
    if (disposed || loadingModels.has(modelId) || unavailableModels.has(modelId)) return;
    loadingModels.add(modelId);
    loader.load(
      CROP_MODEL_URLS[modelId],
      (gltf) => {
        loadingModels.delete(modelId);
        if (disposed) {
          disposeModelResources(gltf.scene);
          return;
        }
        models.set(modelId, prepareVariants(gltf.scene));
        applyState(state);
        draw();
      },
      undefined,
      (error: unknown) => {
        loadingModels.delete(modelId);
        unavailableModels.add(modelId);
        if (disposed) return;
        options.onAssetProblem?.(modelId, error);
      }
    );
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
    const visible = cameraRig.state.distance <= DETAIL_DISTANCE_LIMIT;
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

  function updateCamera(): void {
    // The camera is wherever the player put it: it orbits a target on the ground, and the target
    // never moves on its own unless the player asked for a recenter. Looking is then a matter of
    // placing the eye on the orbit and aiming it at the ground the target stands on.
    const orbit = cameraRig.state;
    const eye = cameraRig.eye(groundHeightAt, cameraBlockedAt);
    camera.position.set(eye.x, eye.y, eye.z);
    camera.lookAt(orbit.targetX, groundHeightAt(orbit.targetX, orbit.targetZ) + 0.8, orbit.targetZ);
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
      groundMesh = buildTerrain(
        worldGroup,
        assets,
        next.world,
        next.layout,
        generatedModels.building_barn,
        buildingModel,
        propModel
      );
      // Two passes, one destination each: mass scenery into the world group and small detail into the
      // group the camera switches off when it pulls back. The detail pass belongs to the dynamic
      // layer, which owns both detail groups, so it is not duplicated here.
      buildScenery(worldGroup, assets, next.world.scenery.filter((entry) => !entry.detail), sceneryModel);
      // A new static world means new scenery for the detail groups and the overlay to draw, so the
      // dynamic layer cannot be considered up to date.
      dynamicWorldSignature = "";
      worldExtent = Math.max(next.world.islandHalfWidthWorld, next.world.islandHalfDepthWorld, MIN_FRAMED_EXTENT);
      // The buildings the camera must not sit inside: the same circles the player's own collision
      // uses, so "solid" means one thing in this client rather than two.
      cameraBlockers = STATIC_OBSTACLES;
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
  }

  let hoveredCoordinate: TileCoordinate | null = null;

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
    updateCamera();
    draw();
    if (cameraRig.isSettling()) scheduleCameraFrame();
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
        const turn = rotationForDrag(deltaX, deltaY);
        cameraRig.rotate(turn.yaw, turn.pitch);
      } else {
        panByScreen(deltaX, deltaY);
      }
      scheduleDraw();
      return;
    }

    const intent = gesture.move({ id: event.pointerId, x: event.clientX, y: event.clientY });
    switch (intent.kind) {
      case "pan":
        // A finger drag pans; a mouse's left drag belongs to selection, so it never moves the view.
        if (event.pointerType !== "mouse") {
          panByScreen(intent.deltaX, intent.deltaY);
          scheduleDraw();
        }
        return;
      case "pinch":
        cameraRig.zoomByScale(intent.scale);
        scheduleCameraFrame();
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
    cameraRig.zoomByWheel(event.deltaY);
    scheduleCameraFrame();
  }

  /** The context menu belongs to the game's own right-drag, not to the browser's. */
  function onContextMenu(event: Event): void {
    event.preventDefault();
  }

  /** How far one press of Q or E turns the camera. */
  const KEY_ROTATION_STEP = Math.PI / 30;

  /** Editors own the keyboard; a shortcut must not fire while somebody is typing. */
  function isTypingTarget(target: EventTarget | null): boolean {
    if (target === null || typeof target !== "object") return false;
    const element = target as { tagName?: unknown; isContentEditable?: unknown };
    if (element.isContentEditable === true) return true;
    if (typeof element.tagName !== "string") return false;
    const tag = element.tagName.toUpperCase();
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  }

  /**
   * Keyboard camera shortcuts: Q/E orbit, F recenters on the character.
   *
   * WASD is deliberately not among them. The brief allows WASD to pan the camera, but WASD already
   * walks the avatar in this client, and silently repurposing a shipped movement key would be exactly
   * the kind of takeover the brief's left-click rule forbids. Panning is the middle button.
   */
  function onKeyDown(event: KeyboardEvent): void {
    if (isTypingTarget(event.target)) return;
    switch (event.key) {
      case "q":
      case "Q":
        cameraRig.rotate(-KEY_ROTATION_STEP, 0);
        break;
      case "e":
      case "E":
        cameraRig.rotate(KEY_ROTATION_STEP, 0);
        break;
      case "f":
      case "F":
        // A glide, not a cut: the camera is never taken away from the player, only asked to move.
        cameraRig.recenterTo(playerPose?.worldX ?? cameraHomeX, playerPose?.worldZ ?? cameraHomeZ);
        scheduleCameraFrame();
        return;
      default:
        return;
    }
    updateCamera();
    draw();
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
      draw();
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
        disposeModelResources(variants.growing);
        disposeModelResources(variants.ready);
      }
      models.clear();
      for (const model of sceneryModels.values()) {
        disposeModelResources(model);
      }
      assets.dispose();
      renderer.dispose();
    }
  };
}
