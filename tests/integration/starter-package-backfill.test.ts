import { describe, expect, it } from "vitest";
import { starterPackage } from "@happy-farm/game-data";
import {
  STAGING_CONFIG,
  STAGING_DATABASE,
  assertStagingTarget,
  parseArgs,
  planStatements,
  readStarterPackage,
  selectUnreceiptedPlayersSql
} from "../../scripts/repair/starter-package-backfill.mjs";

/**
 * The staging repair, held to the same package the game grants.
 *
 * The repair is the only thing in the repository allowed to write a starter receipt outside the
 * game itself, so it is tested for the two ways it could do damage: guessing a package that game
 * data no longer defines, and running anywhere but staging.
 */
describe("starter package repair", () => {
  const definition = {
    grantKey: starterPackage.grantKey,
    seedItemDefinitionId: starterPackage.seedItemDefinitionId,
    seedQuantity: starterPackage.seedQuantity,
    currencyDefinitionId: starterPackage.currencyDefinitionId,
    goldAmount: starterPackage.goldAmount
  };

  it("reads the package out of game data instead of restating it", () => {
    expect(readStarterPackage()).toEqual(definition);
    expect(readStarterPackage()).toEqual({
      grantKey: "starter_package_v1",
      seedItemDefinitionId: "item_carrot_seed",
      seedQuantity: 10,
      currencyDefinitionId: "currency_gold",
      goldAmount: 100
    });
  });

  it("refuses to guess when game data no longer parses", () => {
    const missing = new URL("../../scripts/repair/does-not-exist.ts", import.meta.url).pathname;
    expect(() => readStarterPackage(missing)).toThrow();
  });

  it("only ever runs against the staging database and the staging config", () => {
    expect(() => {
      assertStagingTarget({ database: STAGING_DATABASE, config: STAGING_CONFIG, limit: null })
    }).not.toThrow();
    for (const database of ["happy-farm-production", "happy-farm-local", "", "staging"]) {
      expect(() => {
        assertStagingTarget({ database, config: STAGING_CONFIG, limit: null });
      }).toThrow();
    }
    expect(() => {
      assertStagingTarget({ database: STAGING_DATABASE, config: "workers/api/wrangler.toml", limit: null })
    }).toThrow();
  });

  it("writes by receipt, so a player who already has one is skipped", () => {
    const statements = planStatements(definition, ["player_1", "player_2"], {
      now: "2026-09-30T00:00:00.000Z",
      newTransactionId: () => "econ_11111111-1111-4111-8111-111111111111"
    });
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      expect(statement).toContain("INSERT INTO starter_grants");
      expect(statement).toContain("'starter_package_v1'");
      expect(statement).toContain("'item_carrot_seed', 10");
      expect(statement).toContain("'currency_gold', 100");
      expect(statement).toContain("ON CONFLICT DO NOTHING");
    }
    expect(statements[1]).toContain("'player_2'");
  });

  it("looks for players by their own missing receipt, not by a list kept here", () => {
    expect(selectUnreceiptedPlayersSql(definition)).toContain("FROM players p");
    expect(selectUnreceiptedPlayersSql(definition)).toContain("g.grant_key = 'starter_package_v1'");
  });

  it("is a dry run unless the caller asks to write", () => {
    expect(parseArgs([]).apply).toBe(false);
    expect(parseArgs(["--dry-run"]).apply).toBe(false);
    expect(parseArgs(["--apply"]).apply).toBe(true);
    expect(parseArgs(["--limit", "2"]).limit).toBe(2);
    expect(parseArgs([]).database).toBe(STAGING_DATABASE);
    expect(parseArgs([]).config).toBe(STAGING_CONFIG);
    expect(() => parseArgs(["--database", "happy-farm-production"])).not.toThrow();
    expect(() => {
      assertStagingTarget(parseArgs(["--database", "happy-farm-production"]));
    }).toThrow();
    expect(() => parseArgs(["--nonsense"])).toThrow();
  });
});
