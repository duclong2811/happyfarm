import {
  AmbientLight,
  BoxGeometry,
  Color,
  ConeGeometry,
  DirectionalLight,
  Group,
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
import { layoutFarmTiles, type TileCoordinate } from "./layout";
import type { FarmSceneInput, SceneTile } from "./view-model";

/**
 * Three.js view of the farm.
 *
 * This module owns rendering mechanics only: camera, lights, ground, one slab per unlocked tile, a
 * placeholder crop mesh per planted tile, a selection marker, sizing, picking, and disposal. It
 * never fetches and never decides anything about the game. It receives descriptors that
 * `view-model.ts` derived from authoritative state, so "what is planted" and "how grown it is" are
 * decided by the server and by pure code, not here.
 *
 * Rendering is on demand: a frame is drawn when the state changes, when the canvas is resized, and
 * when the caller asks. Nothing animates yet, so an unconditional `requestAnimationFrame` loop would
 * redraw an identical image and hold a GPU wake-up open for the whole session. The loop arrives with
 * the first animated content (3.6B assets). Reworking `applyState` into an instance pool or
 * `InstancedMesh` is the follow-up to do at the same time: a rebuilt scene graph is fine for 36
 * tiles, but not once a farm grows or assets become expensive.
 */

/** World units of ground kept around the tile area so the farm does not run to the horizon. */
export const GROUND_MARGIN = 1.5;
/** Placeholder slab thickness. Real tile art replaces this rather than describing it. */
export const TILE_THICKNESS = 0.08;
/** Height of a fully grown placeholder crop, in world units. */
export const CROP_MAX_HEIGHT = 0.75;
/** A just-planted crop still has to be visible, so growth never scales below this. */
export const MIN_CROP_HEIGHT = 0.06;

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
      // The slab rests on the ground, so its top face sits exactly at TILE_THICKNESS. That is the
      // height crops stand at and where the selection ring floats just above the surface.
      const slab = tileMesh(tile, tileGeometry, terrainMaterials[tile.terrainType], 0, TILE_THICKNESS);
      tileGroup.add(slab);
      pickTargets.set(slab, { x: tile.tileX, y: tile.tileY });

      const crop = tile.crop;
      if (crop !== null) {
        // A crop the server has just planted reports zero growth. MIN_CROP_HEIGHT draws it as a
        // sprout rather than leaving the tile bare until the next refresh reports real progress.
        const height = Math.max(crop.heightFraction * CROP_MAX_HEIGHT, MIN_CROP_HEIGHT);
        const plant = tileMesh(
          tile,
          cropGeometry,
          crop.mature ? matureCropMaterial : growingCropMaterial,
          TILE_THICKNESS,
          height
        );
        tileGroup.add(plant);
        // Clicking the crop selects its tile too; the plant is not a separate target.
        pickTargets.set(plant, { x: tile.tileX, y: tile.tileY });
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
    for (const intersection of raycaster.intersectObjects([...pickTargets.keys()], false)) {
      const coordinate = pickTargets.get(intersection.object);
      if (coordinate !== undefined) {
        handler(coordinate);
        return;
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
      canvas.removeEventListener("pointerdown", pickTile);
      observer?.disconnect();
      tileGroup.clear();
      pickTargets.clear();
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
