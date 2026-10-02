import { describe, expect, it } from "vitest";
import {
  CHARACTER_HEIGHT_WORLD,
  PLAYER_CHARACTER_ASSET,
  characterAnimationChange,
  characterAnimationStateFor,
  characterModelOffset,
  characterOrientationYaw,
  characterVisualScale,
  missingCharacterClips,
  resolveCharacterClip,
  type PlayerCharacterAssetConfig
} from "../../apps/web/src/render/player-character";
import { CHARACTER_MODEL_IDS } from "../../apps/web/src/render/character-model-urls";

/**
 * The character as presentation: what the gameplay state means, which clip draws it, and how a model
 * of any size or origin is drawn at the world's scale.
 *
 * All of this is pure, which is the point of the module's shape: the animation state machine, the
 * clip mapping and the scale/orientation correction can be asserted here, without a canvas, and the
 * parts that need three (the mixer, the clone) do nothing but execute the instructions computed here.
 * The last suite is the one that matters most - none of it may touch gameplay.
 */

/** A stand-in asset with the three clips under their own names. */
const SAMPLE: PlayerCharacterAssetConfig = {
  id: "test.sample",
  modelId: "character.test",
  targetHeightWorld: 1.6,
  scale: null,
  rotationOffsetY: 0,
  groundOffsetWorld: 0,
  animations: { idle: "Idle_A", walk: "Walk_A", run: "Run_A" },
  runFallbackRate: 1.35,
  crossFadeSeconds: 0.2
};

const CLIPS = ["Idle_A", "Walk_A", "Run_A", "Jump_A"] as const;

describe("what the character is doing", () => {
  it("is idle when nothing moves, and walking or running when something does", () => {
    expect(characterAnimationStateFor({ moving: false, running: false })).toBe("IDLE");
    // A run key held while standing still is not a run: it is not a movement state at all.
    expect(characterAnimationStateFor({ moving: false, running: true })).toBe("IDLE");
    expect(characterAnimationStateFor({ moving: true, running: false })).toBe("WALK");
    expect(characterAnimationStateFor({ moving: true, running: true })).toBe("RUN");
  });
});

describe("which clip draws it", () => {
  it("maps a semantic state to this asset's own clip name", () => {
    expect(resolveCharacterClip("IDLE", SAMPLE, CLIPS)).toEqual({ clip: "Idle_A", timeScale: 1 });
    expect(resolveCharacterClip("WALK", SAMPLE, CLIPS)).toEqual({ clip: "Walk_A", timeScale: 1 });
    expect(resolveCharacterClip("RUN", SAMPLE, CLIPS)).toEqual({ clip: "Run_A", timeScale: 1 });
  });

  it("falls back to the nearest clip an asset actually has", () => {
    // No run clip: the walk clip, played faster. The gameplay run speed is untouched - this is only
    // what the legs do.
    const noRun: PlayerCharacterAssetConfig = { ...SAMPLE, animations: { ...SAMPLE.animations, run: null } };
    expect(resolveCharacterClip("RUN", noRun, CLIPS)).toEqual({ clip: "Walk_A", timeScale: 1.35 });
    // A clip the config names but the file does not carry is treated as missing, not as a crash.
    const wrongNames: PlayerCharacterAssetConfig = {
      ...SAMPLE,
      animations: { idle: "Idle_Z", walk: "Walk_A", run: "Run_Z" }
    };
    expect(resolveCharacterClip("IDLE", wrongNames, CLIPS)).toEqual({ clip: "Walk_A", timeScale: 1 });
    expect(resolveCharacterClip("RUN", wrongNames, CLIPS)).toEqual({ clip: "Walk_A", timeScale: 1.35 });
    // Nothing usable at all: no clip, so the caller keeps whatever is playing rather than stopping.
    expect(resolveCharacterClip("RUN", SAMPLE, [])).toEqual({ clip: null, timeScale: 1 });
  });

  it("only ever hands back an instruction when the state actually changed", () => {
    // The rule that stops a clip being restarted every frame: same state in, nothing to do.
    expect(characterAnimationChange("WALK", "WALK", SAMPLE, CLIPS)).toBeNull();
    expect(characterAnimationChange(null, "IDLE", SAMPLE, CLIPS)).toEqual({
      clip: "Idle_A",
      timeScale: 1,
      fadeSeconds: 0.2
    });
    expect(characterAnimationChange("IDLE", "WALK", SAMPLE, CLIPS)?.clip).toBe("Walk_A");
    expect(characterAnimationChange("WALK", "RUN", SAMPLE, CLIPS)?.clip).toBe("Run_A");
    expect(characterAnimationChange("RUN", "IDLE", SAMPLE, CLIPS)?.clip).toBe("Idle_A");
    // An asset with no clips resolves to nothing to do, rather than to an instruction naming null.
    expect(characterAnimationChange("IDLE", "WALK", SAMPLE, [])).toBeNull();
  });
});

