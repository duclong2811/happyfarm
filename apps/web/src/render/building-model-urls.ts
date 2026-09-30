import barnT1Url from "../assets/models/farm-buildings/farm.barn.t1.glb?url";
import barnT2Url from "../assets/models/farm-buildings/farm.barn.t2.glb?url";
import barnT3Url from "../assets/models/farm-buildings/farm.barn.t3.glb?url";
import coopUrl from "../assets/models/farm-buildings/farm.coop.t1.glb?url";
import openBarnUrl from "../assets/models/farm-buildings/farm.openbarn.t1.glb?url";
import siloUrl from "../assets/models/farm-buildings/farm.silo.t1.glb?url";
import siloHouseUrl from "../assets/models/farm-buildings/farm.silo_house.t2.glb?url";
import windmillT2Url from "../assets/models/farm-buildings/farm.windmill.t2.glb?url";
import wellUrl from "../assets/models/farm-buildings/civic.well.t1.glb?url";

/**
 * The building models, keyed by the deterministic id a `BuildingVariant` names.
 *
 * A world definition says `farm.barn.t2`, never a file. That is what lets a tier be swapped, a pack be
 * replaced, or a model be dropped without the world layout code learning about it - and it is what
 * `docs/ASSET_LICENSES.md` can point at when somebody asks where a barn came from.
 *
 * `sizeWorld` is how large the model is drawn, in metres, measured across its largest dimension: the
 * importers normalize every model to one unit, so this number *is* the building's size. A barn is six
 * metres across, a well is two, and the player is 1.6 tall - which is what makes the settlement read
 * as a place at estate zoom instead of as specks on a lawn.
 */
export interface BuildingModelEntry {
  readonly id: string;
  readonly url: string;
  readonly sizeWorld: number;
}

export const BUILDING_MODELS: ReadonlyMap<string, BuildingModelEntry> = new Map(
  (
    [
      { id: "farm.barn.t1", url: barnT1Url, sizeWorld: 4.6 },
      { id: "farm.barn.t2", url: barnT2Url, sizeWorld: 6.4 },
      { id: "farm.barn.t3", url: barnT3Url, sizeWorld: 8.4 },
      { id: "farm.openbarn.t1", url: openBarnUrl, sizeWorld: 5.2 },
      { id: "farm.silo.t1", url: siloUrl, sizeWorld: 3.6 },
      { id: "farm.silo_house.t2", url: siloHouseUrl, sizeWorld: 5.6 },      { id: "farm.windmill.t2", url: windmillT2Url, sizeWorld: 8.6 },      { id: "civic.well.t1", url: wellUrl, sizeWorld: 2.1 },
      { id: "farm.coop.t1", url: coopUrl, sizeWorld: 1.6 }
    ] as const
  ).map((entry) => [entry.id, entry])
);

/** Every building model the client may load, for the asset test to walk. */
export const BUILDING_MODEL_IDS: readonly string[] = [...BUILDING_MODELS.keys()];
