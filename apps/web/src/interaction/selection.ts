import type { CameraMode } from "../render/camera-mode";
import {
  INTERACTION_FACING_TOLERANCE_WORLD,
  type InteractableTarget,
  type InteractionCandidate
} from "./model";
import { targetsNear, type InteractionIndex } from "./registry";

/**
 * Which target the player means, and what happens when they act on it.
 *
 * Choosing is the only place "what is nearest" is decided, and it is a pure function of the targets,
 * where the player is, and which way they are facing - so the answer is a test rather than whatever
 * order the renderer happened to build its rows in. Acting is a separate decision that re-asks the
 * question with *fresh* data: a candidate the player has walked away from, or one the world has
 * changed underneath, must never be trusted just because a button was drawn a moment ago.
 */

export interface InteractionQuery {
  readonly worldX: number;
  readonly worldZ: number;
  /** Radians about Y, where 0 faces world +Z - the character's own facing. Null when unknown. */
  readonly facingYaw: number | null;
}

function distanceBetween(a: { worldX: number; worldZ: number }, b: { worldX: number; worldZ: number }): number {
  return Math.hypot(a.worldX - b.worldX, a.worldZ - b.worldZ);
}

/**
 * How much the character is facing a target: the cosine of the angle between them.
 *
 * `1` is straight ahead, `-1` is directly behind. Used only as a *preference* within a small distance
 * band, never as a filter: a farming game read through a third-person camera must not ask the player
 * to line up a crosshair, and a target they have walked up to must not be refused for being behind
 * them.
 */
export function facingTowards(query: InteractionQuery, target: { worldX: number; worldZ: number }): number {
  if (query.facingYaw === null || !Number.isFinite(query.facingYaw)) return 0;
  const dx = target.worldX - query.worldX;
  const dz = target.worldZ - query.worldZ;
  if (dx === 0 && dz === 0) return 1;
  // The world's yaw convention: 0 faces +Z, and a point is "ahead" when it lies along (sin, cos).
  const angleTo = Math.atan2(dx, dz);
  return Math.cos(angleTo - query.facingYaw);
}

/** A target in reach, or null when the player is standing next to nothing useful. */
export function interactionCandidateFrom(
  targets: readonly InteractableTarget[],
  query: InteractionQuery
): InteractionCandidate | null {
  let best: InteractionCandidate | null = null;
  for (const target of targets) {
    const distanceWorld = distanceBetween(query, target);
    const range = Number.isFinite(target.rangeWorld) ? target.rangeWorld : 0;
    if (!Number.isFinite(distanceWorld) || distanceWorld > range) continue;
    const candidate: InteractionCandidate = {
      ...target,
      distanceWorld,
      facing: facingTowards(query, target)
    };
    if (best === null || beats(candidate, best)) best = candidate;
  }
  return best;
}

/**
 * The order the choice is made in, and why it is this one.
 *
 * 1. **The more useful action wins.** A mature crop beats a landmark the player is standing beside,
 *    because "something I can do" outranks "something I can look at".
 * 2. **Otherwise the nearer one wins**, unless the two are within the facing tolerance - in which case
 *    the one the character is walking towards wins. That is the whole of the "broad facing preference":
 *    forgiving on a phone, and never a reason to refuse a clearly closer target.
 * 3. **Otherwise the lower key wins.** Keys are derived from server ids, so this is a stable
 *    tie-break between two equidistant targets rather than whatever order they arrived in.
 */
function beats(candidate: InteractionCandidate, incumbent: InteractionCandidate): boolean {
  if (candidate.priority !== incumbent.priority) return candidate.priority > incumbent.priority;
  const gap = Math.abs(candidate.distanceWorld - incumbent.distanceWorld);
  if (gap > INTERACTION_FACING_TOLERANCE_WORLD) return candidate.distanceWorld < incumbent.distanceWorld;
  if (candidate.facing !== incumbent.facing) return candidate.facing > incumbent.facing;
  if (gap > 1e-9) return candidate.distanceWorld < incumbent.distanceWorld;
  return candidate.key < incumbent.key;
}

/** What the player means right now: the bounded neighbourhood query and the choice above, together. */
export function selectInteractionCandidate(
  index: InteractionIndex,
  query: InteractionQuery
): InteractionCandidate | null {
  return interactionCandidateFrom(targetsNear(index, query.worldX, query.worldZ), query);
}

/**
 * What activating a candidate does, once the world has been asked again.
 *
 * `selected` is the candidate the prompt was drawn for; `fresh` is what discovery returns for where
 * the player is *now*. Anything that is no longer the same target is stale, and a stale candidate
 * activates nothing: the UI simply updates. This is the client's half of the range race - the server's
 * half is that it re-checks ownership, state and maturity on every command regardless.
 */
export type InteractionActivation =
  | { readonly kind: "INSPECT"; readonly target: InteractionCandidate }
  | {
      readonly kind: "HARVEST_CROP";
      readonly cropInstanceId: string;
      readonly expectedCropVersion: number;
    }
  | {
      readonly kind: "HARVEST_TREE";
      readonly treeInstanceId: string;
      readonly expectedTreeVersion: number;
    }
  | {
      /** A place that offers a service: walking up to the market stall and trading at it. */
      readonly kind: "TRADE";
      readonly service: "FARM_MARKET";
      readonly target: InteractionCandidate;
    }
  | { readonly kind: "STALE"; readonly reason: "GONE" | "CHANGED" };

export function interactionActivation(
  selected: InteractionCandidate | null,
  fresh: InteractionCandidate | null
): InteractionActivation {
  if (selected === null || fresh === null) return { kind: "STALE", reason: "GONE" };
  if (fresh.key !== selected.key) return { kind: "STALE", reason: "CHANGED" };
  if (fresh.action === "TRADE") return { kind: "TRADE", service: "FARM_MARKET", target: fresh };
  if (fresh.action === "HARVEST") {
    return fresh.kind === "TREE"
      ? { kind: "HARVEST_TREE", treeInstanceId: fresh.targetId, expectedTreeVersion: fresh.version }
      : { kind: "HARVEST_CROP", cropInstanceId: fresh.targetId, expectedCropVersion: fresh.version };
  }
  return { kind: "INSPECT", target: fresh };
}

export interface InteractionKeyInput {
  readonly key: string;
  /** Whether the keystroke landed in a text field, a select or anything else that owns the keyboard. */
  readonly typing: boolean;
  /**
   * Whether this is a held key repeating rather than a fresh press.
   *
   * Holding `E` must not machine-gun the server: the harvest is one press, one command. A repeat is
   * ignored here rather than throttled later, so nothing is ever sent for a keystroke the player did
   * not make.
   */
  readonly repeat: boolean;
  readonly cameraMode: CameraMode;
  readonly hasCandidate: boolean;
  /** Whether a panel, a placement or a move owns the pointer and keyboard right now. */
  readonly uiOpen: boolean;
}

/**
 * Whether `E` means "interact" rather than "turn the camera".
 *
 * `E` is already the character camera's keyboard orbit-right, so this is deliberately contextual
 * rather than a rebinding: with something in reach, `E` acts on it; with nothing in reach, the camera
 * keeps the key. The prompt is only drawn when this returns true, so the player is never guessing. It
 * never fires while typing, while a panel is open, or in estate view - where `E` still turns the item
 * in hand.
 */
export function interactionKeyRequested(input: InteractionKeyInput): boolean {
  if (input.key !== "e" && input.key !== "E") return false;
  if (input.typing || input.repeat || input.uiOpen) return false;
  if (input.cameraMode !== "CHARACTER") return false;
  return input.hasCandidate;
}
