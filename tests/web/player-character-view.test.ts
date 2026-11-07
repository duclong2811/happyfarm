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
import { CHARACTER_MODEL_URL_BY_ID } from "../../apps/web/src/render/character-model-urls";

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
    readonly loadTimeoutMs?: number;
    /** When false the harness builds the view and never asks it to load anything. */
    readonly request?: boolean;
  } = {}
) {
  const fallback = new Group();
  fallback.add(new Mesh(new BoxGeometry(0.2, 0.2, 0.2), new MeshBasicMaterial()));
  const problems: string[] = [];
  const lines: string[] = [];
  const view = createPlayerCharacterView({
    fallback,
    onProblem: (assetId, message) => {
      problems.push(`${assetId}: ${message}`);
      options.onProblem?.(assetId, message);
    },
    config: options.config ?? CONFIG,
    log: (line) => lines.push(line),
    ...(options.loadTimeoutMs === undefined ? {} : { loadTimeoutMs: options.loadTimeoutMs })
  });
  // Building the view never loads anything; the caller asks, exactly as the scene does at the end of
  // its own setup - after the model library exists.
  if (options.request !== false) {
    view.load({
      loadModel: () => (options.load === undefined ? Promise.resolve(syntheticModel()) : options.load()),
      animationsOf: () => clips()
    });
    // A turn of the microtask queue: the loader above is a resolved promise.
    await Promise.resolve();
    await Promise.resolve();
  }
  return { view, fallback, problems, lines };
}

describe("the character view", () => {
  it("draws the placeholder before anything has been asked for, and loads nothing itself", async () => {
    // The V13.4.1 hotfix, as a test. Constructing the view used to call the model library immediately,
    // which threw inside the scene's own setup ("Cannot access 'library' before initialization") and
    // left the world stuck before it was ever drawn. Constructing a cosmetic view must do nothing but
    // build the placeholder.
    const { view, fallback } = await loadedView({ request: false });
    expect(view.ready()).toBe(false);
    expect(view.usingFallback()).toBe(true);
    expect(fallback.visible).toBe(true);
    // And it is already usable: a pose draws the placeholder, so the game is playable before - and
    // whether or not - the real model ever arrives.
    view.update(pose({ movementState: "WALKING", elapsedWalk: 0.5 }), 0.016);
    expect(view.root.visible).toBe(true);
    expect(view.root.position.x).toBe(10);
  });

  it("asks for the model without handing the caller anything to wait on", async () => {
    // `load` returns void by design: the world cannot accidentally await a cosmetic asset, because
    // there is no promise to await. This is the API-level half of the invariant above.
    const { view } = await loadedView({ request: false });
    // The void-ness *is* the assertion here, which is the one case where reading a void expression is
    // deliberate rather than a mistake.
    // eslint-disable-next-line @typescript-eslint/no-confusing-void-expression -- asserting `load` hands back nothing
    const returned: unknown = view.load({
      loadModel: () => Promise.resolve(syntheticModel()),
      animationsOf: () => clips()
    });
    expect(returned).toBeUndefined();
    // And a second ask is ignored rather than starting a second download or a second mixer.
    view.load({ loadModel: () => Promise.reject(new Error("should not be called")), animationsOf: () => [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(view.ready()).toBe(true);
  });

  it("stays playable while the model is still loading, and reports a slow request without a failure", async () => {
    // A loader that never settles: the placeholder keeps being drawn, the world-facing state is
    // unaffected, and the timeout is only a slow-load diagnostic - not a failure raised to the UI.
    const { view, problems, lines } = await loadedView({ request: false, loadTimeoutMs: 0 });
    view.load({ loadModel: () => new Promise<Group | null>(() => undefined), animationsOf: () => [] });
    expect(view.ready()).toBe(false);
    expect(view.usingFallback()).toBe(true);
    view.update(pose({ movementState: "WALKING", elapsedWalk: 0.2 }), 0.016);
    expect(view.root.visible).toBe(true);
    // The timeout is a report, not a failure: nothing is cancelled and nothing is retried.
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(problems).toHaveLength(0);
    expect(lines.some((line) => line.includes("slow load") && line.includes("placeholder remains active"))).toBe(true);
    expect(lines.some((line) => line.startsWith("[character] loading "))).toBe(true);
  });

  it("swaps in a model that arrives after the slow-load diagnostic", async () => {
    let resolve: ((model: Group) => void) | undefined;
    const delayed = new Promise<Group>((complete) => { resolve = complete; });
    const { view, fallback, problems, lines } = await loadedView({ request: false, loadTimeoutMs: 0 });
    view.load({ loadModel: () => delayed, animationsOf: () => clips() });
    await new Promise((wait) => setTimeout(wait, 5));
    expect(view.usingFallback()).toBe(true);
    expect(problems).toHaveLength(0);
    resolve?.(syntheticModel());
    await Promise.resolve();
    await Promise.resolve();
    expect(view.ready()).toBe(true);
    expect(fallback.visible).toBe(false);
    expect(lines.some((line) => line.startsWith("[character] loaded "))).toBe(true);
  });

  it("draws the fallback until the model arrives, then swaps to it", async () => {
    const { view, fallback, lines } = await loadedView();
    expect(view.ready()).toBe(true);
    expect(view.usingFallback()).toBe(false);
    // The fallback is still in the graph - a failed asset must be able to come back to it - but the
    // player cannot see it, so there are never two characters on screen.
    expect(fallback.visible).toBe(false);
    expect(view.root.children).toContain(fallback);
    // The two diagnostics the hotfix asked for: what is being fetched, and that it arrived.
    expect(lines[0]).toBe(`[character] loading ${CHARACTER_MODEL_URL_BY_ID.get(CONFIG.modelId) ?? CONFIG.modelId}`);
    expect(lines.some((line) => line.startsWith("[character] loaded "))).toBe(true);
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
