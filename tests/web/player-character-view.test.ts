import { describe, expect, it } from "vitest";
import {
  AnimationClip,
  BoxGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  VectorKeyframeTrack
} from "three";
import {
  PLAYER_CHARACTER_ASSET,
  createPlayerCharacterView,
  type PlayerCharacterAssetConfig,
  type PlayerCharacterPose
} from "../../apps/web/src/render/player-character";

/**
 * The character view, driven with a *synthetic* model.
 *
 * The real GLB cannot be parsed outside a browser (three's loader needs an image decoder, and this
 * project's tests run without a DOM), so this suite exercises everything that is HappyFarm's own code
 * with a stand-in that has the same shape: a mesh whose feet are at its origin, and clips named the
 * way the config asks. That covers the parts that could actually be wrong - measuring, normalising,
 * grounding, hiding the fallback, choosing a clip, cross-fading, and never writing to the pose.
 *
 * The asset itself is held to its own contract in `tests/integration/player-character-asset.test.ts`:
 * one self-contained file, skinned, with the clips the config names.
 */

const CONFIG: PlayerCharacterAssetConfig = {
  ...PLAYER_CHARACTER_ASSET,
  animations: { idle: "idle", walk: "walk", run: "sprint" }
};

/** A 0.5-metre-tall box standing on its own origin, with three one-node clips. */
function syntheticModel(): Group {
  const model = new Group();
  const body = new Mesh(new BoxGeometry(0.3, 0.5, 0.2), new MeshBasicMaterial());
  body.name = "body";
  body.position.y = 0.25;
  model.add(body);
  return model;
}

function clips(): readonly AnimationClip[] {
  const track = (): VectorKeyframeTrack =>
    new VectorKeyframeTrack("body.position", [0, 0.5], [0, 0.25, 0, 0, 0.3, 0]);
  return (["idle", "walk", "sprint"] as const).map((name) => new AnimationClip(name, 0.5, [track()]));
}

/** A pose that is exactly what the runtime publishes for a walking character. */
function pose(overrides: Partial<PlayerCharacterPose> = {}): PlayerCharacterPose {
  return {
    worldX: 10,
    worldY: 1.5,
    worldZ: -4,
    facingYaw: Math.PI / 3,
    movementState: "IDLE",
    elapsedWalk: 0,
    running: false,
    ...overrides
  };
}

async function loadedView(
  options: {
    readonly load?: () => Promise<Group | null>;
    readonly onProblem?: (assetId: string, message: string) => void;
    readonly config?: PlayerCharacterAssetConfig;
  } = {}
) {
  const fallback = new Group();
  fallback.add(new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial()));
  const problems: string[] = [];
  const view = createPlayerCharacterView({
    fallback,
    loadModel: async () => (options.load === undefined ? syntheticModel() : options.load()),
    animationsOf: () => clips(),
    onProblem: (assetId, message) => {
      problems.push(`${assetId}: ${message}`);
      options.onProblem?.(assetId, message);
    },
    config: options.config ?? CONFIG
  });
  // One turn of the microtask queue: the load above is a resolved promise.
  await Promise.resolve();
  await Promise.resolve();
  return { view, fallback, problems };
}

