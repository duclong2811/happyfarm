import {
  BufferAttribute,
  BufferGeometry,
  Box3,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  type InterleavedBufferAttribute,
  type Object3D,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer
} from "three";
import { ROAD_SEGMENT_CELLS, ROAD_TIERS, type RoadTierId } from "@happy-farm/game-data";
import { layoutFarmTiles, worldFrame } from "./layout";
import { sharedModelLibrary, type ModelLibrary } from "./model-library";
import { ribbonSurface, stonePlateSurface, type SurfaceData } from "./road-surface";
import { buildRoadSpec } from "./roads";
import { TERRAIN_SHAPE, type Road } from "./world-config";
import {
  ROAD_PREVIEW_STYLES,
  THUMBNAIL_SIZE,
  boundsSize,
  trimmedBounds,
  thumbnailCacheKey,
  thumbnailFraming,
  type ThumbnailRequest,
  type ThumbnailResult
} from "./thumbnail-spec";

export {
  ROAD_PREVIEW_STYLES,
  THUMBNAIL_FILL,
  THUMBNAIL_SIZE,
  thumbnailCacheKey,
  thumbnailFraming,
  type ThumbnailRequest,
  type ThumbnailResult,
  type ThumbnailSource
} from "./thumbnail-spec";

/**
 * Shop thumbnails: one offscreen renderer, drawn on demand, cached as bitmaps.
 *
 * The obvious implementation - a small Three.js scene per shop card - is fifty-five WebGL contexts
 * and fifty-five animation loops, which is the CPU problem this project already paid for once. So
 * there is exactly one renderer here, it draws only when a card asks for a picture it has not got,
 * and what it produces is a data URL rather than a live scene. Reopening a category is then a map
 * lookup and a few `img.src` assignments.
 *
 * The art direction is deliberately plain and consistent: warm cream ground, one soft key light, a
 * three-quarter view, the object filling most of the frame, no horizon and no sky.
 */

/** The camera's three-quarter bearing, in world units before normalisation. */
const VIEW_DIRECTION = new Vector3(1, 0.72, 1.35).normalize();

/** The grass a road preview is laid on, so the card shows a road *in a field* rather than a swatch. */
const PREVIEW_GRASS = 0x7fae5c;

export interface ThumbnailRenderer {
  render(request: ThumbnailRequest): Promise<ThumbnailResult>;
  /** How many were drawn and how many were served from the cache - the proof the cache works. */
  stats(): { readonly drawn: number; readonly cached: number };
  dispose(): void;
}

export interface ThumbnailRendererOptions {
  readonly library?: ModelLibrary;
  readonly onProblem?: (modelId: string, error: unknown) => void;
}

