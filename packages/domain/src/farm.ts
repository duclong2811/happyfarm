import { DomainError } from "./errors";
import type { FarmId, PlayerId } from "./ids";

export const FARM_ROLES = ["OWNER", "EDITOR", "HELPER", "VISITOR"] as const;
export type FarmRole = (typeof FARM_ROLES)[number];

export interface Farm {
  readonly id: FarmId;
  readonly ownerPlayerId: PlayerId;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface FarmMember {
  readonly farmId: FarmId;
  readonly playerId: PlayerId;
  readonly role: FarmRole;
  readonly createdAt: string;
}

export function parseFarmRole(value: string): FarmRole {
  if (!FARM_ROLES.some((role) => role === value)) {
    throw new DomainError("INVALID_ROLE", "Invalid farm role");
  }
  return value as FarmRole;
}

export function validateFarmName(value: string): string {
  const name = value.trim();
  if (name.length < 1 || name.length > 80) {
    throw new DomainError("INVALID_FARM", "Farm name must contain 1 to 80 characters");
  }
  return name;
}

export function createOwnedFarm(
  id: FarmId,
  ownerPlayerId: PlayerId,
  name: string,
  timestamp: string
): { farm: Farm; ownerMembership: FarmMember } {
  const farm: Farm = {
    id,
    ownerPlayerId,
    name: validateFarmName(name),
    createdAt: timestamp,
    updatedAt: timestamp
  };
  return {
    farm,
    ownerMembership: {
      farmId: id,
      playerId: ownerPlayerId,
      role: "OWNER",
      createdAt: timestamp
    }
  };
}

export function assertOwnershipInvariant(farm: Farm, membership: FarmMember): void {
  if (
    membership.farmId !== farm.id ||
    membership.playerId !== farm.ownerPlayerId ||
    membership.role !== "OWNER"
  ) {
    throw new DomainError("INVALID_FARM", "Farm owner membership is inconsistent");
  }
}
