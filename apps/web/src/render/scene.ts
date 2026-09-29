import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Material,
  type Object3D
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cropModelId, type CropModelId } from "./assets";
import { layoutFarmTiles, type TileCoordinate } from "./layout";
import { createSharedAssets, tileMaterial, type SharedAssets } from "./materials";
import { CROP_MODEL_URLS } from "./model-urls";
import { ENVIRONMENT_MODEL_URLS } from "./environment-model-urls";
import { buildScenery, type SceneryKind } from "./scenery";
import { buildTerrain, TILE_THICKNESS } from "./terrain";
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
const CAMERA_DIRECTION = new Vector3(0.66, 0.82, 0.74).normalize();
const ZOOM_MIN = 0.62;
const ZOOM_MAX = 2.4;
const PAN_LIMIT_FACTOR = 0.55;
const MIN_FRAMED_EXTENT = 7;
const MAX_PIXEL_RATIO = 2;
const CLICK_SLOP_PX = 6;
const CROP_RADIUS_FACTOR = 0.32;
const SKY_COLOR = 0x9fd4ef;
/** Warm tint applied to a loaded model once the server calls the crop mature. Placeholder art. */
const READY_EMISSIVE_COLOR = 0x4a3410;

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
  /** Re-measures the canvas and redraws. */
  resize(): void;
  /** Releases GPU resources, detaches observers and listeners, and leaves the canvas unusable. */
  dispose(): void;
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
 * Scale of the shared tree model, matching the normalization the scenery applies to the same file.
 *
 * One model serves every tree: the visual stage is a scale and a decoration, not another asset, so a
 * farm with many trees loads and caches exactly one tree model.
 */
const TREE_MODEL_SCALE = 0.78;

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
  return plant;
}

