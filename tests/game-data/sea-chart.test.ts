import { describe, expect, it } from "vitest";
import {
  findSeaSlot,
  INITIAL_OPEN_ARCHIPELAGOS,
  nextFreeSeaSlot,
  openArchipelagos,
  regionSlots,
  SEA_HUB_RADIUS_TILES,
  SEA_REGIONS,
  SEA_SLOT_SPACING_TILES,
  seaChart
} from "@happy-farm/game-data";

/** The world's sea chart (sea-chart.ts): stable, well spaced, and filling in order. */

describe("the sea chart", () => {
  const all = SEA_REGIONS.flatMap((region) => regionSlots(region));

  it("gives every slot a unique, findable id and every archipelago four to eight slots", () => {
    expect(new Set(all.map((slot) => slot.slotId)).size).toBe(all.length);
    for (const slot of all) expect(findSeaSlot(slot.slotId)).toBe(slot);
    for (const archipelagos of seaChart().values()) {
      for (const archipelago of archipelagos) {
        expect(archipelago.slots.length).toBeGreaterThanOrEqual(4);
        expect(archipelago.slots.length).toBeLessThanOrEqual(8);
      }
    }
    expect(findSeaSlot("slot_north_99_1")).toBeNull();
  });

  it("keeps islands apart and clear of the Centre's hub", () => {
    for (const slot of all) expect(Math.hypot(slot.x, slot.z), slot.slotId).toBeGreaterThan(SEA_HUB_RADIUS_TILES);
    for (let a = 0; a < all.length; a += 1) {
      for (let b = a + 1; b < all.length; b += 1) {
        const first = all[a];
        const second = all[b];
        if (first === undefined || second === undefined) continue;
        expect(Math.hypot(first.x - second.x, first.z - second.z), `${first.slotId} ${second.slotId}`).toBeGreaterThanOrEqual(SEA_SLOT_SPACING_TILES);
      }
    }
  });

  it("puts each region on its own side of the world", () => {
    for (const slot of regionSlots("NORTH")) expect(slot.z).toBeLessThan(0);
    for (const slot of regionSlots("SOUTH")) expect(slot.z).toBeGreaterThan(0);
    for (const slot of regionSlots("EAST")) expect(slot.x).toBeGreaterThan(0);
    for (const slot of regionSlots("WEST")) expect(slot.x).toBeLessThan(0);
  });

  it("fills in order and opens archipelagos as they fill", () => {
    const taken = new Set<string>();
    expect(nextFreeSeaSlot("EAST", (id) => taken.has(id))?.slotId).toBe("slot_east_1_1");
    expect(openArchipelagos("EAST", (id) => taken.has(id))).toHaveLength(INITIAL_OPEN_ARCHIPELAGOS);
    const first = seaChart().get("EAST")?.[0];
    for (const slot of first?.slots ?? []) taken.add(slot.slotId);
    expect(nextFreeSeaSlot("EAST", (id) => taken.has(id))?.slotId).toBe("slot_east_2_1");
    expect(openArchipelagos("EAST", (id) => taken.has(id)).map((entry) => entry.archipelagoId)).toEqual(["sea_east_1", "sea_east_2"]);
  });

  it("mixes the elements of its wild islands within a region", () => {
    for (const region of SEA_REGIONS) {
      const elements = new Set(regionSlots(region).map((slot) => slot.wild.element));
      expect(elements.size, region).toBeGreaterThanOrEqual(4);
    }
  });
});
