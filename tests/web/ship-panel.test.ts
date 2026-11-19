import type { FleetResponse } from "@happy-farm/contracts";
import { describe, expect, it } from "vitest";
import { shipPanelModel, type ShipPanelInput } from "../../apps/web/src/ship-panel";

/**
 * The ship's panel (ship-panel.ts): which requests it offers from where the ship lies, and how it
 * words them. It decides nothing the server does not decide again.
 */

const NOW = Date.parse("2026-11-20T10:00:00.000Z");

const translate: ShipPanelInput["translate"] = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`);

function fleet(overrides: Partial<FleetResponse> = {}): FleetResponse {
  return {
    readAt: "2026-11-20T10:00:00.000Z",
    ship: { classId: "ship_class_sloop", tier: 2, hull: 150, hullMax: 150, speedTilesPerMinute: 70, cannons: 2 },
    next: {
      classId: "ship_class_brig",
      tier: 3,
      requiredPlayerLevel: 25,
      speedTilesPerMinute: 100,
      hull: 320,
      cannons: 6,
      cost: { currencyId: "currency_gold", gold: 3000, materials: [{ itemDefinitionId: "item_wood", quantity: 500 }, { itemDefinitionId: "item_ore", quantity: 300 }] }
    },
    location: "HOME",
    voyage: null,
    ...overrides
  };
}

function model(input: Partial<ShipPanelInput> & { fleet: FleetResponse }): ReturnType<typeof shipPanelModel> {
  return shipPanelModel({ serverNowMs: NOW, playerLevel: 30, ambushDue: false, canHelm: true, placeName: (slotId) => `place(${slotId})`, translate, ...input });
}

const voyage = (arrived: boolean, ambush: NonNullable<FleetResponse["voyage"]>["ambush"] = null): NonNullable<FleetResponse["voyage"]> => ({
  fromSlotId: "slot_north_1_1",
  toSlotId: "slot_north_1_2",
  departedAt: "2026-11-20T09:55:00.000Z",
  arrivesAt: arrived ? "2026-11-20T09:59:00.000Z" : "2026-11-20T10:04:30.000Z",
  arrived,
  ambush
});

describe("the ship's panel", () => {
  it("offers sailing, the helm, the build and its price at the pier, and leads with sailing", () => {
    const view = model({ fleet: fleet() });
    expect(view.modelId).toBe("ship_sloop");
    expect(view.where).toBe("shipPanel.atHome");
    expect(view.actions.map((action) => [action.kind, action.enabled, action.primary])).toEqual([
      ["SAIL", true, true],
      ["HELM", true, false],
      ["BUILD", true, false]
    ]);
    expect(view.actions[2]?.detail).toBe('shipPanel.buildCost:{"gold":3000,"wood":500,"ore":300}');
    expect(view.next).toContain("ship.class.ship_class_brig");
  });

  it("offers the helm only where the ship can be drawn and only while it floats", () => {
    expect(model({ fleet: fleet(), canHelm: false }).actions.map((action) => action.kind)).not.toContain("HELM");
    const sunk = fleet({ ship: { classId: "ship_class_sloop", tier: 2, hull: 0, hullMax: 150, speedTilesPerMinute: 70, cannons: 2 } });
    expect(model({ fleet: sunk }).actions.map((action) => action.kind)).not.toContain("HELM");
    // At sea or at a place there is no ship at the pier to take.
    expect(model({ fleet: fleet({ location: "AT_SEA", voyage: voyage(false) }) }).actions.map((action) => action.kind)).not.toContain("HELM");
  });

  it("says when the build needs a higher level, and offers repair at its cost when the hull is down", () => {
    const view = model({ fleet: fleet({ ship: { classId: "ship_class_sloop", tier: 2, hull: 100, hullMax: 150, speedTilesPerMinute: 70, cannons: 2 } }), playerLevel: 12 });
    const repair = view.actions.find((action) => action.kind === "REPAIR");
    expect(repair?.detail).toBe('shipPanel.repairCost:{"gold":100,"wood":13}');
    const build = view.actions.find((action) => action.kind === "BUILD");
    expect(build).toMatchObject({ enabled: false, detail: 'shipPanel.buildLevel:{"level":25}' });
  });

  it("will not sail a sunk ship, and leads with the repair", () => {
    const view = model({ fleet: fleet({ ship: { classId: "ship_class_sloop", tier: 2, hull: 0, hullMax: 150, speedTilesPerMinute: 70, cannons: 2 } }) });
    expect(view.actions.find((action) => action.kind === "SAIL")).toMatchObject({ enabled: false, primary: false, detail: "shipPanel.sunk" });
    expect(view.actions.find((action) => action.kind === "REPAIR")).toMatchObject({ enabled: true, primary: true });
  });

  it("counts down a voyage at sea and offers only calling the ship home", () => {
    const view = model({ fleet: fleet({ location: "AT_SEA", voyage: voyage(false) }) });
    expect(view.where).toBe('shipPanel.atSea:{"place":"place(slot_north_1_2)","minutes":5}');
    expect(view.actions.map((action) => action.kind)).toEqual(["COME_HOME"]);
  });

  it("offers a look round, sailing on, or home at an arrived place", () => {
    const view = model({ fleet: fleet({ location: "AT_PLACE", voyage: voyage(true) }) });
    expect(view.where).toBe('shipPanel.atPlace:{"place":"place(slot_north_1_2)"}');
    expect(view.actions.map((action) => [action.kind, action.primary])).toEqual([
      ["VISIT", true],
      ["SAIL", false],
      ["COME_HOME", false]
    ]);
  });

  it("puts the fight first when pirates have struck, and warns that going home fights without orders", () => {
    const struck = voyage(false, {
      at: "2026-11-20T09:58:00.000Z",
      status: "PENDING",
      pirates: ["pirate_cutter"],
      setup: { seed: 1, player: { hull: 150, hullMax: 150, cannons: 2, speed: 9, turn: 14, radius: 4.5, spread: 40 }, pirates: [{ hull: 80, hullMax: 80, cannons: 2, speed: 8, turn: 12, radius: 4, spread: 90 }] }
    });
    const view = model({ fleet: fleet({ location: "AT_SEA", voyage: struck }), ambushDue: true });
    expect(view.actions.map((action) => [action.kind, action.primary])).toEqual([
      ["FIGHT", true],
      ["COME_HOME", false]
    ]);
    expect(view.actions[1]?.detail).toBe("shipPanel.comeHomeAmbush");
  });
});
