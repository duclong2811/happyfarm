import type { FleetResponse } from "@happy-farm/contracts";
import { describe, expect, it } from "vitest";
import { shipPanelModel, type ShipDetailModel, type ShipPanelInput, type ShipyardModel, type DockDetailModel } from "../../apps/web/src/ship-panel";
import { FIXTURE_PLAYER_UUID, fleetResponse } from "../support/fleet-fixture";

/**
 * The fleet's panel (ship-panel.ts): which tiles, numbers and buttons it draws from the fleet read,
 * and which requests it offers from where each ship lies. It decides nothing the server does not
 * decide again.
 */

const NOW = Date.parse("2026-11-20T10:00:00.000Z");
const SHIP = `ship_${FIXTURE_PLAYER_UUID}`;

const translate: ShipPanelInput["translate"] = (key, params) => (params === undefined ? key : `${key}:${JSON.stringify(params)}`);

function fleet(overrides: Parameters<typeof fleetResponse>[0] = {}): FleetResponse {
  return fleetResponse(overrides);
}

function model(input: Partial<ShipPanelInput> & { fleet: FleetResponse }): ReturnType<typeof shipPanelModel> {
  return shipPanelModel({ serverNowMs: NOW, playerLevel: 30, ambushDue: false, canHelm: true, placeName: (slotId) => `place(${slotId})`, translate, ...input });
}

function ship(view: ReturnType<typeof shipPanelModel>): ShipDetailModel {
  if (view.detail.kind !== "SHIP") throw new Error(`expected a ship, got ${view.detail.kind}`);
  return view.detail;
}

const voyage = (arrived: boolean, ambush: NonNullable<FleetResponse["voyage"]>["ambush"] = null): NonNullable<FleetResponse["voyage"]> => ({
  shipId: SHIP,
  fromSlotId: "slot_north_1_1",
  toSlotId: "slot_north_1_2",
  departedAt: "2026-11-20T09:55:00.000Z",
  arrivesAt: arrived ? "2026-11-20T09:59:00.000Z" : "2026-11-20T10:04:30.000Z",
  arrived,
  ambush
});

describe("the fleet panel at the pier", () => {
  it("leads with sailing, offers the helm, and shows the ship's numbers as bars with the upgrade's gain", () => {
    const view = ship(model({ fleet: fleet() }));
    expect(view.modelId).toBe("ship_sloop");
    expect(view).toMatchObject({ role: "WAR", rank: 1, maxRank: 4, status: { icon: "anchor", text: "fleet.status.home", tone: "calm" }, warning: null });
    expect(view.actions.map((action) => [action.kind, action.icon, action.enabled, action.primary])).toEqual([
      ["SAIL", "sail", true, true],
      ["HELM", "helm", true, false]
    ]);
    expect(view.stats.map((stat) => [stat.icon, stat.value, stat.next])).toEqual([
      ["hull", 150, 320],
      ["speed", 70, 100],
      ["cannon", 2, 6],
      ["hold", 30, 50]
    ]);
    expect(view.upgrade).toMatchObject({ name: "ship.class.ship_class_brig", rank: 2, action: { kind: "UPGRADE", shipId: SHIP, lockLevel: null } });
    expect(view.upgrade?.action.cost).toEqual([
      { icon: "gold", amount: 3000, short: false },
      { icon: "wood", amount: 500, short: false },
      { icon: "ore", amount: 300, short: false }
    ]);
  });

  it("marks a price the island cannot pay, and locks what the player's level does not reach", () => {
    const view = ship(model({ fleet: fleet({ ship: { hull: 100 } }), playerLevel: 12, holdings: { gold: 2000, wood: 900, ore: 100 } }));
    expect(view.upgrade?.action).toMatchObject({ enabled: false, lockLevel: 25 });
    expect(view.upgrade?.action.cost.filter((chip) => chip.short).map((chip) => chip.icon)).toEqual(["gold", "ore"]);
    const repair = view.actions.find((action) => action.kind === "REPAIR");
    expect(repair?.cost).toEqual([
      { icon: "gold", amount: 100, short: false },
      { icon: "wood", amount: 13, short: false }
    ]);
  });

  it("offers the helm only where the ship can be drawn and only while it floats, and leads a sunk ship with the repair", () => {
    expect(ship(model({ fleet: fleet(), canHelm: false })).actions.map((action) => action.kind)).not.toContain("HELM");
    const sunk = ship(model({ fleet: fleet({ ship: { hull: 0 } }) }));
    expect(sunk.actions.map((action) => action.kind)).not.toContain("HELM");
    expect(sunk.warning).toBe("fleet.warn.sunk");
    expect(sunk.actions.find((action) => action.kind === "SAIL")).toMatchObject({ enabled: false, primary: false });
    expect(sunk.actions.find((action) => action.kind === "REPAIR")).toMatchObject({ enabled: true, primary: true });
  });
});

