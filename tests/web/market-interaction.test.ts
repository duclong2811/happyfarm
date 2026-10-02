import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ConstructionDTO, WorldObjectDefinitionDTO } from "@happy-farm/contracts";
import {
  buildInteractionIndex,
  type InteractionWorldInput
} from "../../apps/web/src/interaction/registry";
import { interactionActivation, selectInteractionCandidate } from "../../apps/web/src/interaction/selection";
import type { WorldObjectDefinitions } from "../../apps/web/src/world-objects";

/**
 * The market stall as a gameplay object, and the rules that keep it honest.
 *
 * The stall is the first building that *does* something. It is identified by its own definition's
 * service - never by a model name, a mesh, or a distance to a hard-coded coordinate - and walking up to
 * it offers Trade exactly as walking up to a ripe crop offers Harvest. Opening the market is a UI
 * action: it sends no command, and it does not move the character or the camera.
 */

const MAIN = fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url));
const NOW = Date.parse("2026-10-02T12:00:00.000Z");

function objectDefinition(
  overrides: Partial<WorldObjectDefinitionDTO> = {}
): WorldObjectDefinitionDTO {
  return {
    id: "world.market_stall",
    displayNameKey: "object.market_stall.name",
    modelId: null,
    landmarkKind: "MARKET_STALL",
    sizeWorld: 1,
    collisionRadiusWorld: 1.2,
    footprint: { widthCells: 2, depthCells: 2 },
    allowedTerrain: ["LAND"],
    movable: true,
    rotatable: true,
    storable: true,
    removable: true,
    removalRefundRate: 0.5,
    service: "FARM_MARKET",
    ...overrides
  };
}

function row(overrides: Partial<ConstructionDTO> = {}): ConstructionDTO {
  return {
    constructionId: "construct_11111111-1111-4111-8111-111111111111",
    farmId: "farm_11111111-1111-4111-8111-111111111111",
    entryId: "world.market_stall",
    category: "BUILDING",
    anchorX: 10,
    anchorY: 4,
    rotation: 0,
    footprint: { widthCells: 2, depthCells: 2 },
    state: "ACTIVE",
    source: "STARTER",
    placementKey: "starter.building.market_stall",
    paidAmount: 0,
    costAmount: 0,
    costCurrencyDefinitionId: "currency_gold",
    createdAt: "2026-09-01T00:00:00.000Z",
    storedAt: null,
    version: 1,
    ...overrides
  };
}

function world(
  constructions: readonly ConstructionDTO[],
  definitions: WorldObjectDefinitions
): InteractionWorldInput {
  return {
    crops: [],
    trees: [],
    constructions,
    cropDefinitions: [],
    treeDefinitions: [],
    worldObjects: definitions,
    buildCatalog: [],
    nowMs: NOW
  };
}

function definitionsFor(...rows: readonly ConstructionDTO[]): WorldObjectDefinitions {
  return new Map(
    rows.map((definition) => [
      definition.entryId,
      objectDefinition({
        id: definition.entryId,
        displayNameKey: `object.${definition.entryId}.name`,
        service: definition.entryId === "world.market_stall" ? "FARM_MARKET" : null
      })
    ])
  );
}

