import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDeploymentWorker, type DeploymentEnv } from "../../workers/api/src/index";
import { playerIdForAccessSubject } from "../../workers/api/src/access-auth";
import { GUEST_COOKIE_NAME, hashGuestCredential } from "../../workers/api/src/guest-auth";
import { NodeD1Database } from "../support/node-d1";

/**
 * The public guest alpha, end to end through the deployed entrypoint.
 *
 * These tests hold the product invariant the brief is built on: a guest is a real Player whose
 * authentication happens to be anonymous, never a throwaway farm. Two browsers get two players and
 * two farms; the same browser returns to the same one; an unprovable credential never adopts
 * somebody else's player; and switching guest play off is what production looks like.
 */
const MIGRATIONS = [
  "0001_phase_1_foundation.sql",
  "0002_crop_simulation.sql",
  "0003_inventory_and_harvest.sql",
  "0004_economy_and_shop.sql",
  "0005_player_progression.sql",
  "0006_farm_expansion.sql",
  "0007_seed_economy.sql",
  "0008_tree_instances.sql",
  "0009_starter_package.sql",
  "0010_farm_constructions.sql",
  "0011_construction_editing.sql",
  "0012_world_objects.sql",
  "0013_world_objects_v2.sql",
  "0014_one_farm_per_player.sql",
  "0015_player_identities.sql"
]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

const ORIGIN = "https://happyfarm-staging.longfx.trade";
const TEAM_DOMAIN = "https://team.cloudflareaccess.com";
const AUDIENCE = "test-audience-tag";

/** A verifier seam: any token of the form `token-for-<subject>` is a verified Access visitor. */
const verifier = {
  verify(token: string): Promise<Record<string, unknown> | null> {
    if (!token.startsWith("token-for-")) return Promise.resolve(null);
    return Promise.resolve({
      iss: TEAM_DOMAIN,
      sub: token.slice("token-for-".length),
      aud: [AUDIENCE],
      exp: Math.floor(Date.now() / 1000) + 3600
    });
  }
};

interface RequestOptions {
  readonly method?: string;
  readonly body?: unknown;
  readonly cookie?: string;
  readonly origin?: string;
  readonly jwt?: string;
}

function apiRequest(path: string, options: RequestOptions = {}): Request {
  const headers = new Headers();
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookie !== undefined) headers.set("cookie", options.cookie);
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.jwt !== undefined) headers.set("cf-access-jwt-assertion", options.jwt);
  return new Request(`${ORIGIN}/api${path}`, {
    method: options.method ?? "GET",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) })
  });
}

/** The credential half of a `Set-Cookie`, ready to send back as a cookie. */
function cookieFrom(response: Response): string {
  const header = response.headers.get("set-cookie");
  expect(header, "expected the session to set a cookie").not.toBeNull();
  const pair = (header ?? "").split(";")[0] ?? "";
  expect(pair.startsWith(`${GUEST_COOKIE_NAME}=`)).toBe(true);
  return pair;
}

interface SessionBody {
  readonly data: { readonly player: { readonly playerId: string; readonly kind: string } };
}

/** A response body as an unknown shape, so each test narrows only what it actually asserts. */
async function body(response: Response): Promise<unknown> {
  return response.json();
}

async function sessionBody(response: Response): Promise<SessionBody> {
  return (await body(response)) as SessionBody;
}

async function sessionPlayer(response: Response): Promise<string> {
  const playerId = (await sessionBody(response)).data.player.playerId;
  expect(playerId).toMatch(/^player_/);
  return playerId;
}

function guestEnv(db: NodeD1Database, extra: Partial<DeploymentEnv> = {}): DeploymentEnv {
  return { DB: db, GUEST_AUTH_ENABLED: "true", STARTER_GRANT_POLICY: "ALL_UNRECEIPTED", ...extra };
}

