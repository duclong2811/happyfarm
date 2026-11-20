import { describe, expect, it } from "vitest";
import {
  giveHelmOrder,
  helmShipForTier,
  horizonWatersRadius,
  nearestPort,
  HELM_PORT_REACH,
  helmTargetSpeed,
  HELM_OAR_REST_SECONDS,
  HELM_OARS_SECONDS,
  islandHelmWaters,
  setHelmRudder,
  startHelm,
  stepHelm,
  type HelmState,
  type HelmWaters
} from "../../apps/web/src/helm/helm";

/**
 * The helm (helm/helm.ts): the player's ship sailed by hand round home waters. Presentation only - it
 * is never sent anywhere - but it must not sail through land, out of home waters, or backwards.
 */

const ship = helmShipForTier(2, 4);

/** Open sea for 50 tiles round the origin, with land east of `shore` when given. */
function sea(shore = Number.POSITIVE_INFINITY): HelmWaters {
  return { centerX: 0, centerY: 0, radius: 50, isWater: (x) => x < shore };
}

function sail(state: HelmState, waters: HelmWaters, seconds: number): HelmState {
  let next = state;
  for (let elapsed = 0; elapsed < seconds; elapsed += 0.1) next = stepHelm(next, ship, waters, 0.1);
  return next;
}

describe("the helm", () => {
  it("lies still at the pier, gathers way under sail, and runs along its heading", () => {
    const moored = startHelm({ x: 0, y: 0, heading: 0 });
    expect(stepHelm(moored, ship, sea(), 1)).toMatchObject({ x: 0, y: 0, speed: 0 });
    const underway = sail(giveHelmOrder(giveHelmOrder(moored, "SAIL_UP"), "SAIL_UP"), sea(), 5);
    expect(underway.speed).toBeCloseTo(ship.maxSpeed, 5);
    expect(underway.x).toBeGreaterThan(10);
    expect(Math.abs(underway.y)).toBeLessThan(1e-9);
  });

  it("turns to starboard with the rudder right, faster with way on than at rest", () => {
    const moored = setHelmRudder(startHelm({ x: 0, y: 0, heading: 0 }), 1);
    const atRest = stepHelm(moored, ship, sea(), 0.5);
    expect(atRest.heading).toBeGreaterThan(0);
    const running = { ...moored, sail: 2 as const, speed: ship.maxSpeed };
    expect(stepHelm(running, ship, sea(), 0.5).heading).toBeGreaterThan(atRest.heading * 2);
    expect(stepHelm(setHelmRudder(running, -1), ship, sea(), 0.5).heading).toBeLessThan(0);
  });

  it("stops at the shore, and can turn away from it but not into it", () => {
    const heading = giveHelmOrder(giveHelmOrder(startHelm({ x: 0, y: 0, heading: 0 }), "SAIL_UP"), "SAIL_UP");
    const aground = sail(heading, sea(10), 6);
    expect(aground.blocked).toBe("LAND");
    expect(aground.speed).toBeLessThan(ship.maxSpeed * 0.1);
    // The bow never went past the shore.
    expect(aground.x + ship.lengthTiles * 0.45).toBeLessThan(10);
    // Turned away, it sails on and forgets it was stopped.
    const away = sail(setHelmRudder(aground, 1), sea(10), 4);
    expect(away.blocked).toBe("NONE");
    expect(away.y).toBeGreaterThan(aground.y);
  });

  it("stops at the edge of home waters and says so", () => {
    const running = giveHelmOrder(giveHelmOrder(startHelm({ x: 40, y: 0, heading: 0 }), "SAIL_UP"), "SAIL_UP");
    const edge = sail(running, sea(), 6);
    expect(edge.blocked).toBe("EDGE");
    // The whole hull stays inside: the bow is at most at the edge.
    expect(edge.x + ship.lengthTiles * 0.45).toBeLessThanOrEqual(50);
    expect(edge.x).toBeGreaterThan(45);
  });

  it("rows a short sprint, then needs a rest before rowing again", () => {
    const moored = startHelm({ x: 0, y: 0, heading: 0 });
    const rowing = giveHelmOrder(moored, "OARS");
    expect(rowing.oars).toBe(HELM_OARS_SECONDS);
    expect(helmTargetSpeed(rowing, ship)).toBeGreaterThan(0);
    // With sails set, rowing beats sailing alone.
    const sailed = { ...rowing, sail: 2 as const };
    expect(helmTargetSpeed(sailed, ship)).toBeGreaterThan(ship.maxSpeed);
    const spent = sail(rowing, sea(), HELM_OARS_SECONDS + 0.5);
    expect(spent.oars).toBe(0);
    expect(spent.oarRest).toBeGreaterThan(HELM_OAR_REST_SECONDS - 1);
    expect(giveHelmOrder(spent, "OARS")).toBe(spent);
    expect(sail(spent, sea(), HELM_OAR_REST_SECONDS + 0.5).oarRest).toBe(0);
  });

  it("keeps the sails between struck and full", () => {
    const moored = startHelm({ x: 0, y: 0, heading: 0 });
    expect(giveHelmOrder(moored, "SAIL_DOWN")).toBe(moored);
    const full = giveHelmOrder(giveHelmOrder(moored, "SAIL_UP"), "SAIL_UP");
    expect(giveHelmOrder(full, "SAIL_UP")).toBe(full);
  });

  it("does not sail through a long pause in one stride", () => {
    const running = { ...startHelm({ x: 0, y: 0, heading: 0 }), sail: 2 as const, speed: ship.maxSpeed };
    const after = stepHelm(running, ship, sea(), 30);
    expect(after.x).toBeLessThanOrEqual(ship.maxSpeed * 0.5 + 1e-9);
    // And a wall half a tile thick is not jumped over by a slow frame.
    const wall: HelmWaters = { ...sea(), isWater: (x) => x < 3 || x > 3.5 };
    expect(stepHelm(running, ship, wall, 0.5).x).toBeLessThan(3);
  });

  it("leaves a mooring whose stern lies over the sand, bow first", () => {
    // Land west of x = 0: the stern of a ship at x = 1 is ashore, its bow is not.
    const beach: HelmWaters = { ...sea(), isWater: (x) => x > 0 };
    const moored = giveHelmOrder(giveHelmOrder(startHelm({ x: 1, y: 0, heading: 0 }), "SAIL_UP"), "SAIL_UP");
    expect(sail(moored, beach, 3).x).toBeGreaterThan(3);
    // Pointed at the beach, it does not move.
    const inward = { ...moored, heading: Math.PI };
    expect(sail(inward, beach, 3).x).toBeCloseTo(1, 5);
  });
});

