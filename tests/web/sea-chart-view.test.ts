import { describe, expect, it } from "vitest";
import { openArchipelagos, SEA_REGIONS } from "@happy-farm/game-data";
import type { GetWorldChartResponse } from "@happy-farm/contracts";
import {
  ARCHIPELAGO_NAMES,
  archipelagoName,
  fitChart,
  freePlaces,
  regionAt,
  slotAt,
  suggestedRegion,
  toCanvas
} from "../../apps/web/src/sea-chart-view";
import { describeMySlot, describeSlot } from "../../apps/web/src/sea-chart-modal";

/**
 * The sea chart's geometry and words (sea-chart-view.ts, sea-chart-modal.ts): it fits every open
 * archipelago on the canvas around the Centre, finds the island under a tap, names the sea a tap
 * falls in, and says where the reader's island lies. The drawing itself only paints what these
 * decide, and is checked by eye.
 */

/** A chart response as the server builds it from the game-data chart, with `claimed` slot ids taken. */
function chartWith(claimed: readonly string[], mine: string | null): GetWorldChartResponse {
  const taken = new Set(claimed);
  return {
    mySlotId: mine,
    regions: SEA_REGIONS.map((region) => ({
      region,
      archipelagos: openArchipelagos(region, (slotId) => taken.has(slotId)).map((archipelago) => ({
        archipelagoId: archipelago.archipelagoId,
        index: archipelago.index,
        centreX: archipelago.centreX,
        centreZ: archipelago.centreZ,
        slots: archipelago.slots.map((slot) => ({
          slotId: slot.slotId,
          x: slot.x,
          z: slot.z,
          claimed: taken.has(slot.slotId),
          mine: slot.slotId === mine,
          name: taken.has(slot.slotId) ? `Isle ${slot.slotId}` : null,
          island: { ...slot.wild, generatorVersion: 2 }
        }))
      }))
    }))
  };
}

const translate = (key: string, params?: Record<string, string | number>): string =>
  params === undefined ? key : `${key}(${Object.entries(params).map(([name, value]) => `${name}=${String(value)}`).join(",")})`;

