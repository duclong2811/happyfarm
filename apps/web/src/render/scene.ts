import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  WebGLRenderer
} from "three";
import { layoutFarmTiles, type FarmLayout, type TileCoordinate } from "./layout";

/**
 * Three.js foundation for the farm view.
 *
 * This module owns rendering mechanics only: camera, lights, ground, one slab per unlocked tile,
 * sizing, and disposal. It never fetches state and never decides anything about the game — it
 * receives server-owned tile coordinates and draws them. Crop visuals, materials, and models arrive
 * with the asset pipeline (3.6B) and the live-state pass (3.6C).
 *
 * Rendering is on demand: a frame is drawn when the tiles change, when the canvas is resized, and
 * when the caller asks. Nothing animates yet, so an unconditional `requestAnimationFrame` loop
 * would burn GPU time to redraw an identical image; the animation loop belongs with the first
 * animated content.
 */

/** World units of ground kept around the tile area so the farm does not run to the horizon. */
export const GROUND_MARGIN = 1.5;
/** Placeholder slab thickness. Real tile art replaces this rather than describing it. */
export const TILE_THICKNESS = 0.08;

const CAMERA_FOV = 50;
const CAMERA_DISTANCE_FACTOR = 2.4;
const MIN_FRAMED_EXTENT = 4;
const MAX_PIXEL_RATIO = 2;
const GROUND_COLOR = 0x3f6b3a;
const TILE_COLOR = 0x7d5a3c;
const SKY_COLOR = 0x0b1220;

/** Thrown when the browser cannot give the page a WebGL context. */
export class FarmRendererUnavailableError extends Error {
  constructor(cause: unknown) {
    super("WebGL is not available in this browser session");
    this.name = "FarmRendererUnavailableError";
    this.cause = cause;
  }
}

export interface FarmSceneHandle {
  readonly canvas: HTMLCanvasElement;
  /** Re-lays out the unlocked tiles and redraws. Safe to call repeatedly. */
  setTiles(tiles: readonly TileCoordinate[]): void;
  /** Re-measures the canvas and redraws. */
  resize(): void;
  /** Releases GPU resources, detaches observers, and leaves the canvas unusable. */
  dispose(): void;
}

/** Places the camera on a fixed three-quarter view that contains the whole tile area. */
function frameCamera(camera: PerspectiveCamera, layout: FarmLayout): void {
  const extent = Math.max(layout.tileAreaWidth, layout.tileAreaDepth, layout.tileSize, MIN_FRAMED_EXTENT);
  const distance = extent * CAMERA_DISTANCE_FACTOR;
  camera.position.set(distance * 0.55, distance * 0.62, distance * 0.8);
  camera.lookAt(0, 0, 0);
}

export function createFarmScene(canvas: HTMLCanvasElement): FarmSceneHandle {
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
  const groundMaterial = new MeshStandardMaterial({ color: GROUND_COLOR });
  const ground = new Mesh(new PlaneGeometry(1, 1), groundMaterial);
  ground.rotation.x = -Math.PI / 2;

  const tileGroup = new Group();
  const tileGeometry = new BoxGeometry(1, TILE_THICKNESS, 1);
  const tileMaterial = new MeshStandardMaterial({ color: TILE_COLOR });

  scene.add(ground, tileGroup);
  scene.add(new AmbientLight(0xffffff, 0.85));
  const sun = new DirectionalLight(0xffffff, 2.1);
  sun.position.set(6, 12, 8);
  scene.add(sun);

  let layout = layoutFarmTiles([]);

  function draw(): void {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // A hidden or not-yet-laid-out canvas has no size, and a zero aspect would poison the
    // projection matrix with NaN. Skipping the frame leaves the last good image in place.
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.render(scene, camera);
  }

  function applyLayout(next: FarmLayout): void {
    layout = next;
    // Group.clear() drops the previous frame's meshes; geometry and material are shared and stay
    // owned by this closure, so nothing per-tile needs disposing here.
    tileGroup.clear();
    for (const placement of layout.placements) {
      const slab = new Mesh(tileGeometry, tileMaterial);
      slab.position.set(placement.worldX, TILE_THICKNESS / 2, placement.worldZ);
      slab.scale.set(layout.tileSize, 1, layout.tileSize);
      tileGroup.add(slab);
    }
    // An empty farm still shows one tile-sized patch of ground instead of an invisible plane.
    const width = Math.max(layout.tileAreaWidth, layout.tileSize) + GROUND_MARGIN * 2;
    const depth = Math.max(layout.tileAreaDepth, layout.tileSize) + GROUND_MARGIN * 2;
    // The ground plane is rotated flat, so its local Y axis maps onto world Z.
    ground.scale.set(width, depth, 1);
    frameCamera(camera, layout);
  }

  const observer =
    typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => { draw(); });
  observer?.observe(canvas);

  applyLayout(layout);

  return {
    canvas,
    setTiles(tileCoordinates: readonly TileCoordinate[]): void {
      applyLayout(layoutFarmTiles(tileCoordinates));
      draw();
    },
    resize: draw,
    dispose(): void {
      observer?.disconnect();
      tileGroup.clear();
      tileGeometry.dispose();
      tileMaterial.dispose();
      ground.geometry.dispose();
      groundMaterial.dispose();
      renderer.dispose();
    }
  };
}
