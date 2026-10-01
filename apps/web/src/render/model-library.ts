import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Mesh, type BufferGeometry, type Material, type Object3D } from "three";
import { CROP_MODEL_URLS } from "./model-urls";
import { ENVIRONMENT_MODEL_URL_BY_ID } from "./environment-model-urls";
import { PROP_MODEL_URL_BY_ID } from "./prop-model-urls";
import { BUILDING_MODELS } from "./building-model-urls";
import { GENERATED_MODEL_URLS, type GeneratedModelId } from "./generated-model-urls";
import { cropModelId } from "./assets";

/**
 * Every model the client can draw, behind one cache and one loader.
 *
 * Before this module the scene owned four caches (crops, scenery, props, buildings) and four loaders,
 * each with its own idea of "where is this file" and "is it already arriving". A shop that has to draw
 * the *same* assets as thumbnails cannot do that from inside the scene, and a second loader would mean
 * downloading the same barn twice - so the cache moved here, where the world, the thumbnails and the
 * placement ghost can all reach it.
 *
 * Three rules:
 *
 * * **One URL table per family, and none here.** The ids and their files are owned by the existing
 *   manifests; this module only knows which manifest to ask.
 * * **Lazy, and never twice.** A model is fetched the first time something asks, and every later ask -
 *   world, thumbnail, ghost - joins the same promise or reads the same cached object.
 * * **The caller gets the original.** Cloning is the caller's business: a model instance is shared, and
 *   a thumbnail or a ghost that mutated it would change the world.
 */

export interface ModelLibrary {
  /** The model if it is loaded, otherwise undefined - and the load starts. */
  get(modelId: string): Object3D | undefined;
  /** The model, waiting for it if it has not arrived. Null when nothing can draw this id. */
  load(modelId: string): Promise<Object3D | null>;
  /** Called once per model that arrives, so a caller can redraw what was waiting for it. */
  onArrive(listener: (modelId: string) => void): () => void;
  /** Whether anything is still downloading. */
  isLoading(): boolean;
  dispose(): void;
}

/** Where a model id lives, or undefined when this build ships nothing for it. */
export function modelUrlFor(modelId: string): string | undefined {
  const crop = cropModelId(modelId);
  if (crop !== null) return CROP_MODEL_URLS[crop];
  const environment = ENVIRONMENT_MODEL_URL_BY_ID.get(modelId);
  if (environment !== undefined) return environment;
  const prop = PROP_MODEL_URL_BY_ID.get(modelId);
  if (prop !== undefined) return prop;
  const building = BUILDING_MODELS.get(modelId);
  if (building !== undefined) return building.url;
  const generated = GENERATED_MODEL_URLS[modelId as GeneratedModelId];
  return generated;
}

/** Releases the GPU resources of a model nothing will draw again. */
export function disposeModelResources(root: Object3D): void {
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return;
    const geometry = child.geometry as BufferGeometry | undefined;
    geometry?.dispose();
    const material = child.material as Material | Material[] | undefined;
    if (Array.isArray(material)) {
      for (const entry of material) entry.dispose();
    } else {
      material?.dispose();
    }
  });
}

export interface ModelLibraryOptions {
  /** Reported once per model this build cannot draw, so a host can surface a missing asset. */
  readonly onProblem?: (modelId: string, error: unknown) => void;
}

export function createModelLibrary(options: ModelLibraryOptions = {}): ModelLibrary {
  const loader = new GLTFLoader();
  const models = new Map<string, Object3D>();
  const inFlight = new Map<string, Promise<Object3D | null>>();
  const unavailable = new Set<string>();
  const listeners = new Set<(modelId: string) => void>();
  let disposed = false;

  function announce(modelId: string): void {
    for (const listener of listeners) listener(modelId);
  }

  function start(modelId: string): Promise<Object3D | null> {
    const existing = inFlight.get(modelId);
    if (existing !== undefined) return existing;
    const url = modelUrlFor(modelId);
    if (url === undefined) {
      unavailable.add(modelId);
      return Promise.resolve(null);
    }
    const promise = loader
      .loadAsync(url)
      .then((gltf) => {
        inFlight.delete(modelId);
        if (disposed) {
          disposeModelResources(gltf.scene);
          return null;
        }
        models.set(modelId, gltf.scene);
        announce(modelId);
        return gltf.scene;
      })
      .catch((error: unknown) => {
        inFlight.delete(modelId);
        unavailable.add(modelId);
        if (!disposed) options.onProblem?.(modelId, error);
        return null;
      });
    inFlight.set(modelId, promise);
    return promise;
  }

  return {
    get(modelId: string): Object3D | undefined {
      const model = models.get(modelId);
      if (model !== undefined) return model;
      if (!unavailable.has(modelId)) void start(modelId);
      return undefined;
    },
    load(modelId: string): Promise<Object3D | null> {
      const model = models.get(modelId);
      if (model !== undefined) return Promise.resolve(model);
      if (unavailable.has(modelId)) return Promise.resolve(null);
      return start(modelId);
    },
    onArrive(listener: (modelId: string) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    isLoading(): boolean {
      return inFlight.size > 0;
    },
    dispose(): void {
      disposed = true;
      for (const model of models.values()) disposeModelResources(model);
      models.clear();
      inFlight.clear();
      listeners.clear();
    }
  };
}

/** The shared library the client draws from. One per page, created on first use. */
let shared: ModelLibrary | null = null;

export function sharedModelLibrary(options: ModelLibraryOptions = {}): ModelLibrary {
  shared ??= createModelLibrary(options);
  return shared;
}