describe("the fleet panel with a ship away", () => {
  it("counts down a voyage at sea and offers only calling the ship home", () => {
    const view = ship(model({ fleet: fleet({ location: "AT_SEA", voyage: voyage(false) }) }));
    expect(view.status).toMatchObject({ icon: "sail", text: 'fleet.status.sea:{"place":"place(slot_north_1_2)","minutes":5}', tone: "busy" });
    expect(view.actions.map((action) => [action.kind, action.primary])).toEqual([["COME_HOME", true]]);
    expect(view.upgrade).toBeNull();
  });

  it("offers going ashore, sailing on, or home at an arrived place", () => {
    const view = ship(model({ fleet: fleet({ location: "AT_PLACE", voyage: voyage(true) }) }));
    expect(view.status.text).toBe('fleet.status.place:{"place":"place(slot_north_1_2)"}');
    expect(view.actions.map((action) => [action.kind, action.enabled, action.primary])).toEqual([
      ["VISIT", true, true],
      ["SAIL", true, false],
      ["COME_HOME", true, false]
    ]);
  });

  it("puts the fight first when pirates have struck, and says so", () => {
    const struck = voyage(false, {
      at: "2026-11-20T09:58:00.000Z",
      status: "PENDING",
      pirates: ["pirate_cutter"],
      setup: { seed: 1, player: { hull: 150, hullMax: 150, cannons: 2, speed: 9, turn: 14, radius: 4.5, spread: 40 }, pirates: [{ hull: 80, hullMax: 80, cannons: 2, speed: 8, turn: 12, radius: 4, spread: 90 }] }
    });
    const view = ship(model({ fleet: fleet({ location: "AT_SEA", voyage: struck }), ambushDue: true }));
    expect(view.status).toMatchObject({ icon: "fight", tone: "alert" });
    expect(view.actions.map((action) => [action.kind, action.primary])).toEqual([
      ["FIGHT", true],
      ["COME_HOME", false]
    ]);
    expect(view.actions[1]?.hint).toBe("shipPanel.comeHomeAmbush");
  });

  it("keeps the ships at the dock waiting while another is out", () => {
    const base = fleet();
    const away = { ...base.ship, shipId: `${SHIP}_2`, berth: 2, away: true };
    const out = fleetResponse({ ship: { ...away }, ships: [base.ship, away], location: "AT_SEA", voyage: { ...voyage(false), shipId: away.shipId } });
    const home = ship(model({ fleet: out, selected: { kind: "SHIP", shipId: base.ship.shipId } }));
    expect(home.warning).toBe("fleet.warn.otherAway");
    expect(home.actions.find((action) => action.kind === "SAIL")).toMatchObject({ enabled: false });
    expect(home.actions.map((action) => action.kind)).not.toContain("HELM");
    expect(home.upgrade).not.toBeNull();
    expect(ship(model({ fleet: out })).actions.map((action) => action.kind)).toEqual(["COME_HOME"]);
  });
});

