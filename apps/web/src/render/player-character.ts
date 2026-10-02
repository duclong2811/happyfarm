import {
  AnimationMixer,
  Box3,
  Group,
  LoopRepeat,
  type AnimationAction,
  type AnimationClip,
  type Object3D
} from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

/**
 * The player character as *presentation*, and nothing else.
 *
 * The authoritative player - position, facing, terrain following, collision, speed - lives in
 * `apps/web/src/player/` and never learns that a model exists. This module is the other half: it is
 * handed the pose the runtime produced and draws a character at it. The GLTF is never the source of
 * truth for anything, and swapping it must not change a single gameplay number.
 *
 * Three rules make the asset replaceable:
 *
 * 1. **Asset-specific values live in one config** (`PLAYER_CHARACTER_ASSET`): the model id, the height
 *    it should be drawn at, the facing correction, the ground offset, which clips mean idle/walk/run,
 *    and how long a cross-fade takes. Nothing here is a literal inside the scene.
 * 2. **The model is normalised at load from its own bounding box** - measured height to the world's
 *    character height, feet on the ground - so a replacement with a different native scale needs no
 *    maths done by hand. (Geometry is left alone: this is a *skinned* mesh, and rescaling POSITION
 *    accessors without the skeleton tears the skin apart.)
 * 3. **Animation is a separate vocabulary from the clip names.** Gameplay produces a movement state;
 *    the config maps that state to whatever this asset calls its clips, and a missing clip falls back
 *    to the nearest one it does have rather than throwing.
 *
 * The old procedural avatar is kept as a development fallback: if the model cannot be loaded, it is
 * shown instead and the problem is reported, because an asset request that fails must never leave the
 * player invisible.
 */

/** How tall the character is drawn, in world metres. The world's scale is 1.6 and does not move. */
export const CHARACTER_HEIGHT_WORLD = 1.6;

export interface PlayerCharacterAssetConfig {
  /** A name for logs and reports: where this model came from. */
  readonly id: string;
  /** The id the shared model library resolves to a file (`character-model-urls.ts`). */
  readonly modelId: string;
  /** The height the model is normalised to. */
  readonly targetHeightWorld: number;
  /**
   * An explicit visual scale, or null to derive one from the loaded model's own bounding box.
   *
   * Null is the right answer for a new asset: the box is measured and the scale comes out of it, so a
   * replacement at a different native scale needs no arithmetic. The override exists for the case
   * where a model's *box* is not its height - a character with a raised prop, say.
   */
  readonly scale: number | null;
  /** Facing correction in radians. The game's convention is that a model faces its local +Z. */
  readonly rotationOffsetY: number;
  /** Extra lift after the feet are put on the ground, in metres. */
  readonly groundOffsetWorld: number;
  /** Which clip means what. Null when this asset has no such clip. */
  readonly animations: {
    readonly idle: string | null;
    readonly walk: string | null;
    readonly run: string | null;
  };
  /** How much faster the walk clip is played when there is no run clip. Never a gameplay speed. */
  readonly runFallbackRate: number;
  /** How long a change of animation state takes to blend. */
  readonly crossFadeSeconds: number;
}

/**
 * The temporary character.
 *
 * Kenney's Mini Characters, CC0, imported by `tools/asset-pipeline/node/import-kenney-character.mjs`.
 * See `docs/assets/PLAYER_CHARACTER_ASSET.md` for the licence and the file's measurements. Replacing
 * it is this object and the manifest entry it names - not a line of controller, camera or scene code.
 */
export const PLAYER_CHARACTER_ASSET: PlayerCharacterAssetConfig = {
  id: "kenney.mini-characters.character-male-a",
  modelId: "character.player_farmer",
  targetHeightWorld: CHARACTER_HEIGHT_WORLD,
  scale: null,
  // The pack is authored facing its own +Z, which is the convention `facingYaw` already uses. This is
  // the one value to flip (to `Math.PI`) if a visual check ever shows the character walking backwards.
  rotationOffsetY: 0,
  groundOffsetWorld: 0,
  animations: { idle: "idle", walk: "walk", run: "sprint" },
  runFallbackRate: 1.35,
  crossFadeSeconds: 0.2
};

