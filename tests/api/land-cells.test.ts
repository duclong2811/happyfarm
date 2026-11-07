import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ActorContext, AuthenticationPort, Clock, IdGenerator } from "@happy-farm/application";
import {
  BuyLandCellsResponseSchema,
  QuoteLandCellsResponseSchema
} from "@happy-farm/contracts";
import {
  INITIAL_LAND_SIZE,
  parseConstructionId,
  parseCropInstanceId,
  parseEconomyTransactionId,
  parseTreeInstanceId,
  plotTiles,
  singleCellPrice,
  type ConstructionId,
  type CropInstanceId,
  type EconomyTransactionId,
  type FarmId,
  type TreeInstanceId
} from "@happy-farm/domain";
import { z } from "zod";
import { createHandler } from "../../workers/api/src/handler";
import {
  GameDataConstructionDefinitions,
  GameDataCropDefinitions,
  GameDataCurrencyDefinitions,
  GameDataItemDefinitions,
  GameDataPlotDefinitions,
  GameDataShopEntries,
  GameDataTreeDefinitions,
  Sha256Fingerprint,
  gameDataLandSale,
  gameDataProgressionDefinition,
  gameDataStarterWorld,
  gameDataTileTerrain
} from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { FARM_ONE_ID, FARM_TWO_ID, NOW, PLAYER_ONE_ID, PLAYER_TWO_ID } from "../support/fixtures";
import type { LandSaleLookup } from "@happy-farm/application";

const migration = [
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

const QuoteEnvelope = z.object({ ok: z.literal(true), data: QuoteLandCellsResponseSchema }).strict();
const PurchaseEnvelope = z.object({ ok: z.literal(true), data: BuyLandCellsResponseSchema }).strict();
const FailureEnvelope = z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }).strict();

class FixedAuth implements AuthenticationPort<Request> {
  constructor(private actor: ActorContext | null) {}
  setActor(actor: ActorContext | null): void {
    this.actor = actor;
  }
  authenticate(): Promise<ActorContext | null> {
    return Promise.resolve(this.actor);
  }
}

class FixedClock implements Clock {
  now(): string {
    return NOW;
  }
}

class FixedIds implements IdGenerator {
  private economySequence = 1;
  private constructionSequence = 1;
  private farmSequence = 1;
  newFarmId(): FarmId {
    return this.farmSequence++ === 1 ? FARM_ONE_ID : FARM_TWO_ID;
  }
  newCropInstanceId(): CropInstanceId {
    return parseCropInstanceId("cropinst_cccccccc-cccc-4ccc-8ccc-cccccccccccc");
  }
  newTreeInstanceId(): TreeInstanceId {
    return parseTreeInstanceId("treeinst_eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee");
  }
  newEconomyTransactionId(): EconomyTransactionId {
    return parseEconomyTransactionId(
      `econ_eeeeeeee-eeee-4eee-8eee-${String(this.economySequence++).padStart(12, "0")}`
    );
  }
  newConstructionId(): ConstructionId {
    return parseConstructionId(
      `construct_11111111-1111-4111-8111-${String(this.constructionSequence++).padStart(12, "0")}`
    );
  }
}

