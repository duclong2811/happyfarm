import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import {
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseTreeInstanceId,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type TreeInstanceId
} from "@happy-farm/domain";
import { CollectMineResponseSchema, GetFarmMinesResponseSchema, UpgradeMineResponseSchema } from "@happy-farm/contracts";
import { createHandler } from "../../workers/api/src/handler";
import {
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
  GameDataItemDefinitions,
  GameDataPlotDefinitions,
  GameDataShopEntries,
  GameDataTreeDefinitions,
  GameDataWarehouseTiers,
  Sha256Fingerprint,
  gameDataIslandGroundBuilder,
  gameDataLandSale,
  gameDataMineCatalogue,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain
} from "../../workers/api/src/runtime";
import { schemaSql } from "../support/migrations";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, FARM_TWO_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";

/**
 * Island mines through the real Worker handler.
 *
 * The rules held here: a mine fills from server time and stops at four hours; a dig takes what the
 * warehouse has room for and leaves the rest in the mine; experience is one point per twenty ore
 * over the mine's life; an upgrade is paid in gold through the ledger and in wood and ore through the
 * inventory, banks what the mine had made, and is gated on the owner's level; slots open with the
 * owner's level; only the owner works the mines; and a replayed request changes nothing twice.
 */

const MIGRATIONS = schemaSql();

class SequenceIds implements IdGenerator {
  private sequence = 1;
  newFarmId(): FarmId {
    return this.sequence++ === 1 ? FARM_ONE_ID : FARM_TWO_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId(`cropinst_cccccccc-cccc-4ccc-8ccc-${String(this.sequence++).padStart(12, "0")}`);
  }
  newTreeInstanceId(): TreeInstanceId {
    return parseTreeInstanceId(`treeinst_eeeeeeee-eeee-4eee-8eee-${String(this.sequence++).padStart(12, "0")}`);
  }
  newEconomyTransactionId(): EconomyTransactionId {
    return parseEconomyTransactionId(`econ_eeeeeeee-eeee-4eee-8eee-${String(this.sequence++).padStart(12, "0")}`);
  }
  newConstructionId(): ConstructionId {
    return parseConstructionId(`construct_11111111-1111-4111-8111-${String(this.sequence++).padStart(12, "0")}`);
  }
}

class MutableClock implements Clock {
  current = NOW;
  now(): string {
    return this.current;
  }
  advanceMinutes(minutes: number): void {
    this.current = new Date(Date.parse(this.current) + minutes * 60_000).toISOString();
  }
}

class SwitchableAuth implements AuthenticationPort<Request> {
  constructor(private actor: ActorContext | null) {}
  setActor(actor: ActorContext | null): void {
    this.actor = actor;
  }
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.actor);
  }
}