/** What the renderer knows about the character this frame. A subset of the scene's player pose. */
export interface PlayerCharacterPose {
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly facingYaw: number;
  readonly movementState: "IDLE" | "WALKING";
  readonly elapsedWalk: number;
  /** Whether the player is holding the run key. Presentation only; the runtime owns the speed. */
  readonly running?: boolean;
}

// ------------------------------------------------------------------------------------------------
// The pure half: state, mapping, scale, orientation. All of it testable without a renderer.
// ------------------------------------------------------------------------------------------------

/** The three states every character has, whatever its clips are called. */
export type CharacterAnimationState = "IDLE" | "WALK" | "RUN";

export interface CharacterMotion {
  readonly moving: boolean;
  readonly running: boolean;
}

/**
 * What the character should be doing, from what the gameplay layer says they are doing.
 *
 * The only derivation in the module, and deliberately the only place `running` matters: the animation
 * represents the speed the runtime already applied, it never decides it.
 */
export function characterAnimationStateFor(motion: CharacterMotion): CharacterAnimationState {
  if (!motion.moving) return "IDLE";
  return motion.running ? "RUN" : "WALK";
}

export interface CharacterAnimationInstruction {
  readonly clip: string;
  /** Playback rate for the clip, 1 for a direct match. */
  readonly timeScale: number;
  readonly fadeSeconds: number;
}

/**
 * Which clip a semantic state means for this asset, and how fast to play it.
 *
 * The fallbacks are the point of the indirection. A state with no clip of its own borrows the nearest
 * one it can: RUN without a run clip is the walk clip played faster (which is what a run *is*, at this
 * fidelity), WALK without a walk clip is idle, and a state with nothing at all resolves to null so the
 * caller keeps whatever is already playing rather than stopping dead.
 */
export function resolveCharacterClip(
  state: CharacterAnimationState,
  config: PlayerCharacterAssetConfig,
  available: readonly string[]
): { readonly clip: string | null; readonly timeScale: number } {
  const has = (name: string | null): name is string => name !== null && available.includes(name);
  switch (state) {
    case "RUN":
      if (has(config.animations.run)) return { clip: config.animations.run, timeScale: 1 };
      if (has(config.animations.walk)) return { clip: config.animations.walk, timeScale: config.runFallbackRate };
      if (has(config.animations.idle)) return { clip: config.animations.idle, timeScale: config.runFallbackRate };
      return { clip: null, timeScale: 1 };
    case "WALK":
      if (has(config.animations.walk)) return { clip: config.animations.walk, timeScale: 1 };
      if (has(config.animations.idle)) return { clip: config.animations.idle, timeScale: 1 };
      return { clip: null, timeScale: 1 };
    case "IDLE":
      if (has(config.animations.idle)) return { clip: config.animations.idle, timeScale: 1 };
      if (has(config.animations.walk)) return { clip: config.animations.walk, timeScale: 1 };
      return { clip: null, timeScale: 1 };
  }
}

/**
 * What to do when the state changes, or null when it has not.
 *
 * Returning an *instruction* rather than touching an action keeps "only transition when the semantic
 * state changes" true by construction: the caller has nothing to do when this returns null, so a clip
 * cannot be restarted every frame.
 */
export function characterAnimationChange(
  previous: CharacterAnimationState | null,
  next: CharacterAnimationState,
  config: PlayerCharacterAssetConfig,
  available: readonly string[]
): CharacterAnimationInstruction | null {
  if (previous === next) return null;
  const resolved = resolveCharacterClip(next, config, available);
  if (resolved.clip === null) return null;
  return { clip: resolved.clip, timeScale: resolved.timeScale, fadeSeconds: config.crossFadeSeconds };
}

/** The visual scale that draws a model of this native height at the world's character height. */
export function characterVisualScale(
  config: PlayerCharacterAssetConfig,
  modelHeightWorld: number
): number {
  if (config.scale !== null) return config.scale;
  const target = config.targetHeightWorld;
  if (!Number.isFinite(modelHeightWorld) || modelHeightWorld <= 0.001) return 1;
  return target / modelHeightWorld;
}

/**
 * Where the model sits inside the character's own root, so its feet are on the ground and its centre
 * is over the authoritative position.
 *
 * Derived from the loaded bounding box rather than hand-tuned, which is what lets the next asset be
 * dropped in without anybody measuring it: a model whose origin is at its navel, or a metre off the
 * floor, is corrected here and the world never hears about it.
 */
