import {
  assertPlotDefinition,
  DomainError,
  isPlotUnlocked,
  parseCurrencyDefinitionId,
  parseEconomyTransactionId,
  parsePlotId,
  plotTiles,
  unlockedPlotIndex,
  type FarmId,
  type FarmTile,
  type PlotDefinition,
  type ProgressionDefinition
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
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
  PayloadFingerprint,
  PlotDefinitionRepository,
  ProgressionRepository,
  WalletRepository
} from "./ports";

/** One piece of land, in the shape the API sends: the catalogue plus this farm's unlock state. */
export interface PlotView {
  readonly plotId: string;
  readonly plotIndex: number;
  readonly currencyId: string;
  readonly price: number;
  readonly requiredLevel: number;
  readonly unlocked: boolean;
}

/** What one expansion settled: which land, at what price, in which currency, leaving which balance. */
export interface ExpansionResult {
  readonly plotId: string;
  readonly plotIndex: number;
  readonly currencyId: string;
  readonly amountSpent: number;
  readonly newBalance: number;
  readonly tilesAdded: number;
}

export interface ExpandFarmCommand {
  readonly requestId: string;
}

const EXPANSION_OPERATION = "EXPAND_FARM";

/**
 * The land this deployment sells, and which of it a farm already owns.
 *
 * Unlock state is derived from the farm's tiles rather than stored separately: a tile row *is*
 * unlocked land, so there is one authoritative representation and no second one to drift. The
 * catalogue is listed whole, locked plots included, so the client can show what the next plot costs
 * and which level it needs instead of hiding it.
 */
export class ListPlots {
  constructor(
    private readonly plots: PlotDefinitionRepository,
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly tiles: FarmTileRepository
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<readonly PlotView[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    if ((await this.members.findByFarmAndPlayer(farmId, actor.playerId)) === null) {
      throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
    }
    const unlockedIndex = unlockedPlotIndex(await this.tiles.listByFarm(farmId));
    return [...this.plots.list()]
      .sort((left, right) => left.plotIndex - right.plotIndex)
      .map((definition) => ({
        plotId: definition.id,
        plotIndex: definition.plotIndex,
        currencyId: definition.currencyDefinitionId,
        price: definition.price,
        requiredLevel: definition.requiredLevel,
        unlocked: definition.plotIndex <= unlockedIndex
      }));
  }
}

interface ExpandFarmDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly tiles: FarmTileRepository;
  readonly plots: PlotDefinitionRepository;
  readonly progressions: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  readonly currencies: CurrencyDefinitionRepository;
  readonly wallets: WalletRepository;
  readonly idempotency: IdempotencyRepository;
  readonly settlement: FarmExpansionRepository;
  readonly economyService: EconomyService;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

/**
 * Buys the next plot of land for a farm the actor owns.
 *
 * Three things are deliberate here:
 *
 * 1. The plot is chosen by the server from the farm's own unlocked land. The command carries a
 *    request ID and nothing else, so no client can name a price, a currency, a level, or a plot.
 * 2. The target plot is decided once, before the retry loop, and only the wallet is re-read while
 *    retrying. A wallet conflict therefore retries the *same* purchase; it can never quietly turn
 *    into the purchase of the next, dearer plot while the player looks away.
 * 3. Land already bought is never re-bought. The frontier is the contiguous run of complete plots,
 *    and a concurrent expansion that takes the same plot makes this one fail closed rather than
 *    charge for land the farm already has.
 */
export class ExpandFarm {
  constructor(private readonly dependencies: ExpandFarmDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: ExpandFarmCommand): Promise<ExpansionResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");

    // The only client input is the farm, which is already in the path.
    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([farmId]));
    if ((await this.dependencies.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Farm expansion is not allowed");
    }

    const existing = await this.dependencies.idempotency.find(actor.playerId, EXPANSION_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const definition = this.nextPlot(await this.dependencies.tiles.listByFarm(farmId));
    const stored = await this.dependencies.progressions.find(actor.playerId);
    if (!isPlotUnlocked(definition, storedLevel(this.dependencies.progressionDefinition, stored))) {
      throw new ApplicationError("PLOT_LEVEL_REQUIRED", "This plot needs a higher player level");
    }
    const currency = this.dependencies.currencies.findById(definition.currencyDefinitionId);
    if (currency === null) {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }

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
      // The price and the land both come from this one definition, and `assertPlotDefinition` has
      // already refused a definition whose id and index disagree.
      const economy = this.dependencies.economyService.prepareMutation(actor, wallet, currency, {
        delta: -definition.price,
        reason: "FARM_EXPANSION",
        referenceId: definition.id,
        requestId: command.requestId
      });
      const tiles = plotTiles(farmId, definition.plotIndex, timestamp);
      const result: ExpansionResult = {
        plotId: definition.id,
        plotIndex: definition.plotIndex,
        currencyId: definition.currencyDefinitionId,
        amountSpent: definition.price,
        newBalance: economy.balanceAfter,
        tilesAdded: tiles.length
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: EXPANSION_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: economy.transactionId,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: timestamp
      };
      try {
        await this.dependencies.settlement.expandFarmAtomically(economy, tiles, record);
        return result;
      } catch (error: unknown) {
        const raced = await this.dependencies.idempotency.find(actor.playerId, EXPANSION_OPERATION, command.requestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        if (!(error instanceof ApplicationError) || error.code !== "ECONOMY_CONFLICT") throw error;
      }
    }
    throw new ApplicationError("ECONOMY_CONFLICT", "Economy state changed concurrently");
  }

  /**
   * The plot after the land the farm already holds, or a refusal when there is none left.
   *
   * Buying out of order is not offered: a farm grows outward one plot at a time, so the only land
   * for sale is the plot immediately after the contiguous run the farm already owns.
   */
  private nextPlot(tiles: readonly FarmTile[]): PlotDefinition {
    const unlockedIndex = unlockedPlotIndex(tiles);
    const definition = this.dependencies.plots.findByIndex(unlockedIndex + 1);
    if (definition === null) {
      throw new ApplicationError("PLOT_LIMIT_REACHED", "This farm has bought all the land for sale");
    }
    try {
      assertPlotDefinition(definition);
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
      throw error;
    }
    return definition;
  }

  /**
   * Returns the original settlement without touching the wallet or the land.
   *
   * The stored result is re-read as the server's own record, so a replay reports the balance the
   * purchase actually left rather than recomputing it from state that has moved on since.
   */
  private replay(record: IdempotencyRecord, fingerprint: string): ExpansionResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      parseEconomyTransactionId(record.resourceId);
      parsePlotId(String(value.plotId));
      parseCurrencyDefinitionId(String(value.currencyId));
      if (
        !Number.isSafeInteger(value.plotIndex) || (value.plotIndex as number) < 1 ||
        !Number.isSafeInteger(value.amountSpent) || (value.amountSpent as number) <= 0 ||
        !Number.isSafeInteger(value.newBalance) || (value.newBalance as number) < 0 ||
        !Number.isSafeInteger(value.tilesAdded) || (value.tilesAdded as number) <= 0
      ) {
        throw new Error("invalid stored result");
      }
      return value as unknown as ExpansionResult;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}
