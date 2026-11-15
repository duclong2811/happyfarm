import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GetProgression } from "@happy-farm/application";
import { D1ProgressionRepository } from "../../workers/api/src/d1-repositories";
import { gameDataProgressionDefinition } from "../../workers/api/src/runtime";
import { NodeD1Database } from "../support/node-d1";
import { NOW, PLAYER_ONE_ID } from "../support/fixtures";

const migration = ["0001_phase_1_foundation.sql", "0005_player_progression.sql"]
  .map((name) => readFileSync(fileURLToPath(new URL(`../../database/migrations/${name}`, import.meta.url)), "utf8"))
  .join("\n");

describe("GetProgression", () => {
  let db: NodeD1Database;

  beforeEach(() => {
    db = new NodeD1Database(migration);
    db.sqlite
      .prepare(
        "INSERT INTO players (id, auth_issuer, auth_subject, display_name, status, created_at, updated_at) VALUES (?, 'issuer', 'subject-one', 'Player', 'ACTIVE', ?, ?)"
      )
      .run(PLAYER_ONE_ID, NOW, NOW);
  });

  afterEach(() => {
    db.close();
  });

  function service(): GetProgression {
    return new GetProgression(
      gameDataProgressionDefinition,
      new D1ProgressionRepository(db),
      { now: () => NOW }
    );
  }

  function seed(xp: number, level: number, version = 1): void {
    db.sqlite
      .prepare(
        "INSERT INTO player_progression (player_id, level, xp, progression_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(PLAYER_ONE_ID, level, xp, version, NOW, NOW);
  }

  it("requires authentication", async () => {
    await expect(service().execute(null)).rejects.toMatchObject({ code: "NOT_AUTHENTICATED" });
  });

  it("reports a player who has never earned experience as level 1", async () => {
    await expect(service().execute({ playerId: PLAYER_ONE_ID })).resolves.toEqual({
      level: 1,
      xp: 0,
      xpIntoLevel: 0,
      xpForNextLevel: 120,
      maxLevel: 100
    });
  });

  it("derives the level from experience rather than trusting the stored column", async () => {
    // The stored level is a cache. Even if it were wrong, the read path answers from `xp`.
    seed(130, 9);
    await expect(service().execute({ playerId: PLAYER_ONE_ID })).resolves.toEqual({
      level: 2,
      xp: 130,
      xpIntoLevel: 10,
      xpForNextLevel: 240,
      maxLevel: 100
    });
  });

  it("reports the cap without promising a level that does not exist", async () => {
    // The cap is level 100: 120 x 99 x 100 / 2 experience.
    seed(594_000, 100);
    await expect(service().execute({ playerId: PLAYER_ONE_ID })).resolves.toEqual({
      level: 100,
      xp: 594_000,
      xpIntoLevel: 0,
      xpForNextLevel: 0,
      maxLevel: 100
    });
  });
});