describe("island mines", () => {
  let db: NodeD1Database;
  let auth: SwitchableAuth;
  let clock: MutableClock;
  let handle: (request: Request) => Promise<Response>;

  function request(path: string, body?: unknown): Promise<Response> {
    return handle(
      new Request(`https://dev.happy-farm.local${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { "content-type": "application/json" },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      })
    );
  }

  async function data(response: Response): Promise<unknown> {
    const body: { readonly data?: unknown; readonly error?: unknown } = await response.json();
    if (body.data === undefined) throw new Error(`expected success, got ${JSON.stringify(body.error)}`);
    return body.data;
  }

  async function codeOf(response: Response): Promise<unknown> {
    const body: unknown = await response.json();
    return (body as { readonly error?: { readonly code?: unknown } }).error?.code;
  }

  const list = async (farmId: FarmId = FARM_ONE_ID) => GetFarmMinesResponseSchema.parse(await data(await request(`/farms/${farmId}/mines`)));
  const dig = (slot: number, requestId: string) => request(`/farms/${FARM_ONE_ID}/mines/${String(slot)}/collect`, { requestId });
  const upgrade = (slot: number, requestId: string) => request(`/farms/${FARM_ONE_ID}/mines/${String(slot)}/upgrade`, { requestId });

  function held(itemId: string, playerId: string = PLAYER_ONE_ID): number {
    const row = db.sqlite
      .prepare("SELECT quantity FROM inventory_items WHERE player_id = ? AND item_definition_id = ?")
      .get(playerId, itemId) as { quantity: number } | undefined;
    return row?.quantity ?? 0;
  }

  function setHeld(itemId: string, quantity: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(player_id, item_definition_id) DO UPDATE SET quantity = excluded.quantity, version = inventory_items.version + 1"
      )
      .run(PLAYER_ONE_ID, itemId, quantity, NOW);
  }

  function gold(): number {
    const row = db.sqlite.prepare("SELECT balance FROM wallets WHERE player_id = ? AND currency_id = 'currency_gold'").get(PLAYER_ONE_ID) as
      | { balance: number }
      | undefined;
    return row?.balance ?? 0;
  }

  function xp(): number {
    const row = db.sqlite.prepare("SELECT xp FROM player_progression WHERE player_id = ?").get(PLAYER_ONE_ID) as { xp: number } | undefined;
    return row?.xp ?? 0;
  }

  /** Gives the owner exactly the experience the curve needs for `level` (120 x (L-1) x L / 2). */
  function reachLevel(level: number): void {
    const needed = (120 * (level - 1) * level) / 2;
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, xp, level, progression_version, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT(player_id) DO UPDATE SET xp = excluded.xp, level = excluded.level"
      )
      .run(PLAYER_ONE_ID, needed, level, NOW, NOW);
  }

  function emptyWarehouse(): void {
    db.sqlite.prepare("DELETE FROM inventory_items WHERE player_id = ?").run(PLAYER_ONE_ID);
  }

  function build(islandChoice: boolean): void {
    handle = createHandler({
      db,
      authenticator: auth,
      ids: new SequenceIds(),
      fingerprints: new Sha256Fingerprint(),
      cropDefinitions: new GameDataCropDefinitions(),
      itemDefinitions: new GameDataItemDefinitions(),
      currencyDefinitions: new GameDataCurrencyDefinitions(),
      shopEntries: new GameDataShopEntries(),
      plotDefinitions: new GameDataPlotDefinitions(),
      treeDefinitions: new GameDataTreeDefinitions(),
      constructionDefinitions: new GameDataConstructionDefinitions(),
      progressionDefinition: gameDataProgressionDefinition,
      starterWorld: gameDataStarterWorld,
      terrain: gameDataTileTerrain,
      landSale: gameDataLandSale,
      warehouse: { tiers: new GameDataWarehouseTiers() },
      mines: { catalogue: gameDataMineCatalogue },
      ...(islandChoice ? { islands: { choiceEnabled: true, builder: gameDataIslandGroundBuilder } } : {}),
      clock
    });
  }

  beforeEach(async () => {
    db = new NodeD1Database(MIGRATIONS);
    for (const playerId of [PLAYER_ONE_ID, PLAYER_TWO_ID]) {
      db.sqlite
        .prepare(
          "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', ?, 'Miner', 'ACTIVE', ?, ?)"
        )
        .run(playerId, `subject-${playerId}`, NOW, NOW);
    }
    auth = new SwitchableAuth({ playerId: PLAYER_ONE_ID });
    clock = new MutableClock();
    build(false);
    expect((await request("/farms", { name: "Đảo Quặng" })).status).toBe(201);
    emptyWarehouse();
  });

  afterEach(() => {
    db.close();
  });

  it("opens one mine for a new owner, at the composed island's ore ridge, and shows the locked slots", async () => {
    const view = await list();
    expect(view.mines).toHaveLength(1);
    expect(view.mines[0]).toMatchObject({ slot: 0, x: 12, y: -12, level: 1, orePerHour: 60, capacityOre: 240, availableMilli: 0 });
    expect(view.mines[0]?.nextLevel).toMatchObject({ level: 2, requiredPlayerLevel: 8, gold: 500 });
    expect(view.locked.map((slot) => [slot.slot, slot.requiredPlayerLevel])).toEqual([[1, 20], [2, 50]]);
  });

  it("fills from server time and stops at four hours of output", async () => {
    await list();
    clock.advanceMinutes(30);
    expect((await list()).mines[0]?.availableMilli).toBe(30_000);
    clock.advanceMinutes(24 * 60);
    expect((await list()).mines[0]?.availableMilli).toBe(240_000);
  });

  it("digs everything into the warehouse, pays a point of experience per twenty ore, and restarts the clock", async () => {
    await list();
    clock.advanceMinutes(5 * 60);
    const response = await dig(0, "dig-request-0001");
    expect(response.status).toBe(200);
    const result = CollectMineResponseSchema.parse(await data(response));
    expect(result).toMatchObject({ collected: 240, xpAwarded: 12 });
    expect(result.mine.availableMilli).toBe(0);
    expect(held("item_ore")).toBe(240);
    expect(xp()).toBe(12);
    expect(await codeOf(await dig(0, "dig-request-0002"))).toBe("MINE_EMPTY");
  });

  it("leaves in the mine what the warehouse has no room for, and refuses when there is no room at all", async () => {
    await list();
    clock.advanceMinutes(4 * 60);
    setHeld("item_wheat", 1_000 - 100);
    const partial = CollectMineResponseSchema.parse(await data(await dig(0, "dig-request-0003")));
    expect(partial.collected).toBe(100);
    expect(partial.mine.availableMilli).toBe(140_000);
    expect(held("item_ore")).toBe(100);
    expect(await codeOf(await dig(0, "dig-request-0004"))).toBe("WAREHOUSE_FULL");
    // Nothing was lost: once there is room, the rest is still there.
    setHeld("item_wheat", 0);
    const rest = CollectMineResponseSchema.parse(await data(await dig(0, "dig-request-0005")));
    expect(rest.collected).toBe(140);
    expect(xp()).toBe(12);
  });

  it("pays experience over the mine's life, so small digs earn what one big dig would", async () => {
    await list();
    for (const minutes of [10, 10, 10, 10]) {
      clock.advanceMinutes(minutes);
      await data(await dig(0, `small-dig-${String(clock.current.length)}-${String(Date.parse(clock.current))}`));
    }
    expect(held("item_ore")).toBe(40);
    expect(xp()).toBe(2);
  });

  it("answers a replayed dig from its receipt without digging twice", async () => {
    await list();
    clock.advanceMinutes(60);
    const first = await data(await dig(0, "dig-request-0006"));
    clock.advanceMinutes(60);
    const again = await data(await dig(0, "dig-request-0006"));
    expect(again).toEqual(first);
    expect(held("item_ore")).toBe(60);
  });

  it("upgrades through the ledger and the inventory, banks what the mine made, and fills faster", async () => {
    reachLevel(8);
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 1000, 1, ?, ?) ON CONFLICT(player_id, currency_id) DO UPDATE SET balance = 1000")
      .run(PLAYER_ONE_ID, NOW, NOW);
    setHeld("item_wood", 100);
    setHeld("item_ore", 200);
    await list();
    clock.advanceMinutes(60);
    const response = await upgrade(0, "upgrade-request-01");
    expect(response.status).toBe(200);
    const result = UpgradeMineResponseSchema.parse(await data(response));
    expect(result.mine).toMatchObject({ level: 2, orePerHour: 90, capacityOre: 360, availableMilli: 60_000 });
    expect(gold()).toBe(500);
    expect(held("item_wood")).toBe(20);
    expect(held("item_ore")).toBe(50);
    const ledger = db.sqlite
      .prepare("SELECT delta, reason, reference_type, reference_id FROM economy_ledger WHERE player_id = ? AND reason = 'MINE_UPGRADE'")
      .all(PLAYER_ONE_ID);
    expect(ledger).toEqual([
      { delta: -500, reason: "MINE_UPGRADE", reference_type: "MINE", reference_id: `mine_${FARM_ONE_ID.slice("farm_".length)}_0` }
    ]);
    clock.advanceMinutes(60);
    expect((await list()).mines[0]?.availableMilli).toBe(150_000);
    // The same request again changes nothing.
    expect(await data(await upgrade(0, "upgrade-request-01"))).toEqual(result);
    expect(gold()).toBe(500);
    expect((await list()).mines[0]?.level).toBe(2);
  });

  it("refuses an upgrade below the level, without the materials, or without the gold - and charges nothing", async () => {
    db.sqlite
      .prepare("INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', 1000, 1, ?, ?) ON CONFLICT(player_id, currency_id) DO UPDATE SET balance = 1000")
      .run(PLAYER_ONE_ID, NOW, NOW);
    setHeld("item_wood", 100);
    setHeld("item_ore", 200);
    await list();
    expect(await codeOf(await upgrade(0, "upgrade-request-02"))).toBe("MINE_LEVEL_REQUIRED");
    reachLevel(8);
    setHeld("item_wood", 10);
    expect(await codeOf(await upgrade(0, "upgrade-request-03"))).toBe("INSUFFICIENT_ITEMS");
    setHeld("item_wood", 100);
    db.sqlite.prepare("UPDATE wallets SET balance = 100 WHERE player_id = ?").run(PLAYER_ONE_ID);
    expect(await codeOf(await upgrade(0, "upgrade-request-04"))).toBe("INSUFFICIENT_FUNDS");
    expect(held("item_wood")).toBe(100);
    expect(held("item_ore")).toBe(200);
    expect((await list()).mines[0]?.level).toBe(1);
  });

  it("opens more slots as the owner levels up", async () => {
    reachLevel(20);
    const view = await list();
    expect(view.mines.map((mine) => [mine.slot, mine.x, mine.y])).toEqual([[0, 12, -12], [1, 18, -14]]);
    expect(view.locked.map((slot) => slot.slot)).toEqual([2]);
    expect(await codeOf(await dig(2, "dig-request-0007"))).toBe("MINE_SLOT_LOCKED");
    expect(await codeOf(await dig(9, "dig-request-0008"))).toBe("MINE_NOT_FOUND");
  });

  it("lets a visitor look without opening anything, and lets only the owner dig or upgrade", async () => {
    clock.advanceMinutes(60);
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect(await codeOf(await request(`/farms/${FARM_ONE_ID}/mines`))).toBe("NOT_AUTHORIZED");
    db.sqlite.prepare("INSERT INTO farm_members (farm_id, player_id, role, created_at) VALUES (?, ?, 'VISITOR', ?)").run(FARM_ONE_ID, PLAYER_TWO_ID, NOW);
    const seen = await list();
    expect(seen.mines).toEqual([]);
    expect((db.sqlite.prepare("SELECT COUNT(*) AS n FROM farm_mines").get() as { n: number }).n).toBe(0);
    auth.setActor({ playerId: PLAYER_ONE_ID });
    await list();
    clock.advanceMinutes(60);
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect((await list()).mines[0]?.availableMilli).toBe(60_000);
    expect(await codeOf(await dig(0, "dig-request-0009"))).toBe("NOT_AUTHORIZED");
    expect(await codeOf(await upgrade(0, "upgrade-request-05"))).toBe("NOT_AUTHORIZED");
    expect(held("item_ore", PLAYER_TWO_ID)).toBe(0);
    auth.setActor(null);
    expect(await codeOf(await dig(0, "dig-request-0010"))).toBe("NOT_AUTHENTICATED");
  });

  it("refuses a malformed request before touching anything", async () => {
    await list();
    expect(await codeOf(await request(`/farms/${FARM_ONE_ID}/mines/0/collect`, { requestId: "short" }))).toBe("INVALID_INPUT");
    expect(await codeOf(await request(`/farms/${FARM_ONE_ID}/mines/0/collect`, { requestId: "dig-request-0011", quantity: 9999 }))).toBe(
      "INVALID_INPUT"
    );
    expect(await codeOf(await request(`/farms/not-a-farm/mines`))).toBe("INVALID_INPUT");
  });

  it("puts a Kim island's six mines on its own ore sites", async () => {
    db.close();
    db = new NodeD1Database(MIGRATIONS);
    for (const playerId of [PLAYER_ONE_ID, PLAYER_TWO_ID]) {
      db.sqlite
        .prepare(
          "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://dev.happy-farm.local', ?, 'Miner', 'ACTIVE', ?, ?)"
        )
        .run(playerId, `subject-${playerId}`, NOW, NOW);
    }
    build(true);
    const choice = { element: "KIM", outline: "ROUND", seed: 9 };
    expect((await request("/farms", { name: "Đảo Kim", island: choice })).status).toBe(201);
    reachLevel(100);
    const view = await list();
    const island = gameDataIslandGroundBuilder.build(choice);
    const ore = island.sites.filter((site) => site.kind === "ORE").map((site) => [site.x, site.y]);
    expect(view.mines.map((mine) => [mine.x, mine.y])).toEqual(ore);
    expect(view.locked).toEqual([]);
  });
});
