import { describe, expect, it } from "vitest";
import {
  MAX_WORK_AREA_CELLS as CONTRACT_MAX_CELLS,
  MAX_WORK_AREA_NAME_LENGTH as CONTRACT_MAX_NAME,
  WORK_AREA_KINDS as CONTRACT_KINDS,
  CreateWorkAreaRequestSchema,
  DeleteWorkAreaRequestSchema,
  ListWorkAreasResponseSchema,
  homeIslandZoneRef,
  RenameWorkAreaRequestSchema,
  ReplaceWorkAreaCellsRequestSchema
} from "@happy-farm/contracts";
import {
  MAX_WORK_AREA_CELLS,
  MAX_WORK_AREA_NAME_LENGTH,
  WORK_AREA_KINDS,
  homeIslandZoneId,
  parseFarmId
} from "@happy-farm/domain";

/**
 * The work-area wire contract and the domain must not drift.
 *
 * `packages/contracts` is a leaf (zod only) and `packages/domain` is a leaf too, so each keeps its own
 * copy of two constants, the kind list, and the home-island zone prefix. This test is the seam: if a
 * bound is widened on one side and not the other, it fails here rather than letting a client send a
 * selection the server silently truncates.
 */

describe("work-area contract matches the domain", () => {
  it("keeps the cell cap and the name length equal", () => {
    expect(CONTRACT_MAX_CELLS).toBe(MAX_WORK_AREA_CELLS);
    expect(CONTRACT_MAX_NAME).toBe(MAX_WORK_AREA_NAME_LENGTH);
  });

  it("keeps the same kind vocabulary, in the same order", () => {
    expect(CONTRACT_KINDS).toEqual(WORK_AREA_KINDS);
  });

  it("derives the same home-island zone id as the wire's zone reference", () => {
    const farmId = parseFarmId("farm_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(homeIslandZoneId(farmId)).toBe(homeIslandZoneRef(farmId).zoneId);
  });
});

describe("work-area requests", () => {
  it("accepts a well-formed create and refuses a rectangle-shaped one", () => {
    const ok = CreateWorkAreaRequestSchema.safeParse({
      requestId: "wa_contract_01",
      kind: "FARM",
      name: "East Field",
      cells: [{ x: 1, y: 2 }]
    });
    expect(ok.success).toBe(true);

    const rectangle = CreateWorkAreaRequestSchema.safeParse({
      requestId: "wa_contract_02",
      kind: "FARM",
      name: "East Field",
      rect: { x: 1, y: 2, width: 4, height: 4 }
    });
    expect(rectangle.success).toBe(false);
  });

  it("refuses a create with no cells, a bad kind and a client-supplied owner", () => {
    expect(
      CreateWorkAreaRequestSchema.safeParse({ requestId: "wa_contract_03", kind: "FARM", name: "Empty", cells: [] })
        .success
    ).toBe(false);
    expect(
      CreateWorkAreaRequestSchema.safeParse({ requestId: "wa_contract_04", kind: "MIXED", name: "X", cells: [{ x: 0, y: 0 }] })
        .success
    ).toBe(false);
    expect(
      CreateWorkAreaRequestSchema.safeParse({
        requestId: "wa_contract_05",
        kind: "FARM",
        name: "Mine",
        cells: [{ x: 0, y: 0 }],
        ownerPlayerId: "player_11111111-1111-4111-8111-111111111111"
      }).success
    ).toBe(false);
  });

  it("requires a version on every edit and a request id on every write", () => {
    expect(RenameWorkAreaRequestSchema.safeParse({ requestId: "wa_rename_01", name: "New" }).success).toBe(false);
    expect(
      ReplaceWorkAreaCellsRequestSchema.safeParse({ requestId: "wa_cells_01", cells: [{ x: 0, y: 0 }] }).success
    ).toBe(false);
    expect(DeleteWorkAreaRequestSchema.safeParse({ requestId: "wa_delete_01" }).success).toBe(false);
    expect(
      DeleteWorkAreaRequestSchema.safeParse({ requestId: "wa_delete_02", expectedVersion: 1 }).success
    ).toBe(true);
  });
});

describe("work-area summaries", () => {
  it("accepts an existing empty area without weakening create validation", () => {
    const result = ListWorkAreasResponseSchema.safeParse({
      workAreas: [{
        workAreaId: "workarea_11111111-1111-4111-8111-111111111111",
        farmId: "farm_11111111-1111-4111-8111-111111111111",
        kind: "FARM",
        displayName: "Starter field",
        cellCount: 0,
        version: 1,
        createdAt: "2026-10-21T00:00:00.000Z",
        updatedAt: "2026-10-21T00:00:00.000Z"
      }]
    });
    expect(result.success).toBe(true);
    expect(
      CreateWorkAreaRequestSchema.safeParse({
        requestId: "wa_contract_empty_summary",
        kind: "FARM",
        name: "Starter field",
        cells: []
      }).success
    ).toBe(false);
  });
});
