import { DomainError } from "./errors";

/**
 * Emergency funding for Auto supplies.
 *
 * Auto may buy the seed an assignment needs, and when the player's Gold cannot cover that purchase
 * the player may allow Auto to sell *only* from a list they wrote, in the order they wrote it. This
 * file is that rule and nothing else: no warehouse, no wallet, no clock, no shop. The caller supplies
 * the authoritative unit prices and the quantities actually available, and gets back either an exact
 * sale plan that covers the shortfall or `null`.
 */

/** The most items one assignment may whitelist. Bounded so a plan can never scan an unbounded list. */
export const MAX_AUTO_FUNDING_ITEMS = 8;

/** One whitelisted resource, as the authoritative catalogue and warehouse describe it right now. */
export interface FundingCandidate {
  readonly itemDefinitionId: string;
  /** The server's NPC sell price for one unit. Never a client value. */
  readonly unitPrice: number;
  /** How many units the Warehouse actually holds. */
  readonly available: number;
}

/** One line of the sale plan: the minimum needed of this resource, and what it raises. */
export interface FundingSale {
  readonly itemDefinitionId: string;
  readonly quantity: number;
  readonly unitPrice: number;
  readonly proceeds: number;
}

export interface FundingSalePlan {
  readonly sales: readonly FundingSale[];
  readonly totalProceeds: number;
}

/**
 * The whole units needed to raise `shortfall` at `unitPrice`, rounded up.
 *
 * Integer prices can overshoot by less than one unit's worth of Gold; that is acceptable and is why
 * the caller sells this count and not "the whole stack".
 */
export function minimumUnitsFor(shortfall: number, unitPrice: number): number {
  if (!Number.isSafeInteger(shortfall) || shortfall <= 0) {
    throw new DomainError("INVALID_FUNDING", "A funding shortfall must be a positive whole number");
  }
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0) {
    throw new DomainError("INVALID_FUNDING", "A funding price must be a positive whole number");
  }
  return Math.ceil(shortfall / unitPrice);
}

/**
 * The minimum sale that covers `shortfall`, following the candidates' own order, or `null`.
 *
 * All-or-nothing on purpose: a plan that cannot cover the shortfall is not a plan, and the caller
 * must leave the Warehouse alone rather than liquidate part of it and stay blocked. Candidates are
 * read in the order given - that order *is* the player's priority - and a candidate with no available
 * units is skipped without being examined further.
 */
export function planFundingSale(
  shortfall: number,
  candidates: readonly FundingCandidate[]
): FundingSalePlan | null {
  if (!Number.isSafeInteger(shortfall) || shortfall < 0) {
    throw new DomainError("INVALID_FUNDING", "A funding shortfall must be a non-negative whole number");
  }
  if (shortfall === 0) return { sales: [], totalProceeds: 0 };
  if (candidates.length > MAX_AUTO_FUNDING_ITEMS) {
    throw new DomainError("INVALID_FUNDING", "Too many funding items");
  }
  const sales: FundingSale[] = [];
  let remaining = shortfall;
  for (const candidate of candidates) {
    if (remaining <= 0) break;
    if (
      typeof candidate.itemDefinitionId !== "string" ||
      candidate.itemDefinitionId.length === 0 ||
      !Number.isSafeInteger(candidate.unitPrice) ||
      candidate.unitPrice <= 0 ||
      !Number.isSafeInteger(candidate.available) ||
      candidate.available < 0
    ) {
      throw new DomainError("INVALID_FUNDING", "A funding candidate is invalid");
    }
    if (candidate.available === 0) continue;
    const needed = minimumUnitsFor(remaining, candidate.unitPrice);
    const quantity = Math.min(candidate.available, needed);
    if (quantity <= 0) continue;
    const proceeds = quantity * candidate.unitPrice;
    if (!Number.isSafeInteger(proceeds)) {
      throw new DomainError("INVALID_FUNDING", "Funding proceeds overflow the safe integer range");
    }
    sales.push({ itemDefinitionId: candidate.itemDefinitionId, quantity, unitPrice: candidate.unitPrice, proceeds });
    remaining -= proceeds;
  }
  if (remaining > 0) return null;
  return { sales, totalProceeds: sales.reduce((total, sale) => total + sale.proceeds, 0) };
}
