import type { FleetResponse } from "@happy-farm/contracts";
import { describe, expect, it } from "vitest";
import { shipPanelModel, type ShipPanelInput } from "../../apps/web/src/ship-panel";
import { FIXTURE_PLAYER_UUID, fleetResponse } from "../support/fleet-fixture";

/**
 * The ship's panel (ship-panel.ts): which requests it offers from where the ship lies, and how it
 * words them. It decides nothing the server does not decide again.
 */

const NOW = Date.parse("2026-11-20T10:00:00.000Z");

const translate: ShipPanelInput["translate"] = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`);

function fleet(overrides: Parameters<typeof fleetResponse>[0] = {}): FleetResponse {
  return fleetResponse(overrides);
}

function model(input: Partial<ShipPanelInput> & { fleet: FleetResponse }): ReturnType<typeof shipPanelModel> {
  return shipPanelModel({ serverNowMs: NOW, playerLevel: 30, ambushDue: false, canHelm: true, placeName: (slotId) => `place(${slotId})`, translate, ...input });
}

const voyage = (arrived: boolean, ambush: NonNullable<FleetResponse["voyage"]>["ambush"] = null): NonNullable<FleetResponse["voyage"]> => ({
  shipId: `ship_${FIXTURE_PLAYER_UUID}`,
  fromSlotId: "slot_north_1_1",
  toSlotId: "slot_north_1_2",
  departedAt: "2026-11-20T09:55:00.000Z",
  arrivesAt: arrived ? "2026-11-20T09:59:00.000Z" : "2026-11-20T10:04:30.000Z",
  arrived,
  ambush
});

describe("the ship's panel", () => {
  it("offers sailing, the helm, the upgrade and its price at the pier, and leads with sailing", () => {
    const view = model({ fleet: fleet() });
    expect(view.modelId).toBe("ship_sloop");
    expect(view.where).toBe("shipPanel.atHome");
    expect(view.actions.map((action) => [action.kind, action.enabled, action.primary])).toEqual([
      ["SAIL", true, true],
      ["HELM", true, false],
      ["UPGRADE", true, false],
      ["DOCK", true, false]
    ]);
    expect(view.actions[2]?.detail).toBe('shipPanel.buildCost:{"gold":3000,"wood":500,"ore":300}');
    expect(view.actions[2]?.shipId).toBe(`ship_${FIXTURE_PLAYER_UUID}`);
    expect(view.next).toContain("ship.class.ship_class_brig");
  });

  it("offers the helm only where the ship can be drawn and only while it floats", () => {
    expect(model({ fleet: fleet(), canHelm: false }).actions.map((action) => action.kind)).not.toContain("HELM");
    const sunk = fleet({ ship: { hull: 0 } });
    expect(model({ fleet: sunk }).actions.map((action) => action.kind)).not.toContain("HELM");
    // At sea or at a place there is no ship at the pier to take.
    expect(model({ fleet: fleet({ location: "AT_SEA", voyage: voyage(false) }) }).actions.map((action) => action.kind)).not.toContain("HELM");
  });

  it("says when the build needs a higher level, and offers repair at its cost when the hull is down", () => {
    const view = model({ fleet: fleet({ ship: { hull: 100 } }), playerLevel: 12 });
    const repair = view.actions.find((action) => action.kind === "REPAIR");
    expect(repair?.detail).toBe('shipPanel.repairCost:{"gold":100,"wood":13}');
    const upgrade = view.actions.find((action) => action.kind === "UPGRADE");
    expect(upgrade).toMatchObject({ enabled: false, detail: 'shipPanel.buildLevel:{"level":25}' });
  });

  it("will not sail a sunk ship, and leads with the repair", () => {
    const view = model({ fleet: fleet({ ship: { hull: 0 } }) });
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

  it("lists a berth per ship and an empty one while the dock has room, and builds any role into it", () => {
    const fishing = { shipId: `ship_${FIXTURE_PLAYER_UUID}_2`, berth: 2, classId: "ship_class_rowboat", role: "FISHING" as const, rank: 1, tier: 1, hull: 60, hullMax: 60, cannons: 0, hold: 20, upgrade: null };
    const base = fleet();
    const two = fleetResponse({ ships: [base.ship, { ...base.ship, ...fishing }], dock: { ...base.dock, tier: 3, berths: 3, freeBerths: 1, next: null } });
    const view = model({ fleet: two });
    expect(view.dock).toBe('shipPanel.dock:{"tier":3,"used":2,"berths":3}');
    expect(view.berths.map((berth) => [berth.label, berth.selected, berth.empty])).toEqual([
      ["ship.class.ship_class_sloop", true, false],
      ["ship.class.ship_class_rowboat", false, false],
      ["shipPanel.berthEmpty", false, true]
    ]);
    // The dock at its largest offers no raise.
    expect(view.actions.map((action) => action.kind)).not.toContain("DOCK");

    const boat = model({ fleet: two, selected: { kind: "SHIP", shipId: fishing.shipId } });
    expect(boat.name).toBe("ship.class.ship_class_rowboat");
    expect(boat.actions.find((action) => action.kind === "SAIL")?.shipId).toBe(fishing.shipId);

    const empty = model({ fleet: two, selected: { kind: "BERTH" }, playerLevel: 20 });
    expect(empty.modelId).toBeNull();
    expect(empty.hull).toBeNull();
    expect(empty.actions.map((action) => [action.kind, action.role, action.enabled])).toEqual([
      ["BUILD", "FISHING", true],
      ["BUILD", "MERCHANT", false],
      ["BUILD", "WAR", true]
    ]);
    expect(empty.actions[1]?.detail).toBe('shipPanel.buildLevel:{"level":50}');
    // A full dock has no empty berth; asking for one falls back to the ship in hand.
    const full = model({ fleet: fleet(), selected: { kind: "BERTH" } });
    expect(full.berths.some((berth) => berth.empty)).toBe(false);
    expect(full.name).toBe("ship.class.ship_class_sloop");
  });

  it("keeps the ships at the dock waiting while another is out, and says the lent rowboat gives way", () => {
    const base = fleet();
    const away = { ...base.ship, shipId: `ship_${FIXTURE_PLAYER_UUID}_2`, berth: 2, away: true };
    const out = fleetResponse({ ship: { ...away }, ships: [base.ship, away], location: "AT_SEA", voyage: { ...voyage(false), shipId: away.shipId } });
    const home = model({ fleet: out, selected: { kind: "SHIP", shipId: base.ship.shipId } });
    expect(home.actions.find((action) => action.kind === "SAIL")).toMatchObject({ enabled: false, detail: "shipPanel.otherAway" });
    expect(home.actions.map((action) => action.kind)).not.toContain("HELM");
    expect(home.actions.map((action) => action.kind)).toContain("UPGRADE");
    expect(model({ fleet: out }).actions.map((action) => action.kind)).toEqual(["COME_HOME"]);

    const lent = fleetResponse({ ship: { lent: true, classId: "ship_class_rowboat", role: "FISHING", hull: 60, hullMax: 60 }, dock: { ...base.dock, freeBerths: 1 } });
    const berth = model({ fleet: lent, selected: { kind: "BERTH" } });
    expect(berth.stats).toBe("shipPanel.replaceLent");
    expect(model({ fleet: lent }).berths[0]?.detail).toBe("shipPanel.lent");
  });
});
