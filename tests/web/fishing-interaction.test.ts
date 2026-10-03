import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FishingSpotDTO } from "@happy-farm/contracts";
import { fish } from "@happy-farm/game-data";
import { tileToWorld, worldFrame } from "../../apps/web/src/render/layout";
import { fishModelUrl } from "../../apps/web/src/render/model-urls";
import {
  INTERACTION_RANGE_WORLD,
  interactionPromptFor
} from "../../apps/web/src/interaction/model";
import {
  buildInteractionIndex,
  type InteractionWorldInput
} from "../../apps/web/src/interaction/registry";
import {
  interactionActivation,
  selectInteractionCandidate
} from "../../apps/web/src/interaction/selection";
import { inventoryCards, inventoryTabs } from "../../apps/web/src/items/catalogue";

/**
 * Fishing as Character gameplay: water becomes a target the existing interaction system discovers.
 *
 * The spot is a place, so it is bucketed and ranged like everything else - no second proximity scanner,
 * no fishing-only prompt. The model manifest and the inventory tab are here too, because "the catch
 * reaches the player" means a picture and a shelf as much as a reward.
 */

const POND_NORTH: FishingSpotDTO = {
  spotId: "spot_pond_north",
  displayNameKey: "spot.pond_north.name",
  zoneKind: "HOME_ISLAND",
  position: { x: -3, y: 42 },
  interactionRadiusTiles: 3,
  tableId: "fishtable_freshwater"
};

function world(spots: readonly FishingSpotDTO[]): InteractionWorldInput {
  return {
    crops: [],
    trees: [],
    constructions: [],
    cropDefinitions: [],
    treeDefinitions: [],
    worldObjects: new Map(),
    buildCatalog: [],
    fishingSpots: spots,
    nowMs: 0
  };
}

describe("fishing spots in the interaction system", () => {
  it("becomes a Fish target at the spot's own world position", () => {
    const index = buildInteractionIndex(world([POND_NORTH]));
    expect(index.targets).toHaveLength(1);
    const target = index.targets[0];
    expect(target).toMatchObject({
      key: "fishing:spot_pond_north",
      kind: "FISHING_SPOT",
      action: "FISH",
      targetId: "spot_pond_north",
      nameKey: "spot.pond_north.name"
    });

    const at = tileToWorld(POND_NORTH.position, worldFrame());
    const candidate = selectInteractionCandidate(index, {
      worldX: at.worldX,
      worldZ: at.worldZ,
      facingYaw: 0
    });
    expect(candidate?.action).toBe("FISH");
    expect(candidate?.distanceWorld).toBe(0);
  });

  it("offers the Fish prompt, and activation asks the server for that spot", () => {
    const index = buildInteractionIndex(world([POND_NORTH]));
    const at = tileToWorld(POND_NORTH.position, worldFrame());
    const candidate = selectInteractionCandidate(index, {
      worldX: at.worldX,
      worldZ: at.worldZ,
      facingYaw: 0
    });
    if (candidate === null) throw new Error("fixture produced no candidate");
    expect(interactionPromptFor(candidate).actionKey).toBe("interaction.fish");
    // The activation carries the spot id and nothing else: no fish, no reward, no duration.
    expect(interactionActivation(candidate, candidate)).toEqual({
      kind: "FISH",
      spotId: "spot_pond_north",
      target: candidate
    });
    expect(candidate.version).toBe(0);
  });

  it("is out of reach from across the island, like any other target", () => {
    const index = buildInteractionIndex(world([POND_NORTH]));
    const at = tileToWorld(POND_NORTH.position, worldFrame());
    expect(
      selectInteractionCandidate(index, {
        worldX: at.worldX + INTERACTION_RANGE_WORLD.FISHING_SPOT + 1,
        worldZ: at.worldZ,
        facingYaw: 0
      })
    ).toBeNull();
  });

  it("adds no target when the catalogue is absent", () => {
    const input = world([]);
    const withoutSpots: InteractionWorldInput = { ...input };
    delete (withoutSpots as { fishingSpots?: unknown }).fishingSpots;
    expect(buildInteractionIndex(withoutSpots).targets).toEqual([]);
  });
});

describe("the fish model manifest", () => {
  const MODEL_DIRECTORY = fileURLToPath(new URL("../../apps/web/src/assets/models/fishing/", import.meta.url));

  it("ships a model for every species the server can catch", () => {
    for (const definition of fish) {
      const url = fishModelUrl(definition.modelId);
      expect(url, definition.id).toBeTypeOf("string");
      expect(existsSync(`${MODEL_DIRECTORY}${definition.modelId}.glb`), definition.modelId).toBe(true);
    }
  });

  it("answers null for a species this build has never heard of", () => {
    expect(fishModelUrl("fish_leviathan")).toBeNull();
    expect(fishModelUrl(null)).toBeNull();
  });
});

describe("the catch in the inventory", () => {
  it("gets its own tab, and shows the species' own picture", () => {
    const cards = inventoryCards({
      inventory: [
        {
          itemDefinitionId: "item_fish_tuna",
          displayNameKey: "item.fish_tuna.name",
          category: "FISH",
          quantity: 2
        }
      ],
      cropDefinitions: [],
      treeDefinitions: [],
      fish: [
        {
          fishDefinitionId: "fish_tuna",
          displayNameKey: "fish.tuna.name",
          itemDefinitionId: "item_fish_tuna",
          itemDisplayNameKey: "item.fish_tuna.name",
          modelId: "fish_tuna",
          sellPrice: 15,
          xp: 8,
          requiredLevel: 1
        }
      ]
    });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.category).toBe("FISH");
    expect(cards[0]?.visual.key).toContain("fish_tuna");
    expect(cards[0]?.visual.request.modelId).toContain("fish_tuna");
    expect(inventoryTabs(cards)).toEqual(["ALL", "FISH"]);
  });
});
