import { DomainError } from "./errors";
import type { PlayerId } from "./ids";

export const PLAYER_STATUSES = ["ACTIVE", "SUSPENDED", "DELETED"] as const;
export type PlayerStatus = (typeof PLAYER_STATUSES)[number];

export interface Player {
  readonly id: PlayerId;
  readonly authIssuer: string;
  readonly authSubject: string;
  readonly displayName: string;
  readonly status: PlayerStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export function assertActivePlayer(player: Player | null): asserts player is Player {
  if (player === null || player.status !== "ACTIVE") {
    throw new DomainError("INVALID_PLAYER", "Authenticated player is not active");
  }
}