describe("single-cell land purchase", () => {
  let db: NodeD1Database;
  let auth: FixedAuth;
  let handle: (request: Request) => Promise<Response>;

  function makeHandler(landSale: LandSaleLookup = gameDataLandSale): (request: Request) => Promise<Response> {
    return createHandler({
      db,
      authenticator: auth,
      ids: new FixedIds(),
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
      landSale,
      clock: new FixedClock()
    });
  }

  beforeEach(async () => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'https://identity.test', 'subject-one', 'Player One', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    auth = new FixedAuth({ playerId: PLAYER_ONE_ID });
    handle = makeHandler();
    await handle(
      new Request("https://api.test/farms", {
        method: "POST",
        body: JSON.stringify({ name: "Land Farm" }),
        headers: { "content-type": "application/json" }
      })
    );
  });

  afterEach(() => {
    db.close();
  });

  function fund(balance: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO wallets (player_id, currency_id, balance, version, created_at, updated_at) VALUES (?, 'currency_gold', ?, 1, ?, ?) ON CONFLICT(player_id, currency_id) DO UPDATE SET balance = excluded.balance, version = version + 1, updated_at = excluded.updated_at"
      )
      .run(PLAYER_ONE_ID, balance, NOW, NOW);
  }

  function quote(cells: readonly { readonly x: number; readonly y: number }[]): Promise<Response> {
    return handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/land/quote`, {
        method: "POST",
        body: JSON.stringify({ cells }),
        headers: { "content-type": "application/json" }
      })
    );
  }

  function buy(requestId: string, cells: readonly { readonly x: number; readonly y: number }[]): Promise<Response> {
    return handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/land/cells`, {
        method: "POST",
        body: JSON.stringify({ requestId, cells }),
        headers: { "content-type": "application/json" }
      })
    );
  }

  it("quotes an authoritative price for an unowned cell", async () => {
    fund(500);
    const response = await quote([{ x: 12, y: 0 }]);
    expect(response.status).toBe(200);
    const body = QuoteEnvelope.parse(await response.json());
    expect(body.data.quote).toMatchObject({
      totalPrice: singleCellPrice(100),
      currencyId: "currency_gold",
      cells: [{ x: 12, y: 0, eligible: true, reason: "ELIGIBLE", plotIndex: 1, price: singleCellPrice(100) }]
    });
    // The formula is the domain's: a parcel's per-cell price plus the convenience premium.
    expect(singleCellPrice(100)).toBe(1);
    expect(singleCellPrice(250)).toBe(2);
  });

  it("buys cells atomically, debits gold, and replays the receipt without charging again", async () => {
    fund(500);
    const cells = [
      { x: 12, y: 0 },
      { x: 12, y: 1 }
    ];
    const first = await buy("land_buy_0001", cells);
    expect(first.status).toBe(200);
    const body = PurchaseEnvelope.parse(await first.json());
    expect(body.data.purchase).toMatchObject({ amountSpent: 2, newBalance: 498, currencyId: "currency_gold" });

    const replay = await buy("land_buy_0001", cells);
    expect(replay.status).toBe(200);
    expect(PurchaseEnvelope.parse(await replay.json()).data.purchase.newBalance).toBe(498);

    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({
      count: INITIAL_LAND_SIZE * INITIAL_LAND_SIZE + cells.length
    });
    expect(db.sqlite.prepare("SELECT balance, version FROM wallets WHERE player_id = ?").get(PLAYER_ONE_ID)).toEqual({
      balance: 498,
      version: 2
    });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger WHERE reason = 'FARM_EXPANSION'").get()
    ).toEqual({ count: 1 });
  });

  it("refuses a request reused with a different cell list", async () => {
    fund(500);
    expect((await buy("land_buy_conflict", [{ x: 12, y: 0 }])).status).toBe(200);
    const conflict = await buy("land_buy_conflict", [{ x: 12, y: 2 }]);
    expect(conflict.status).toBe(409);
    expect(FailureEnvelope.parse(await conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("refuses insufficient gold without buying any land", async () => {
    fund(0);
    const response = await buy("land_buy_broke", [{ x: 12, y: 0 }]);
    expect(response.status).toBe(409);
    expect(FailureEnvelope.parse(await response.json()).error.code).toBe("INSUFFICIENT_FUNDS");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({
      count: INITIAL_LAND_SIZE * INITIAL_LAND_SIZE
    });
  });

  it("refuses already-owned, disconnected, and unsellable cells", async () => {
    fund(500);
    expect(FailureEnvelope.parse(await (await buy("land_buy_owned", [{ x: 0, y: 0 }])).json()).error.code).toBe(
      "LAND_ALREADY_OWNED"
    );
    // Off the island entirely: open sea the server classifies as water.
    expect(FailureEnvelope.parse(await (await buy("land_buy_out", [{ x: 1_000, y: 1_000 }])).json()).error.code).toBe(
      "LAND_NOT_DEVELOPABLE"
    );
    // The island's inland water is not dry land either.
    expect(FailureEnvelope.parse(await (await buy("land_buy_pond", [{ x: -3, y: 45 }])).json()).error.code).toBe(
      "LAND_NOT_DEVELOPABLE"
    );
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({
      count: INITIAL_LAND_SIZE * INITIAL_LAND_SIZE
    });
  });

  it("sells a distant developable cell with no adjacency to the farm's land", async () => {
    // Level 8 is 60 * 7 * 8 = 3,360 experience on the shipped curve.
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 8, 3360, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
    fund(5_000);
    // (40,40) is ~29 tiles from the starter square and touches none of it. It lies beyond every
    // catalogue cohort, so it is sold at the deepest plot's rate plus the convenience premium.
    const expected = singleCellPrice(8_000);
    const quoted = await quote([{ x: 40, y: 40 }]);
    expect(quoted.status).toBe(200);
    expect(QuoteEnvelope.parse(await quoted.json()).data.quote).toMatchObject({
      totalPrice: expected,
      cells: [{ x: 40, y: 40, eligible: true, reason: "ELIGIBLE", price: expected }]
    });

    const bought = await buy("land_buy_distant", [{ x: 40, y: 40 }]);
    expect(bought.status).toBe(200);
    expect(PurchaseEnvelope.parse(await bought.json()).data.purchase).toMatchObject({
      amountSpent: expected,
      newBalance: 5_000 - expected
    });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ? AND x = 40 AND y = 40").get(FARM_ONE_ID)
    ).toEqual({ count: 1 });
  });

  it("charges nothing for owned cells in a mixed quote", async () => {
    fund(500);
    const response = await quote([
      { x: 0, y: 0 },
      { x: 12, y: 0 }
    ]);
    const body = QuoteEnvelope.parse(await response.json());
    const owned = body.data.quote.cells.find((cell) => cell.x === 0 && cell.y === 0);
    const unowned = body.data.quote.cells.find((cell) => cell.x === 12 && cell.y === 0);
    expect(owned).toMatchObject({ eligible: false, reason: "ALREADY_OWNED", price: 0 });
    expect(unowned?.price).toBe(singleCellPrice(100));
    // The total is only what a purchase would actually cost.
    expect(body.data.quote.totalPrice).toBe(singleCellPrice(100));
  });

  it("keeps bulk land cheaper per cell than on-demand land", () => {
    // 144 on-demand cells always cost more than the plot they sit in, at every catalogue price.
    for (const plotPrice of [100, 250, 500, 1_000, 2_000, 3_500, 5_500, 8_000]) {
      expect(singleCellPrice(plotPrice) * 144, String(plotPrice)).toBeGreaterThan(plotPrice);
    }
  });

  it("gates a cell by the level of the plot that contains it", async () => {
    fund(500);
    // (12,12) is plot 2, which the catalogue gates at level 2.
    const response = await buy("land_buy_level", [{ x: 12, y: 12 }]);
    expect(response.status).toBe(403);
    expect(FailureEnvelope.parse(await response.json()).error.code).toBe("PLOT_LEVEL_REQUIRED");
  });

  it("refuses ground the island will not let a farm develop", async () => {
    fund(500);
    auth.setActor({ playerId: PLAYER_ONE_ID });
    handle = makeHandler({ isDevelopable: () => false });
    const response = await buy("land_buy_undevelopable", [{ x: 12, y: 0 }]);
    expect(response.status).toBe(403);
    expect(FailureEnvelope.parse(await response.json()).error.code).toBe("LAND_NOT_DEVELOPABLE");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({
      count: INITIAL_LAND_SIZE * INITIAL_LAND_SIZE
    });
  });

  it("lets exactly one of two concurrent purchases of the same cell win", async () => {
    fund(500);
    const cell = [{ x: 12, y: 0 }];
    const responses = await Promise.all([buy("land_buy_race_a", cell), buy("land_buy_race_b", cell)]);
    expect(responses.filter((response) => response.status === 200)).toHaveLength(1);
    expect(responses.filter((response) => response.status === 409)).toHaveLength(1);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({
      count: INITIAL_LAND_SIZE * INITIAL_LAND_SIZE + 1
    });
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM economy_ledger WHERE reason = 'FARM_EXPANSION'").get()
    ).toEqual({ count: 1 });
  });

  it("lets only the owner buy, and never lets the client name a price", async () => {
    db.sqlite
      .prepare("INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'other', 'Other', 'ACTIVE', ?, ?)")
      .run(PLAYER_TWO_ID, NOW, NOW);
    auth.setActor({ playerId: PLAYER_TWO_ID });
    expect((await quote([{ x: 12, y: 0 }])).status).toBe(403);
    expect((await buy("land_buy_other", [{ x: 12, y: 0 }])).status).toBe(403);

    // The body is strict: a client-supplied price is a malformed request, not an accepted input.
    auth.setActor({ playerId: PLAYER_ONE_ID });
    const injected = await handle(
      new Request(`https://api.test/farms/${FARM_ONE_ID}/land/cells`, {
        method: "POST",
        body: JSON.stringify({ requestId: "land_buy_price", cells: [{ x: 12, y: 0, price: 1 }] }),
        headers: { "content-type": "application/json" }
      })
    );
    expect(injected.status).toBe(400);
  });

  it("validates the coordinate list: empty, duplicated, and oversized are refused", async () => {
    fund(500);
    expect((await buy("land_buy_empty", [])).status).toBe(400);
    expect(
      (await buy("land_buy_dupe", [
        { x: 12, y: 0 },
        { x: 12, y: 0 }
      ])).status
    ).toBe(400);
    const oversized = Array.from({ length: 257 }, (_, index) => ({ x: 12 + (index % 12), y: Math.floor(index / 12) }));
    expect((await buy("land_buy_many", oversized)).status).toBe(400);
  });

  it("keeps a purchased plot's existing tiles intact", async () => {
    // An existing save that already bought plot 1: the new single-cell path must not disturb it.
    const insert = db.sqlite.prepare(
      "INSERT INTO farm_tiles (farm_id, x, y, terrain_type, tile_state, version, updated_at) VALUES (?, ?, ?, 'SOIL', 'IDLE', 1, ?)"
    );
    for (const tile of plotTiles(FARM_ONE_ID, 1, NOW)) insert.run(tile.farmId, tile.x, tile.y, tile.updatedAt);
    db.sqlite
      // Level 5 is 60 * 4 * 5 = 1,200 experience on the shipped curve.
      .prepare("INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 5, 1200, 1, ?, ?)")
      .run(PLAYER_ONE_ID, NOW, NOW);
    const before = db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID);

    fund(5_000);
    // (24,0) is plot 4's first column, adjacent to the plot-1 land the save already owns.
    expect((await buy("land_buy_after_plot", [{ x: 24, y: 0 }])).status).toBe(200);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual({
      count: (before as { count: number }).count + 1
    });
    // Every existing plot-1 tile is still there, exactly once.
    for (const tile of plotTiles(FARM_ONE_ID, 1, NOW)) {
      expect(
        db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ? AND x = ? AND y = ?").get(
          FARM_ONE_ID,
          tile.x,
          tile.y
        )
      ).toEqual({ count: 1 });
    }
  });

  /** Level 8 is 60 * 7 * 8 = 3,360 experience on the shipped curve. */
  function setLevel8(): void {
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, 8, 3360, 1, ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
  }

  function giveItem(itemDefinitionId: string, quantity: number): void {
    db.sqlite
      .prepare(
        "INSERT INTO inventory_items (player_id, item_definition_id, quantity, updated_at, version) VALUES (?, ?, ?, ?, 1)"
      )
      .run(PLAYER_ONE_ID, itemDefinitionId, quantity, NOW);
  }

  function post(path: string, body: unknown): Promise<Response> {
    return handle(
      new Request(`https://api.test${path}`, {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" }
      })
    );
  }

  /** The cells a 4x3 barn at this anchor covers, in the server's own convention. */
  function barnFootprint(anchorX: number, anchorY: number): readonly { readonly x: number; readonly y: number }[] {
    const startX = anchorX - Math.floor((4 - 1) / 2);
    const startY = anchorY - Math.floor((3 - 1) / 2);
    const cells: { x: number; y: number }[] = [];
    for (let dy = 0; dy < 3; dy += 1) {
      for (let dx = 0; dx < 4; dx += 1) cells.push({ x: startX + dx, y: startY + dy });
    }
    return cells;
  }

  it("plants a crop, a tree, and a building on distant bought cells", async () => {
    setLevel8();
    fund(50_000);
    giveItem("item_carrot_seed", 1);
    giveItem("item_apple_sapling", 1);

    const cropCell = { x: 40, y: 40 };
    const treeCell = { x: 44, y: 44 };
    const barn = barnFootprint(30, 30);
    // Buy exactly the land the three actions need, in one freeform purchase with no adjacency.
    expect((await buy("freeform_land", [cropCell, treeCell, ...barn])).status).toBe(200);

    const planted = await post(`/farms/${FARM_ONE_ID}/crops`, {
      requestId: "freeform_crop",
      cropDefinitionId: "crop_carrot",
      x: cropCell.x,
      y: cropCell.y,
      expectedTileVersion: 1
    });
    expect(planted.status).toBe(201);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM crop_instances WHERE farm_id = ? AND tile_x = ? AND tile_y = ?").get(
        FARM_ONE_ID,
        cropCell.x,
        cropCell.y
      )
    ).toEqual({ count: 1 });

    const plantedTree = await post(`/farms/${FARM_ONE_ID}/trees`, {
      requestId: "freeform_tree",
      treeDefinitionId: "tree_apple",
      x: treeCell.x,
      y: treeCell.y,
      expectedTileVersion: 1
    });
    expect(plantedTree.status).toBe(201);
    expect(
      db.sqlite.prepare("SELECT COUNT(*) AS count FROM tree_instances WHERE farm_id = ? AND tile_x = ? AND tile_y = ?").get(
        FARM_ONE_ID,
        treeCell.x,
        treeCell.y
      )
    ).toEqual({ count: 1 });

    const built = await post(`/farms/${FARM_ONE_ID}/constructions`, {
      requestId: "freeform_build",
      entryId: "place_barn_t1",
      anchorX: 30,
      anchorY: 30,
      rotation: 0
    });
    expect(built.status).toBe(201);
  });

  it("charges only the unowned cells of a mixed footprint", async () => {
    setLevel8();
    fund(50_000);
    // Far enough out that every cell is sold at the deepest plot's rate.
    const barn = barnFootprint(40, 40);
    const ownedCell = barn[0];
    if (ownedCell === undefined) throw new Error("a barn footprint has cells");
    expect((await buy("mixed_owned", [ownedCell])).status).toBe(200);

    const missing = barn.filter((cell) => cell.x !== ownedCell.x || cell.y !== ownedCell.y);
    const response = await quote(missing);
    const body = QuoteEnvelope.parse(await response.json());
    expect(body.data.quote.totalPrice).toBe(missing.length * singleCellPrice(8_000));
    for (const cell of body.data.quote.cells) expect(cell.eligible, `${String(cell.x)},${String(cell.y)}`).toBe(true);

    const ownedQuote = QuoteEnvelope.parse(
      await (await quote([ownedCell])).json()
    );
    expect(ownedQuote.data.quote.cells[0]).toMatchObject({ eligible: false, reason: "ALREADY_OWNED", price: 0 });
  });

  it("refuses a land list containing any invalid cell without buying the valid ones", async () => {
    setLevel8();
    fund(50_000);
    const before = db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID);
    const response = await buy("mixed_invalid", [
      { x: 40, y: 40 },
      { x: -3, y: 45 }
    ]);
    expect(response.status).toBe(403);
    expect(FailureEnvelope.parse(await response.json()).error.code).toBe("LAND_NOT_DEVELOPABLE");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS count FROM farm_tiles WHERE farm_id = ?").get(FARM_ONE_ID)).toEqual(before);
  });
});