describe("public guest alpha", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(MIGRATIONS);
  });

  afterEach(() => {
    db.close();
  });

  it("opens a new guest session, creates one player, and grants the starter package once", async () => {
    const handle = createDeploymentWorker(guestEnv(db));
    const session = await handle(apiRequest("/session"));
    expect(session.status).toBe(200);
    const cookie = cookieFrom(session);
    expect(cookie).toMatch(new RegExp(`^${GUEST_COOKIE_NAME}=[A-Za-z0-9_-]{43}$`));
    const body = await sessionBody(session);
    expect(body.data.player.kind).toBe("GUEST");
    const playerId = body.data.player.playerId;

    // The cookie is the whole credential, and the database holds only its hash.
    const stored = db.sqlite.prepare("SELECT subject FROM player_identities WHERE kind = 'GUEST'").all() as {
      readonly subject: string;
    }[];
    expect(stored).toHaveLength(1);
    expect(stored[0]?.subject).toBe(await hashGuestCredential(cookie.slice(`${GUEST_COOKIE_NAME}=`.length)));
    expect(stored[0]?.subject).not.toBe(cookie);

    // Returning to the session changes nothing and hands back nothing to set.
    const again = await handle(apiRequest("/session", { cookie }));
    expect(again.headers.get("set-cookie")).toBeNull();
    const againBody = await sessionBody(again);
    expect(againBody.data.player.playerId).toBe(playerId);
    expect(againBody.data.player.kind).toBe("GUEST");

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 1 });
  });

  it("gives the same browser the same player and the same farm, however many times it asks", async () => {
    const handle = createDeploymentWorker(guestEnv(db));
    const first = await handle(apiRequest("/session"));
    const cookie = cookieFrom(first);
    const playerId = await sessionPlayer(first);

    const created = await handle(
      apiRequest("/farms", { method: "POST", body: { name: "Guest Farm" }, cookie })
    );
    expect(created.status).toBe(201);
    const farmId = farmIdOf(await created.json());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const repeat = await handle(
        apiRequest("/farms", { method: "POST", body: { name: "Guest Farm" }, cookie })
      );
      // 200: the farm already existed, and it is the same one.
      expect(repeat.status).toBe(200);
      expect(farmIdOf(await repeat.json())).toBe(farmId);
    }
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT owner_player_id FROM farms").get()).toEqual({ owner_player_id: playerId });
  });

  it("absorbs two racing bootstrap requests for one guest into a single player and farm", async () => {
    const handle = createDeploymentWorker(guestEnv(db));
    const session = await handle(apiRequest("/session"));
    const cookie = cookieFrom(session);

    // Two requests arrive before either has answered - a phone on a flaky connection retrying.
    const [first, second] = await Promise.all([
      handle(apiRequest("/farms", { method: "POST", body: { name: "Race Farm" }, cookie })),
      handle(apiRequest("/farms", { method: "POST", body: { name: "Race Farm" }, cookie }))
    ]);
    const firstFarm = farmIdOf(await first.json());
    const secondFarm = farmIdOf(await second.json());
    expect(firstFarm).toBe(secondFarm);
    // One request created the farm (201), the other read the winner's (200).
    expect([first.status, second.status].sort((a, b) => a - b)).toEqual([200, 201]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 1 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get()).toEqual({ count: 1 });
    // One grant, not two, even though two requests were authenticated at the same time.
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM starter_grants").get()).toEqual({ count: 1 });
  });

  it("gives two browsers two players and two farms", async () => {
    const handle = createDeploymentWorker(guestEnv(db));
    const first = await handle(apiRequest("/session"));
    const second = await handle(apiRequest("/session"));
    const cookieA = cookieFrom(first);
    const cookieB = cookieFrom(second);
    expect(cookieA).not.toBe(cookieB);
    const playerA = await sessionPlayer(first);
    const playerB = await sessionPlayer(second);

    const bodyA = await (await handle(apiRequest("/farms", { method: "POST", body: { name: "Farm A" }, cookie: cookieA }))).json();
    const bodyB = await (await handle(apiRequest("/farms", { method: "POST", body: { name: "Farm B" }, cookie: cookieB }))).json();
    const farmA = farmIdOf(bodyA);
    const farmB = farmIdOf(bodyB);

    expect(playerA).not.toBe(playerB);
    expect(farmA).not.toBe(farmB);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 2 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get()).toEqual({ count: 2 });
  });

  it("never resolves an edited, unknown, or truncated credential to another guest", async () => {
    const handle = createDeploymentWorker(guestEnv(db));
    const guestA = await handle(apiRequest("/session"));
    const guestB = await handle(apiRequest("/session"));
    const cookieA = cookieFrom(guestA);
    const cookieB = cookieFrom(guestB);
    const playerA = await sessionPlayer(guestA);
    const playerB = await sessionPlayer(guestB);
    const credential = cookieA.slice(`${GUEST_COOKIE_NAME}=`.length);

    const forged = [
      // One character changed: a different hash, therefore a different identity.
      `${GUEST_COOKIE_NAME}=${credential.slice(0, -1)}${credential.endsWith("A") ? "B" : "A"}`,
      // A credential nobody has ever held.
      `${GUEST_COOKIE_NAME}=${"z".repeat(43)}`,
      // Truncated, which is not even a well-formed credential.
      `${GUEST_COOKIE_NAME}=${credential.slice(0, 20)}`,
      `${GUEST_COOKIE_NAME}=`
    ];
    for (const attempt of forged) {
      const response = await handle(apiRequest("/session", { cookie: attempt }));
      expect(response.status, attempt).toBe(200);
      const playerId = await sessionPlayer(response);
      // A brand-new identity: never guest A's player, and never guest B's.
      expect(playerId, attempt).not.toBe(playerA);
      expect(playerId, attempt).not.toBe(playerB);
      // The unknown cookie is replaced, not trusted.
      expect(response.headers.get("set-cookie")).not.toBeNull();
    }

    // The real cookies still resolve to their own players.
    expect(await sessionPlayer(await handle(apiRequest("/session", { cookie: cookieA })))).toBe(playerA);
    expect(await sessionPlayer(await handle(apiRequest("/session", { cookie: cookieB })))).toBe(playerB);
  });

  it("establishes nothing when guest play is switched off", async () => {
    const handle = createDeploymentWorker({ DB: db });
    const session = await handle(apiRequest("/session"));
    expect(session.status).toBe(401);
    await expect(session.json()).resolves.toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });

    const forged = `${GUEST_COOKIE_NAME}=${"z".repeat(43)}`;
    const mutation = await handle(apiRequest("/farms", { method: "POST", body: { name: "Nope" }, cookie: forged }));
    expect(mutation.status).toBe(401);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM players").get()).toEqual({ count: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM player_identities").get()).toEqual({ count: 0 });
  });

  it("prefers a verified Access identity over a guest cookie", async () => {
    const handle = createDeploymentWorker(
      guestEnv(db, { ACCESS_TEAM_DOMAIN: TEAM_DOMAIN, ACCESS_AUD: AUDIENCE }),
      { verifier }
    );
    const guest = await handle(apiRequest("/session"));
    const guestCookie = cookieFrom(guest);
    const guestPlayer = await sessionPlayer(guest);

    const strong = await handle(apiRequest("/session", { cookie: guestCookie, jwt: "token-for-visitor-one" }));
    const body = await sessionBody(strong);
    expect(body.data.player.kind).toBe("CLOUDFLARE_ACCESS");
    expect(body.data.player.playerId).toBe(await playerIdForAccessSubject(TEAM_DOMAIN, "visitor-one"));
    expect(body.data.player.playerId).not.toBe(guestPlayer);
    // The guest identity was not consumed or moved by the stronger identity.
    expect(await sessionPlayer(await handle(apiRequest("/session", { cookie: guestCookie })))).toBe(guestPlayer);
  });

  it("refuses an unsafe mutation the browser says came from another origin", async () => {
    const handle = createDeploymentWorker(guestEnv(db));
    const session = await handle(apiRequest("/session"));
    const cookie = cookieFrom(session);

    const crossOrigin = await handle(
      apiRequest("/farms", { method: "POST", body: { name: "Cross" }, cookie, origin: "https://evil.example" })
    );
    expect(crossOrigin.status).toBe(401);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farms").get()).toEqual({ count: 0 });

    const sameOrigin = await handle(
      apiRequest("/farms", { method: "POST", body: { name: "Mine" }, cookie, origin: ORIGIN })
    );
    expect(sameOrigin.status).toBe(201);
  });

  it("keeps two guests' gold, inventory, and farms apart", async () => {
    const handle = createDeploymentWorker(guestEnv(db));
    const first = await handle(apiRequest("/session"));
    const second = await handle(apiRequest("/session"));
    const cookieA = cookieFrom(first);
    const cookieB = cookieFrom(second);

    const farmA = farmIdOf(
      await (await handle(apiRequest("/farms", { method: "POST", body: { name: "Farm A" }, cookie: cookieA }))).json()
    );
    await handle(apiRequest("/farms", { method: "POST", body: { name: "Farm B" }, cookie: cookieB }));

    const bought = await handle(
      apiRequest("/shop/buy", {
        method: "POST",
        body: { requestId: "req_guest_a_buy_seeds", shopEntryId: "shop_carrot_seed", quantity: 5 },
        cookie: cookieA
      })
    );
    expect(bought.status).toBe(200);

    const walletA = (await body(await handle(apiRequest("/wallet", { cookie: cookieA })))) as WalletBody;
    const walletB = (await body(await handle(apiRequest("/wallet", { cookie: cookieB })))) as WalletBody;
    expect(walletA.data.wallets[0]?.balance).toBe(90);
    expect(walletB.data.wallets[0]?.balance).toBe(100);

    const inventoryB = (await body(await handle(apiRequest("/inventory", { cookie: cookieB })))) as InventoryBody;
    expect(inventoryB.data.items[0]?.quantity).toBe(10);

    // B cannot even read A's farm, let alone change it.
    expect((await handle(apiRequest(`/farms/${farmA}`, { cookie: cookieB }))).status).toBe(403);
  });

});

interface WalletBody {
  readonly data: { readonly wallets: { readonly balance: number }[] };
}
interface InventoryBody {
  readonly data: { readonly items: { readonly quantity: number }[] };
}

function farmIdOf(body: unknown): string {
  const farm = (body as { readonly data?: { readonly farm?: { readonly id?: string } } }).data?.farm;
  expect(farm?.id).toMatch(/^farm_/);
  return farm?.id ?? "";
}
