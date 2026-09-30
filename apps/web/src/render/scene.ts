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
import { cameraFrameExtent, createCameraRig, zoomRangeFor, ZOOM_MIN } from "./camera";
import { GENERATED_MODEL_URLS, type GeneratedModelId } from "./generated-model-urls";
import { layoutFarmTiles, type TileCoordinate } from "./layout";
import { createSharedAssets, tileColorFor, type SharedAssets } from "./materials";
import { CROP_MODEL_URLS } from "./model-urls";
import { createPointerGesture } from "./pointer-gesture";
import { ENVIRONMENT_MODEL_URL_BY_ID } from "./environment-model-urls";
import { BUILDING_MODELS } from "./building-model-urls";
import { buildScenery } from "./scenery";
import { buildLockedPlotOverlay, buildTerrain, TILE_THICKNESS } from "./terrain";
import type { FarmSceneInput, SceneTile, SceneTree } from "./view-model";
import { buildFarmWorld } from "./world";

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

const CAMERA_FOV = 45;
/**
 * Where the camera sits relative to what it looks at.
 *
 * A three-quarter view: far enough off the vertical to show the sides of a building and the slope of
 * the ground, high enough that a field of crops reads as rows rather than as a wall of them.
 */
const CAMERA_DIRECTION = new Vector3(0.62, 0.95, 0.62).normalize();
/** Near and far planes. The near plane is far enough out to keep the depth buffer quiet at zoom. */
const CAMERA_NEAR = 0.5;
const CAMERA_FAR = 1400;
/** Radius of the sky dome. Inside the far plane, and far outside the island. */
const SKY_RADIUS = 600;
const MIN_FRAMED_EXTENT = 7;
const MAX_PIXEL_RATIO = 2;
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
/**
 * Framing used while a character is drawn.
 *
 * The default view frames the farm - the field and its apron - and a follow camera at that distance
 * would show the avatar as a few pixels, so a character pulls the camera in to a fixed, much smaller
 * extent while zoom and the camera direction stay exactly as they were. Nine metres is about eight
 * tiles: enough to see the row being planted and the path behind it without losing the crop detail.
 */
