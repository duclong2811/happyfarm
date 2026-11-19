import { describe, expect, it } from "vitest";
import { Raycaster, Vector3, type Mesh } from "three";
import { ISLAND_GENERATOR_VERSION, seaChart, SEA_REGIONS } from "@happy-farm/game-data";
import {
  buildHorizonIsland,
  horizonGround,
  horizonIslandGeometry,
  horizonPlacements,
  HORIZON_FAR,
  HORIZON_ISLAND_SCALE,
  HORIZON_NEAR,
  type HorizonSlot
} from "../../apps/web/src/render/horizon-islands";
import { SEA_SURFACE_Y } from "../../apps/web/src/render/world-cell-overlay";

/**
 * The archipelago on the horizon (horizon-islands.ts): every other place of the player's
 * archipelago stands at its chart bearing, inside the horizon band, never on top of another, and is
 * drawn from its own template - with a flag when someone lives there - as scenery nothing can pick.
 */

const CENTRE = { x: 40, z: -12 };
const EXTENT = 48;

function slotsOf(region: (typeof SEA_REGIONS)[number], index: number): HorizonSlot[] {
  const archipelago = seaChart().get(region)?.[index];
  return (archipelago?.slots ?? []).map((slot, n) => ({
    slotId: slot.slotId,
    x: slot.x,
    z: slot.z,
    claimed: n % 2 === 0,
    island: { ...slot.wild, generatorVersion: ISLAND_GENERATOR_VERSION }
  }));
}

describe("the horizon islands", () => {
  it("stands every other place at its chart bearing, in the horizon band, apart from the others", () => {
    const footprint = EXTENT * 2 * HORIZON_ISLAND_SCALE;
    for (const region of SEA_REGIONS) {
      for (const index of [0, 1, 5]) {
        const slots = slotsOf(region, index);
        for (const home of slots) {
          const placed = horizonPlacements(home, slots, CENTRE, EXTENT);
          expect(placed.map((entry) => entry.slotId)).toEqual(slots.filter((slot) => slot !== home).map((slot) => slot.slotId).sort());
          for (const entry of placed) {
            const slot = slots.find((candidate) => candidate.slotId === entry.slotId);
            if (slot === undefined) throw new Error("placed a slot that is not in the archipelago");
            const radius = Math.hypot(entry.worldX - CENTRE.x, entry.worldZ - CENTRE.z);
            expect(radius).toBeGreaterThanOrEqual(EXTENT * HORIZON_NEAR - 1e-9);
            expect(radius).toBeLessThanOrEqual(EXTENT * HORIZON_FAR + footprint * 0.35 * 12);
            const bearing = Math.atan2(entry.worldZ - CENTRE.z, entry.worldX - CENTRE.x);
            const chartBearing = Math.atan2(slot.z - home.z, slot.x - home.x);
            expect(Math.abs(Math.atan2(Math.sin(bearing - chartBearing), Math.cos(bearing - chartBearing)))).toBeLessThan(1e-9);
            expect(entry.footprint).toBeCloseTo(footprint);
          }
          for (const a of placed) {
            for (const b of placed) {
              if (a === b) continue;
              expect(Math.hypot(a.worldX - b.worldX, a.worldZ - b.worldZ)).toBeGreaterThanOrEqual(footprint * 1.08 - 1e-9);
            }
          }
        }
      }
    }
  });

  it("keeps nearer places nearer", () => {
    const slots = slotsOf("EAST", 0);
    const home = slots[0];
    if (home === undefined) throw new Error("no slots");
    const placed = horizonPlacements(home, slots, CENTRE, EXTENT);
    const byChart = [...placed].sort((a, b) => {
      const sa = slots.find((slot) => slot.slotId === a.slotId);
      const sb = slots.find((slot) => slot.slotId === b.slotId);
      return Math.hypot((sa?.x ?? 0) - home.x, (sa?.z ?? 0) - home.z) - Math.hypot((sb?.x ?? 0) - home.x, (sb?.z ?? 0) - home.z);
    });
    const nearest = byChart[0];
    const farthest = byChart[byChart.length - 1];
    if (nearest === undefined || farthest === undefined) throw new Error("nothing placed");
    expect(Math.hypot(nearest.worldX - CENTRE.x, nearest.worldZ - CENTRE.z)).toBeLessThanOrEqual(Math.hypot(farthest.worldX - CENTRE.x, farthest.worldZ - CENTRE.z));
  });

  it("draws an island from its template: inside its footprint, raised where it has mountains", () => {
    const kim = horizonGround({ element: "KIM", outline: "ROUND", seed: 4242, generatorVersion: 2 });
    const tho = horizonGround({ element: "THO", outline: "LONG", seed: 4242, generatorVersion: 2 });
    if (kim === null || tho === null) throw new Error("no island");
    const footprint = 40;
    const peaks = (geometry: ReturnType<typeof horizonIslandGeometry>): number => {
      const position = geometry.getAttribute("position");
      let top = -Infinity;
      for (let i = 0; i < position.count; i += 1) {
        expect(Math.abs(position.getX(i))).toBeLessThanOrEqual(footprint / 2 + 1e-6);
        expect(Math.abs(position.getZ(i))).toBeLessThanOrEqual(footprint / 2 + 1e-6);
        top = Math.max(top, position.getY(i));
      }
      expect(geometry.getIndex()?.count ?? 0).toBeGreaterThan(0);
      return top;
    };
    const kimTop = peaks(horizonIslandGeometry(kim, footprint, 0xcfe9f7));
    const thoTop = peaks(horizonIslandGeometry(tho, footprint, 0xcfe9f7));
    expect(kimTop).toBeGreaterThan(SEA_SURFACE_Y);
    expect(kimTop).toBeGreaterThan(thoTop);
    expect(horizonGround({ element: "NOPE", outline: "ROUND", seed: 1, generatorVersion: 2 })).toBeNull();
  });

  it("flies a flag only over a settled island, and nothing in it can be picked", () => {
    const slots = slotsOf("SOUTH", 0);
    const home = slots[1];
    if (home === undefined) throw new Error("no slots");
    const placed = horizonPlacements(home, slots, CENTRE, EXTENT);
    const settled = placed.find((entry) => entry.claimed);
    const wild = placed.find((entry) => !entry.claimed);
    if (settled === undefined || wild === undefined) throw new Error("expected both kinds");
    const settledGroup = buildHorizonIsland(settled, 0xcfe9f7, 3);
    const wildGroup = buildHorizonIsland(wild, 0xcfe9f7, 3);
    // Its patch of sea and its ground, and on a settled island a flagpole and its pennant.
    expect(settledGroup?.children).toHaveLength(4);
    expect(wildGroup?.children).toHaveLength(2);
    if (settledGroup === null) return;
    settledGroup.updateMatrixWorld(true);
    const ray = new Raycaster(new Vector3(settled.worldX, 100, settled.worldZ), new Vector3(0, -1, 0));
    expect(ray.intersectObject(settledGroup, true)).toEqual([]);
    for (const child of settledGroup.children) expect((child as Mesh).castShadow).toBe(false);
  });
});