describe("how big the model is drawn", () => {
  it("normalises a model of any native size to the world's character height", () => {
    // The imported Kenney character measures 0.6713 units tall; the world's character is 1.6 metres.
    const scale = characterVisualScale(SAMPLE, 0.6713);
    expect(scale).toBeCloseTo(1.6 / 0.6713, 6);
    expect(1.6 / scale).toBeCloseTo(0.6713, 6);
    // Twice as tall a source needs half the scale: the drawn character is the same size.
    expect(characterVisualScale(SAMPLE, 1.3426)).toBeCloseTo(scale / 2, 6);
  });

  it("uses an explicit scale when the config gives one", () => {
    const fixed: PlayerCharacterAssetConfig = { ...SAMPLE, scale: 2 };
    expect(characterVisualScale(fixed, 0.1)).toBe(2);
    expect(characterVisualScale(fixed, 100)).toBe(2);
  });

  it("survives a model with no measurable height", () => {
    // A degenerate bounding box is a broken asset, not a reason to divide by zero and hide the player.
    expect(characterVisualScale(SAMPLE, 0)).toBe(1);
    expect(characterVisualScale(SAMPLE, Number.NaN)).toBe(1);
    expect(characterVisualScale(SAMPLE, -3)).toBe(1);
  });

  it("puts the feet on the ground and the centre over the player, wherever the model's origin is", () => {
    // A box from y = 0.5 to 2.5 (a model in metres, origin at its navel) drawn at scale 1.
    const offset = characterModelOffset({ min: [-1, 0.5, -1], max: [2, 2.5, 3] }, 1, SAMPLE);
    expect(offset.x).toBeCloseTo(-0.5, 9);
    expect(offset.z).toBeCloseTo(-1, 9);
    // The lowest point is brought to y = 0: feet on the ground rather than half a metre into it.
    expect(offset.y).toBeCloseTo(-0.5, 9);
    // And the offset is in the model's own units, so it scales with it.
    const scaled = characterModelOffset({ min: [-1, 0.5, -1], max: [2, 2.5, 3] }, 2, SAMPLE);
    expect(scaled.y).toBeCloseTo(-1, 9);
  });

  it("lifts the model by the config's ground offset", () => {
    const lifted: PlayerCharacterAssetConfig = { ...SAMPLE, groundOffsetWorld: 0.1 };
    const offset = characterModelOffset({ min: [0, 0, 0], max: [1, 1, 1] }, 2, lifted);
    expect(offset.y).toBeCloseTo(0.2, 9);
  });
});

describe("which way the model faces", () => {
  it("keeps the authoritative facing and adds this asset's own correction", () => {
    expect(characterOrientationYaw(Math.PI / 2, SAMPLE)).toBeCloseTo(Math.PI / 2, 9);
    const turned: PlayerCharacterAssetConfig = { ...SAMPLE, rotationOffsetY: Math.PI };
    expect(characterOrientationYaw(0, turned)).toBeCloseTo(Math.PI, 9);
    // The game's convention: local +Z is forward, which is what `facingYaw` already means.
    expect(PLAYER_CHARACTER_ASSET.rotationOffsetY).toBe(0);
  });
});

describe("the shipped asset configuration", () => {
  it("names a model the client can actually load", () => {
    expect(CHARACTER_MODEL_IDS).toContain(PLAYER_CHARACTER_ASSET.modelId);
    expect(PLAYER_CHARACTER_ASSET.targetHeightWorld).toBe(CHARACTER_HEIGHT_WORLD);
  });

  it("names the clips the imported pack ships, and lacks none of the three states", () => {
    // The Kenney Mini Characters pack carries exactly these three; the contract test on the file
    // itself (`tests/integration/player-character-asset.test.ts`) holds the other end of this.
    expect(PLAYER_CHARACTER_ASSET.animations).toEqual({ idle: "idle", walk: "walk", run: "sprint" });
    expect(missingCharacterClips(PLAYER_CHARACTER_ASSET, ["idle", "walk", "sprint"])).toEqual([]);
    expect(missingCharacterClips(PLAYER_CHARACTER_ASSET, ["idle"])).toEqual(["WALK", "RUN"]);
    expect(missingCharacterClips(SAMPLE, [])).toEqual(["IDLE", "WALK", "RUN"]);
  });
});

describe("gameplay cannot be changed by presentation", () => {
  it("reads its inputs and returns new values rather than mutating them", () => {
    // The invariant the brief cares about most, at the level where it could actually be broken: every
    // function here takes plain data, and none of them writes to it.
    const config: PlayerCharacterAssetConfig = Object.freeze({
      ...SAMPLE,
      animations: Object.freeze({ idle: "Idle_A", walk: "Walk_A", run: "Run_A" })
    });
    const clips = Object.freeze([...CLIPS]);
    const motion = Object.freeze({ moving: true, running: true });
    const box = Object.freeze({
      min: Object.freeze([-1, 0.5, -1] as const),
      max: Object.freeze([2, 2.5, 3] as const)
    });

    expect(characterAnimationStateFor(motion)).toBe("RUN");
    expect(resolveCharacterClip("RUN", config, clips).clip).toBe("Run_A");
    expect(characterAnimationChange("WALK", "RUN", config, clips)?.clip).toBe("Run_A");
    expect(characterVisualScale(config, 0.6713)).toBeGreaterThan(1);
    expect(characterModelOffset(box, 2, config).y).toBeCloseTo(-1, 9);
    expect(characterOrientationYaw(1, config)).toBe(1);
    expect(missingCharacterClips(config, clips)).toEqual([]);

    // Still exactly what it was: nothing above wrote through a frozen object.
    expect(config.animations).toEqual({ idle: "Idle_A", walk: "Walk_A", run: "Run_A" });
    expect([...clips]).toEqual([...CLIPS]);
    expect(motion).toEqual({ moving: true, running: true });
  });
});