export function characterModelOffset(
  box: { readonly min: readonly [number, number, number]; readonly max: readonly [number, number, number] },
  scale: number,
  config: PlayerCharacterAssetConfig
): { readonly x: number; readonly y: number; readonly z: number } {
  const centreX = (box.min[0] + box.max[0]) / 2;
  const centreZ = (box.min[2] + box.max[2]) / 2;
  return {
    x: -centreX * scale,
    y: (-box.min[1] + config.groundOffsetWorld) * scale,
    z: -centreZ * scale
  };
}

/** The yaw a model is drawn at: the authoritative facing, plus this asset's own correction. */
export function characterOrientationYaw(facingYaw: number, config: PlayerCharacterAssetConfig): number {
  return facingYaw + config.rotationOffsetY;
}

/** Which of the three semantic clips this asset cannot provide. For the report and the docs. */
export function missingCharacterClips(
  config: PlayerCharacterAssetConfig,
  available: readonly string[]
): readonly CharacterAnimationState[] {
  const missing: CharacterAnimationState[] = [];
  if (config.animations.idle === null || !available.includes(config.animations.idle)) missing.push("IDLE");
  if (config.animations.walk === null || !available.includes(config.animations.walk)) missing.push("WALK");
  if (config.animations.run === null || !available.includes(config.animations.run)) missing.push("RUN");
  return missing;
}

// ------------------------------------------------------------------------------------------------
// The view: one model, one mixer, loaded once and reused for the life of the scene.
// ------------------------------------------------------------------------------------------------

export interface PlayerCharacterViewOptions {
  /**
   * The procedural avatar, used until the model arrives and whenever it cannot.
   *
   * The scene owns what it looks like (and may rebuild its contents when a generated model lands);
   * this view owns the one decision that matters here - which of the two the player can see.
   */
  readonly fallback: Object3D;
  /** Loads a model by id through the shared library. Resolves null when nothing can draw it. */
  readonly loadModel: (modelId: string) => Promise<Object3D | null>;
  /** The clips that arrived with that model. Empty for a model with no animation. */
  readonly animationsOf: (modelId: string) => readonly AnimationClip[];
  /** Reports a failed load, so the host can say which asset and which fallback is active. */
  readonly onProblem?: (assetId: string, message: string) => void;
  readonly config?: PlayerCharacterAssetConfig;
}

export interface PlayerCharacterView {
  /** Added to the scene once. Follows the authoritative pose; nothing reads it back. */
  readonly root: Group;
  /** Whether the real model is in the scene. */
  ready(): boolean;
  /** Whether the procedural fallback is what the player can currently see. */
  usingFallback(): boolean;
  /**
   * Draws the character at this pose, one frame of animation at a time.
   *
   * Position and facing come from gameplay, never from the mesh: this reads the pose the runtime
   * produced and writes nothing back.
   */
  update(pose: PlayerCharacterPose | null, deltaSeconds: number): void;
  dispose(): void;
}

/** The bob the fallback avatar had before there was a model: it keeps the old look intact. */
const FALLBACK_BOB_WORLD = 0.035;
const FALLBACK_STEP_FREQUENCY = 9;

