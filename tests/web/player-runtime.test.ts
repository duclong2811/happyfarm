import { describe, expect, it } from "vitest";
import { PLAYER_SPEED, type PlayerState } from "../../apps/web/src/player/controller";
import type { InputVector } from "../../apps/web/src/player/input";
import { createPlayerRuntime } from "../../apps/web/src/player/runtime";
import { tileToWorld, worldFrame } from "../../apps/web/src/render/layout";
import type { SceneTile } from "../../apps/web/src/render/view-model";
import { SPAWN_WORLD } from "../../apps/web/src/render/world-config";

const SPAWN = { worldX: SPAWN_WORLD.worldX, worldZ: SPAWN_WORLD.worldZ };
const FEET_Y = 0.02;

function plantedTile(x: number, y: number): SceneTile {
  const position = tileToWorld({ x, y }, worldFrame());
  return {
    tileX: x,
    tileY: y,
    worldX: position.worldX,
    worldZ: position.worldZ,
    terrainType: "SOIL",
    plantable: false,
    selected: false,
    crop: { cropInstanceId: "cropinst_1", definitionId: "crop_carrot", mature: false, heightFraction: 0.2 },
    tree: null
  };
}

function emptyTile(x: number, y: number): SceneTile {
  const position = tileToWorld({ x, y }, worldFrame());
  return {
    tileX: x,
    tileY: y,
    worldX: position.worldX,
    worldZ: position.worldZ,
    terrainType: "SOIL",
    plantable: true,
    selected: false,
    crop: null,
    tree: null
  };
}

/** The runtime with a frame source the test drives by hand, standing in for `requestAnimationFrame`. */
function createHarness() {
  const poses: (PlayerState | null)[] = [];
  const pending: ((timestampMs: number) => void)[] = [];
  let input: InputVector = { x: 0, z: 0 };
  let cancels = 0;

  const runtime = createPlayerRuntime({
    spawn: SPAWN,
    feetY: FEET_Y,
    readInput: () => input,
    onPose: (pose) => poses.push(pose),
    requestFrame: (tick) => pending.push(tick),
    cancelFrame: () => {
      cancels += 1;
      pending.length = 0;
    }
  });

  return {
    runtime,
    poses,
    setInput(next: InputVector): void {
      input = next;
    },
    pendingFrames(): number {
      return pending.length;
    },
    cancels(): number {
      return cancels;
    },
    runFrame(timestampMs: number): void {
      const tick = pending.shift();
      if (tick === undefined) throw new Error("the runtime did not schedule a frame");
      tick(timestampMs);
    }
  };
}

