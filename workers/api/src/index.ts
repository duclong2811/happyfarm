import { createHandler } from "./handler";
import { CryptoIdGenerator, SystemClock, UnconfiguredAuthenticator } from "./runtime";
import type { D1DatabaseLike } from "./d1-types";

interface Env {
  readonly DB: D1DatabaseLike;
}

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return createHandler({
      db: env.DB,
      authenticator: new UnconfiguredAuthenticator(),
      ids: new CryptoIdGenerator(),
      clock: new SystemClock()
    })(request);
  }
};
