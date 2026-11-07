import { DomainError } from "./errors";
import type {
  ConstructionId,
  CurrencyDefinitionId,
  EconomyTransactionId,
  ItemDefinitionId,
  PlayerId,
  PlotId,
  ShopEntryId,
  WarehouseId
} from "./ids";
import { parseConstructionId, parsePlayerId, parsePlotId, parseShopEntryId, parseWarehouseId } from "./ids";

export const MAX_WALLET_BALANCE = Number.MAX_SAFE_INTEGER;
export const MAX_SHOP_QUANTITY = 1_000_000;

export interface CurrencyDefinition {
  readonly id: CurrencyDefinitionId;
  readonly displayNameKey: string;
  readonly maxBalance: number;
}

export interface ShopEntry {
  readonly id: ShopEntryId;
  readonly itemDefinitionId: ItemDefinitionId;
  /** Optional label for a shop purpose; inventory still uses the item definition's label. */
  readonly shopDisplayNameKey?: string;
  readonly currencyDefinitionId: CurrencyDefinitionId;
  /**
   * What the server charges for one unit, or null when this entry does not trade that way.
   *
   * A null price is the server's statement that the direction is closed: the shop sells seeds
   * (`buyPrice`) and buys produce (`sellPrice`), and no entry does both for the same item. The
   * client only ever displays the directions that exist.
   */
  readonly buyPrice: number | null;
  readonly sellPrice: number | null;
  readonly maxQuantityPerRequest: number;
}

export interface Wallet {
  readonly playerId: PlayerId;
  readonly currencyDefinitionId: CurrencyDefinitionId;
  readonly balance: number;
  readonly version: number;
  readonly updatedAt: string;
}

export type EconomyReason =
  | "SHOP_BUY"
  | "SHOP_SELL"
  | "FARM_EXPANSION"
  | "STARTER_GRANT"
  | "CONSTRUCTION"
  /**
   * Money coming back when a player takes something down.
   *
   * Its own reason rather than a negative `CONSTRUCTION`: the ledger's whole job is to say *why* a
   * balance moved, and "I built this" and "I dismantled this" are different facts about the same
   * object. Both point at the construction, so the pair reads as the object's whole financial life.
   */
  | "CONSTRUCTION_REFUND"
  /**
   * Buying the next warehouse tier.
   *
   * A currency sink like any other: the row says the money left to make the island hold more, which
   * is why it is its own reason rather than a negative sale or a construction.
   */
  | "WAREHOUSE_UPGRADE";
export type EconomyReferenceType = "SHOP_ENTRY" | "PLOT" | "PLAYER" | "CONSTRUCTION" | "WAREHOUSE";

/**
 * What a ledger row points at: the shop entry that was traded, the land that was bought, or the
 * player a one-time starter grant was issued to.
 *
 * Every reason has exactly one reference kind (`referenceTypeForReason`), so a row cannot claim to
 * be a shop purchase while citing a plot, or the reverse, and a starter grant cannot hide behind a
 * shop or a plot reference. That pairing is what keeps the append-only history readable by a later
 * audit: `reason`, `reference_type`, and `reference_id` agree by construction rather than by
 * convention.
 */
export type EconomyReferenceId = ShopEntryId | PlotId | PlayerId | ConstructionId | WarehouseId;

const REFERENCE_TYPE_BY_REASON: Record<EconomyReason, EconomyReferenceType> = {
  SHOP_BUY: "SHOP_ENTRY",
  SHOP_SELL: "SHOP_ENTRY",
  FARM_EXPANSION: "PLOT",
  STARTER_GRANT: "PLAYER",
  // Construction money points at the thing that was built, so an audit can read the ledger row and
  // the construction row against each other.
  CONSTRUCTION: "CONSTRUCTION",
  // A refund points at the same object, from the other side: the ledger pair is the object's life.
  CONSTRUCTION_REFUND: "CONSTRUCTION",
  // The upgrade points at the warehouse it made bigger.
  WAREHOUSE_UPGRADE: "WAREHOUSE"
};

/** The one reference kind a reason may carry. The mapping is total, or the reason is not one. */
export function referenceTypeForReason(reason: EconomyReason): EconomyReferenceType {
  const referenceType = (REFERENCE_TYPE_BY_REASON as Partial<Record<string, EconomyReferenceType>>)[reason];
  if (referenceType === undefined) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Economy reason is invalid");
  }
  return referenceType;
}