describe("player runtime", () => {
  it("starts at the spawn and stops with no pose", () => {
    const harness = createHarness();
    expect(harness.runtime.running).toBe(false);
    expect(harness.runtime.pose).toBeNull();

    harness.runtime.start();
    expect(harness.runtime.running).toBe(true);
    expect(harness.runtime.pose?.x).toBeCloseTo(SPAWN.worldX, 9);
    expect(harness.runtime.pose?.z).toBeCloseTo(SPAWN.worldZ, 9);
    expect(harness.runtime.pose?.y).toBeCloseTo(FEET_Y, 9);
    // The first pose reaches the scene without a frame and without a key press: a character that
    // only appeared once the player moved would be invisible on a farm nobody has touched.
    expect(harness.pendingFrames()).toBe(0);
    expect(harness.poses).toHaveLength(1);
    expect(harness.poses[0]?.x).toBeCloseTo(SPAWN.worldX, 9);
    expect(harness.poses[0]?.z).toBeCloseTo(SPAWN.worldZ, 9);

    harness.runtime.stop();
    expect(harness.runtime.running).toBe(false);
    expect(harness.runtime.pose).toBeNull();
    expect(harness.poses).toEqual([expect.objectContaining({ x: SPAWN.worldX }), null]);
  });

  it("wakes exactly one frame per burst, and does not move before the first timestamp", () => {
    const harness = createHarness();
    harness.runtime.start();
    harness.setInput({ x: 0, z: 1 });
    harness.runtime.wake();
    harness.runtime.wake();
    expect(harness.pendingFrames()).toBe(1);

    // The first frame of a burst has no predecessor, so it establishes the clock and moves nothing.
    harness.runFrame(1000);
    expect(harness.runtime.pose?.z).toBeCloseTo(SPAWN.worldZ, 9);
    expect(harness.pendingFrames()).toBe(1);
  });

  it("keeps walking while a key is held and sleeps once it is released", () => {
    const harness = createHarness();
    harness.runtime.start();
    harness.setInput({ x: 0, z: 1 });
    harness.runtime.wake();
    harness.runFrame(0);
    harness.runFrame(16);
    harness.runFrame(32);
    expect(harness.runtime.pose?.z).toBeCloseTo(SPAWN.worldZ + PLAYER_SPEED * 0.032, 6);
    expect(harness.runtime.pose?.movementState).toBe("WALKING");
    expect(harness.pendingFrames()).toBe(1);

    harness.setInput({ x: 0, z: 0 });
    harness.runFrame(48);
    expect(harness.runtime.pose?.movementState).toBe("IDLE");
    expect(harness.pendingFrames()).toBe(0);

    // A new burst starts from a clean clock, not from the timestamp of the last one.
    harness.runtime.wake();
    expect(harness.pendingFrames()).toBe(1);
  });

  it("does nothing when woken while stopped", () => {
    const harness = createHarness();
    harness.runtime.wake();
    expect(harness.pendingFrames()).toBe(0);
    expect(harness.runtime.pose).toBeNull();
  });

  it("cancels the outstanding frame on stop and ignores a frame that arrives afterwards", () => {
    const harness = createHarness();
    harness.runtime.start();
    harness.setInput({ x: 0, z: 1 });
    harness.runtime.wake();
    expect(harness.pendingFrames()).toBe(1);

    harness.runtime.stop();
    expect(harness.cancels()).toBe(1);
    expect(harness.pendingFrames()).toBe(0);

    // Even a frame that somehow still fires cannot resurrect the character.
    const published = harness.poses.length;
    harness.runtime.tick(2000);
    expect(harness.runtime.pose).toBeNull();
    expect(harness.poses).toHaveLength(published);
  });

  it("rebuilds collision on a farm refresh without moving or resetting the character", () => {
    const harness = createHarness();
    harness.runtime.start();
    harness.setInput({ x: 0, z: 1 });
    harness.runtime.wake();
    harness.runFrame(0);
    harness.runFrame(16);
    harness.runFrame(32);
    const moved = harness.runtime.pose;

    harness.runtime.setTiles([emptyTile(0, 0), plantedTile(4, 4)]);
    expect(harness.runtime.pose).toBe(moved);
    expect(harness.runtime.pose?.z).toBeCloseTo(moved?.z ?? Number.NaN, 9);
    expect(harness.pendingFrames()).toBe(1);
  });

  it("lets a plot purchase change the ground without teleporting the character", () => {
    const harness = createHarness();
    harness.runtime.start();
    harness.setInput({ x: 0, z: -1 });
    harness.runtime.wake();
    harness.runFrame(0);
    harness.runFrame(16);
    const before = harness.runtime.pose?.z ?? Number.NaN;

    // The farm grows from the starter plot to the whole catalogue field.
    const expanded: SceneTile[] = [];
    for (let y = 0; y < 18; y += 1) {
      for (let x = 0; x < 18; x += 1) expanded.push(emptyTile(x, y));
    }
    harness.runtime.setTiles(expanded);
    expect(harness.runtime.pose?.z).toBeCloseTo(before, 9);

    harness.runFrame(32);
    // One more frame of walking: the position continues from where it was, and cannot have jumped.
    const after = harness.runtime.pose?.z ?? Number.NaN;
    expect(before - after).toBeGreaterThan(0);
    expect(before - after).toBeLessThanOrEqual(PLAYER_SPEED * 0.05);
  });

  it("respawns a running character at the spawn and leaves a stopped one alone", () => {
    const harness = createHarness();
    harness.runtime.respawn();
    expect(harness.runtime.pose).toBeNull();

    harness.runtime.start();
    harness.setInput({ x: 0, z: 1 });
    harness.runtime.wake();
    harness.runFrame(0);
    harness.runFrame(500);
    expect(harness.runtime.pose?.z).toBeGreaterThan(SPAWN.worldZ);

    harness.runtime.respawn();
    expect(harness.runtime.pose?.z).toBeCloseTo(SPAWN.worldZ, 9);
    expect(harness.runtime.pose?.movementState).toBe("IDLE");
  });

  it("walks to a queued destination and stops there", () => {
    const harness = createHarness();
    harness.runtime.start();
    const targetZ = SPAWN.worldZ - 3;
    harness.runtime.setDestination({ worldX: SPAWN.worldX, worldZ: targetZ });
    // A destination wakes the loop the same way a held key does.
    expect(harness.pendingFrames()).toBe(1);

    let timestamp = 0;
    for (let frame = 0; frame < 400 && harness.runtime.destination !== null; frame += 1) {
      harness.runFrame(timestamp);
      timestamp += 16;
    }
    expect(harness.runtime.destination).toBeNull();
    // Arrival means stopping inside the arrival radius, on the near side of the target.
    expect(Math.abs((harness.runtime.pose?.z ?? 0) - targetZ)).toBeLessThanOrEqual(0.4);
    expect(harness.runtime.pose?.movementState).toBe("IDLE");
    expect(harness.pendingFrames()).toBe(0);
  });

  it("never moves a destination without a frame", () => {
    // Only a tick moves the character. Nothing else - a camera drag, a panel toggle, a refresh -
    // can reach the pose, which is why a destination alone must leave it exactly where it was.
    const harness = createHarness();
    harness.runtime.start();
    const before = harness.runtime.pose;
    harness.runtime.setDestination({ worldX: SPAWN.worldX + 4, worldZ: SPAWN.worldZ });
    expect(harness.runtime.pose).toBe(before);
  });

  it("cancels a destination the moment a movement key is pressed", () => {
    const harness = createHarness();
    harness.runtime.start();
    harness.runtime.setDestination({ worldX: SPAWN.worldX, worldZ: SPAWN.worldZ - 5 });
    harness.runFrame(0);
    expect(harness.runtime.destination).not.toBeNull();

    harness.setInput({ x: 0, z: 1 });
    harness.runFrame(16);
    expect(harness.runtime.destination).toBeNull();
    // The hand wins: the character now walks south, away from the queued target.
    expect(harness.runtime.pose?.z).toBeGreaterThan(SPAWN.worldZ);
  });

  it("replaces an old destination with a new one", () => {
    const harness = createHarness();
    harness.runtime.start();
    harness.runtime.setDestination({ worldX: SPAWN.worldX, worldZ: SPAWN.worldZ - 5 });
    harness.runFrame(0);
    harness.runFrame(16);
    harness.runtime.setDestination({ worldX: SPAWN.worldX + 2, worldZ: SPAWN.worldZ });
    expect(harness.runtime.destination).toEqual({ worldX: SPAWN.worldX + 2, worldZ: SPAWN.worldZ });
    // One walk at a time: the loop is alive for the new target, not the abandoned one.
    expect(harness.pendingFrames()).toBe(1);
  });

  it("stops safely when a destination cannot be reached", () => {
    const harness = createHarness();
    harness.runtime.start();
    // A crop sits on the target tile, so the walk can never arrive: the collision world refuses the
    // last step and the queue is dropped instead of spinning against the obstacle.
    const blockedTile = plantedTile(3, 25);
    harness.runtime.setTiles([blockedTile]);
    harness.runtime.setDestination({ worldX: blockedTile.worldX, worldZ: blockedTile.worldZ });

    let timestamp = 0;
    let frames = 0;
    for (; frames < 600 && harness.runtime.destination !== null; frames += 1) {
      harness.runFrame(timestamp);
      timestamp += 16;
    }
    expect(harness.runtime.destination).toBeNull();
    expect(harness.pendingFrames()).toBe(0);
    // It stopped on the near side of the crop rather than standing on it.
    expect(harness.runtime.pose?.movementState).toBe("IDLE");
    const distance = Math.hypot(
      (harness.runtime.pose?.x ?? 0) - blockedTile.worldX,
      (harness.runtime.pose?.z ?? 0) - blockedTile.worldZ
    );
    expect(distance).toBeGreaterThan(0.4);
  });
});
