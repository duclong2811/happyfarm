import bushModelUrl from "../assets/models/kenney-nature/bush.glb?url";
import flowerModelUrl from "../assets/models/kenney-nature/flower.glb?url";
import pineModelUrl from "../assets/models/kenney-nature/pine.glb?url";
import rockModelUrl from "../assets/models/kenney-nature/rock.glb?url";
import treeModelUrl from "../assets/models/kenney-nature/tree.glb?url";
import type { SceneryKind } from "./scenery";

/**
 * Curated CC0 models from Kenney's Nature Kit. Keeping this mapping explicit means adding a new
 * environment asset is a deliberate bundle-size decision, rather than importing the whole pack.
 */
export const ENVIRONMENT_MODEL_URLS: Readonly<Record<SceneryKind, string>> = {
  tree: treeModelUrl,
  pine: pineModelUrl,
  bush: bushModelUrl,
  rock: rockModelUrl,
  flower: flowerModelUrl
};
