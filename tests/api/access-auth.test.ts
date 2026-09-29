import { generateKeyPairSync, sign as signWithKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CloudflareAccessAuthenticator,
  createJwksAccessVerifier,
  playerIdForAccessSubject,
  readAccessConfig
} from "../../workers/api/src/access-auth";
import { createDeploymentWorker } from "../../workers/api/src/index";
import { NodeD1Database } from "../support/node-d1";

/**
 * Deterministic Cloudflare Access verification tests.
 *
 * No live JWKS: the suite generates an RSA keypair, publishes it as a JWKS fixture, and signs its
 * own tokens with the same WebCrypto primitives the Worker uses, so the production code path
 * (import JWK → RSASSA-PKCS1-v1_5 verify → claim checks) runs exactly as deployed.
 */

const TEAM_DOMAIN = "https://happyfarm-staging.cloudflareaccess.com";
const AUDIENCE = "aud-tag-for-tests-0001";
const JWKS_URL = `${TEAM_DOMAIN}/cdn-cgi/access/certs`;
const JWT_HEADER = "cf-access-jwt-assertion";
const NOW_SECONDS = 1_800_000_000;

const migration = ["0001_phase_1_foundation.sql", "0002_crop_simulation.sql", "0003_inventory_and_harvest.sql", "0004_economy_and_shop.sql", "0007_seed_economy.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicJwk = publicKey.export({ format: "jwk" }) as { n: string; e: string };
const otherKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const JWKS = { keys: [{ kty: "RSA", kid: "test-key-1", alg: "RS256", use: "sig", n: publicJwk.n, e: publicJwk.e }] };

/** base64url without Buffer: this repository typechecks against the Workers Buffer declaration. */
function base64Url(value: string | Uint8Array): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : value;
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

interface TokenOverrides {
  readonly iss?: string;
  readonly aud?: string | readonly string[];
  readonly sub?: string;
  readonly exp?: number;
  readonly nbf?: number;
  readonly alg?: string;
  readonly keyId?: string;
  readonly key?: typeof privateKey;
  readonly signature?: string;
}

function accessToken(overrides: TokenOverrides = {}): string {
  const header = { alg: overrides.alg ?? "RS256", kid: overrides.keyId ?? "test-key-1", typ: "JWT" };
  const payload = {
    iss: overrides.iss ?? TEAM_DOMAIN,
    aud: overrides.aud ?? AUDIENCE,
    sub: overrides.sub ?? "subject-one",
    exp: overrides.exp ?? NOW_SECONDS + 600,
    nbf: overrides.nbf ?? NOW_SECONDS - 10,
    email: "tester@example.com"
  };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature =
    overrides.signature ??
    base64Url(new Uint8Array(signWithKey("sha256", new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`), overrides.key ?? privateKey)));
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function authenticator(bindings: { ACCESS_TEAM_DOMAIN?: string; ACCESS_AUD?: string } = { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUDIENCE }) {
  return new CloudflareAccessAuthenticator({
    ...bindings,
    verifier: createJwksAccessVerifier({
      jwksUrl: JWKS_URL,
      fetchJwks: () => Promise.resolve(JWKS),
      nowSeconds: () => NOW_SECONDS
    })
  });
}

function requestWith(token: string | null, headers: Record<string, string> = {}): Request {
  const all = { ...headers };
  if (token !== null) all[JWT_HEADER] = token;
  return new Request("https://staging.test/api/wallet", { headers: all });
}

describe("cloudflare access configuration", () => {
  it("accepts a team domain and audience, and normalises the JWKS url", () => {
    expect(readAccessConfig({ ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUDIENCE })).toEqual({
      teamDomain: TEAM_DOMAIN,
      audience: AUDIENCE,
      jwksUrl: JWKS_URL
    });
  });

  it("fails closed on missing, blank, non-https, or foreign team domains", () => {
    expect(readAccessConfig({})).toBeNull();
    expect(readAccessConfig({ ACCESS_TEAM_DOMAIN: TEAM_DOMAIN })).toBeNull();
    expect(readAccessConfig({ ACCESS_AUD: AUDIENCE })).toBeNull();
    expect(readAccessConfig({ ACCESS_TEAM_DOMAIN: "   ", ACCESS_AUD: AUDIENCE })).toBeNull();
    expect(readAccessConfig({ ACCESS_TEAM_DOMAIN: "http://happyfarm.cloudflareaccess.com", ACCESS_AUD: AUDIENCE })).toBeNull();
    expect(readAccessConfig({ ACCESS_TEAM_DOMAIN: "https://evil.example.com", ACCESS_AUD: AUDIENCE })).toBeNull();
    expect(readAccessConfig({ ACCESS_TEAM_DOMAIN: "https://happyfarm.cloudflareaccess.com/path", ACCESS_AUD: AUDIENCE })).toBeNull();
    expect(readAccessConfig({ ACCESS_TEAM_DOMAIN: "https://happyfarm.cloudflareaccess.com", ACCESS_AUD: "  " })).toBeNull();
  });

  it("rejects every request when the deployment is not configured", async () => {
    const unconfigured = new CloudflareAccessAuthenticator({});
    expect(unconfigured.configured).toBe(false);
    expect(await unconfigured.authenticate(requestWith(accessToken()))).toBeNull();
  });
});

describe("cloudflare access token verification", () => {
  it("accepts a signed, unexpired token for this application", async () => {
    const actor = await authenticator().authenticate(requestWith(accessToken()));
    const expected = await playerIdForAccessSubject(TEAM_DOMAIN, "subject-one");
    expect(actor).toEqual({ playerId: expected });
  });

  it("rejects a missing, empty, or oversized assertion", async () => {
    const handle = authenticator();
    expect(await handle.authenticate(requestWith(null))).toBeNull();
    expect(await handle.authenticate(requestWith(""))).toBeNull();
    expect(await handle.authenticate(requestWith("x".repeat(9000)))).toBeNull();
  });

  it("rejects a malformed token instead of decoding whatever is in it", async () => {
    const handle = authenticator();
    for (const token of ["not-a-jwt", "a.b", "a.b.c.d", "!!!.???.###", `${base64Url("{}")}.${base64Url("{}")}.`]) {
      expect(await handle.authenticate(requestWith(token)), token).toBeNull();
    }
  });

  it("rejects a token signed by another key", async () => {
    const forged = accessToken({ key: otherKeys.privateKey });
    expect(await authenticator().authenticate(requestWith(forged))).toBeNull();
    const tampered = accessToken({ signature: base64Url(new TextEncoder().encode("not-a-real-signature")) });
    expect(await authenticator().authenticate(requestWith(tampered))).toBeNull();
  });

  it("rejects a token that asks for an algorithm this application did not configure", async () => {
    for (const alg of ["none", "HS256", "RS512"]) {
      const token = accessToken({ alg });
      expect(await authenticator().authenticate(requestWith(token)), alg).toBeNull();
    }
  });

  it("rejects a token with the wrong issuer", async () => {
    const token = accessToken({ iss: "https://someone-else.cloudflareaccess.com" });
    expect(await authenticator().authenticate(requestWith(token))).toBeNull();
  });

  it("rejects a token for a different Access application", async () => {
    expect(await authenticator().authenticate(requestWith(accessToken({ aud: "another-app" })))).toBeNull();
    expect(await authenticator().authenticate(requestWith(accessToken({ aud: ["other", "another-app"] })))).toBeNull();
  });

  it("accepts a token that lists this application among several audiences", async () => {
    const token = accessToken({ aud: ["another-app", AUDIENCE] });
    expect(await authenticator().authenticate(requestWith(token))).not.toBeNull();
  });

  it("rejects an expired token and one that is not valid yet", async () => {
    expect(await authenticator().authenticate(requestWith(accessToken({ exp: NOW_SECONDS - 3600 })))).toBeNull();
    expect(await authenticator().authenticate(requestWith(accessToken({ nbf: NOW_SECONDS + 3600 })))).toBeNull();
  });

  it("tolerates small clock skew, and only small skew", async () => {
    expect(await authenticator().authenticate(requestWith(accessToken({ exp: NOW_SECONDS - 5 })))).not.toBeNull();
    expect(await authenticator().authenticate(requestWith(accessToken({ exp: NOW_SECONDS - 3600 })))).toBeNull();
  });

  it("rejects a token whose key is not in the published set", async () => {
    const token = accessToken({ keyId: "unknown-key" });
    expect(await authenticator().authenticate(requestWith(token))).toBeNull();
  });

  it("fails closed when the JWKS cannot be fetched", async () => {
    const handle = new CloudflareAccessAuthenticator({
      ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
      ACCESS_AUD: AUDIENCE,
      verifier: createJwksAccessVerifier({
        jwksUrl: JWKS_URL,
        fetchJwks: async () => {
          return Promise.reject(new Error("network down"));
        },
        nowSeconds: () => NOW_SECONDS
      })
    });
    expect(await handle.authenticate(requestWith(accessToken()))).toBeNull();
  });
});

describe("happyfarm identity mapping", () => {
  it("gives the same person the same id and different people different ids", async () => {
    const first = await playerIdForAccessSubject(TEAM_DOMAIN, "subject-one");
    const again = await playerIdForAccessSubject(TEAM_DOMAIN, "subject-one");
    const other = await playerIdForAccessSubject(TEAM_DOMAIN, "subject-two");
    const otherTeam = await playerIdForAccessSubject("https://other.cloudflareaccess.com", "subject-one");
    expect(first).toBe(again);
    expect(other).not.toBe(first);
    expect(otherTeam).not.toBe(first);
    expect(first).toMatch(/^player_[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it("never puts the email or the subject in the id", async () => {
    const id = await playerIdForAccessSubject(TEAM_DOMAIN, "tester@example.com");
    expect(id).not.toContain("tester");
    expect(id).not.toContain("example.com");
    expect(id).not.toContain("@");
  });

  it("ignores identity a client tries to supply", async () => {
    // A header, a query string, and a body are all invisible to the authenticator: the actor comes
    // from the verified token alone.
    const token = accessToken({ sub: "subject-one" });
    const spoofed = await authenticator().authenticate(
      new Request("https://staging.test/api/wallet?playerId=player_99999999-9999-4999-8999-999999999999", {
        method: "POST",
        headers: { [JWT_HEADER]: token, "x-player-id": "player_99999999-9999-4999-8999-999999999999", authorization: "Bearer dev-token-for-tests-0001" },
        body: JSON.stringify({ playerId: "player_99999999-9999-4999-8999-999999999999" })
      })
    );
    expect(spoofed).toEqual({ playerId: await playerIdForAccessSubject(TEAM_DOMAIN, "subject-one") });
  });

  it("rejects the development bearer token", async () => {
    const devRequest = new Request("https://staging.test/api/wallet", {
      headers: { authorization: "Bearer dev-token-for-tests-0001" }
    });
    expect(await authenticator().authenticate(devRequest)).toBeNull();
  });
});

describe("deployed worker authentication", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
  });

  afterEach(() => {
    db.close();
  });

  const env = (database: NodeD1Database) => ({
    DB: database,
    ACCESS_TEAM_DOMAIN: TEAM_DOMAIN,
    ACCESS_AUD: AUDIENCE
  });

  const verifier = () =>
    createJwksAccessVerifier({ jwksUrl: JWKS_URL, fetchJwks: () => Promise.resolve(JWKS), nowSeconds: () => NOW_SECONDS });

  it("fails closed without an Access assertion", async () => {
    const handle = createDeploymentWorker(env(db), { verifier: verifier() });
    const response = await handle(new Request("https://staging.test/api/wallet"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });
  });

  it("fails closed when the deployment has no Access configuration at all", async () => {
    const handle = createDeploymentWorker({ DB: db }, { verifier: verifier() });
    const response = await handle(new Request("https://staging.test/api/wallet", { headers: { [JWT_HEADER]: accessToken() } }));
    expect(response.status).toBe(401);
  });

  it("onboards a verified visitor once, and keeps two visitors apart", async () => {
    // The worker under test is the deployed entrypoint: same routing, same authenticator wiring,
    // same onboarding. The only substitution is the JWKS, so no network is involved.
    const handle = createDeploymentWorker(env(db), { verifier: verifier() });
    const tokenFor = (subject: string) => accessToken({ sub: subject });

    const created = await handle(
      new Request("https://staging.test/api/farms", {
        method: "POST",
        headers: { [JWT_HEADER]: tokenFor("subject-one"), "content-type": "application/json" },
        body: JSON.stringify({ name: "Alpha Farm" })
      })
    );
    expect(created.status).toBe(201);
    const createdBody: unknown = await created.json();
    const farm = (createdBody as { data?: { farm?: { id?: string; ownerPlayerId?: string } } }).data?.farm;
    const expectedOwner = await playerIdForAccessSubject(TEAM_DOMAIN, "subject-one");
    expect(farm?.ownerPlayerId).toBe(expectedOwner);
    const farmId = farm?.id ?? "";
    expect(farmId).toMatch(/^farm_/);

    // Onboarding is idempotent: a second verified request does not create a second Player row.
    await handle(new Request("https://staging.test/api/wallet", { headers: { [JWT_HEADER]: tokenFor("subject-one") } }));
    const rows = db.sqlite.prepare("SELECT id FROM players WHERE auth_subject = ?").all("subject-one");
    expect(rows).toHaveLength(1);

    // A different Access user is a different HappyFarm player and cannot read the first one's farm.
    const mine = await handle(new Request("https://staging.test/api/wallet", { headers: { [JWT_HEADER]: tokenFor("subject-one") } }));
    expect(mine.status).toBe(200);
    const theirs = await handle(
      new Request(`https://staging.test/api/farms/${farmId}`, { headers: { [JWT_HEADER]: tokenFor("subject-two") } })
    );
    expect(theirs.status).toBe(403);
  });
});