export function createPlayerCharacterView(options: PlayerCharacterViewOptions): PlayerCharacterView {
  const config = options.config ?? PLAYER_CHARACTER_ASSET;
  const root = new Group();

  const fallback = options.fallback;
  root.add(fallback);

  /** Where the model lives: this node carries the asset's own orientation correction. */
  const modelRoot = new Group();
  modelRoot.visible = false;
  root.add(modelRoot);

  let mixer: AnimationMixer | null = null;
  const actions = new Map<string, AnimationAction>();
  let clips: ReadonlyMap<string, AnimationClip> = new Map();
  let available: readonly string[] = [];
  let animationState: CharacterAnimationState | null = null;
  let current: AnimationAction | null = null;
  let disposed = false;

  void options.loadModel(config.modelId).then(
    (loaded) => {
      if (disposed) return;
      if (loaded === null) {
        // A missing or broken asset is a presentation problem, never a gameplay one: the fallback
        // stays on screen and the console says exactly what failed and what is being used instead.
        options.onProblem?.(
          config.id,
          `could not load ${config.modelId}; the placeholder character is being drawn instead`
        );
        return;
      }
      // The library keeps the original for every other caller, so a skinned mesh is cloned with
      // `SkeletonUtils.clone` rather than `Object3D.clone`: a plain clone would share the original's
      // bones and deform with it.
      const model = cloneSkinned(loaded);
      const box = new Box3().setFromObject(model);
      const height = box.max.y - box.min.y;
      const scale = characterVisualScale(config, height);
      model.scale.setScalar(scale);
      const offset = characterModelOffset(
        { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
        scale,
        config
      );
      model.position.set(offset.x, offset.y, offset.z);
      // One traversal, at load: shadows are configured once and never touched per frame.
      model.traverse((child) => {
        child.castShadow = true;
      });
      modelRoot.add(model);
      modelRoot.visible = true;
      fallback.visible = false;

      const animationClips = options.animationsOf(config.modelId);
      clips = new Map(animationClips.map((clip) => [clip.name, clip]));
      available = animationClips.map((clip) => clip.name);
      mixer = new AnimationMixer(model);
    },
    (error: unknown) => {
      if (disposed) return;
      options.onProblem?.(
        config.id,
        `could not load ${config.modelId} (${error instanceof Error ? error.message : String(error)}); ` +
          "the placeholder character is being drawn instead"
      );
    }
  );

  /**
   * The action for a clip, created the first time it is wanted.
   *
   * Lazy on purpose: the pack ships thirty-two clips and this character uses three, so building an
   * action for every one of them at load would be twenty-nine actions nothing will ever play.
   */
  function actionFor(name: string): AnimationAction | null {
    const existing = actions.get(name);
    if (existing !== undefined) return existing;
    const clip = clips.get(name);
    if (clip === undefined || mixer === null) return null;
    const action = mixer.clipAction(clip);
    actions.set(name, action);
    return action;
  }

  function play(instruction: CharacterAnimationInstruction): void {
    const next = actionFor(instruction.clip);
    if (next === null) return;
    const fade = instruction.fadeSeconds;
    if (current === next) {
      // The same clip, a different pace (walking into a run on an asset with no run clip).
      next.setEffectiveTimeScale(instruction.timeScale);
      return;
    }
    next.reset();
    next.setEffectiveWeight(1);
    next.setEffectiveTimeScale(instruction.timeScale);
    next.setLoop(LoopRepeat, Infinity);
    next.play();
    if (current !== null) next.crossFadeFrom(current, fade, false);
    else next.fadeIn(fade);
    current = next;
  }

  return {
    root,
    ready: () => mixer !== null,
    usingFallback: () => mixer === null,
    update(pose, deltaSeconds): void {
      if (disposed) return;
      if (pose === null) {
        root.visible = false;
        return;
      }
      root.visible = true;
      root.rotation.y = characterOrientationYaw(pose.facingYaw, config);

      if (mixer === null) {
        // The fallback has no clips, so its walk is the old step bob, driven by the same elapsed-walk
        // clock the placeholder always used.
        const bob =
          pose.movementState === "WALKING"
            ? Math.abs(Math.sin(pose.elapsedWalk * FALLBACK_STEP_FREQUENCY)) * FALLBACK_BOB_WORLD
            : 0;
        root.position.set(pose.worldX, pose.worldY + bob, pose.worldZ);
        return;
      }

      root.position.set(pose.worldX, pose.worldY, pose.worldZ);
      const state = characterAnimationStateFor({
        moving: pose.movementState === "WALKING",
        running: pose.running === true
      });
      const change = characterAnimationChange(animationState, state, config, available);
      if (change !== null) play(change);
      animationState = state;
      // A restored tab hands in a huge delta; the mixer clamps nothing, so the caller's seconds are
      // bounded the same way the player runtime bounds its own.
      const seconds = Number.isFinite(deltaSeconds) ? Math.min(Math.max(deltaSeconds, 0), 0.25) : 0;
      mixer.update(seconds);
    },
    dispose(): void {
      disposed = true;
      mixer?.stopAllAction();
      mixer = null;
      actions.clear();
      clips = new Map();
      // The clone's geometry and materials belong to the shared library's original, so they are not
      // disposed here - only the scene graph this view built is let go.
      modelRoot.clear();
      root.clear();
    }
  };
}