describe("home waters", () => {
  const waters = islandHelmWaters({
    size: 21,
    originX: -10,
    originY: -10,
    isSeaCell: (x) => x < 0,
    pier: { x0: -1, y0: 0, x1: -5, y1: 0 },
    reach: 6
  });

  it("is a circle round the island's grid, sea cells only, and clear of the pier", () => {
    expect([waters.centerX, waters.centerY, waters.radius]).toEqual([0, 0, 16]);
    expect(waters.isWater(-3, 3)).toBe(true);
    expect(waters.isWater(2, 3)).toBe(false);
    expect(waters.isWater(-3, 0.2)).toBe(false);
    expect(waters.isWater(-3, 0.6)).toBe(true);
    // Past the pier's head the water is open again.
    expect(waters.isWater(-6, 0)).toBe(true);
  });
});

describe("sailing to the horizon", () => {
  const islands = [
    { slotId: "slot_north_1_1", x: 0, y: -120, radius: 18 },
    { slotId: "slot_east_1_2", x: 130, y: 0, radius: 16 }
  ];

  it("reaches out past the farthest neighbour, but not past the sea that is drawn", () => {
    const radius = horizonWatersRadius({ centre: { x: 0, y: 0 }, gridHalf: 47.5, seaRadius: 200, islands });
    expect(radius).toBeGreaterThan(130 + 16);
    expect(horizonWatersRadius({ centre: { x: 0, y: 0 }, gridHalf: 47.5, seaRadius: 150, islands })).toBeCloseTo(150 * 0.94, 5);
    // With no neighbours on the horizon, home waters are the island's own.
    expect(horizonWatersRadius({ centre: { x: 0, y: 0 }, gridHalf: 47.5, seaRadius: 200, islands: [] })).toBeCloseTo(67.5, 5);
  });

  it("keeps the hull off a neighbour's shore", () => {
    const waters = islandHelmWaters({ size: 96, originX: -47, originY: -47, isSeaCell: () => true, pier: null, radius: 160, obstacles: islands });
    expect(waters.isWater(130, 0)).toBe(false);
    expect(waters.isWater(130 - 16 - 1, 0)).toBe(true);
  });

  it("offers a neighbour once the ship is close to its shore, the nearest one first", () => {
    expect(nearestPort({ x: 0, y: 0 }, islands)).toBeNull();
    expect(nearestPort({ x: 130 - 16 - HELM_PORT_REACH + 1, y: 0 }, islands)?.slotId).toBe("slot_east_1_2");
    expect(nearestPort({ x: 0, y: -120 + 18 + 2 }, islands)?.slotId).toBe("slot_north_1_1");
  });
});
