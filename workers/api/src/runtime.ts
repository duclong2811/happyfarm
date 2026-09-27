import {
  cropInstanceIdFromUuid,
  farmIdFromUuid,
  parseCropDefinitionId,
  type CropDefinition,
  type CropDefinitionId,
  type CropInstanceId,
  type FarmId
} from "@happy-farm/domain";
import type {
  ActorContext,
  AuthenticationPort,
  Clock,
  CropDefinitionRepository,
  CropIdGenerator,
  IdGenerator,
  PayloadFingerprint
} from "@happy-farm/application";
import { cropRegistry } from "@happy-farm/game-data";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator implements IdGenerator, CropIdGenerator {
  newFarmId(): FarmId {
    return farmIdFromUuid(crypto.randomUUID());
  }

  newCropInstanceId(): CropInstanceId {
    return cropInstanceIdFromUuid(crypto.randomUUID());
  }
}

export class Sha256Fingerprint implements PayloadFingerprint {
  async hash(canonicalPayload: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalPayload));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
}

export class GameDataCropDefinitions implements CropDefinitionRepository {
  findById(id: CropDefinitionId): CropDefinition | null {
    const definition = cropRegistry.get(id);
    if (definition === undefined) return null;
    return definition.requiredFarmLevel === undefined
      ? {
          id: parseCropDefinitionId(definition.id),
          displayNameKey: definition.displayNameKey,
          growthDurationSeconds: definition.growthDurationSeconds,
          growthStages: definition.growthStages,
          harvest: definition.harvest
        }
      : {
          id: parseCropDefinitionId(definition.id),
          displayNameKey: definition.displayNameKey,
          growthDurationSeconds: definition.growthDurationSeconds,
          growthStages: definition.growthStages,
          requiredFarmLevel: definition.requiredFarmLevel,
          harvest: definition.harvest
        };
  }
}

export class UnconfiguredAuthenticator implements AuthenticationPort<Request> {
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(null);
  }
}
