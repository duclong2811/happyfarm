import { catalogueLabel, placementEntries } from "@happy-farm/game-data";
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
    capability: entry.capability,
    tier: entry.tier,
    upgradeTo: entry.upgradeTo,
    rotatable: entry.rotatable,
    decorative: entry.decorative,
    tags: [...entry.tags],
    unlockCondition: entry.unlockCondition
  }));
}
