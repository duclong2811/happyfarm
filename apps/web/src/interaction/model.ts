/**
 * The vocabulary of "something is in reach and can be used".
 *
 * Character view used to be walking and looking. This module is the first half of making it gameplay:
 * a target is *discovered* (an adapter describes something in the world as something a player could
 * interact with) and only then is an *intent* executed. The two are deliberately different types in
 * different modules, because "which thing is nearest" and "what happens when you press the button" are
 * the two questions that must never be answered in the same place - discovery may not mutate anything,
 * and execution may not go looking for targets of its own.
 *
 * The model is generic on purpose. Harvest is the first real action because the server-authoritative
 * endpoint already exists, but the shape is the one Fishing, Mining, Chopping, Talking, Opening,
 * Entering and Using will all land in: a target, an action, a name, a distance, and a priority.
 */

import type { CropStateDTO, TreeStateDTO } from "@happy-farm/contracts";

/**
 * What a player can do to a target.
 *
 * Two actions ship in V14.1. The rest of the vocabulary in the brief (FISH, MINE, CHOP, TALK, OPEN,
 * ENTER, USE) is deliberately absent rather than declared and unimplemented: an action exists here when
 * there is a handler for it, and adding one is a case in `interactionActionPriority` plus an executor.
 */
export type InteractionAction = "INSPECT" | "HARVEST" | "TRADE" | "FISH";

/**
 * What the target *is*, for range, priority and the adapter that reads it.
 *
 * These are the client's read-model families, not persistence: a crop row stays a crop row, a
 * production tree stays a production tree, and a world object stays a construction. The interaction
 * layer adapts them into one candidate shape and never merges them into one table.
 */
export type InteractableKind = "CROP" | "TREE" | "WORLD_OBJECT" | "FISHING_SPOT";

/**
 * How close the player has to be, in world metres, by kind.
 *
 * One table rather than a number per call site, and deliberately generous: this is a farming game on a
 * phone, not a first-person shooter, so the player should be able to stand *near* a thing and use it.
 * A tile is about 1.08 m and the character is 1.6 m tall, so a crop's 2.6 m is roughly "standing at the
 * edge of the next tile", and a building's 3.6 m accounts for standing outside a barn rather than in
 * its middle. The server is still free to refuse: this is only what the client will offer.
 */
export const INTERACTION_RANGE_WORLD: Readonly<Record<InteractableKind, number>> = {
  CROP: 2.6,
  TREE: 2.8,
  WORLD_OBJECT: 3.6,
  // A fishing spot is a patch of water just off the bank, so the player stands on the shore and
  // reaches it: the same order as a building, and generous enough for a bank that curves.
  FISHING_SPOT: 3
};

/**
 * Which action wins when two targets are both in reach.
 *
 * A mature crop beats a rock the player is standing next to, because "something I can actually do"
 * outranks "something I can look at". The numbers are a table so a future FISH or MINE is one row.
 */
export const INTERACTION_ACTION_PRIORITY: Readonly<Record<InteractionAction, number>> = {
  // A place's own service and a ripe crop are both "something I can do", so they share a band and are
  // separated by distance; looking at a thing is worth less than acting on one.
  TRADE: 2,
  HARVEST: 2,
  FISH: 2,
  INSPECT: 1
};

/**
 * How much closer one target has to be before it beats another the player is facing.
 *
 * Half a metre: within that band the tie is broken by which way the character is looking, so a player
 * standing between two crops tends to get the one they walked towards - but a clearly nearer target
 * always wins, which is what keeps the choice predictable rather than camera-dependent.
 */
export const INTERACTION_FACING_TOLERANCE_WORLD = 0.5;

/**
 * One thing in the world a player could interact with.
 *
 * Adapters produce these; nothing else does. `key` is stable and unique across every family (it is
 * what the UI compares to know whether the prompt changed, and what activation compares to know
 * whether the world moved on), and `nameKey`/`nameFallback` follow the repository's rule that a name
 * comes from the server's own display key with the id as the honest fallback.
 */
export interface InteractableTarget {
  /** Stable identity of this target: family and instance. */
  readonly key: string;
  readonly kind: InteractableKind;
  readonly action: InteractionAction;
  /** The instance id the action will name: a crop, a tree, or a built thing. */
  readonly targetId: string;
  /** The cell it stands on, for selection and for the bounded neighbourhood search. */
  readonly tileX: number;
  readonly tileY: number;
  /** Where the player has to stand near, in world metres. */
  readonly worldX: number;
  readonly worldZ: number;
  readonly rangeWorld: number;
  readonly priority: number;
  readonly nameKey: string | null;
  readonly nameFallback: string;
  /**
   * The revision the client is looking at.
   *
   * Sent with the command as `expectedCropVersion`/`expectedTreeVersion`; the server refuses a stale
   * one, which is what stops a client that has not noticed a harvest from paying it twice.
   */
  readonly version: number;
  /**
   * For something that exists but is not ready: the server's own countdown, in seconds.
   *
   * The client never computes maturity - a growing crop offers Inspect, and this number is only how
   * the prompt says when it will be worth coming back. `null` means "ready, or not a timed thing".
   */
  readonly readyInSeconds: number | null;
}

/** A target that is in reach right now, with the number that put it there. */
export interface InteractionCandidate extends InteractableTarget {
  readonly distanceWorld: number;
  /** Cosine of the angle between where the character faces and where the target is. */
  readonly facing: number;
}

/**
 * The sentence a prompt shows for a target, in the current language.
 *
 * Built from the action's own key and the target's name, so the UI needs no per-kind wording: a future
 * FISH shows "Fish" with the fishing spot's name and nothing in the HUD changes.
 */
export interface InteractionPrompt {
  readonly key: string;
  readonly actionKey:
    | "interaction.harvest"
    | "interaction.inspect"
    | "interaction.trade"
    | "interaction.fish";
  readonly nameKey: string | null;
  readonly nameFallback: string;
  readonly readyInSeconds: number | null;
}

export function interactionPromptFor(candidate: InteractionCandidate): InteractionPrompt {
  return {
    key: candidate.key,
    actionKey: interactionActionKey(candidate.action),
    nameKey: candidate.nameKey,
    nameFallback: candidate.nameFallback,
    readyInSeconds: candidate.readyInSeconds
  };
}

/** The action's own word, as a translation key. One table, so a new action is one row. */
export function interactionActionKey(
  action: InteractionAction
): "interaction.harvest" | "interaction.inspect" | "interaction.trade" | "interaction.fish" {
  switch (action) {
    case "HARVEST":
      return "interaction.harvest";
    case "TRADE":
      return "interaction.trade";
    case "FISH":
      return "interaction.fish";
    case "INSPECT":
      return "interaction.inspect";
  }
}

/** A crop row is harvestable exactly when the server says it is mature. */
export function cropInteraction(crop: CropStateDTO): InteractionAction {
  return crop.mature ? "HARVEST" : "INSPECT";
}

/** A production tree offers its fruit exactly when the server says this cycle is ready. */
export function treeInteraction(tree: TreeStateDTO): InteractionAction {
  return tree.ready ? "HARVEST" : "INSPECT";
}
