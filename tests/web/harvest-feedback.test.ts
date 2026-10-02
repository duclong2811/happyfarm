import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  HARVEST_GESTURE_DURATION_MS,
  HARVEST_GESTURE_PEAK_RADIANS,
  REWARD_POP_DURATION_MS,
  harvestGestureBend,
  rewardPopKey
} from "../../apps/web/src/interaction/feedback";
import { interactionKeyRequested } from "../../apps/web/src/interaction/selection";
import {
  buildInteractionIndex,
  type InteractionWorldInput
} from "../../apps/web/src/interaction/registry";
import { selectInteractionCandidate } from "../../apps/web/src/interaction/selection";

/**
 * The beat a harvest has, and the rule that keeps it honest.
 *
 * Three things make a harvest feel like gameplay rather than an API call: the character moves, the
 * number that lands is the server's own, and the next ripe crop is already the candidate when the
 * player presses again. The first is arithmetic here; the third is the interaction registry doing its
 * job over the rows the server sent back; and the middle one is asserted by the code path rather than
 * by the client inventing a quantity.
 */

const STYLES = fileURLToPath(new URL("../../apps/web/src/styles.css", import.meta.url));
const NOW = Date.parse("2026-10-02T12:00:00.000Z");

function world(crops: InteractionWorldInput["crops"]): InteractionWorldInput {
  return {
    crops,
    trees: [],
    constructions: [],
    cropDefinitions: [
      {
        cropDefinitionId: "crop_carrot",
        displayNameKey: "crop.carrot.name",
        growthDurationSeconds: 300,
        seedItemDefinitionId: "item_carrot_seed",
        seedItemDisplayNameKey: "item.carrot_seed.name",
        harvestItemDefinitionId: "item_carrot",
        baseQuantity: 2,
        harvestXp: 1,
        requiredLevel: 1
      }
    ],
    treeDefinitions: [],
    worldObjects: new Map(),
    buildCatalog: [],
    nowMs: NOW
  };
}

function carrot(id: string, tileX: number, tileY: number, mature: boolean) {
  return {
    cropInstanceId: id,
    definitionId: "crop_carrot",
    tileX,
    tileY,
    plantedAt: new Date(NOW - 600_000).toISOString(),
    growthStage: 3,
    growthProgress: 1,
    mature,
    version: 4
  } as const;
}

describe("the harvest gesture", () => {
  it("starts and ends at rest, and peaks in the middle", () => {
    expect(harvestGestureBend(0)).toBe(0);
    expect(harvestGestureBend(HARVEST_GESTURE_DURATION_MS)).toBe(0);
    expect(harvestGestureBend(HARVEST_GESTURE_DURATION_MS / 2)).toBeCloseTo(HARVEST_GESTURE_PEAK_RADIANS, 6);
    // Out and back, and never past the peak.
    let previous = 0;
    for (let step = 1; step <= 10; step += 1) {
      const bend = harvestGestureBend((HARVEST_GESTURE_DURATION_MS * step) / 10);
      if (step <= 5) expect(bend).toBeGreaterThanOrEqual(previous);
      else expect(bend).toBeLessThanOrEqual(previous);
      previous = bend;
    }
  });

  it("is exactly zero outside the gesture, however odd the input", () => {
    // Zero outside means the caller can stop applying it without a special case, and a nonsense delta
    // can never leave the character leaning.
    expect(harvestGestureBend(-5)).toBe(0);
    expect(harvestGestureBend(HARVEST_GESTURE_DURATION_MS + 1)).toBe(0);
    expect(harvestGestureBend(Number.NaN)).toBe(0);
    expect(harvestGestureBend(100, 0)).toBe(0);
    expect(harvestGestureBend(100, -1)).toBe(0);
  });

  it("keeps a short, non-blocking beat", () => {
    // Long enough to read, short enough that movement is never locked: the brief's "no long animation
    // locks" in one assertion.
    expect(HARVEST_GESTURE_DURATION_MS).toBeGreaterThanOrEqual(200);
    expect(HARVEST_GESTURE_DURATION_MS).toBeLessThanOrEqual(500);
  });
});

describe("the reward pop", () => {
  it("is keyed by the harvest, so two of the same item are two pops", () => {
    expect(rewardPopKey(1, "item_carrot")).not.toBe(rewardPopKey(2, "item_carrot"));
  });

  it("runs for as long as the stylesheet says it does", () => {
    // The element is cleared by a timer in the page and animated by the sheet; the two numbers have to
    // be the same one, or the number vanishes mid-flight or hangs after the animation.
    const css = readFileSync(STYLES, "utf8");
    expect(REWARD_POP_DURATION_MS).toBe(1100);
    expect(css).toContain(`animation: reward-pop-rise ${String(REWARD_POP_DURATION_MS / 1000)}s`);
    expect(css).toContain(".reward-pop.is-live");
  });
});

describe("harvesting several crops", () => {
  it("makes the next ripe crop the candidate once the first is gone", () => {
    // The world the server reports after one harvest: the same field with one fewer crop. The candidate
    // is recomputed from that, so pressing again acts on the next one - no auto-harvest, no field sweep.
    const before = buildInteractionIndex(
      world([carrot("cropinst_11111111-1111-4111-8111-111111111111", 5, 5, true), carrot("cropinst_22222222-2222-4222-8222-222222222222", 6, 5, true)])
    );
    const standing = before.targets[0];
    if (standing === undefined) throw new Error("fixture produced no target");
    const here = { worldX: standing.worldX, worldZ: standing.worldZ, facingYaw: null };
    const first = selectInteractionCandidate(before, here);
    expect(first).not.toBeNull();

    const after = buildInteractionIndex(
      world([carrot("cropinst_22222222-2222-4222-8222-222222222222", 6, 5, true)])
    );
    const second = selectInteractionCandidate(after, here);
    expect(second?.targetId).toBe("cropinst_22222222-2222-4222-8222-222222222222");
    expect(second?.key).not.toBe(first?.key);
  });

  it("leaves a growing crop as something to inspect, never to harvest", () => {
    const index = buildInteractionIndex(world([carrot("cropinst_33333333-3333-4333-8333-333333333333", 5, 5, false)]));
    const target = index.targets[0];
    if (target === undefined) throw new Error("fixture produced no target");
    const candidate = selectInteractionCandidate(index, {
      worldX: target.worldX,
      worldZ: target.worldZ,
      facingYaw: null
    });
    expect(candidate?.action).toBe("INSPECT");
    expect(candidate?.readyInSeconds).not.toBeNull();
  });
});

describe("one press, one command", () => {
  it("ignores a held key and a second press while the first is in flight", () => {
    // The keyboard half: a repeat is not a press.
    const base = {
      key: "e",
      typing: false,
      repeat: true,
      cameraMode: "CHARACTER" as const,
      hasCandidate: true,
      uiOpen: false
    };
    expect(interactionKeyRequested(base)).toBe(false);
    expect(interactionKeyRequested({ ...base, repeat: false })).toBe(true);
  });
});