describe("the sea chart view", () => {
  it("names twelve archipelagos in every sea, all different", () => {
    for (const region of SEA_REGIONS) {
      expect(ARCHIPELAGO_NAMES[region]).toHaveLength(12);
      expect(new Set(ARCHIPELAGO_NAMES[region]).size).toBe(12);
    }
    expect(archipelagoName("NORTH", 1)).toBe(ARCHIPELAGO_NAMES.NORTH[0]);
  });

  it("counts free places per sea and offers the emptiest first", () => {
    const empty = chartWith([], null);
    const counts = freePlaces(empty);
    for (const region of SEA_REGIONS) expect(counts[region]).toBeGreaterThanOrEqual(4);
    const north = empty.regions.find((entry) => entry.region === "NORTH")?.archipelagos[0]?.slots.map((slot) => slot.slotId) ?? [];
    const crowded = chartWith(north.slice(0, 3), null);
    expect(freePlaces(crowded).NORTH).toBe(counts.NORTH - 3);
    expect(suggestedRegion(crowded)).not.toBe("NORTH");
  });

  it("fits the harbour's chart round the Centre, and a player's chart round what they have seen", () => {
    const inside = (chart: GetWorldChartResponse, width: number, height: number): ReturnType<typeof fitChart> => {
      const frame = fitChart(chart, width, height);
      for (const entry of chart.regions) {
        for (const archipelago of entry.archipelagos) {
          for (const slot of archipelago.slots) {
            const at = toCanvas(frame, slot.x, slot.z);
            expect(at.x).toBeGreaterThan(0);
            expect(at.x).toBeLessThan(width);
            expect(at.y).toBeGreaterThan(0);
            expect(at.y).toBeLessThan(height);
          }
        }
      }
      return frame;
    };
    const harbour = chartWith([], null);
    for (const [width, height] of [[900, 900], [1200, 700], [360, 640]] as const) {
      const frame = inside(harbour, width, height);
      const hub = toCanvas(frame, 0, 0);
      expect(hub.x).toBeGreaterThan(0);
      expect(hub.x).toBeLessThan(width);
      expect(hub.y).toBeGreaterThan(0);
      expect(hub.y).toBeLessThan(height);
    }
    // A newcomer's chart is their own archipelago, drawn larger than the whole harbour's world.
    const home = harbour.regions[0]?.archipelagos[0]?.slots[0]?.slotId ?? "";
    const own: GetWorldChartResponse = {
      mySlotId: home,
      regions: harbour.regions.map((entry) => ({ region: entry.region, archipelagos: entry.region === "NORTH" ? entry.archipelagos : [] }))
    };
    expect(inside(own, 900, 900).scale).toBeGreaterThan(fitChart(harbour, 900, 900).scale);
  });

  it("finds the island under a tap, and none on open sea", () => {
    const chart = chartWith([], null);
    const frame = fitChart(chart, 900, 900);
    const slot = chart.regions[1]?.archipelagos[0]?.slots[2];
    expect(slot).toBeDefined();
    if (slot === undefined) return;
    const at = toCanvas(frame, slot.x, slot.z);
    expect(slotAt(chart, frame, at.x + 3, at.y - 2, 20)?.slotId).toBe(slot.slotId);
    expect(slotAt(chart, frame, frame.offsetX, frame.offsetY, 20)).toBeNull();
  });

  it("puts a tap in the sea of its bearing from the Centre", () => {
    const frame = fitChart(chartWith([], null), 800, 800);
    const hub = toCanvas(frame, 0, 0);
    expect(regionAt(frame, hub.x, hub.y - 300)).toBe("NORTH");
    expect(regionAt(frame, hub.x + 300, hub.y + 10)).toBe("EAST");
    expect(regionAt(frame, hub.x - 10, hub.y + 300)).toBe("SOUTH");
    expect(regionAt(frame, hub.x - 300, hub.y)).toBe("WEST");
  });

  it("says where the reader's island lies, and what a tapped place holds", () => {
    const south = chartWith([], null).regions.find((entry) => entry.region === "SOUTH")?.archipelagos[0]?.slots ?? [];
    const mine = south[0]?.slotId ?? "";
    const other = south[1]?.slotId ?? "";
    const wild = south[2]?.slotId ?? "";
    const chart = chartWith([mine, other], mine);
    const isles = `chart.archipelago(name=${ARCHIPELAGO_NAMES.SOUTH[0] ?? ""})`;
    expect(describeMySlot(chart, translate)).toBe(`chart.you(archipelago=${isles},region=chart.region.SOUTH)`);
    expect(describeSlot(chart, mine, translate)).toBe(`chart.slot.mine(archipelago=${isles})`);
    expect(describeSlot(chart, other, translate)).toBe(`chart.slot.named(name=Isle ${other},archipelago=${isles})`);
    expect(describeSlot(chart, wild, translate)).toBe(`chart.slot.wild(archipelago=${isles})`);
    expect(describeMySlot(chartWith([other], null), translate)).toBeNull();
    expect(describeSlot(chart, "slot_south_99_1", translate)).toBeNull();
  });
});

describe("the visit heading", () => {
  it("names a settled island by its own name, a free place as a wild island, and says where it lies", async () => {
    const { visitHeading } = await import("../../apps/web/src/visit-view");
    const place = {
      slotId: "slot_east_1_2",
      region: "EAST" as const,
      archipelagoId: "sea_east_1",
      archipelagoIndex: 1,
      claimed: true,
      mine: false,
      name: "Đảo Ngọc",
      island: { element: "HOA" as const, outline: "ROUND" as const, seed: 7, generatorVersion: 2 }
    };
    const isles = `chart.archipelago(name=${ARCHIPELAGO_NAMES.EAST[0] ?? ""})`;
    expect(visitHeading({ place, farm: null }, translate)).toEqual({
      title: "Đảo Ngọc",
      subtitle: `visit.where(archipelago=${isles},region=chart.region.EAST)`
    });
    expect(visitHeading({ place: { ...place, claimed: false, name: null }, farm: null }, translate).title).toBe("visit.wild");
  });
});