export function createFarmScene(canvas: HTMLCanvasElement, options: FarmSceneOptions = {}): FarmSceneHandle {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ canvas, antialias: true });
  } catch (error: unknown) {
    throw new FarmRendererUnavailableError(error);
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));

  const scene = new Scene();
  scene.background = new Color(SKY_COLOR);
  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 800);

  const assets = createSharedAssets();
  const worldGroup = new Group();
  const tileGroup = new Group();
  const cropGroup = new Group();
  const treeGroup = new Group();
  scene.add(worldGroup, tileGroup, cropGroup, treeGroup);

  scene.add(new HemisphereLight(0xdfefff, 0x4a6a3f, 1.15));
  scene.add(new AmbientLight(0xffffff, 0.45));
  const sun = new DirectionalLight(0xfff4d6, 1.9);
  sun.position.set(9, 16, 7);
  scene.add(sun);

  const selectionMarker = new Mesh(assets.ring, assets.selection);
  selectionMarker.rotation.x = -Math.PI / 2;
  selectionMarker.visible = false;
  let hoverMarker: Mesh | null = null;

  const pickTargets = new Map<Object3D, TileCoordinate>();
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const emptyLayout = layoutFarmTiles([]);
  let state: FarmSceneInput = {
    layout: emptyLayout,
    world: buildFarmWorld({ layout: emptyLayout, tiles: [], plots: [] }),
    tiles: []
  };
  let worldSignature = "";
  let worldExtent = MIN_FRAMED_EXTENT;
  let zoom = 1;
  let targetX = 0;
  let targetZ = 0;

  const loader = new GLTFLoader();
  const models = new Map<CropModelId, ModelVariants>();
  const loadingModels = new Set<CropModelId>();
  const unavailableModels = new Set<CropModelId>();
  const sceneryModels: Partial<Record<SceneryKind, Object3D>> = {};
  const loadingScenery = new Set<SceneryKind>();
  const unavailableScenery = new Set<SceneryKind>();
  let disposed = false;

  function requestSceneryModels(): void {
    for (const kind of Object.keys(ENVIRONMENT_MODEL_URLS) as SceneryKind[]) {
      if (loadingScenery.has(kind) || unavailableScenery.has(kind) || sceneryModels[kind] !== undefined) continue;
      loadingScenery.add(kind);
      loader.load(
        ENVIRONMENT_MODEL_URLS[kind],
        (gltf) => {
          loadingScenery.delete(kind);
          if (disposed) {
            disposeModelResources(gltf.scene);
            return;
          }
          sceneryModels[kind] = gltf.scene;
          // Static scenery is cached behind the world signature. Invalidate that cache once when
          // each asset arrives so primitive fallbacks are replaced without changing world state.
          worldSignature = "";
          applyState(state);
          draw();
        },
        undefined,
        (error: unknown) => {
          loadingScenery.delete(kind);
          unavailableScenery.add(kind);
          if (!disposed) options.onAssetProblem?.(`kenney-nature:${kind}`, error);
        }
      );
    }
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
    return worldExtent * 2.35 * zoom;
  }

  function updateCamera(): void {
    const limit = worldExtent * PAN_LIMIT_FACTOR;
    targetX = clamp(targetX, -limit, limit);
    targetZ = clamp(targetZ, -limit, limit);
    const distance = cameraDistance();
    camera.position.set(
      targetX + CAMERA_DIRECTION.x * distance,
      CAMERA_DIRECTION.y * distance,
      targetZ + CAMERA_DIRECTION.z * distance
    );
    camera.lookAt(targetX, 0.2, targetZ);
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

  function tileMesh(tile: SceneTile, geometry: BufferGeometry, material: Material, baseY: number, height: number): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(tile.worldX, baseY + height / 2, tile.worldZ);
    mesh.scale.set(state.layout.tileSize, height, state.layout.tileSize);
    return mesh;
  }

  function modelPlant(tile: SceneTile, variants: ModelVariants, mature: boolean, height: number): Group {
    const plant = new Group();
    plant.add((mature ? variants.ready : variants.growing).clone(true));
    plant.position.set(tile.worldX, TILE_THICKNESS, tile.worldZ);
    plant.scale.setScalar(height);
    return plant;
  }

  /** Placeholder crop for a definition with no shipped model: a cone on the tile centre. */
  function placeholderCrop(tile: SceneTile, material: Material, height: number): Mesh {
    const mesh = new Mesh(assets.cone, material);
    mesh.position.set(tile.worldX, TILE_THICKNESS + height / 2, tile.worldZ);
    mesh.scale.set(state.layout.tileSize * CROP_RADIUS_FACTOR, height, state.layout.tileSize * CROP_RADIUS_FACTOR);
    return mesh;
  }

  function signatureOf(input: FarmSceneInput): string {
    const world = input.world;
    return [
      world.outer?.minX ?? "x",
      world.outer?.maxX ?? "x",
      world.outer?.minY ?? "x",
      world.outer?.maxY ?? "x",
      world.islandHalfWidthWorld.toFixed(3),
      world.islandHalfDepthWorld.toFixed(3),
      world.lockedPlots.map((plot) => `${String(plot.plotIndex)}:${String(plot.minX)},${String(plot.minY)}`).join("|")
    ].join(";");
  }

  function applyState(next: FarmSceneInput): void {
    state = next;
    const signature = signatureOf(next);
    if (signature !== worldSignature) {
      worldSignature = signature;
      worldGroup.clear();
      buildTerrain(worldGroup, assets, next.world, next.layout);
      buildScenery(worldGroup, assets, next.world.scenery, sceneryModels);
      worldExtent = Math.max(next.world.islandHalfWidthWorld, next.world.islandHalfDepthWorld, MIN_FRAMED_EXTENT);
      zoom = 1;
      targetX = 0;
      targetZ = 0;
      scene.fog = new Fog(SKY_COLOR, worldExtent * 1.35, worldExtent * 3.9);
    }

    tileGroup.clear();
    cropGroup.clear();
    treeGroup.clear();
    pickTargets.clear();

    for (const tile of state.tiles) {
      const coordinate = { x: tile.tileX, y: tile.tileY };
      const occupied = tile.crop !== null;
      const slab = tileMesh(tile, assets.box, tileMaterial(assets, tile.terrainType, occupied), 0, TILE_THICKNESS);
      tileGroup.add(slab);
      pickTargets.set(slab, coordinate);

      const crop = tile.crop;
      const tree = tile.tree;
      if (tree !== null) {
        // A tree keeps its tile, so it is drawn in its own group and never as a crop. Selection maps
        // to the tile coordinate the authoritative tree row is looked up by, never to a mesh, a
        // display name, or an array index.
        const treePlantNode = treePlant(tile, assets, sceneryModels.tree, tree);
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
  let pointerDown = false;
  let dragging = false;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let lastY = 0;

  function raycastTile(event: PointerEvent): TileCoordinate | null {
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return null;
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    for (const intersection of raycaster.intersectObjects([...pickTargets.keys()], true)) {
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
    const worldPerPixel = (2 * cameraDistance() * Math.tan((CAMERA_FOV / 2) * (Math.PI / 180))) / Math.max(canvas.clientHeight, 1);
    targetX -= deltaX * worldPerPixel;
    targetZ -= deltaY * worldPerPixel;
    updateCamera();
  }

  function onPointerDown(event: PointerEvent): void {
    pointerDown = true;
    dragging = false;
    startX = event.clientX;
    startY = event.clientY;
    lastX = event.clientX;
    lastY = event.clientY;
    canvas.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent): void {
    if (pointerDown) {
      if (!dragging && Math.abs(event.clientX - startX) + Math.abs(event.clientY - startY) > CLICK_SLOP_PX) {
        dragging = true;
      }
      if (dragging) {
        panBy(event.clientX - lastX, event.clientY - lastY);
        lastX = event.clientX;
        lastY = event.clientY;
        draw();
        return;
      }
    }
    hoveredCoordinate = raycastTile(event);
    canvas.style.cursor = hoveredCoordinate === null ? "grab" : "pointer";
    updateMarkers();
    draw();
  }

  function onPointerUp(event: PointerEvent): void {
    const wasDragging = dragging;
    pointerDown = false;
    dragging = false;
    canvas.releasePointerCapture(event.pointerId);
    if (wasDragging) return;
    const coordinate = raycastTile(event);
    if (coordinate !== null) options.onTileSelected?.(coordinate);
  }

  function onPointerLeave(): void {
    pointerDown = false;
    dragging = false;
    hoveredCoordinate = null;
    if (hoverMarker !== null) hoverMarker.visible = false;
    draw();
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    zoom = clamp(zoom * Math.exp(event.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
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
  canvas.addEventListener("pointerleave", onPointerLeave);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.style.cursor = "grab";

  applyState(state);
  requestSceneryModels();

  return {
    canvas,
    setState(next: FarmSceneInput): void {
      applyState(next);
      draw();
    },
    resize: draw,
    dispose(): void {
      disposed = true;
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointerleave", onPointerLeave);
      canvas.removeEventListener("wheel", onWheel);
      observer?.disconnect();
      worldGroup.clear();
      tileGroup.clear();
      cropGroup.clear();
      treeGroup.clear();
      pickTargets.clear();
      for (const variants of models.values()) {
        disposeModelResources(variants.growing);
        disposeModelResources(variants.ready);
      }
      models.clear();
      for (const model of Object.values(sceneryModels)) {
        disposeModelResources(model);
      }
      assets.dispose();
      renderer.dispose();
    }
  };
}
