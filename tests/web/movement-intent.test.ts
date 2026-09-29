import { describe, expect, it } from "vitest";
import {
  ARRIVAL_RADIUS_WORLD,
  destinationIntent,
  hasArrived,
  intentFor,
  movementVector,
  NO_MOVEMENT
} from "../../apps/web/src/player/intent";

describe("movement intent", () => {
  it("walks in the direction a key asks for", () => {
    const intent = intentFor({ x: 0, z: 1 }, null);
    expect(intent).toEqual({ kind: "directional", input: { x: 0, z: 1 } });
    expect(movementVector(intent, { x: 5, z: 5 })).toEqual({ x: 0, z: 1 });
  });

  it("stands still with no key and no destination", () => {
    expect(intentFor({ x: 0, z: 0 }, null)).toEqual(NO_MOVEMENT);
    expect(movementVector(NO_MOVEMENT, { x: 0, z: 0 })).toBeNull();
    expect(destinationIntent(null)).toEqual(NO_MOVEMENT);
  });

  it("walks a straight unit vector at a queued destination", () => {
    const intent = destinationIntent({ worldX: 3, worldZ: 4 });
    const vector = movementVector(intent, { x: 0, z: 0 });
    // Unit length, so a walk is the same speed as holding a key.
    expect(vector?.x).toBeCloseTo(0.6, 9);
    expect(vector?.z).toBeCloseTo(0.8, 9);
    expect(Math.hypot(vector?.x ?? 0, vector?.z ?? 0)).toBeCloseTo(1, 9);
  });

  it("arrives rather than orbiting the target", () => {
    const target = { worldX: 0, worldZ: ARRIVAL_RADIUS_WORLD };
    expect(hasArrived(target, { x: 0, z: 0 })).toBe(true);
    expect(movementVector(destinationIntent(target), { x: 0, z: 0 })).toBeNull();
    // Just outside the radius still walks.
    const outside = { worldX: 0, worldZ: ARRIVAL_RADIUS_WORLD * 2 };
    expect(movementVector(destinationIntent(outside), { x: 0, z: 0 })).not.toBeNull();
  });

  it("lets a held key win over a queued destination", () => {
    const intent = intentFor({ x: -1, z: 0 }, { worldX: 100, worldZ: 100 });
    expect(intent).toEqual({ kind: "directional", input: { x: -1, z: 0 } });
  });

  it("refuses nonsense rather than walking on it", () => {
    expect(intentFor({ x: Number.NaN, z: 1 }, null)).toEqual(NO_MOVEMENT);
    expect(movementVector(destinationIntent({ worldX: Number.NaN, worldZ: 0 }), { x: 0, z: 0 })).toBeNull();
    expect(hasArrived({ worldX: Number.POSITIVE_INFINITY, worldZ: 0 }, { x: 0, z: 0 })).toBe(true);
  });
});