describe("the berth tiles, the shipyard and the dock", () => {
  const fishing = { shipId: `${SHIP}_2`, berth: 2, classId: "ship_class_rowboat", role: "FISHING" as const, rank: 1, tier: 1, hull: 30, hullMax: 60, cannons: 0, hold: 20, upgrade: null };
  const base = fleet();
  const two = fleetResponse({ ships: [base.ship, { ...base.ship, ...fishing }], dock: { ...base.dock, tier: 2, berths: 3, freeBerths: 1, next: { tier: 3, berths: 5, requiredPlayerLevel: 50, cost: base.dock.next?.cost ?? { currencyId: "currency_gold", gold: 1, materials: [] } } } });

  it("draws a tile per ship, a free berth, and the berths the next dock would add, locked", () => {
    const view = model({ fleet: two });
    expect(view.dock).toEqual({ tier: 2, used: 2, berths: 3, selected: false, canGrow: true });
    expect(view.berths.map((tile) => [tile.kind, tile.modelId, tile.role, tile.rank, tile.selected])).toEqual([
      ["SHIP", "ship_sloop", "WAR", 1, true],
      ["SHIP", "ship_rowboat", "FISHING", 1, false],
      ["FREE", null, null, 0, false],
      ["LOCKED", null, null, 0, false],
      ["LOCKED", null, null, 0, false]
    ]);
    expect(view.berths[1]?.hull).toBe(0.5);
    expect(view.berths[3]?.selection).toEqual({ kind: "DOCK" });
    const boat = ship(model({ fleet: two, selected: { kind: "SHIP", shipId: fishing.shipId } }));
    expect(boat.name).toBe("ship.class.ship_class_rowboat");
    expect(boat.actions.find((action) => action.kind === "SAIL")?.shipId).toBe(fishing.shipId);
  });

  it("offers a ship of each role in the free berth, locked by level", () => {
    const view = model({ fleet: two, selected: { kind: "BERTH" }, playerLevel: 20 });
    const yard = view.detail as ShipyardModel;
    expect(yard.kind).toBe("SHIPYARD");
    expect(yard.note).toBeNull();
    expect(yard.cards.map((card) => [card.role, card.modelId, card.action.role, card.action.enabled, card.action.lockLevel])).toEqual([
      ["FISHING", "ship_rowboat", "FISHING", true, null],
      ["MERCHANT", "ship_coaster", "MERCHANT", false, 50],
      ["WAR", "ship_sloop", "WAR", true, null]
    ]);
    expect(yard.cards[0]?.stats.map((stat) => stat.icon)).toEqual(["speed", "cannon", "hold"]);
    // A full dock has no free berth; asking for one falls back to the ship in hand.
    const full = model({ fleet: fleet(), selected: { kind: "BERTH" } });
    expect(full.berths.some((tile) => tile.kind === "FREE")).toBe(false);
    expect(full.detail.kind).toBe("SHIP");
  });

  it("says the lent rowboat gives way to the first ship of one's own", () => {
    const lent = fleetResponse({ ship: { lent: true, classId: "ship_class_rowboat", role: "FISHING", hull: 60, hullMax: 60 }, dock: { ...base.dock, freeBerths: 1 } });
    expect((model({ fleet: lent, selected: { kind: "BERTH" } }).detail as ShipyardModel).note).toBe("fleet.replaceLent");
    expect(model({ fleet: lent }).berths[0]?.lent).toBe(true);
  });

  it("shows the dock, its next tier and the price, or that it is the largest", () => {
    const dock = model({ fleet: two, selected: { kind: "DOCK" }, playerLevel: 60 }).detail as DockDetailModel;
    expect(dock).toMatchObject({ kind: "DOCK", tier: 2, berths: 3, next: { tier: 3, berths: 5, action: { kind: "DOCK", enabled: true, primary: true, lockLevel: null } } });
    const largest = fleetResponse({ dock: { ...base.dock, tier: 4, berths: 5, freeBerths: 4, next: null } });
    const top = model({ fleet: largest, selected: { kind: "DOCK" } });
    expect((top.detail as DockDetailModel).next).toBeNull();
    expect(top.dock.canGrow).toBe(false);
    expect(top.berths.some((tile) => tile.kind === "LOCKED")).toBe(false);
  });
});
