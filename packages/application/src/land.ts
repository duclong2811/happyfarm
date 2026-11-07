import {
  createFarmTile,
  isPlotUnlocked,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  plotIndexContaining,
  singleCellPrice,
  type FarmId,
  type LandCellReason,
  type PlotDefinition,
  type ProgressionDefinition,
  type TileCoordinate
} from "@happy-farm/domain";
import { ApplicationError, type ApplicationErrorCode } from "./errors";
import type { EconomyService } from "./economy";
import { storedLevel } from "./progression";
import type {
  ActorContext,
  Clock,
  CurrencyDefinitionRepository,
  FarmExpansionRepository,
  FarmMemberRepository,
  FarmRepository,
  FarmTileRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  LandSaleLookup,
  PayloadFingerprint,
  PlotDefinitionRepository,
  ProgressionRepository,
  WalletRepository
} from "./ports";

/**
 * How many cells one request may buy.
 *
 * A whole plot cohort (144 cells) is comfortably inside this, so a player who wants a parcel in one
 * command can still send one; the cap is what keeps a single request from becoming an unbounded write
 * and keeps the payload small.
 */
export const MAX_LAND_CELLS_PER_REQUEST = 256;

/**
 * Why one requested cell is, or is not, for sale to this farm right now.
 *
 * The canonical domain list, re-exported so a caller can import it from the use case it belongs to.
 * There is deliberately no second union here: the wire contract derives its enum from the same
 * values and a contract test fails if the two ever drift.
 */
export type { LandCellReason };

/** One cell, priced and judged against the farm's own land and the catalogue. */
export interface LandCellQuote {
  readonly x: number;
  readonly y: number;
  readonly eligible: boolean;
  readonly reason: LandCellReason;
  /** The catalogue plot the cell belongs to, or null when no plot covers it. */
  readonly plotIndex: number | null;
  /** The authoritative single-cell price when a plot covers the cell, otherwise 0. */
  readonly price: number;
  readonly currencyId: string | null;
}

export interface LandQuote {
  readonly cells: readonly LandCellQuote[];
  /** The sum of the eligible cells' prices: what a purchase of exactly these cells would cost. */
  readonly totalPrice: number;
  readonly currencyId: string | null;
}

export interface QuoteLandCellsCommand {
  readonly cells: readonly TileCoordinate[];
}

export interface BuyLandCellsCommand {
  readonly requestId: string;
  readonly cells: readonly TileCoordinate[];
}

export interface LandPurchaseResult {
  readonly cells: readonly TileCoordinate[];
  readonly currencyId: string;
  readonly amountSpent: number;
  readonly newBalance: number;
}

const LAND_PURCHASE_OPERATION = "BUY_LAND_CELLS";

interface LandSaleDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly tiles: FarmTileRepository;
  readonly plots: PlotDefinitionRepository;
  readonly progressions: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  readonly currencies: CurrencyDefinitionRepository;
  readonly landSale: LandSaleLookup;
  readonly clock: Clock;
}

/**
 * Prices and judges a set of cells without writing anything.
 *
 * The command carries coordinates and nothing else: the plot, the price, the currency and the level
 * requirement all come from the catalogue the server owns, and ownership comes from the farm's own
 * rows. A quote is an answer about *these* cells, not a reservation - two clients may be quoted the
 * same cell, and only the purchase settles who gets it.
 */
export class QuoteLandCells {
  constructor(private readonly dependencies: LandSaleDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: QuoteLandCellsCommand): Promise<LandQuote> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if ((await this.dependencies.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Land purchase is not allowed");
    }
    const coordinates = normaliseCells(command.cells);
    const owned = await this.ownedKeys(farmId);
    const level = await this.level(actor);
    return this.decide(coordinates, owned, level);
  }

  private async ownedKeys(farmId: FarmId): Promise<ReadonlySet<string>> {
    return new Set((await this.dependencies.tiles.listByFarm(farmId)).map((tile) => key(tile)));
  }

  private async level(actor: ActorContext): Promise<number> {
    const stored = await this.dependencies.progressions.find(actor.playerId);
    return storedLevel(this.dependencies.progressionDefinition, stored);
  }

  private decide(
    coordinates: readonly TileCoordinate[],
    owned: ReadonlySet<string>,
    level: number
  ): LandQuote {
    const cells = coordinates.map((coordinate) => this.judge(coordinate, owned, level));
    const priced = cells.filter((cell) => cell.eligible);
    const totalPrice = priced.reduce((total, cell) => total + cell.price, 0);
    return { cells, totalPrice, currencyId: priced[0]?.currencyId ?? null };
  }

  private judge(coordinate: TileCoordinate, owned: ReadonlySet<string>, level: number): LandCellQuote {
    const location = { x: coordinate.x, y: coordinate.y };
    const judgement = judgeLandCell(this.dependencies.plots, this.dependencies.landSale, location, owned, level);
    return {
      x: coordinate.x,
      y: coordinate.y,
      eligible: judgement.eligible,
      reason: judgement.reason,
      plotIndex: judgement.definition === null ? null : judgement.definition.plotIndex,
      price: judgement.price,
      currencyId: judgement.definition === null ? null : judgement.definition.currencyDefinitionId
    };
  }
}