describe("the market stall as an interaction target", () => {
  it("offers Trade when the character is standing at it", () => {
    const stall = row();
    const index = buildInteractionIndex(world([stall], definitionsFor(stall)));
    const target = index.targets[0];
    if (target === undefined) throw new Error("fixture produced no target");
    const candidate = selectInteractionCandidate(index, {
      worldX: target.worldX,
      worldZ: target.worldZ,
      facingYaw: null
    });
    expect(candidate?.action).toBe("TRADE");
    expect(candidate?.kind).toBe("WORLD_OBJECT");
    expect(candidate?.targetId).toBe(stall.constructionId);
    // Trade outranks looking at things, and shares a band with harvesting - both are "do something".
    expect(candidate?.priority).toBeGreaterThan(1);
  });

  it("offers Inspect, not Trade, at an ordinary building", () => {
    const barn = row({ entryId: "world.barn", placementKey: "starter.building.barn" });
    const index = buildInteractionIndex(world([barn], definitionsFor(barn)));
    const target = index.targets[0];
    if (target === undefined) throw new Error("fixture produced no target");
    const candidate = selectInteractionCandidate(index, {
      worldX: target.worldX,
      worldZ: target.worldZ,
      facingYaw: null
    });
    expect(candidate?.action).toBe("INSPECT");
  });

  it("does not offer anything at all from across the island", () => {
    const stall = row();
    const index = buildInteractionIndex(world([stall], definitionsFor(stall)));
    const target = index.targets[0];
    if (target === undefined) throw new Error("fixture produced no target");
    // Twenty metres away: outside the stall's own interaction range, so there is no candidate.
    const candidate = selectInteractionCandidate(index, {
      worldX: target.worldX + 20,
      worldZ: target.worldZ,
      facingYaw: null
    });
    expect(candidate).toBeNull();
  });

  it("turns activation into Trade, and a stale or changed stall into nothing", () => {
    const stall = row();
    const index = buildInteractionIndex(world([stall], definitionsFor(stall)));
    const target = index.targets[0];
    if (target === undefined) throw new Error("fixture produced no target");
    const here = { worldX: target.worldX, worldZ: target.worldZ, facingYaw: null };
    const candidate = selectInteractionCandidate(index, here);
    expect(interactionActivation(candidate, candidate)).toEqual({
      kind: "TRADE",
      service: "FARM_MARKET",
      target: candidate
    });
    // Walking away, or a different object becoming the candidate, activates nothing.
    expect(interactionActivation(candidate, null)).toEqual({ kind: "STALE", reason: "GONE" });
    const other = row({
      constructionId: "construct_22222222-2222-4222-8222-222222222222",
      entryId: "world.barn",
      placementKey: "starter.building.barn"
    });
    const otherIndex = buildInteractionIndex(world([other], definitionsFor(other)));
    const otherTarget = otherIndex.targets[0];
    if (otherTarget === undefined) throw new Error("fixture produced no target");
    const changed = selectInteractionCandidate(otherIndex, {
      worldX: otherTarget.worldX,
      worldZ: otherTarget.worldZ,
      facingYaw: null
    });
    expect(interactionActivation(candidate, changed)).toEqual({ kind: "STALE", reason: "CHANGED" });
  });

  it("offers nothing at a stall that is in storage", () => {
    const stored = row({ state: "STORED", storedAt: "2026-10-01T00:00:00.000Z" });
    const index = buildInteractionIndex(world([stored], definitionsFor(stored)));
    expect(index.targets).toEqual([]);
  });
});

describe("opening and closing the market", () => {
  const main = readFileSync(MAIN, "utf8");

  it("opens the market from the Trade action without sending a command", () => {
    const tradeCase = main.indexOf('case "TRADE"');
    expect(tradeCase).toBeGreaterThan(-1);
    const body = main.slice(tradeCase, main.indexOf('case "HARVEST_CROP"'));
    expect(body).toContain("openFarmMarketFromStall()");
    // Opening a *service* is a UI action: no fetch, no client, no settlement.
    expect(body).not.toContain("api(");
    expect(body).not.toContain("await ");
  });

  it("keeps the player where they are: opening it does not change the camera mode", () => {
    const open = main.indexOf("function openFarmMarket(");
    const end = main.indexOf("function openFarmMarketFromStall(");
    expect(open).toBeGreaterThan(-1);
    const body = main.slice(open, end);
    expect(body).not.toContain("setCameraMode");
    // It opens the market panel and nothing else.
    expect(body).toContain('setActivePanel(openPanel(panels, "market"))');
  });

  it("suppresses world input while a panel owns the screen", () => {
    // Walking, running and interaction all read this one condition, so a panel cannot be operated
    // while the character strolls away underneath it.
    const input = main.indexOf("readInput: () =>");
    const body = main.slice(input, input + 700);
    expect(body).toContain("panels.active !== null");
    expect(body).toContain("NEUTRAL_INPUT");
    expect(main).toContain("panels.active === null && state.cameraMode");
    // And the touch stick is put away with the panel rather than left live behind it.
    expect(main).toContain("panels.active === null");
  });
});
