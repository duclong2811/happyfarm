import { describe, expect, it } from "vitest";
import type { FleetResponse, GetWorldChartResponse } from "@happy-farm/contracts";
import { openArchipelagos, SEA_REGIONS, SHIP_CLASSES } from "@happy-farm/game-data";
import { activityTrayItems, clockText } from "../../apps/web/src/activity-tray";
import { describeFleet, placeAction } from "../../apps/web/src/sea-chart-modal";

/**
 * What the chart offers for a tapped place, given where the ship is (display only - the server decides
 * again), the ship's line and price, and the voyage's card in the activity tray.
 */

const translate = (key: string, params?: Readonly<Record<string, string | number>>): string =>
  params === undefined ? key : `${key}(${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(",")})`;

function northChart(mySlotId: string): GetWorldChartResponse {
  return {
    mySlotId,
    regions: SEA_REGIONS.map((region) => ({
      region,
      archipelagos:
        region !== "NORTH"
          ? []
          : openArchipelagos(region, () => false).map((archipelago) => ({
              archipelagoId: archipelago.archipelagoId,
              index: archipelago.index,
              centreX: archipelago.centreX,
              centreZ: archipelago.centreZ,
              slots: archipelago.slots.map((slot) => ({
                slotId: slot.slotId,
                x: slot.x,
                z: slot.z,
                claimed: slot.slotId === mySlotId,
                mine: slot.slotId === mySlotId,
                name: slot.slotId === mySlotId ? "Home" : null,
                island: { ...slot.wild, generatorVersion: 2 }
              }))
            }))
    }))
  };
}

function fleet(location: FleetResponse["location"], toSlotId: string | null): FleetResponse {
  const rowboat = SHIP_CLASSES[0];
  const sloop = SHIP_CLASSES[1];
  return {
    readAt: "2026-11-20T00:00:00.000Z",
    ship: { classId: "ship_class_rowboat", tier: 1, hull: rowboat?.hull ?? 60, hullMax: rowboat?.hull ?? 60, speedTilesPerMinute: rowboat?.speedTilesPerMinute ?? 40, cannons: 0 },
    next: {
      classId: "ship_class_sloop",
      tier: 2,
      requiredPlayerLevel: sloop?.requiredPlayerLevel ?? 10,
      speedTilesPerMinute: sloop?.speedTilesPerMinute ?? 70,
      hull: sloop?.hull ?? 150,
      cannons: 2,
      cost: { currencyId: "currency_gold", gold: 800, materials: [{ itemDefinitionId: "item_wood", quantity: 150 }, { itemDefinitionId: "item_ore", quantity: 60 }] }
    },
    location,
    voyage:
      toSlotId === null
        ? null
        : { fromSlotId: "slot_north_1_1", toSlotId, departedAt: "2026-11-19T23:55:00.000Z", arrivesAt: "2026-11-20T00:05:00.000Z", arrived: location === "AT_PLACE" }
  };
}

describe("the chart's ship actions", () => {
  const chart = northChart("slot_north_1_1");
  it("offers a voyage from home, with its time from the distance and the ship's speed", () => {
    const action = placeAction(chart, fleet("HOME", null), "slot_north_1_2");
    expect(action.kind).toBe("SAIL");
    const home = chart.regions[0]?.archipelagos[0]?.slots[0];
    const there = chart.regions[0]?.archipelagos[0]?.slots[1];
    if (home === undefined || there === undefined || action.kind !== "SAIL") throw new Error("no chart");
    expect(action.minutes).toBe(Math.max(1, Math.ceil(Math.hypot(there.x - home.x, there.z - home.z) / 40)));
  });

  it("offers a look where the ship lies, nothing at home, and waits while the ship is at sea", () => {
    expect(placeAction(chart, fleet("AT_PLACE", "slot_north_1_2"), "slot_north_1_2")).toEqual({ kind: "VISIT" });
    expect(placeAction(chart, fleet("AT_PLACE", "slot_north_1_2"), "slot_north_1_3").kind).toBe("SAIL");
    expect(placeAction(chart, fleet("AT_SEA", "slot_north_1_2"), "slot_north_1_3")).toEqual({ kind: "AT_SEA" });
    expect(placeAction(chart, fleet("HOME", null), "slot_north_1_1")).toEqual({ kind: "NONE" });
    expect(placeAction(chart, null, "slot_north_1_2")).toEqual({ kind: "NONE" });
  });

  it("says what the ship is and what the next one costs", () => {
    expect(describeFleet(fleet("HOME", null), translate)).toEqual({
      ship: "chart.ship(name=ship.class.ship_class_rowboat,speed=40,hull=60,hullMax=60)",
      next: "chart.shipBuild(name=ship.class.ship_class_sloop,gold=800,wood=150,ore=60,level=10)"
    });
    expect(describeFleet({ ...fleet("HOME", null), next: null }, translate).next).toBeNull();
  });
});