/** Reads back a persisted reference, accepting exactly the shapes `createEconomyMutation` writes. */
export function parseEconomyReferenceId(value: string): EconomyReferenceId {
  const shopEntry = parseOrNull(parseShopEntryId, value);
  const plot = parseOrNull(parsePlotId, value);
  const construction = parseOrNull(parseConstructionId, value);
  const warehouse = parseOrNull(parseWarehouseId, value);
  const reference = shopEntry ?? plot ?? construction ?? warehouse ?? parseOrNull(parsePlayerId, value);
  if (reference === null) {
    throw new DomainError("INVALID_ID", "Invalid economy reference ID");
  }
  return reference;
}

function parseOrNull<T>(parse: (value: string) => T, value: string): T | null {
  try {
    return parse(value);
  } catch {
    return null;
  }
}

/**
 * Refuses a reference whose kind does not match its reason.
 *
 * The database enforces the same pairing in `economy_ledger`; this is the earlier, cheaper refusal
 * that keeps a mis-paired mutation from ever reaching a settlement.
 */
function assertReferenceMatchesType(referenceType: EconomyReferenceType, referenceId: EconomyReferenceId): void {
  try {
    if (referenceType === "SHOP_ENTRY") parseShopEntryId(referenceId);
    else if (referenceType === "PLOT") parsePlotId(referenceId);
    else if (referenceType === "CONSTRUCTION") parseConstructionId(referenceId);
    else if (referenceType === "WAREHOUSE") parseWarehouseId(referenceId);
    else parsePlayerId(referenceId);
  } catch {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Economy reference does not match its reason");
  }
}

export interface EconomyMutation {
  readonly transactionId: EconomyTransactionId;
  readonly playerId: PlayerId;
  readonly currencyDefinitionId: CurrencyDefinitionId;
  readonly delta: number;
  readonly reason: EconomyReason;
  readonly referenceType: EconomyReferenceType;
  readonly referenceId: EconomyReferenceId;
  readonly requestId: string;
  readonly balanceBefore: number;
  readonly balanceAfter: number;
  readonly expectedWalletVersion: number;
  readonly createdAt: string;
}

export type EconomyLedgerEntry = EconomyMutation;

export function calculateShopTotal(entry: ShopEntry, quantity: number, operation: "BUY" | "SELL"): number {
  if (!Number.isSafeInteger(quantity) || quantity <= 0 || quantity > entry.maxQuantityPerRequest) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Shop quantity is invalid");
  }
  const unitPrice = operation === "BUY" ? entry.buyPrice : entry.sellPrice;
  // A direction the entry does not trade is refused here as well as in the use case, so no caller
  // can turn a null price into a free purchase or a zero-value sale.
  if (unitPrice === null) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Shop entry does not trade in that direction");
  }
  const total = unitPrice * quantity;
  if (!Number.isSafeInteger(unitPrice) || unitPrice <= 0 || !Number.isSafeInteger(total)) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Shop total is outside the safe integer range");
  }
  return total;
}

export function createEconomyMutation(
  wallet: Wallet,
  definition: CurrencyDefinition,
  input: Omit<EconomyMutation, "playerId" | "currencyDefinitionId" | "balanceBefore" | "balanceAfter" | "expectedWalletVersion" | "referenceType">
): EconomyMutation {
  if (wallet.currencyDefinitionId !== definition.id || definition.maxBalance !== MAX_WALLET_BALANCE) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Wallet currency definition is invalid");
  }
  if (!Number.isSafeInteger(wallet.balance) || wallet.balance < 0 || wallet.balance > definition.maxBalance) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Wallet balance is invalid");
  }
  if (!Number.isSafeInteger(wallet.version) || wallet.version < 1) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Wallet version is invalid");
  }
  if (!Number.isSafeInteger(input.delta) || input.delta === 0) {
    throw new DomainError("INVALID_ECONOMY_MUTATION", "Currency delta must be a non-zero safe integer");
  }
  const balanceAfter = wallet.balance + input.delta;
  if (!Number.isSafeInteger(balanceAfter) || balanceAfter > definition.maxBalance) {
    throw new DomainError("WALLET_LIMIT_EXCEEDED", "Wallet maximum would be exceeded");
  }
  if (balanceAfter < 0) {
    throw new DomainError("INSUFFICIENT_FUNDS", "Wallet cannot become negative");
  }
  const referenceType = referenceTypeForReason(input.reason);
  assertReferenceMatchesType(referenceType, input.referenceId);
  return {
    ...input,
    referenceType,
    playerId: wallet.playerId,
    currencyDefinitionId: wallet.currencyDefinitionId,
    balanceBefore: wallet.balance,
    balanceAfter,
    expectedWalletVersion: wallet.version
  };
}
