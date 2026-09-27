import { farmIdFromUuid, type FarmId } from "@happy-farm/domain";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";

export class SystemClock implements Clock {
  now(): string {
    return new Date().toISOString();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  newFarmId(): FarmId {
    return farmIdFromUuid(crypto.randomUUID());
  }
}

export class UnconfiguredAuthenticator implements AuthenticationPort<Request> {
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(null);
  }
}
