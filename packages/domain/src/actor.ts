import { DomainError } from "./errors";
import type { ActorId, PlayerId } from "./ids";

/**
 * An actor: the entity capable of performing Jobs.
 *
 * An actor is deliberately **not** a player. A player is the account authority - who may act - and an
 * actor is the thing that does the acting. Today they are one-to-one (a player's Main Character), and
 * that is a fact about the current game rather than a rule of the model: a later slice adds NPCs,
 * carts and ships beside the Main Character, each its own actor, without re-identifying anything.
 *
 * **The Main Character is the player's first worker.** There is no separate "automation character"
 * and there never will be: whether the human is driving it or a future Job is, it is the same actor,
 * the same cargo and the same settlements. A slice that introduced a second economic actor for
 * automation would be double-counting the player's own hands.
 */

/**
 * The actor vocabulary.
 *
 * Only `MAIN_CHARACTER` exists today, and only it is ever created. The rest are named for the same
 * reason the wire's `ZONE_KINDS` names unimplemented places: a reader of the schema should see the
 * shape of the world that is coming, and a later slice should be a new row rather than a new enum.
 */
export const ACTOR_KINDS = ["MAIN_CHARACTER", "NPC_WORKER", "VEHICLE", "SHIP"] as const;
export type ActorKind = (typeof ACTOR_KINDS)[number];

export const MAIN_CHARACTER_KIND: ActorKind = "MAIN_CHARACTER";

/**
 * Who decides what the actor does next.
 *
 * This is *configuration* and is stored, because it is the column the future Auto ON/OFF switch
 * writes. It is deliberately independent of both activity and job enablement: an `AUTO_CONTROLLED`
 * actor with nothing actionable is idle, and a `PLAYER_CONTROLLED` actor can be performing a job -
 * the distinction the handoff rules exist for.
 */
export const CONTROL_MODES = ["PLAYER_CONTROLLED", "AUTO_CONTROLLED"] as const;
export type ControlMode = (typeof CONTROL_MODES)[number];

/**
 * What an actor is physically doing.
 *
 * **Deliberately not persisted in this slice.** Activity is runtime state that only a working
 * executor can produce, and a column nobody writes is a column that lies. It is named here so the
 * domain has the vocabulary ready and so no later slice is tempted to overload control mode with it.
 */
export type ActorActivity = "IDLE" | "TRAVELLING" | "WORKING" | "HAULING" | "WAITING_FOR_STORAGE";

export interface Actor {
  readonly id: ActorId;
  /** The player whose account this actor belongs to. Identity, not a client-supplied field. */
  readonly ownerPlayerId: PlayerId;
  readonly kind: ActorKind;
  readonly controlMode: ControlMode;
  /** Where the actor stands. A location, never a permission. */
  readonly zoneKind: string;
  readonly zoneId: string;
  /**
   * How much the actor can carry, in cargo units.
   *
   * On the row rather than in a constant so a backpack, a piece of equipment, a cart or a ship is a
   * different number for the same code, exactly as a warehouse tier is. The starter value comes from
   * game data (`STARTER_CARGO_CAPACITY`), and balancing it is deliberately provisional.
   */
  readonly cargoCapacity: number;
  /**
   * The cargo container's own version.
   *
   * Separate from the actor's configuration `version` on purpose: an unload must not invalidate a
   * concurrent job reorder, and a reorder must not make a cargo read stale. Bumped by every cargo
   * mutation, which is what makes "stale Cargo version" a thing a caller can be told about.
   */
  readonly cargoVersion: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function parseActorKind(value: string): ActorKind {
  if (!(ACTOR_KINDS as readonly string[]).includes(value)) {
    throw new DomainError("INVALID_ACTOR", "Actor kind is not recognised");
  }
  return value as ActorKind;
}

export function parseControlMode(value: string): ControlMode {
  if (!(CONTROL_MODES as readonly string[]).includes(value)) {
    throw new DomainError("INVALID_ACTOR", "Control mode is not recognised");
  }
  return value as ControlMode;
}

export function isMainCharacter(actor: Pick<Actor, "kind">): boolean {
  return actor.kind === MAIN_CHARACTER_KIND;
}

/**
 * Whether an actor may be asked to do this kind of work.
 *
 * The Main Character is a person: it can farm, keep an orchard, gather wood and mine. That is the
 * whole of today's rule, and it is a *capability* answer rather than a permission one - a later slice
 * gives ships and carts their own smaller sets (SAIL, TRANSPORT) and this function is where a job
 * asks. Nothing here restricts a player by element, level or specialisation.
 */
export function actorAcceptsWork(kind: ActorKind): boolean {
  return kind === MAIN_CHARACTER_KIND;
}

