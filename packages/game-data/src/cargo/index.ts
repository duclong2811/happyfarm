/**
 * Cargo capacity, as content.
 *
 * A container's capacity is a *number the game decides*, not a rule: a backpack carries more than a
 * pocket, a cart more than a person, a ship more than a cart. Keeping the numbers here means the
 * domain keeps the rule (nothing may exceed its capacity, removals are always allowed) and this file
 * keeps the balance, so a later backpack or vehicle is a new entry beside these rather than an edit
 * to a handler.
 *
 * **Provisional.** Thirty units is chosen to be small enough that a real playtest feels the limit and
 * large enough to carry a working session's harvest; it is not a balance decision, and the slice that
 * introduces carrying upgrades is expected to change it.
 */

export const STARTER_CARGO_CAPACITY = 30;

/**
 * The capacity each kind of actor starts with.
 *
 * Only the Main Character exists today. The map is the shape of what is coming - an NPC worker will
 * carry less, a cart and a ship much more - and a kind with no entry simply has no capacity yet.
 *
 * Keyed by the actor kind's own name rather than by an imported type: game data stays definitions and
 * numbers, and the adapter that reads it is the one place that knows the domain's vocabulary.
 */
export const CARGO_CAPACITY_BY_ACTOR_KIND: Readonly<Record<string, number>> = {
  MAIN_CHARACTER: STARTER_CARGO_CAPACITY
};

export function starterCargoCapacity(kind: string): number | null {
  return CARGO_CAPACITY_BY_ACTOR_KIND[kind] ?? null;
}
