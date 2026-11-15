import playerFarmerUrl from "../assets/models/player/player-farmer.glb?url";
import kenneyFemaleAUrl from "../assets/models/player/kenney-female-a.glb?url";
import kenneyFemaleBUrl from "../assets/models/player/kenney-female-b.glb?url";
import kenneyFemaleCUrl from "../assets/models/player/kenney-female-c.glb?url";
import kenneyFemaleDUrl from "../assets/models/player/kenney-female-d.glb?url";
import kenneyFemaleEUrl from "../assets/models/player/kenney-female-e.glb?url";
import kenneyFemaleFUrl from "../assets/models/player/kenney-female-f.glb?url";
import kenneyMaleBUrl from "../assets/models/player/kenney-male-b.glb?url";
import kenneyMaleCUrl from "../assets/models/player/kenney-male-c.glb?url";
import kenneyMaleDUrl from "../assets/models/player/kenney-male-d.glb?url";
import kenneyMaleEUrl from "../assets/models/player/kenney-male-e.glb?url";
import kenneyMaleFUrl from "../assets/models/player/kenney-male-f.glb?url";
import kenneyMaleGUrl from "../assets/models/player/kenney-male-g.glb?url";
import kenneyWorkerUrl from "../assets/models/player/kenney-worker.glb?url";
import kenneyKnightUrl from "../assets/models/player/kenney-knight.glb?url";
import kenneyRobotUrl from "../assets/models/player/kenney-robot.glb?url";
import kenneyAlienUrl from "../assets/models/player/kenney-alien.glb?url";

/**
 * The character models the client may draw, keyed by the id a presentation config names.
 *
 * Deliberately its own family rather than an entry in `generated-model-urls.ts`: those are authored by
 * HappyFarm's own pipeline, and this one is an imported third-party asset with a licence and a
 * provenance to keep track of. One table per family is the rule the model library already follows, so
 * the URL - and the fact that there is a pack behind it - lives in exactly one place.
 *
 * The file also lives in its own folder (`assets/models/player/`) rather than beside the generated
 * placeholder in `assets/models/characters/`: everything in a *generated* model's folder must be
 * declared by a spec in `tools/asset-pipeline/node/specs.mjs`, and an imported, licensed asset is not
 * something `npm run assets:generate` may overwrite.
 *
 * `provenance` is what `docs/assets/PLAYER_CHARACTER_ASSET.md` and `docs/ASSET_LICENSES.md` are
 * checked against: a shipped file that cannot be traced back to a creator and a licence is a problem
 * nobody can fix later.
 */
export interface CharacterModelEntry {
  /** The id the presentation config asks for. Namespaced, like every other id in the client. */
  readonly id: string;
  readonly url: string;
  readonly provenance: string;
}

export const CHARACTER_MODELS: ReadonlyMap<string, CharacterModelEntry> = new Map(
  (
    [
      {
        id: "character.player_farmer",
        url: playerFarmerUrl,
        provenance: "Kenney Mini Characters (CC0 1.0) - character-male-a.glb"
      },
      {
        id: "character.kenney_female_a",
        url: kenneyFemaleAUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-female-a.glb"
      },
      {
        id: "character.kenney_female_b",
        url: kenneyFemaleBUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-female-b.glb"
      },
      {
        id: "character.kenney_female_c",
        url: kenneyFemaleCUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-female-c.glb"
      },
      {
        id: "character.kenney_female_d",
        url: kenneyFemaleDUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-female-d.glb"
      },
      {
        id: "character.kenney_female_e",
        url: kenneyFemaleEUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-female-e.glb"
      },
      {
        id: "character.kenney_female_f",
        url: kenneyFemaleFUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-female-f.glb"
      },
      {
        id: "character.kenney_male_b",
        url: kenneyMaleBUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-male-b.glb"
      },
      {
        id: "character.kenney_male_c",
        url: kenneyMaleCUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-male-c.glb"
      },
      {
        id: "character.kenney_male_d",
        url: kenneyMaleDUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-male-d.glb"
      },
      {
        id: "character.kenney_male_e",
        url: kenneyMaleEUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-male-e.glb"
      },
      {
        id: "character.kenney_male_f",
        url: kenneyMaleFUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-male-f.glb"
      },
      {
        id: "character.kenney_male_g",
        url: kenneyMaleGUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-male-g.glb"
      },
      {
        id: "character.kenney_worker",
        url: kenneyWorkerUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-worker.glb"
      },
      {
        id: "character.kenney_knight",
        url: kenneyKnightUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-knight.glb"
      },
      {
        id: "character.kenney_robot",
        url: kenneyRobotUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-robot.glb"
      },
      {
        id: "character.kenney_alien",
        url: kenneyAlienUrl,
        provenance: "Kenney Mini Characters 2.0 (CC0 1.0) - character-alien.glb"
      }
    ] as const
  ).map((entry) => [entry.id, entry])
);

/** Every character model the client may load, in a stable order. */
export const CHARACTER_MODEL_IDS: readonly string[] = [...CHARACTER_MODELS.keys()].sort();

/** The file behind a character id. The renderer asks by id and never by file name. */
export const CHARACTER_MODEL_URL_BY_ID: ReadonlyMap<string, string> = new Map(
  [...CHARACTER_MODELS.values()].map((entry) => [entry.id, entry.url])
);