interface BuyLandDependencies extends LandSaleDependencies {
  readonly wallets: WalletRepository;
  readonly idempotency: IdempotencyRepository;
  readonly settlement: FarmExpansionRepository;
  readonly economyService: EconomyService;
  readonly fingerprints: PayloadFingerprint;
}

/**
 * Buys one or more individual cells of ground for a farm the actor owns.
 *
 * The purchase is all-or-nothing: every cell is judged before anything is written, a cell that is
 * not for sale refuses the whole request, and the tiles, the wallet movement and the receipt are one
 * database batch. A replay answers with the recorded result instead of charging again, and a racing
 * purchase of the same cell loses on the `farm_tiles` primary key rather than double-charging.
 *
 * The ledger reason is the existing `FARM_EXPANSION`, because a cell purchase *is* farm expansion and
 * the ledger's reference vocabulary already points land at a plot; the reference cites the plot the
 * cells came from. The idempotency operation is its own, so a cell purchase and a plot purchase can
 * never be confused for each other.
 */
export class BuyLandCells {
  constructor(private readonly dependencies: BuyLandDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: BuyLandCellsCommand): Promise<LandPurchaseResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const coordinates = normaliseCells(command.cells);
    const fingerprint = await this.dependencies.fingerprints.hash(
      JSON.stringify([farmId, ...coordinates.map((cell) => [cell.x, cell.y])])
    );

