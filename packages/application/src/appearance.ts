import type { PlayerId } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, Clock } from "./ports";

/** A player's stored look. */
export interface PlayerAppearanceRecord {
  readonly playerId: PlayerId;
  readonly characterId: string;
  readonly version: number;
  readonly updatedAt: string;
}

/** The one write path for a player's look. Upserts and bumps the version. */
export interface PlayerAppearanceRepository {
  find(playerId: PlayerId): Promise<PlayerAppearanceRecord | null>;
  save(playerId: PlayerId, characterId: string, updatedAt: string): Promise<PlayerAppearanceRecord>;
}

/** Which characters exist, from game data. Handed in so the application stays game-data free. */
export interface CharacterCatalogue {
  readonly defaultCharacterId: string;
  isSelectable(characterId: string): boolean;
}

export interface PlayerAppearanceView {
  readonly characterId: string;
  /** Whether the player has ever chosen, so a client can offer the picker to someone who has not. */
  readonly chosen: boolean;
  readonly version: number;
}

function viewOf(record: PlayerAppearanceRecord | null, catalogue: CharacterCatalogue): PlayerAppearanceView {
  // A stored id the catalogue no longer offers falls back to the default rather than drawing nothing.
  if (record === null || !catalogue.isSelectable(record.characterId)) {
    return { characterId: catalogue.defaultCharacterId, chosen: record !== null, version: record?.version ?? 0 };
  }
  return { characterId: record.characterId, chosen: true, version: record.version };
}

/** The caller's own look. Identity is the verified actor; there is no player id in the request. */
export class GetPlayerAppearance {
  constructor(
    private readonly appearances: PlayerAppearanceRepository,
    private readonly catalogue: CharacterCatalogue
  ) {}

  async execute(actor: ActorContext | null): Promise<PlayerAppearanceView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    return viewOf(await this.appearances.find(actor.playerId), this.catalogue);
  }
}

/**
 * Choosing a character.
 *
 * Cosmetic and naturally idempotent - setting the same character twice is the same state - so no
 * receipt is kept. The id must be one game data offers; anything else is refused before a write.
 */
export class SetPlayerAppearance {
  constructor(
    private readonly appearances: PlayerAppearanceRepository,
    private readonly catalogue: CharacterCatalogue,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, command: { readonly characterId: string }): Promise<PlayerAppearanceView> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if (!this.catalogue.isSelectable(command.characterId)) {
      throw new ApplicationError("CHARACTER_NOT_AVAILABLE", "That character cannot be chosen");
    }
    return viewOf(await this.appearances.save(actor.playerId, command.characterId, this.clock.now()), this.catalogue);
  }
}
