import { describe, expect, it } from "vitest";
import {
  BuyLandCellsRequestSchema,
  LandCellQuoteDTOSchema,
  LAND_CELL_QUOTE_REASONS,
  MAX_LAND_CELLS_PER_REQUEST,
  QuoteLandCellsRequestSchema
} from "@happy-farm/contracts";
import { MAX_LAND_CELLS_PER_REQUEST as APPLICATION_LIMIT } from "@happy-farm/application";
import { LAND_CELL_REASONS } from "@happy-farm/domain";

/**
 * The single-cell land wire contract.
 *
 * A request names coordinates and, for a purchase, a request id. It never names a price, a plot, a
 * currency or a level: those are the server's, and a strict schema is what makes an attempt to send
 * them a malformed request rather than an input somebody has to remember not to trust.
 */

describe("single-cell land requests", () => {
  it("keeps the domain's reason list and the wire's enum exactly equal", () => {
    // One canonical set (V14.5.1C). The wire keeps its own copy only because the browser bundle may
    // not import the domain package; this pin is what stops the two from drifting - a stale
    // `NOT_ADJACENT` on the server was exactly the runtime contract bug this guards against.
    expect([...LAND_CELL_QUOTE_REASONS]).toEqual([...LAND_CELL_REASONS]);
    expect(LAND_CELL_QUOTE_REASONS).not.toContain("NOT_ADJACENT");
  });

  it("accepts every reason the server can emit and rejects an obsolete one", () => {
    for (const reason of LAND_CELL_REASONS) {
      const parsed = LandCellQuoteDTOSchema.safeParse({
        x: 12,
        y: 0,
        eligible: reason === "ELIGIBLE",
        reason,
        plotIndex: 1,
        price: reason === "ELIGIBLE" ? 3 : 0,
        currencyId: "currency_gold"
      });
      expect(parsed.success, reason).toBe(true);
    }
    for (const obsolete of ["NOT_ADJACENT", "SOMETHING_ELSE"]) {
      expect(
        LandCellQuoteDTOSchema.safeParse({
          x: 12,
          y: 0,
          eligible: false,
          reason: obsolete,
          plotIndex: 1,
          price: 0,
          currencyId: "currency_gold"
        }).success,
        obsolete
      ).toBe(false);
    }
  });

  it("keeps the request cap in step with the application's own bound", () => {
    expect(MAX_LAND_CELLS_PER_REQUEST).toBe(APPLICATION_LIMIT);
  });

  it("accepts a bounded list of coordinates", () => {
    expect(QuoteLandCellsRequestSchema.safeParse({ cells: [{ x: 12, y: 0 }] }).success).toBe(true);
    expect(
      BuyLandCellsRequestSchema.safeParse({ requestId: "land_buy_0001", cells: [{ x: 12, y: 0 }] }).success
    ).toBe(true);
  });

  it("refuses an empty, oversized, or non-integer list", () => {
    expect(QuoteLandCellsRequestSchema.safeParse({ cells: [] }).success).toBe(false);
    expect(
      BuyLandCellsRequestSchema.safeParse({
        requestId: "land_buy_0001",
        cells: [{ x: 0.5, y: 0 }]
      }).success
    ).toBe(false);
    const tooMany = Array.from({ length: MAX_LAND_CELLS_PER_REQUEST + 1 }, (_, index) => ({
      x: index,
      y: 0
    }));
    expect(QuoteLandCellsRequestSchema.safeParse({ cells: tooMany }).success).toBe(false);
  });

  it("refuses a client-supplied price", () => {
    expect(
      BuyLandCellsRequestSchema.safeParse({
        requestId: "land_buy_0001",
        cells: [{ x: 12, y: 0, price: 1 }]
      }).success
    ).toBe(false);
  });

  it("requires a well-formed request id", () => {
    expect(BuyLandCellsRequestSchema.safeParse({ requestId: "short", cells: [{ x: 12, y: 0 }] }).success).toBe(
      false
    );
  });
});
