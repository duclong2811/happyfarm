import {
  AmbientLight,
  BoxGeometry,
  type BufferGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Group,
  type Material,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  WebGLRenderer,
  type Object3D
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { cropModelId, type CropModelId } from "./assets";
import { layoutFarmTiles, type TileCoordinate } from "./layout";
import { CROP_MODEL_URLS } from "./model-urls";
import type { FarmSceneInput, SceneTile } from "./view-model";

/**
 * Three.js view of the farm.
 *
 * This module owns rendering mechanics only: camera, lights, ground, one slab per unlocked tile, one
 * mesh per planted crop, a selection marker, sizing, picking, disposal, and the model cache behind
 * those crop meshes. It never fetches authoritative state and never decides anything about the game.
 * It receives descriptors that `view-model.ts` derived from server state, so "what is planted" and
 * "how grown it is" are decided by the server and by pure code, not here.
 *
 * A crop draws a shipped model when this build has one for its definition and placeholder geometry
 * when it does not, so a crop the server knows about but the client has no art for still appears.
 * Models load once per session, off the critical path: the placeholder is drawn first and replaced
 * when the file arrives, and a model that fails to load leaves its placeholder in place rather than
 * blanking the tile.
 *
 * Rendering is on demand: a frame is drawn when the state changes, when the caller asks, when a
 * canvas resize is observed, and when a model finishes loading. Nothing animates yet, so an
 * unconditional `requestAnimationFrame` loop would redraw an identical image and hold a GPU wake-up
 * open for the whole session. Moving `applyState` to an instance pool or `InstancedMesh` is now the
 * one remaining follow-up: it still rebuilds the scene graph, with a clone per planted tile, on
 * every refresh. That is fine for 36 starter tiles and wrong once farms grow or models get heavy.
 */

/** World units of ground kept around the tile area so the farm does not run to the horizon. */
export const GROUND_MARGIN = 1.5;
/** Placeholder slab thickness. Real tile art replaces this rather than describing it. */
export const TILE_THICKNESS = 0.08;
/** Height of a fully grown placeholder crop, in world units. */
export const CROP_MAX_HEIGHT = 0.75;
/** A just-planted crop still has to be visible, so growth never scales below this. */
export const MIN_CROP_HEIGHT = 0.06;

/** Warm tint applied to a loaded model once the server calls the crop mature. Placeholder art. */
const READY_EMISSIVE_COLOR = 0x4a3410;

const CAMERA_FOV = 50;
const CAMERA_DISTANCE_FACTOR = 2.4;
const MIN_FRAMED_EXTENT = 4;
const MAX_PIXEL_RATIO = 2;
const CROP_RADIUS_FACTOR = 0.3;
const SELECTION_OUTER_RADIUS = 0.62;

const SKY_COLOR = 0x0b1220;
const GROUND_COLOR = 0x2c4a2a;
const SELECTION_COLOR = 0x5ac48b;
const CROP_GROWING_COLOR = 0x6fbf7f;
const CROP_MATURE_COLOR = 0xe0b64a;

/** Placeholder terrain colours. The 3.6B asset pipeline is what replaces them with real surfaces. */
const TERRAIN_COLORS: Record<SceneTile["terrainType"], number> = {
  SOIL: 0x7d5a3c,
  GRASS: 0x3f6b3a,
  WATER: 0x2f6f9e,
  BLOCKED: 0x454b52
};

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
  /** The authored model, drawn while the crop is still growing. */
  readonly growing: Group;
  /** The same shape carrying tinted material clones, drawn once the crop is mature. */
  readonly ready: Group;
}

/**
 * A mesh as this module needs to see one. `instanceof Mesh` alone narrows the type arguments to
 * `any`, because TypeScript instantiates a generic class without its defaults in that check, so the
 * shape is spelled out here and every traversal in this file goes through the guard.
 */
interface MeshLike extends Object3D {
  geometry: BufferGeometry;
  material: Material | Material[];
}

function isMeshLike(object: Object3D): object is MeshLike {
  return object instanceof Mesh;
}

/**
 * Placeholder art direction: a ripe crop keeps its model and gains a warm emissive tint. The tinted
 * material is a cache entry rather than a per-tile allocation, so a multi-material model costs one
 * clone per source material for the whole scene.
 */
function toReadyMaterial(material: Material, cache: Map<Material, Material>): Material {
  const cached = cache.get(material);
  if (cached !== undefined) return cached;
  const ready = material.clone();
  if (ready instanceof MeshStandardMaterial) ready.emissive.setHex(READY_EMISSIVE_COLOR);
  cache.set(material, ready);
  return ready;
}

function toReadyMaterials(
  material: Material | Material[],
  cache: Map<Material, Material>
): Material | Material[] {
  return Array.isArray(material)
    ? material.map((entry) => toReadyMaterial(entry, cache))
    : toReadyMaterial(material, cache);
}

