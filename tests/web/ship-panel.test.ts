import type { FleetResponse, HuntsResponse } from "@happy-farm/contracts";
import { describe, expect, it } from "vitest";
import { shipPanelModel, type ShipDetailModel, type ShipPanelInput, type ShipyardModel, type DockDetailModel } from "../../apps/web/src/ship-panel";
import { FIXTURE_PLAYER_UUID, fleetResponse, nextShip } from "../support/fleet-fixture";

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
  it("leads a warship with the hunt, offers sailing and the helm, and shows the ship's numbers as bars with the upgrade's gain", () => {
    const view = ship(model({ fleet: fleet() }));
    expect(view.modelId).toBe("ship_sloop");
    expect(view).toMatchObject({ role: "WAR", rank: 1, maxRank: 4, status: { icon: "anchor", text: "fleet.status.home", tone: "calm" }, warning: null });
    expect(view.actions.map((action) => [action.kind, action.icon, action.enabled, action.primary])).toEqual([
      ["HUNTS", "monster", true, true],
      ["SAIL", "sail", true, false],
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

describe("fishing trips in the fleet panel", () => {
  const boat = { classId: "ship_class_line_boat", role: "FISHING" as const, rank: 2, tier: 1, hull: 90, hullMax: 90, speedTilesPerMinute: 55, cannons: 0, hold: 40, upgrade: null };
  const itemName = (id: string): string => `name(${id})`;

  it("leads a fishing boat at its dock with fishing, and offers the grounds its rank reaches", () => {
    const view = ship(model({ fleet: fleet({ ship: boat }) }));
    expect(view.actions.map((action) => [action.kind, action.primary])).toEqual([
      ["FISH", true],
      ["SAIL", false],
      ["HELM", false]
    ]);
    const grounds = model({ fleet: fleet({ ship: boat }), selected: { kind: "GROUNDS", shipId: SHIP }, itemName });
    if (grounds.detail.kind !== "GROUNDS") throw new Error("expected the grounds");
    expect(grounds.berths[0]?.selected).toBe(true);
    expect(grounds.detail.cards.map((card) => [card.groundId, card.minutes, card.expected, card.action.enabled, card.action.groundId])).toEqual([
      ["ground_inshore", 10, 16, true, "ground_inshore"],
      ["ground_offshore", 45, 28, true, "ground_offshore"],
      ["ground_deep_sea", 180, 40, false, "ground_deep_sea"]
    ]);
    expect(grounds.detail.cards[0]?.fish.map((fish) => [fish.modelId, fish.quantity, fish.name])).toEqual([
      ["fish_sardine", 55, "name(item_fish_sardine)"],
      ["fish_mackerel", 40, "name(item_fish_mackerel)"],
      ["fish_snapper", 5, "name(item_fish_snapper)"]
    ]);
    // A warship has no grounds to show: the panel stays on the ship.
    expect(model({ fleet: fleet(), selected: { kind: "GROUNDS", shipId: SHIP } }).detail.kind).toBe("SHIP");
  });

  it("counts a trip down with a bar and offers calling the boat back, then lands the catch", () => {
    const out = { groundId: "ground_inshore", departedAt: "2026-11-20T09:55:00.000Z", returnsAt: "2026-11-20T10:05:00.000Z", returned: false, catch: null };
    const away = ship(model({ fleet: fleet({ ship: { ...boat, trip: out } }) }));
    expect(away.tripShare).toBe(0.5);
    expect(away.status).toMatchObject({ icon: "clock", text: 'fleet.status.fishing:{"ground":"fleet.ground.ground_inshore","minutes":5}', tone: "busy" });
    expect(away.actions.map((action) => action.kind)).toEqual(["RECALL"]);
    expect(away.upgrade).toBeNull();
    expect(model({ fleet: fleet({ ship: { ...boat, trip: out } }) }).berths[0]).toMatchObject({ fishing: false });

    const back = { ...out, returned: true, catch: [{ itemDefinitionId: "item_fish_sardine", quantity: 9 }, { itemDefinitionId: "item_fish_mackerel", quantity: 7 }] };
    const landed = ship(model({ fleet: fleet({ ship: { ...boat, trip: back } }), itemName }));
    expect(landed.catch.map((fish) => [fish.modelId, fish.quantity])).toEqual([
      ["fish_sardine", 9],
      ["fish_mackerel", 7]
    ]);
    expect(landed.actions.map((action) => [action.kind, action.primary])).toEqual([["COLLECT", true]]);
    expect(landed.tripShare).toBeNull();
  });
});

describe("sea monsters in the fleet panel", () => {
  const itemName = (id: string): string => `name(${id})`;
  const reward = (gold: number, xp: number, itemDefinitionId: string, quantity: number): HuntsResponse["monsters"][number]["reward"] => ({ gold, xp, materials: [{ itemDefinitionId, quantity }] });
  const roster = (hunt: HuntsResponse["hunt"] = null): HuntsResponse => ({
    readAt: "2026-11-20T10:00:00.000Z",
    endsAt: "2026-11-20T12:13:00.000Z",
    monsters: [
      { slot: 0, kind: "thuong_luong", level: 1, monsterId: "monster_thuong_luong", defeated: false, reward: reward(80, 40, "item_monster_scale_1", 3) },
      { slot: 1, kind: "cua_da", level: 2, monsterId: "monster_cua_da", defeated: true, reward: reward(250, 120, "item_monster_shell_2", 2) },
      { slot: 2, kind: "sua_lua", level: 1, monsterId: "monster_sua_lua", defeated: false, reward: reward(80, 40, "item_monster_pearl_1", 3) }
    ],
    hunt
  });
  const hunts = (input: Partial<ShipPanelInput> & { fleet: FleetResponse }) => {
    const view = model({ selected: { kind: "HUNTS", shipId: null }, itemName, ...input });
    if (view.detail.kind !== "HUNTS") throw new Error(`expected the hunts, got ${view.detail.kind}`);
    return { view, detail: view.detail };
  };

  it("shows the roster's cards with what a win pays, the warship that fights, and when the roster turns over", () => {
    const { view, detail } = hunts({ fleet: fleet(), hunts: roster() });
    expect(view.hunts).toEqual({ alive: 2, selected: true });
    expect(detail.loading).toBe(false);
    expect(detail.warning).toBeNull();
    expect(detail.renews).toBe('fleet.hunt.endsHours:{"hours":2,"minutes":13}');
    expect(detail.fighters.map((entry) => [entry.shipId, entry.selected, entry.ready])).toEqual([[SHIP, true, true]]);
    expect(detail.cards.map((card) => [card.slot, card.name, card.level, card.defeated, card.action.label, card.action.enabled, card.action.shipId])).toEqual([
      [0, "pirate.monster_thuong_luong", 1, false, "fleet.hunt.fight", true, SHIP],
      [1, "pirate.monster_cua_da", 2, true, "fleet.hunt.beaten", false, SHIP],
      [2, "pirate.monster_sua_lua", 1, false, "fleet.hunt.fight", true, SHIP]
    ]);
    expect(detail.cards[0]).toMatchObject({ gold: 80, xp: 40, drops: [{ icon: "item", itemDefinitionId: "item_monster_scale_1", amount: 3, name: "name(item_monster_scale_1)" }] });
  });

  it("resumes a fight already planned with its own ship, and holds every other card back", () => {
    const setup = { seed: 1, player: { hull: 150, hullMax: 150, cannons: 2, speed: 9, turn: 14, radius: 4.5, spread: 40 }, pirates: [{ hull: 80, hullMax: 80, cannons: 2, speed: 5, turn: 12, radius: 5, spread: 70, behaviour: "SHIP" as const }] };
    const { detail } = hunts({ fleet: fleet(), hunts: roster({ slot: 2, kind: "sua_lua", level: 1, monsterId: "monster_sua_lua", shipId: SHIP, setup }) });
    expect(detail.cards.map((card) => [card.slot, card.open, card.action.label, card.action.enabled, card.action.primary])).toEqual([
      [0, false, "fleet.hunt.fight", false, false],
      [1, false, "fleet.hunt.beaten", false, false],
      [2, true, "fleet.hunt.resume", true, true]
    ]);
    expect(detail.cards[0]?.action.hint).toBe("fleet.hunt.finishOpen");
  });

  it("needs a ship of one's own with guns, at its dock and afloat", () => {
    const boat = { classId: "ship_class_line_boat", role: "FISHING" as const, rank: 2, tier: 1, cannons: 0, upgrade: null };
    const unarmed = hunts({ fleet: fleet({ ship: boat }), hunts: roster() }).detail;
    expect(unarmed.warning).toBe("fleet.hunt.needWarship");
    expect(unarmed.fighters).toEqual([]);
    expect(unarmed.cards.every((card) => !card.action.enabled)).toBe(true);
    expect(hunts({ fleet: fleet({ ship: { lent: true, classId: "ship_class_rowboat", cannons: 1 } }), hunts: roster() }).detail.warning).toBe("fleet.hunt.needWarship");
    const sunk = hunts({ fleet: fleet({ ship: { hull: 0 } }), hunts: roster() }).detail;
    expect(sunk.warning).toBe("fleet.warn.sunk");
    expect(sunk.cards.every((card) => !card.action.enabled)).toBe(true);
    // A fishing boat is never offered the hunt from its own page.
    expect(ship(model({ fleet: fleet({ ship: boat }) })).actions.map((action) => action.kind)).not.toContain("HUNTS");
  });

  it("lists every material with its stock, and offers a merge at ten", () => {
    const stock: Record<string, number> = { item_monster_scale_1: 12, item_monster_scale_2: 1, item_monster_pearl_1: 9 };
    const { detail } = hunts({ fleet: fleet(), hunts: roster(), holdings: { gold: 0, wood: 0, ore: 0, count: (id) => stock[id] ?? 0 } });
    expect(detail.materials.map((row) => row.kind)).toEqual(["thuong_luong", "bach_tuoc", "cua_da", "kinh_ngu", "sua_lua"]);
    const scale = detail.materials[0]?.cells ?? [];
    expect(scale.map((cell) => [cell.itemDefinitionId, cell.have, cell.merge?.enabled ?? null])).toEqual([
      ["item_monster_scale_1", 12, true],
      ["item_monster_scale_2", 1, false],
      ["item_monster_scale_3", 0, null]
    ]);
    expect(scale[0]?.merge).toMatchObject({ kind: "MERGE", itemDefinitionId: "item_monster_scale_1" });
    expect(detail.materials[4]?.cells[0]?.merge?.enabled).toBe(false);
  });

  it("waits for the roster, and counts nothing on the badge until it is read", () => {
    const { view, detail } = hunts({ fleet: fleet(), hunts: null });
    expect(view.hunts.alive).toBeNull();
    expect(detail.loading).toBe(true);
    expect(detail.renews).toBeNull();
  });

  it("prices an upgrade's monster materials as pictures with the island's stock, red when short", () => {
    const needs = ["item_monster_scale_1", "item_monster_tentacle_1", "item_monster_shell_1", "item_monster_bone_1", "item_monster_pearl_1"].map((itemDefinitionId) => ({ itemDefinitionId, quantity: 2 }));
    const upgrade = nextShip({ cost: { currencyId: "currency_gold", gold: 3000, materials: [{ itemDefinitionId: "item_wood", quantity: 500 }, ...needs] } });
    const stock: Record<string, number> = { item_monster_scale_1: 5, item_monster_pearl_1: 1 };
    const view = ship(model({ fleet: fleet({ ship: { upgrade } }), itemName, holdings: { gold: 5000, wood: 900, ore: 0, count: (id) => stock[id] ?? 0 } }));
    const items = view.upgrade?.action.cost.filter((chip) => chip.icon === "item") ?? [];
    expect(items.map((chip) => [chip.itemDefinitionId, chip.amount, chip.have, chip.short])).toEqual([
      ["item_monster_scale_1", 2, 5, false],
      ["item_monster_tentacle_1", 2, 0, true],
      ["item_monster_shell_1", 2, 0, true],
      ["item_monster_bone_1", 2, 0, true],
      ["item_monster_pearl_1", 2, 1, true]
    ]);
    expect(view.upgrade?.action.cost.filter((chip) => chip.icon !== "item").map((chip) => chip.icon)).toEqual(["gold", "wood"]);
  });
});