    if ((await this.dependencies.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Land purchase is not allowed");
    }

    const existing = await this.dependencies.idempotency.find(
      actor.playerId,
      LAND_PURCHASE_OPERATION,
      command.requestId
    );
    if (existing !== null) return this.replay(existing, fingerprint);

    const owned = new Set((await this.dependencies.tiles.listByFarm(farmId)).map((tile) => key(tile)));
    const stored = await this.dependencies.progressions.find(actor.playerId);
    const level = storedLevel(this.dependencies.progressionDefinition, stored);

    // Judge every cell before any write: a mixed request must not buy the legal half and fail the
    // rest, and the price is the catalogue's, never the client's.
    const judgements = coordinates.map((coordinate) =>
      judgeLandCell(this.dependencies.plots, this.dependencies.landSale, coordinate, owned, level)
    );
    const illegal = judgements.find((judgement) => !judgement.eligible);
    if (illegal !== undefined) throw new ApplicationError(codeForReason(illegal.reason), messageForReason(illegal.reason));

    const first = judgements[0];
    if (first === undefined || first.definition === null) {
      throw new ApplicationError("INVALID_INPUT", "No land cells were requested");
    }
    const definition = first.definition;
    const currency = this.dependencies.currencies.findById(definition.currencyDefinitionId);
    if (currency === null) {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }
    const price = judgements.reduce((total, judgement) => total + judgement.price, 0);

    for (let attempt = 0; attempt < 16; attempt += 1) {
      const timestamp = this.dependencies.clock.now();
      const wallet =
        (await this.dependencies.wallets.find(actor.playerId, definition.currencyDefinitionId)) ?? {
          playerId: actor.playerId,
          currencyDefinitionId: definition.currencyDefinitionId,
          balance: 0,
          version: 1,
          updatedAt: timestamp
        };
      const economy = this.dependencies.economyService.prepareMutation(actor, wallet, currency, {
        delta: -price,
        reason: "FARM_EXPANSION",
        referenceId: definition.id,
        requestId: command.requestId
      });
      const tiles = coordinates.map((coordinate) =>
        createFarmTile(farmId, coordinate, "SOIL", timestamp)
      );
      const result: LandPurchaseResult = {
        cells: coordinates,
        currencyId: definition.currencyDefinitionId,
        amountSpent: price,
        newBalance: economy.balanceAfter
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: LAND_PURCHASE_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: economy.transactionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: timestamp
      };
      try {
        await this.dependencies.settlement.buyLandCellsAtomically(economy, tiles, record);
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(
          actor.playerId,
          LAND_PURCHASE_OPERATION,
          command.requestId
        );
        if (raced !== null) return this.replay(raced, fingerprint);
        if (!(error instanceof ApplicationError) || error.code !== "ECONOMY_CONFLICT") throw error;
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "Economy state changed concurrently");
  }

  private replay(record: IdempotencyRecord, fingerprint: string): LandPurchaseResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      parseEconomyTransactionId(record.resourceId);
      parseCurrencyDefinitionId(String(value.currencyId));
      if (
        !Array.isArray(value.cells) ||
        value.cells.length === 0 ||
        !Number.isSafeInteger(value.amountSpent) ||
        (value.amountSpent as number) <= 0 ||
        !Number.isSafeInteger(value.newBalance) ||
        (value.newBalance as number) < 0
      ) {
        throw new Error("invalid stored result");
      }
      return value as unknown as LandPurchaseResult;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}

interface LandJudgement {
  readonly eligible: boolean;
  readonly reason: LandCellReason;
  readonly definition: PlotDefinition | null;
  readonly price: number;
}

/** The cell key ownership is stored and compared under: the same `x,y` the tile rows use. */
function key(coordinate: TileCoordinate): string {
  return `${String(coordinate.x)},${String(coordinate.y)}`;
}

/**
 * The plot rate a cell is sold at.
 *
 * A cell inside a catalogue plot cohort is sold at that plot's rate. Freeform development reaches
 * the whole Home Island, so a cell beyond every cohort - the plot layout only covers the rings the
 * catalogue defines - is sold at the *deepest* plot the catalogue sells. That keeps the on-demand
 * rate tied to the top of the bulk economy instead of inventing a second land price, and it keeps
 * bulk land cheaper per cell.
 */
function saleDefinition(plots: PlotDefinitionRepository, coordinate: TileCoordinate): PlotDefinition | null {
  const plotIndex = plotIndexContaining(coordinate);
  const direct = plotIndex === null ? null : plots.findByIndex(plotIndex);
  if (direct !== null) return direct;
  let deepest: PlotDefinition | null = null;
  for (const plot of plots.list()) {
    if (deepest === null || plot.plotIndex > deepest.plotIndex) deepest = plot;
  }
  return deepest;
}

/**
 * Whether one cell may be sold to this farm right now, and at what price.
 *
 * Ownership is an economic cost, not a placement boundary, so there is deliberately **no** adjacency
 * check: any cell on the Home Island may be bought as long as the island calls it developable. What
 * remains is geography (the `LandSaleLookup` says dry, unprotected island ground), existing ownership,
 * and the level gate of the plot whose rate the cell is sold at. The client can never name a price.
 */
function judgeLandCell(
  plots: PlotDefinitionRepository,
  landSale: LandSaleLookup,
  coordinate: TileCoordinate,
  owned: ReadonlySet<string>,
  level: number
): LandJudgement {
  const definition = saleDefinition(plots, coordinate);
  const price = definition === null ? 0 : singleCellPrice(definition.price);
  if (owned.has(key(coordinate))) {
    // An owned cell needs no purchase, so it carries no additional land cost.
    return { eligible: false, reason: "ALREADY_OWNED", definition, price: 0 };
  }
  if (definition === null) return { eligible: false, reason: "NOT_SELLABLE", definition, price };
  if (!landSale.isDevelopable({ x: coordinate.x, y: coordinate.y })) {
    return { eligible: false, reason: "NOT_DEVELOPABLE", definition, price };
  }
  if (!isPlotUnlocked(definition, level)) {
    return { eligible: false, reason: "LEVEL_REQUIRED", definition, price };
  }
  return { eligible: true, reason: "ELIGIBLE", definition, price };
}

/**
 * Validates the coordinate list: whole numbers in bounds, no duplicates, a bounded count.
 *
 * A duplicate would be charged twice and would violate `farm_tiles`' primary key, which is why it is
 * refused here rather than allowed to fail the batch.
 */
function normaliseCells(cells: readonly TileCoordinate[]): readonly TileCoordinate[] {
  if (cells.length === 0 || cells.length > MAX_LAND_CELLS_PER_REQUEST) {
    throw new ApplicationError("INVALID_INPUT", "Land cell count is invalid");
  }
  const seen = new Set<string>();
  return cells.map((cell) => {
    if (!Number.isInteger(cell.x) || !Number.isInteger(cell.y)) {
      throw new ApplicationError("INVALID_INPUT", "Land cell coordinate is invalid");
    }
    const cellKey = key(cell);
    if (seen.has(cellKey)) throw new ApplicationError("INVALID_INPUT", "Land cells must be distinct");
    seen.add(cellKey);
    return { x: cell.x, y: cell.y };
  });
}

function codeForReason(reason: LandCellReason): ApplicationErrorCode {
  switch (reason) {
    case "ALREADY_OWNED":
      return "LAND_ALREADY_OWNED";
    case "NOT_DEVELOPABLE":
      return "LAND_NOT_DEVELOPABLE";
    case "LEVEL_REQUIRED":
      return "PLOT_LEVEL_REQUIRED";
    case "NOT_SELLABLE":
    case "ELIGIBLE":
      return "LAND_CELL_NOT_AVAILABLE";
  }
}

function messageForReason(reason: LandCellReason): string {
  switch (reason) {
    case "ALREADY_OWNED":
      return "That land is already yours";
    case "NOT_DEVELOPABLE":
      return "That ground cannot be developed";
    case "LEVEL_REQUIRED":
      return "That land needs a higher player level";
    case "NOT_SELLABLE":
    case "ELIGIBLE":
      return "That land is not for sale";
  }
}

