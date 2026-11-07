import { describe, expect, it } from "vitest";
import { allMigrationNames, schemaSql } from "../support/migrations";

describe("D2.3A Auto simulation watermark migration", () => {
  it("ships one additive watermark migration after the D2 travel state", () => {
    const names = allMigrationNames();
    expect(names).toContain("0027_auto_simulation_watermark.sql");
    expect(names.indexOf("0027_auto_simulation_watermark.sql")).toBeGreaterThan(names.indexOf("0026_auto_execution.sql"));
    expect(names.indexOf("0028_auto_funding.sql")).toBeGreaterThan(names.indexOf("0027_auto_simulation_watermark.sql"));
    expect(schemaSql()).toContain("ALTER TABLE actor_auto_state ADD COLUMN simulation_at TEXT");
  });
});
