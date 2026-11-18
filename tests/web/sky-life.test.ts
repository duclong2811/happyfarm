import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { MAX_DISTANCE } from "../../apps/web/src/render/camera";
import { createClouds, driftClouds } from "../../apps/web/src/render/sky-life";

/**
 * The sky's clouds (sky-life.ts) drift round the island but never come between the estate camera and
 * the island: every puff of every cloud stays beyond the camera's farthest reach, at every moment.
 */

function nearestPuffDistance(clouds: ReturnType<typeof createClouds>): number {
  clouds.updateMatrixWorld(true);
  let nearest = Number.POSITIVE_INFINITY;
  for (const cloud of clouds.children) {
    const box = new Box3().setFromObject(cloud);
    const centre = box.getCenter(new Vector3());
    const reach = box.getSize(new Vector3()).length() / 2;
    nearest = Math.min(nearest, Math.hypot(centre.x, centre.z) - reach);
  }
  return nearest;
}

describe("the sky's clouds", () => {
  it("stay beyond the estate camera's reach while they drift", () => {
    const clouds = createClouds();
    expect(clouds.children.length).toBeGreaterThanOrEqual(10);
    for (let step = 0; step < 50; step += 1) {
      expect(nearestPuffDistance(clouds)).toBeGreaterThan(MAX_DISTANCE);
      driftClouds(clouds, 120);
    }
  });

  it("drift: the same sky moves with the wind, and holds still without it", () => {
    const clouds = createClouds();
    const before = clouds.children.map((cloud) => cloud.position.clone());
    driftClouds(clouds, 0);
    expect(clouds.children.map((cloud) => cloud.position.clone())).toEqual(before);
    driftClouds(clouds, 30);
    expect(clouds.children.some((cloud, index) => cloud.position.distanceTo(before[index] ?? cloud.position) > 0.5)).toBe(true);
  });
});