export function createThumbnailRenderer(options: ThumbnailRendererOptions = {}): ThumbnailRenderer {
  const library = options.library ?? sharedModelLibrary();
  const cache = new Map<string, ThumbnailResult>();
  let drawn = 0;
  let cached = 0;
  let renderer: WebGLRenderer | null = null;
  let scene: Scene | null = null;
  let camera: PerspectiveCamera | null = null;
  let ground: Mesh | null = null;
  let disposed = false;

  /** The offscreen stage, built the first time a thumbnail is actually wanted. */
  function stage(): { renderer: WebGLRenderer; scene: Scene; camera: PerspectiveCamera } | null {
    if (disposed) return null;
    if (renderer !== null && scene !== null && camera !== null) return { renderer, scene, camera };
    try {
      renderer = new WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch (error: unknown) {
      options.onProblem?.("*", error);
      return null;
    }
    renderer.setPixelRatio(1);
    renderer.setSize(THUMBNAIL_SIZE, THUMBNAIL_SIZE, false);
    scene = new Scene();
    scene.background = new Color(0xf6efe0);
    camera = new PerspectiveCamera(32, 1, 0.05, 40);

    // A round patch of ground under the object: the contact shadow and the horizon line are what make
    // a thumbnail read as "this stands on something" rather than "this floats in a void".
    ground = new Mesh(
      new CircleGeometry(1, 48),
      new MeshStandardMaterial({ color: 0xe6dcc4, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    // A slightly flattened disc: a miniature presentation platform rather than a perfect circle.
    ground.scale.set(1.08, 1, 0.94);
    ground.receiveShadow = false;
    scene.add(ground);

    const key = new DirectionalLight(0xfff4e2, 2.1);
    key.position.set(2.4, 3.4, 2.0);
    scene.add(key);
    scene.add(new HemisphereLight(0xffffff, 0xb9a887, 1.5));
    return { renderer, scene, camera };
  }

  /** Puts a model on the stage, scaled and centred to the framing rule, and removes it again. */
  async function drawModel(modelId: string): Promise<ThumbnailResult> {
    const model = await library.load(modelId);
    if (model === null) return { dataUrl: null, source: "FALLBACK" };
    const stageParts = stage();
    if (stageParts === null) return { dataUrl: null, source: "FALLBACK" };

    // A clone, not the cached model: the ghost and the world must not inherit a thumbnail's scale, and
    // a thumbnail must not dispose geometry the world is still drawing.
    const instance = model.clone(true);
    // Measured from the vertices, with the outer five per cent of each axis trimmed: a bounding box is
    // honest about vertices and dishonest about pictures, and a plant that is mostly transparent
    // margin framed by its raw box fills a card with nothing.
    const measured = measureModel(instance);
    const framing = thumbnailFraming(measured.size);
    const holder = new Group();
    // Sit the object on the ground and centre it, whatever its own origin was.
    instance.position.set(-measured.center.x, -measured.min.y, -measured.center.z);
    holder.add(instance);
    holder.scale.setScalar(framing.scale);
    stageParts.scene.add(holder);
    if (ground !== null) ground.scale.setScalar(Math.max(1.2, framing.cameraDistance * 0.42));

    const focus = new Vector3(0, framing.centerY * 0.9, 0);
    stageParts.camera.position.copy(VIEW_DIRECTION).multiplyScalar(framing.cameraDistance).add(focus);
    stageParts.camera.lookAt(focus);
    stageParts.renderer.render(stageParts.scene, stageParts.camera);
    const dataUrl = stageParts.renderer.domElement.toDataURL("image/png");
    stageParts.scene.remove(holder);
    // The clone shares geometry and materials with the cached model, so only its own transform is
    // discarded; disposing here would break the world.
    return { dataUrl, source: "MODEL" };
  }

  /**
   * Draws a short road segment in the tier's own surface.
   *
   * The geometry is the *runtime* one - the same `buildRoadSpec` and the same ribbon the island draws -
   * so a dirt thumbnail cannot drift away from what a dirt road looks like, and a tier with no runtime
   * material is shown in its preview colour and flagged as provisional.
   */
  function drawRoad(tierId: RoadTierId): ThumbnailResult {
    const style = ROAD_PREVIEW_STYLES[tierId];
    const stageParts = stage();
    if (stageParts === null) return { dataUrl: null, source: "FALLBACK" };

    const frame = worldFrame();
    const pitch = frame.pitch;
    // Four cells, laid north to south, in world units: a segment exactly as the shop sells it.
    const road: Road = {
      id: `preview_${tierId}`,
      kind: style.cobbled ? "PRIMARY" : "SECONDARY",
      connects: [],
      points: [
        { x: 0, y: 0 },
        { x: 0, y: ROAD_SEGMENT_CELLS }
      ]
    };
    // A real layout, from the real builder: the preview must go through the same code path the island
    // does, or it is a drawing of a road rather than a road.
    const layout = layoutFarmTiles([{ x: 0, y: 0 }]);
    const spec = buildRoadSpec(road, layout, TERRAIN_SHAPE);
    const origin = spec.samples[0];
    if (origin === undefined) return { dataUrl: null, source: "FALLBACK" };
    const surface = new MeshStandardMaterial({
      color: style.surface,
      roughness: style.cobbled ? 0.9 : 0.97,
      vertexColors: true
    });
    const ribbon = new Mesh(
      toGeometry(ribbonSurface([spec], [style.cobbled ? "PRIMARY" : "SECONDARY"])),
      surface
    );
    // The ribbon is built in *world* coordinates, so the road's own start has to become the mesh's
    // local origin. Posing the mesh instead of the geometry is what turned four cards into plain
    // grass on the first attempt: a mesh whose vertices still carry world positions is *placed* by
    // its transform rather than drawn where the geometry says it is.
    ribbon.geometry.translate(-origin.worldX, -origin.worldY, -origin.worldZ);
    // A hair above the grass: the preview road is drawn on the *same* ground plane the disc is, and
    // two coplanar surfaces fight for the pixel - which showed up as a card with no road on it at all.
    ribbon.position.y = 0.03;
    const group = new Group();
    group.add(ribbon);
    const geometryToDispose: BufferGeometry[] = [ribbon.geometry];
    if (style.cobbled) {
      const plates = new Mesh(toGeometry(stonePlateSurface([spec])), surface);
      plates.geometry.translate(-origin.worldX, -origin.worldY, -origin.worldZ);
      plates.position.y = 0.04;
      geometryToDispose.push(plates.geometry);
      group.add(plates);
    }
    const length = ROAD_SEGMENT_CELLS * pitch;
    stageParts.scene.add(group);
    // Grass, not cream: a road card is a road in a field, which is the thing being sold.
    const grassTexture = ground?.material as MeshStandardMaterial | undefined;
    grassTexture?.color.setHex(PREVIEW_GRASS);
    // Wide enough that the four-cell segment sits *on* the platform rather than hanging off it.
    if (ground !== null) ground.scale.setScalar(length * 1.35);

    // Frame the whole four-cell segment with grass around it: the card sells "a short piece of road in
    // a field", and a segment that runs off all four corners is a swatch, not a road.
    const focus = new Vector3(0, 0, length / 2);
    const distance = length * 2.1;
    stageParts.camera.position
      .copy(new Vector3(1, 1.35, 1.15).normalize())
      .multiplyScalar(distance)
      .add(focus);
    stageParts.camera.lookAt(focus);
    stageParts.renderer.render(stageParts.scene, stageParts.camera);
    const dataUrl = stageParts.renderer.domElement.toDataURL("image/png");
    stageParts.scene.remove(group);
    for (const geometry of geometryToDispose) geometry.dispose();
    surface.dispose();
    grassTexture?.color.setHex(0xe6dcc4);
    return { dataUrl, source: "ROAD" };
  }

  return {
    async render(request: ThumbnailRequest): Promise<ThumbnailResult> {
      const key = thumbnailCacheKey(request);
      const hit = cache.get(key);
      if (hit !== undefined) {
        cached += 1;
        return hit;
      }
      const result =
        request.roadTierId !== null && isRoadTier(request.roadTierId)
          ? drawRoad(request.roadTierId)
          : request.modelId !== null
            ? await drawModel(request.modelId)
            : { dataUrl: null, source: "FALLBACK" as const };
      drawn += 1;
      // Only a real picture is cached: caching a failure would make one flaky download permanent.
      if (result.dataUrl !== null) cache.set(key, result);
      return result;
    },
    stats(): { readonly drawn: number; readonly cached: number } {
      return { drawn, cached };
    },
    dispose(): void {
      disposed = true;
      cache.clear();
      if (ground !== null) {
        ground.geometry.dispose();
        const material = ground.material as MeshStandardMaterial;
        material.dispose();
        ground = null;
      }
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
    }
  };
}

function isRoadTier(value: string): value is RoadTierId {
  return (ROAD_TIERS as readonly string[]).includes(value);
}

/**
 * What a model *looks* like: its trimmed bounds, and the centre and size a thumbnail frames.
 *
 * Every vertex of every mesh is gathered in the model's own space, then the outer five per cent of
 * each axis is dropped before the box is taken. That is what lets one rule frame a barn, a pine tree,
 * a boulder and a fern at roughly the same visual weight: the fern's card is mostly empty quad, and
 * the boulder's is a solid lump, and their raw bounding boxes say very different things about how big
 * they look.
 *
 * Falls back to the ordinary bounding box when a model has no vertices to sample, so a model that is
 * only transforms still appears.
 */
function measureModel(instance: Object3D): {
  readonly min: { readonly x: number; readonly y: number; readonly z: number };
  readonly center: { readonly x: number; readonly y: number; readonly z: number };
  readonly size: { readonly x: number; readonly y: number; readonly z: number };
} {
  instance.updateWorldMatrix(true, true);
  const vertices: number[] = [];
  const point = new Vector3();
  instance.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry as BufferGeometry;
    // three's types say this is always present; at runtime a mesh without `position` is possible, and
    // a thumbnail must survive one rather than throw inside a card.
    const position = geometry.getAttribute("position") as
      | BufferAttribute
      | InterleavedBufferAttribute
      | undefined;
    if (position === undefined) return;
    for (let index = 0; index < position.count; index += 1) {
      point.set(position.getX(index), position.getY(index), position.getZ(index));
      point.applyMatrix4(child.matrixWorld);
      vertices.push(point.x, point.y, point.z);
    }
  });
  const bounds = trimmedBounds(vertices);
  if (bounds === null) {
    const box = new Box3().setFromObject(instance);
    const size = box.getSize(new Vector3());
    return {
      min: { x: box.min.x, y: box.min.y, z: box.min.z },
      center: { x: (box.min.x + box.max.x) / 2, y: (box.min.y + box.max.y) / 2, z: (box.min.z + box.max.z) / 2 },
      size: { x: size.x, y: size.y, z: size.z }
    };
  }
  return {
    min: { x: bounds.minX, y: bounds.minY, z: bounds.minZ },
    center: {
      x: (bounds.minX + bounds.maxX) / 2,
      y: (bounds.minY + bounds.maxY) / 2,
      z: (bounds.minZ + bounds.maxZ) / 2
    },
    size: boundsSize(bounds)
  };
}

/** Turns a surface of loose arrays into the geometry a preview mesh needs. */
function toGeometry(data: SurfaceData): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
  if (data.colors !== null) geometry.setAttribute("color", new BufferAttribute(data.colors, 3));
  geometry.setIndex(new BufferAttribute(data.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}