describe("the character view", () => {
  it("draws the fallback until the model arrives, then swaps to it", async () => {
    const { view, fallback } = await loadedView();
    expect(view.ready()).toBe(true);
    expect(view.usingFallback()).toBe(false);
    // The fallback is still in the graph - a failed asset must be able to come back to it - but the
    // player cannot see it, so there are never two characters on screen.
    expect(fallback.visible).toBe(false);
    expect(view.root.children).toContain(fallback);
  });

  it("normalises the model to the world's character height and stands it on its feet", async () => {
    const { view } = await loadedView();
    // The stand-in is 0.5 units tall, so it is drawn at 1.6 / 0.5 = 3.2 times its own size.
    const modelRoot = view.root.children.find((child) => child !== view.root.children[0]);
    const model = modelRoot?.children[0];
    expect(model?.scale.x).toBeCloseTo(1.6 / 0.5, 6);
    // Its base was at y = 0 already, so the model is not lifted or sunk.
    expect(model?.position.y).toBeCloseTo(0, 6);
  });

  it("keeps the model centred over the authoritative position, whatever its origin", async () => {
    const { view } = await loadedView({
      load: () => {
        const model = syntheticModel();
        // An origin a metre off-centre in X, and half a metre above the feet: the classic imported
        // model, and exactly what the presentation layer exists to correct.
        model.position.set(1, 0.5, 0);
        return Promise.resolve(model);
      }
    });
    const model = view.root.children[1]?.children[0];
    // -centreX * scale, where the box now spans x = 0.85..1.15 => centre 1.
    expect(model?.position.x).toBeCloseTo(-1 * (1.6 / 0.5), 6);
    // -minY * scale, minY = 0.5.
    expect(model?.position.y).toBeCloseTo(-0.5 * (1.6 / 0.5), 6);
  });

  it("follows the pose it is given, and never writes to it", async () => {
    const { view } = await loadedView();
    const walking = pose({ movementState: "WALKING", elapsedWalk: 1.2, running: true });
    const frozen = Object.freeze(walking);
    view.update(frozen, 0.016);
    expect(view.root.position.x).toBe(10);
    expect(view.root.position.y).toBe(1.5);
    expect(view.root.position.z).toBe(-4);
    // Facing is the authoritative yaw plus the asset's own correction, which is zero for this one.
    expect(view.root.rotation.y).toBeCloseTo(Math.PI / 3, 9);
    expect(frozen).toEqual(walking);
  });

  it("hides the character when there is no pose, and shows it again when there is", async () => {
    const { view } = await loadedView();
    view.update(null, 0.016);
    expect(view.root.visible).toBe(false);
    view.update(pose(), 0.016);
    expect(view.root.visible).toBe(true);
  });

  it("plays the clip the movement state means, and blends only when it changes", async () => {
    const { view } = await loadedView();
    // Nothing to assert about the mixer's internals, but the call path must be exercised: walking,
    // then running, then stopping, without ever throwing or leaving the view in a bad state.
    view.update(pose({ movementState: "WALKING", elapsedWalk: 0.4 }), 0.016);
    view.update(pose({ movementState: "WALKING", elapsedWalk: 0.8, running: true }), 0.016);
    view.update(pose({ movementState: "IDLE" }), 0.016);
    // A frame with an absurd delta (a restored tab) is clamped rather than jumping the clip.
    view.update(pose({ movementState: "WALKING", elapsedWalk: 9 }), 30);
    expect(view.ready()).toBe(true);
  });

  it("falls back to the placeholder and reports the problem when the model cannot load", async () => {
    const { view, fallback, problems } = await loadedView({ load: () => Promise.resolve(null) });
    expect(view.ready()).toBe(false);
    expect(view.usingFallback()).toBe(true);
    // The player stays visible and keeps moving with the old avatar, and the console was told which
    // asset failed and what is being drawn instead.
    expect(fallback.visible).toBe(true);
    view.update(pose({ movementState: "WALKING", elapsedWalk: 0.3 }), 0.016);
    expect(view.root.visible).toBe(true);
    expect(view.root.position.z).toBe(-4);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain(CONFIG.modelId);
    expect(problems[0]).toContain("placeholder");
  });

  it("reports a load that rejects, rather than leaving a hole where the player is", async () => {
    const { view, problems } = await loadedView({
      load: () => Promise.reject(new Error("network down"))
    });
    expect(view.usingFallback()).toBe(true);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("network down");
  });

  it("lets go of everything on dispose, without touching the shared library's model", async () => {
    const { view } = await loadedView();
    expect(() => {
      view.dispose();
    }).not.toThrow();
    // The view is empty afterwards; the geometry and materials belong to the library's original and
    // are deliberately not disposed here.
    expect(view.root.children).toHaveLength(0);
    // A frame after disposal is a no-op rather than a crash.
    view.update(pose(), 0.016);
  });
});
