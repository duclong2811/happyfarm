import { catalogueLabel, gameplayFor, placementEntries, roadTiers } from "@happy-farm/game-data";
import type { BuildCatalogEntryDTO } from "@happy-farm/contracts";

/**
 * The build catalogue, as the client reads it.
 *
 * A projection and nothing else: the game-data catalogue is the source, this is the shape that crosses
 * the wire, and the mapping is total so a new field on an entry has to be given a DTO rather than
 * quietly dropped. There is no filtering, no per-player view, and no price calculation here - a price
 * is the catalogue's own number, and a level is checked against the player by the command that
 * eventually places something, not by the list that advertises it.
 */
export function listBuildCatalog(): readonly BuildCatalogEntryDTO[] {
  return placementEntries.map((entry) => ({
    entryId: entry.id,
    category: entry.category,
    displayNameKey: entry.displayNameKey,
    label: catalogueLabel(entry),
    descriptionKey: entry.descriptionKey,
    modelId: entry.modelId,
    requiredLevel: entry.requiredLevel,
    price: entry.price,
    currencyDefinitionId: entry.currencyDefinitionId,
    footprint: { widthCells: entry.footprint.widthCells, depthCells: entry.footprint.depthCells },
    allowedTerrain: [...entry.allowedTerrain],
    tier: entry.tier,
    tierRank: entry.tier === null ? null : (roadTiers.get(entry.tier)?.rank ?? null),
    // The effect data the shop is allowed to describe, and the status it must be honest about.
    gameplay: essentialGameplay(entry.id),
    upgradeTo: entry.upgradeTo,
    rotatable: entry.rotatable,
    movable: entry.movable,
    storable: entry.storable,
    removable: entry.removable,
    removalRefundRate: entry.removalRefundRate,
    decorative: entry.decorative,
    tags: [...entry.tags],
    unlockCondition: entry.unlockCondition
  }));
}

/**
 * The gameplay definition as the wire carries it.
 *
 * A catalogue entry with no definition is a loading error rather than a row the shop has to guess
 * about: `gameplayCoverageProblems` exists for that, and this throws so a broken catalogue fails the
 * request instead of shipping an item whose effects nobody can describe.
 */
function essentialGameplay(entryId: string): BuildCatalogEntryDTO["gameplay"] {
  const definition = gameplayFor(entryId);
  if (definition === null) {
    throw new Error(`Build catalogue entry has no gameplay definition: ${entryId}`);
  }
  return {
    classification: definition.classification,
    status: definition.status,
    summaryKey: definition.summaryKey,
    production: definition.production,
    storage: definition.storage,
    movement: definition.movement,
    workerTask: definition.workerTask
  };
}
