import playerFarmerUrl from "../assets/models/player/player-farmer.glb?url";

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