describe("the voyage's card", () => {
  it("counts down while at sea, and invites a look on arrival", () => {
    const voyage = { id: "voyage", startedAt: "2026-11-20T00:00:00.000Z", readyAt: "2026-11-20T00:10:00.000Z", secondsUntilReady: 600, seenAtMs: 1_000, name: "North Isles" };
    const base = { area: null, fishing: null, gather: null, mines: null };
    const sailing = activityTrayItems({ ...base, nowMs: 1_000 + 150_000, voyage }, translate)[0];
    expect(sailing).toMatchObject({ id: "voyage", kind: "VOYAGE", tone: "active", title: "activity.voyage(name=North Isles)", detail: "activity.voyageLeft(time=7:30)" });
    expect(sailing?.fraction).toBeCloseTo(0.25);
    const arrived = activityTrayItems({ ...base, nowMs: 1_000 + 601_000, voyage }, translate)[0];
    expect(arrived).toMatchObject({ tone: "ready", title: "activity.voyageArrived(name=North Isles)", detail: "activity.voyageVisit", fraction: 1 });
    expect(activityTrayItems({ ...base, nowMs: 0 }, translate)).toEqual([]);
    expect(clockText(59.2)).toBe("1:00");
    expect(clockText(3)).toBe("0:03");
  });
});

describe("ships at sea on the chart", () => {
  it("sail along the line from port to destination by the share of their time gone, by the server's clock", async () => {
    const { chartShips } = await import("../../apps/web/src/sea-chart-view");
    const chart = northChart("slot_north_1_1");
    const slots = chart.regions[0]?.archipelagos[0]?.slots ?? [];
    const from = slots[1];
    const to = slots[2];
    if (from === undefined || to === undefined) throw new Error("no chart");
    const withVoyages: GetWorldChartResponse = {
      ...chart,
      voyages: [
        { fromSlotId: from.slotId, toSlotId: to.slotId, shipTier: 1, departedAt: "2026-11-20T00:00:00.000Z", arrivesAt: "2026-11-20T00:10:00.000Z", name: "Isle", mine: false },
        { fromSlotId: from.slotId, toSlotId: "slot_east_9_9", shipTier: 1, departedAt: "2026-11-20T00:00:00.000Z", arrivesAt: "2026-11-20T00:10:00.000Z", name: null, mine: false }
      ]
    };
    const halfway = chartShips(withVoyages, Date.parse("2026-11-20T00:05:00.000Z"));
    // The voyage whose end is off the reader's chart is not drawn.
    expect(halfway).toHaveLength(1);
    expect(halfway[0]?.x).toBeCloseTo((from.x + to.x) / 2);
    expect(halfway[0]?.z).toBeCloseTo((from.z + to.z) / 2);
    expect(halfway[0]?.arrived).toBe(false);
    const before = chartShips(withVoyages, Date.parse("2026-11-19T23:00:00.000Z"))[0];
    expect([before?.x, before?.z]).toEqual([from.x, from.z]);
    const after = chartShips(withVoyages, Date.parse("2026-11-20T01:00:00.000Z"))[0];
    expect([after?.x, after?.z, after?.arrived]).toEqual([to.x, to.z, true]);
    expect(chartShips(chart, 0)).toEqual([]);
  });
});