describe("ships on the horizon", () => {
  it("sail from the home island's shore to a neighbour, and hide when an end is beyond the horizon", async () => {
    const { horizonShipPose } = await import("../../apps/web/src/render/horizon-islands");
    const places = new Map([["slot_north_1_2", { x: 200, z: 0 }]]);
    const voyage = { fromSlotId: "slot_north_1_1", toSlotId: "slot_north_1_2", departedAt: "2026-11-20T00:00:00.000Z", arrivesAt: "2026-11-20T00:10:00.000Z", mine: true };
    const start = horizonShipPose(voyage, Date.parse("2026-11-20T00:00:00.000Z"), places, "slot_north_1_1", { x: 0, z: 0 }, 40);
    expect(start).toEqual({ x: 46, z: 0, heading: 0 });
    const half = horizonShipPose(voyage, Date.parse("2026-11-20T00:05:00.000Z"), places, "slot_north_1_1", { x: 0, z: 0 }, 40);
    expect(half?.x).toBeCloseTo(123);
    const back = horizonShipPose({ ...voyage, fromSlotId: "slot_north_1_2", toSlotId: "slot_north_1_1" }, Date.parse("2026-11-20T01:00:00.000Z"), places, "slot_north_1_1", { x: 0, z: 0 }, 40);
    expect(back?.x).toBeCloseTo(46);
    expect(back?.heading).toBeCloseTo(Math.PI);
    expect(horizonShipPose({ ...voyage, toSlotId: "slot_east_1_1" }, 0, places, "slot_north_1_1", { x: 0, z: 0 }, 40)).toBeNull();
  });
});