/** Releases the geometry and materials a loaded model owns. The two variants share them on purpose. */
function disposeModelResources(root: Object3D): void {
  root.traverse((child) => {
    if (!isMeshLike(child)) return;
    child.geometry.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    for (const material of materials) material.dispose();
  });
}

/** Places the camera on a fixed three-quarter view that contains the whole tile area. */
function frameCamera(camera: PerspectiveCamera, layout: FarmSceneInput["layout"]): void {
  const extent = Math.max(layout.tileAreaWidth, layout.tileAreaDepth, layout.tileSize, MIN_FRAMED_EXTENT);
  const distance = extent * CAMERA_DISTANCE_FACTOR;
  camera.position.set(distance * 0.55, distance * 0.62, distance * 0.8);
  camera.lookAt(0, 0, 0);
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

  const camera = new PerspectiveCamera(CAMERA_FOV, 1, 0.1, 500);
  const groundGeometry = new PlaneGeometry(1, 1);
  const groundMaterial = new MeshStandardMaterial({ color: GROUND_COLOR });
  const ground = new Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;

  const tileGroup = new Group();
  // Unit-sized geometry, scaled to the tile footprint in `tileMesh`. Building the thickness into
  // both the geometry and the scale would multiply it with itself.
  const tileGeometry = new BoxGeometry(1, 1, 1);
  const terrainMaterials: Record<SceneTile["terrainType"], MeshStandardMaterial> = {
    SOIL: new MeshStandardMaterial({ color: TERRAIN_COLORS.SOIL }),
    GRASS: new MeshStandardMaterial({ color: TERRAIN_COLORS.GRASS }),
    WATER: new MeshStandardMaterial({ color: TERRAIN_COLORS.WATER }),
    BLOCKED: new MeshStandardMaterial({ color: TERRAIN_COLORS.BLOCKED })
  };
  const cropGeometry = new ConeGeometry(CROP_RADIUS_FACTOR, 1, 12);
  const growingCropMaterial = new MeshStandardMaterial({ color: CROP_GROWING_COLOR });
  const matureCropMaterial = new MeshStandardMaterial({ color: CROP_MATURE_COLOR });

  const selectionGeometry = new RingGeometry(SELECTION_OUTER_RADIUS - 0.09, SELECTION_OUTER_RADIUS, 32);
  const selectionMaterial = new MeshStandardMaterial({ color: SELECTION_COLOR });
  const selectionMarker = new Mesh(selectionGeometry, selectionMaterial);
  selectionMarker.rotation.x = -Math.PI / 2;
  selectionMarker.visible = false;

  scene.add(ground, tileGroup, selectionMarker);
  scene.add(new AmbientLight(0xffffff, 0.85));
  const sun = new DirectionalLight(0xffffff, 2.1);
  sun.position.set(6, 12, 8);
  scene.add(sun);

  const pickTargets = new Map<Object3D, TileCoordinate>();
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  let state: FarmSceneInput = { layout: layoutFarmTiles([]), tiles: [] };

  // Models load once per session and are reused out of this cache. `unavailableModels` also records
  // failures, so a broken asset is requested once rather than on every two-second refresh.
  const loader = new GLTFLoader();
  const models = new Map<CropModelId, ModelVariants>();
  const loadingModels = new Set<CropModelId>();
  const unavailableModels = new Set<CropModelId>();
  let disposed = false;

  /**
   * The loaded model pair for a crop definition, or undefined when there is nothing to draw yet:
   * this build ships no model for the definition, or it is still loading, or it failed. The caller
   * draws placeholder geometry in that case, so a missing asset degrades instead of blanking a tile.
   */
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
        // Redraw at once, so the placeholder on screen is replaced by the real model rather than
        // waiting for the next refresh.
        applyState(state);
        draw();
      },
      undefined,
      (error: unknown) => {
        loadingModels.delete(modelId);
        unavailableModels.add(modelId);
        // A scene torn down while the request was in flight has nobody left to report to.
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

  /** Puts a loaded model on a tile, scaling its authored one-unit height up to `height`. */
  function modelPlant(tile: SceneTile, variants: ModelVariants, mature: boolean, height: number): Group {
    const plant = new Group();
    plant.add((mature ? variants.ready : variants.growing).clone(true));
    plant.position.set(tile.worldX, TILE_THICKNESS, tile.worldZ);
    plant.scale.setScalar(height);
    return plant;
  }

  function draw(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // A hidden or not-yet-laid-out canvas has no size, and a zero aspect would poison the projection
    // matrix with NaN. Skipping the frame leaves the last good image in place.
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  /** Scales a unit-sized geometry to the tile footprint and raises its base to `baseY`. */
  function tileMesh(
    tile: SceneTile,
    geometry: BoxGeometry | ConeGeometry,
    material: MeshStandardMaterial,
    baseY: number,
    height: number
  ): Mesh {
    const mesh = new Mesh(geometry, material);
    mesh.position.set(tile.worldX, baseY + height / 2, tile.worldZ);
    mesh.scale.set(state.layout.tileSize, height, state.layout.tileSize);
    return mesh;
  }

  function applyState(next: FarmSceneInput): void {
    state = next;
    // Group.clear() drops the previous frame's meshes. Geometry and materials are shared and owned by
    // this closure, so there is nothing per-tile to dispose here.
    tileGroup.clear();
    pickTargets.clear();

    for (const tile of state.tiles) {
      const coordinate = { x: tile.tileX, y: tile.tileY };
      // The slab rests on the ground, so its top face sits exactly at TILE_THICKNESS. That is the
      // height crops stand at and where the selection ring floats just above the surface.
      const slab = tileMesh(tile, tileGeometry, terrainMaterials[tile.terrainType], 0, TILE_THICKNESS);
      tileGroup.add(slab);
      pickTargets.set(slab, coordinate);

      const crop = tile.crop;
      if (crop !== null) {
        // A crop the server has just planted reports zero growth. MIN_CROP_HEIGHT draws it as a
        // sprout rather than leaving the tile bare until the next refresh reports real progress.
        const height = Math.max(crop.heightFraction * CROP_MAX_HEIGHT, MIN_CROP_HEIGHT);
        const variants = modelVariants(crop.definitionId);
        const plant: Object3D =
          variants === undefined
            ? tileMesh(
                tile,
                cropGeometry,
                crop.mature ? matureCropMaterial : growingCropMaterial,
                TILE_THICKNESS,
                height
              )
            : modelPlant(tile, variants, crop.mature, height);
        tileGroup.add(plant);
        // Clicking the crop selects its tile too; the plant is not a separate target.
        pickTargets.set(plant, coordinate);
      }
    }

    const selected = state.tiles.find((tile) => tile.selected);
    selectionMarker.visible = selected !== undefined;
    if (selected !== undefined) {
      selectionMarker.position.set(selected.worldX, TILE_THICKNESS + 0.02, selected.worldZ);
      // The ring is rotated flat, so its local X and Y span the tile footprint.
      selectionMarker.scale.set(state.layout.tileSize, state.layout.tileSize, 1);
    }

    // An empty farm still shows one tile-sized patch of ground instead of an invisible plane.
    const width = Math.max(state.layout.tileAreaWidth, state.layout.tileSize) + GROUND_MARGIN * 2;
    const depth = Math.max(state.layout.tileAreaDepth, state.layout.tileSize) + GROUND_MARGIN * 2;
    // The ground plane is rotated flat, so its local Y axis maps onto world Z.
    ground.scale.set(width, depth, 1);
    frameCamera(camera, state.layout);
  }

  function pickTile(event: PointerEvent): void {
    const handler = options.onTileSelected;
    if (handler === undefined) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width === 0 || bounds.height === 0) return;
    pointer.set(
      ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
      -((event.clientY - bounds.top) / bounds.height) * 2 + 1
    );
    raycaster.setFromCamera(pointer, camera);
    // A loaded model is a subtree rather than a single mesh, so a hit is matched against the closest
    // mapped ancestor instead of against the mesh that was actually hit.
    for (const intersection of raycaster.intersectObjects([...pickTargets.keys()], true)) {
      let node: Object3D | null = intersection.object;
      while (node !== null) {
        const coordinate = pickTargets.get(node);
        if (coordinate !== undefined) {
          handler(coordinate);
          return;
        }
        node = node.parent;
      }
    }
  }

  const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { draw(); });
  observer?.observe(canvas);
  canvas.addEventListener("pointerdown", pickTile);

  applyState(state);

  return {
    canvas,
    setState(next: FarmSceneInput): void {
      applyState(next);
      draw();
    },
    resize: draw,
    dispose(): void {
      disposed = true;
      canvas.removeEventListener("pointerdown", pickTile);
      observer?.disconnect();
      tileGroup.clear();
      pickTargets.clear();
      for (const variants of models.values()) {
        disposeModelResources(variants.growing);
        disposeModelResources(variants.ready);
      }
      models.clear();
      tileGeometry.dispose();
      cropGeometry.dispose();
      selectionGeometry.dispose();
      groundGeometry.dispose();
      for (const material of Object.values(terrainMaterials)) material.dispose();
      growingCropMaterial.dispose();
      matureCropMaterial.dispose();
      selectionMaterial.dispose();
      groundMaterial.dispose();
      renderer.dispose();
    }
  };
}
