import { describe, expect, it } from "vitest";
import {
  DomainError,
  HOME_ISLAND_ZONE_KIND,
  MAX_WORK_AREA_CELLS,
  MAX_WORK_AREA_NAME_LENGTH,
  WORK_AREA_KINDS,
  WORK_AREAS_MAY_OVERLAP,
  assertWorkAreaVersion,
  homeIslandZoneId,
  normalizeWorkAreaCells,
  normalizeWorkAreaName,
  parseFarmId,
  parseWorkAreaId,
  parseWorkAreaKind,
  requiredGroundCapability,
  workAreaCellKey,
  workAreaGroundSupports
} from "../../packages/domain/src/index";

/**
 * The work-area rules that are decisions rather than plumbing.
 *
 * A name is player text and never identity, so it is trimmed, normalised and bounded by what a reader
 * sees; the cell set is explicit, de-duplicated and capped; and a kind maps onto the ground it needs
 * through the same capability vocabulary the rest of the world uses.
 */

describe("work area kinds", () => {
  it("maps each kind onto the ground capability it needs", () => {
    expect(requiredGroundCapability("FARM")).toBe("FARM");
    // An orchard grows on the same ground a crop does: it is the player's grouping, not a terrain.
    expect(requiredGroundCapability("ORCHARD")).toBe("FARM");
    expect(requiredGroundCapability("FORESTRY")).toBe("FORESTRY");
    expect(requiredGroundCapability("MINING")).toBe("MINING");
    expect(requiredGroundCapability("LIVESTOCK")).toBe("LIVESTOCK");
    expect(requiredGroundCapability("AQUACULTURE")).toBe("AQUACULTURE");
  });

  it("offers every kind in the stable set and refuses anything else", () => {
    for (const kind of WORK_AREA_KINDS) {
      expect(parseWorkAreaKind(kind)).toBe(kind);
    }
    expect(() => parseWorkAreaKind("MIXED")).toThrow(DomainError);
    expect(() => parseWorkAreaKind("farm")).toThrow(DomainError);
  });

  it("asks only for a capability the ground has", () => {
    expect(workAreaGroundSupports("FARM", ["FARM", "FORESTRY", "LIVESTOCK"])).toBe(true);
    expect(workAreaGroundSupports("MINING", ["FARM"])).toBe(false);
    expect(workAreaGroundSupports("AQUACULTURE", [])).toBe(false);
  });

  it("permits overlap, because a work area is metadata rather than occupancy", () => {
    expect(WORK_AREAS_MAY_OVERLAP).toBe(true);
  });
});

describe("work area names", () => {
  it("trims outside whitespace and normalises to NFC", () => {
    expect(normalizeWorkAreaName("  East Field  ")).toBe("East Field");
    // "O" + combining circumflex (decomposed) normalises to the composed character.
    expect(normalizeWorkAreaName("O\u0302")).toBe("Ô");
  });

  it("accepts Unicode, including Vietnamese diacritics and emoji", () => {
    expect(normalizeWorkAreaName("Cánh đồng phía Đông")).toBe("Cánh đồng phía Đông");
    expect(Array.from(normalizeWorkAreaName("🌾".repeat(MAX_WORK_AREA_NAME_LENGTH))).length).toBe(
      MAX_WORK_AREA_NAME_LENGTH
    );
  });

  it("refuses empty, whitespace-only, over-long and control-character names", () => {
    expect(() => normalizeWorkAreaName("")).toThrow(DomainError);
    expect(() => normalizeWorkAreaName("   ")).toThrow(DomainError);
    expect(() => normalizeWorkAreaName("a".repeat(MAX_WORK_AREA_NAME_LENGTH + 1))).toThrow(DomainError);
    expect(() => normalizeWorkAreaName("bad\u0000name")).toThrow(DomainError);
    // A bidi override can make two different names render identically; it is refused outright.
    expect(() => normalizeWorkAreaName("east\u202efield")).toThrow(DomainError);
  });
});

describe("work area cells", () => {
  it("de-duplicates and orders by y then x, so the same selection always stores the same list", () => {
    const cells = normalizeWorkAreaCells([
      { x: 5, y: 1 },
      { x: 1, y: 2 },
      { x: 5, y: 1 },
      { x: 2, y: 1 }
    ]);
    expect(cells).toEqual([
      { x: 2, y: 1 },
      { x: 5, y: 1 },
      { x: 1, y: 2 }
    ]);
  });

  it("keeps a stable key per cell", () => {
    expect(workAreaCellKey({ x: -3, y: 12 })).toBe("-3,12");
  });

  it("refuses non-integers and coordinates outside the world", () => {
    expect(() => normalizeWorkAreaCells([{ x: 1.5, y: 0 }])).toThrow(DomainError);
    expect(() => normalizeWorkAreaCells([{ x: 2_000_000, y: 0 }])).toThrow(DomainError);
    expect(() => normalizeWorkAreaCells([{ x: 0, y: Number.NaN }])).toThrow(DomainError);
  });

  it("refuses a set larger than the cap, with its own error so the panel can explain it", () => {
    const tooMany = Array.from({ length: MAX_WORK_AREA_CELLS + 1 }, (_value, index) => ({ x: index, y: 0 }));
    try {
      normalizeWorkAreaCells(tooMany);
      throw new Error("expected a refusal");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).code).toBe("WORK_AREA_TOO_MANY_CELLS");
    }
  });
});

describe("work area identity, zone and version", () => {
  it("brands its own id and derives the home-island zone from the farm", () => {
    expect(parseWorkAreaId("workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    expect(() => parseWorkAreaId("farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toThrow(DomainError);

    const farmId = parseFarmId("farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(HOME_ISLAND_ZONE_KIND).toBe("HOME_ISLAND");
    expect(homeIslandZoneId(farmId)).toBe(`zone_home_island_${farmId}`);
  });

  it("refuses an edit made against a version the area has moved past", () => {
    expect(() => {
      assertWorkAreaVersion({ version: 3 }, 3);
    }).not.toThrow();
    expect(() => {
      assertWorkAreaVersion({ version: 3 }, 2);
    }).toThrow(DomainError);
  });
});