const FOLLOW_FRAME_EXTENT = 9;

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
   * Called with an authoritative tile coordinate when the player clicks a tile. The renderer reports
   * the coordinate only; selecting it, and what that means, stays with the caller.
   */
  readonly onTileSelected?: (coordinate: TileCoordinate) => void;
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
  /** Re-measures the canvas and redraws. */
  resize(): void;
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
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch (error: unknown) {
    throw new FarmRendererUnavailableError(error);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  // A filmic curve keeps the sunlit grass and the shaded sides of a building from clipping to flat
  // colour, which is most of what separated the alpha's look from a stylised one. It is a few lines of
  // shader work, not a post-processing pass.
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;

  const scene = new Scene();
  scene.background = new Color(HORIZON_COLOR);
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, CAMERA_NEAR, CAMERA_FAR);

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
  scene.add(worldGroup, detailGroup, tileGroup, cropGroup, treeGroup, overlayGroup, overlayDetailGroup, playerGroup);

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
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
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
    tiles: []
  };
  let worldSignature = "";
  /**
   * True when the next static rebuild is caused by an asset arriving rather than by the world moving.
   *
   * A model finishing its download must not re-frame a camera the player has positioned; land being
   * bought may, because the farm the camera frames has changed size. Without this, zooming out and
   * then waiting for the trees to load snapped the view back every time.
   */
  let keepZoomOnRebuild = false;
  /**
   * How far the camera may drift from the world's centre, and how far the fog starts.
   *
   * The whole island, so a player who zooms out can look at the orchard, the pond, and the yard -
   * not just the field.
   */
  let worldExtent = MIN_FRAMED_EXTENT;
  /**
   * What the camera frames when there is no character yet.
   *
   * The farm, not the island: opening on a small field inside a large empty circle is exactly the
   * view the alpha shipped. Zooming out from here still reaches the whole world.
   */
  let farmExtent = MIN_FRAMED_EXTENT;
  // Zoom and the player's manual pan live in the rig, so a farm refresh cannot quietly reset either
  // one: `applyState` never touches them.
  const cameraRig = createCameraRig();
  let playerPose: FarmScenePlayer | null = null;

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

  function requestSceneryModel(id: string): void {
    if (loadingScenery.has(id) || unavailableScenery.has(id)) return;
    const url = ENVIRONMENT_MODEL_URL_BY_ID.get(id);
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
        // asset arrives so primitive fallbacks are replaced without changing world state.
        keepZoomOnRebuild = true;
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
        keepZoomOnRebuild = true;
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
            keepZoomOnRebuild = true;
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

  function cameraDistance(): number {
    return framedExtent() * 2.35 * cameraRig.zoom;
  }

  function framedExtent(): number {
    return cameraFrameExtent({
      islandExtent: worldExtent,
      farmExtent,
      followExtent: FOLLOW_FRAME_EXTENT,
      hasCharacter: playerPose !== null
    });
  }

  /**
   * How far out the camera may be before small scenery stops being worth drawing.
   *
   * Roughly the estate view: past it, a flower is a fraction of a pixel and a hundred of them are a
   * haze over the fields. One comparison per camera update, and the group toggles with it.
   */
  const DETAIL_ZOOM_LIMIT = 2.2;

  function updateDetailVisibility(): void {
    const visible = cameraRig.zoom <= DETAIL_ZOOM_LIMIT;
    detailGroup.visible = visible;
    overlayDetailGroup.visible = visible;
  }

  function updateCamera(): void {
    // The target is the character's position plus the player's own drag, clamped so the camera can
    // never leave the farm. The character is not moved by any of it.
    //
    // With no character yet the camera frames the *field*, not the island's centre: the farm the
    // player owns is the smallest thing in the world and the only thing they can act on, so it is
    // what a first view has to land on. The pan clamp is centred on the same point, which is what
    // keeps a dragged view from wandering off the farm while a zoomed-out one can still reach the sea.
    const frameCentre = state.world.apron;
    // Zoomed out, the camera frames the *island*, not the field: the estate view is where the plan is
    // supposed to be legible, and framing the farm put the island off to one side of the screen with
    // the settlement half out of shot.
    const islandFraming = cameraRig.zoom > 3;
    const targetX = islandFraming ? state.world.centerWorldX : frameCentre?.worldX ?? state.world.centerWorldX;
    const targetZ = islandFraming ? state.world.centerWorldZ : frameCentre?.worldZ ?? state.world.centerWorldZ;
    const target = cameraRig.target({
      playerWorldX: playerPose?.worldX ?? null,
      playerWorldZ: playerPose?.worldZ ?? null,
      centerWorldX: targetX,
      centerWorldZ: targetZ,
      worldExtent
    });
    const distance = cameraDistance();
    camera.position.set(
      target.worldX + CAMERA_DIRECTION.x * distance,
      CAMERA_DIRECTION.y * distance,
      target.worldZ + CAMERA_DIRECTION.z * distance
    );
    camera.lookAt(target.worldX, playerPose === null ? 0.2 : PLAYER_HEIGHT * 0.5, target.worldZ);
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
      // Slightly wider than a bare tile, so the seam between two slabs is a furrow line rather than
      // the 8% gap of a chessboard. The soil bed underneath is what shows through it.
      const footprint = state.layout.tileSize + state.layout.tileGap * 0.45;
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

  function applyState(next: FarmSceneInput): void {
    state = next;
    const signature = signatureOf(next);
    if (signature !== worldSignature) {
      worldSignature = signature;
      worldGroup.clear();
      buildTerrain(worldGroup, assets, next.world, next.layout, generatedModels.building_barn, buildingModel);
      // Two passes, one destination each: mass scenery into the world group and small detail into the
      // group the camera switches off when it pulls back.
      buildScenery(worldGroup, assets, next.world.scenery.filter((entry) => !entry.detail), sceneryModel);
      buildScenery(detailGroup, assets, next.world.scenery.filter((entry) => entry.detail), sceneryModel);
      worldExtent = Math.max(next.world.islandHalfWidthWorld, next.world.islandHalfDepthWorld, MIN_FRAMED_EXTENT);
      // A world rebuild re-frames the zoom but keeps the player's own drag: buying land is not a
      // reason to move the camera the player positioned.
      if (!keepZoomOnRebuild) cameraRig.setZoom(1);
      keepZoomOnRebuild = false;
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
    // Outside the signature: the framing extent follows the land the farm owns, and that changes when
    // a plot is bought without the island itself changing.
    farmExtent = Math.max(next.world.farmHalfExtentWorld, MIN_FRAMED_EXTENT);
    // …and so does how far the camera is allowed to pull back, because the estate view has to reach
    // the island from a frame that starts on the field.
    const range = zoomRangeFor({ islandExtent: worldExtent, farmExtent });
    cameraRig.setZoomRange(ZOOM_MIN, range.max);

    tileGroup.clear();
    cropGroup.clear();
    treeGroup.clear();
    overlayGroup.clear();
    detailGroup.clear();
    overlayDetailGroup.clear();
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
      next.world.lockedScenery.filter((entry) => entry.detail),
      sceneryModel
    );
    pickTargets.clear();
    pickedInstances.clear();
    buildTileSlabs(state.tiles);

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
  }

  let hoveredCoordinate: TileCoordinate | null = null;
  const gesture = createPointerGesture();

  function raycastTile(event: PointerEvent): TileCoordinate | null {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    const candidates: Object3D[] = [...pickTargets.keys(), ...pickedInstances.keys()];
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
    }
    return null;
  }

  function panBy(deltaX: number, deltaY: number): void {
    // Dragging moves the camera's offset, never the character: the two are separate on purpose.
    const worldPerPixel = (2 * cameraDistance() * Math.tan((CAMERA_FOV / 2) * (Math.PI / 180))) / Math.max(canvas.clientHeight, 1);
    cameraRig.panByPixels(deltaX, deltaY, worldPerPixel);
    updateCamera();
  }

  function zoomByPinch(scale: number): void {
    cameraRig.zoomByScale(scale);
    updateCamera();
  }

  function onPointerDown(event: PointerEvent): void {
    // Capture keeps a drag or a pinch alive when it wanders off the canvas, which is also what keeps
    // the browser from handing the rest of the gesture to the page underneath.
    canvas.setPointerCapture(event.pointerId);
    gesture.down({ id: event.pointerId, x: event.clientX, y: event.clientY });
  }

  function onPointerMove(event: PointerEvent): void {
    const intent = gesture.move({ id: event.pointerId, x: event.clientX, y: event.clientY });
    switch (intent.kind) {
      case "pan":
        panBy(intent.deltaX, intent.deltaY);
        draw();
        return;
      case "pinch":
        zoomByPinch(intent.scale);
        draw();
        return;
      case "none":
        break;
    }
    // Only a pointer that can hover gets a hover marker: a finger has no hover, and lighting the
    // tile up under it would read as a selection.
    if (event.pointerType !== "touch") {
      hoveredCoordinate = raycastTile(event);
      canvas.style.cursor = hoveredCoordinate === null ? "grab" : "pointer";
      updateMarkers();
      draw();
    }
  }

  function onPointerUp(event: PointerEvent): void {
    const tap = gesture.up({ id: event.pointerId, x: event.clientX, y: event.clientY });
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (!tap) return;
    const coordinate = raycastTile(event);
    if (coordinate !== null) options.onTileSelected?.(coordinate);
  }

  function onPointerCancel(event: PointerEvent): void {
    gesture.cancel(event.pointerId);
  }

  function onPointerLeave(): void {
    hoveredCoordinate = null;
    if (hoverMarker !== null) hoverMarker.visible = false;
    draw();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    cameraRig.zoomByWheel(event.deltaY);
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
    resize: draw,
    dispose(): void {
      disposed = true;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      observer?.disconnect();
      worldGroup.clear();
      tileGroup.clear();
      cropGroup.clear();
      treeGroup.clear();
      overlayGroup.clear();
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
