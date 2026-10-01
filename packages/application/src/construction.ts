import {
  cellsInBounds,
  constructionRefusal,
  createConstructionInstance,
  normaliseQuarterTurns,
  rotatedFootprint,
  type ConstructionCell,
  type ConstructionDefinition,
  type ConstructionInstance,
  type ConstructionRefusal,
  type QuarterTurns
} from "@happy-farm/domain";
import {
  parseCurrencyDefinitionId,
  parseFarmId,
  type CurrencyDefinition,
  type FarmId,
  type PlayerId,
  type Wallet
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { EconomyService } from "./economy";
import type {
  ActorContext,
  Clock,
  ConstructionDefinitionRepository,
  ConstructionIdGenerator,
  ConstructionRepository,
  CurrencyDefinitionRepository,
  FarmMemberRepository,
  FarmRepository,
  FarmTileRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  PayloadFingerprint,
  ProgressionRepository,
  WalletRepository
} from "./ports";
import type { ProgressionDefinition } from "@happy-farm/domain";
import { storedLevel } from "./progression";

/**
 * Building something, and everything that has to change with it.
 *
 * One use case for every buildable thing. The entry decides what it is - its price, its level, its
 * footprint, its capability, whether it may be built at all - and this decides whether *here* is
 * allowed: ownership, ground, capability, collisions, and whether the player can pay.
 *
 * Nothing about the object comes from the request. The client sends which catalogue entry it means and
 * which cell it pointed at; the server reads the rest.
 */

export const PLACE_CONSTRUCTION_OPERATION = "PLACE_CONSTRUCTION";

export interface PlaceConstructionCommand {
  readonly requestId: string;
  readonly entryId: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly rotation: number;
}

export interface PlaceConstructionDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly tiles: FarmTileRepository;
  readonly constructions: ConstructionRepository;
  readonly definitions: ConstructionDefinitionRepository;
  readonly progression: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  readonly wallets: WalletRepository;
  readonly currencies: CurrencyDefinitionRepository;
  readonly economyService: EconomyService;
  readonly idempotency: IdempotencyRepository;
  readonly ids: ConstructionIdGenerator;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

/** The stable external error for each way a placement can be refused. */
function refusalError(refusal: ConstructionRefusal): { readonly code: string; readonly message: string } {
  switch (refusal) {
    case "NOT_CONSTRUCTIBLE":
      return { code: "CONSTRUCTION_NOT_ALLOWED", message: "This cannot be built yet" };
    case "LEVEL_REQUIRED":
      return { code: "CONSTRUCTION_LEVEL_REQUIRED", message: "This requires a higher level" };
    case "INSUFFICIENT_FUNDS":
      return { code: "INSUFFICIENT_FUNDS", message: "Not enough gold" };
    case "OUTSIDE_ISLAND":
      return { code: "CONSTRUCTION_NOT_OWNED", message: "The footprint leaves the island" };
    case "NOT_OWNED":
      return { code: "CONSTRUCTION_NOT_OWNED", message: "That land is not owned" };
    case "VOLCANO":
      return { code: "CONSTRUCTION_UNSUITABLE_GROUND", message: "Nothing may be built on the volcano" };
    case "WRONG_GROUND":
    case "NEEDS_CAPABILITY":
      return { code: "CONSTRUCTION_UNSUITABLE_GROUND", message: "The ground cannot carry this" };
    case "OCCUPIED":
      return { code: "CONSTRUCTION_OCCUPIED", message: "Something is already there" };
  }
}

export class PlaceConstruction {
  constructor(private readonly dependencies: PlaceConstructionDependencies) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: PlaceConstructionCommand
  ): Promise<ConstructionInstance> {
    const {
      farms,
      members,
      tiles,
      constructions,
      definitions,
      progression,
      progressionDefinition,
      wallets,
      currencies,
      economyService,
      idempotency,
      ids,
      fingerprints,
      clock
    } = this.dependencies;
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");

    const fingerprint = await fingerprints.hash(
      JSON.stringify([farmId, command.entryId, command.anchorX, command.anchorY, command.rotation])
    );
    if ((await farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER" && membership?.role !== "EDITOR") {
      throw new ApplicationError("NOT_AUTHORIZED", "Building is not allowed on this farm");
    }

    const existingRequest = await idempotency.find(actor.playerId, PLACE_CONSTRUCTION_OPERATION, command.requestId);
    if (existingRequest !== null) return this.replay(constructions, existingRequest, fingerprint);

    const definition = definitions.findById(command.entryId);
    if (definition === null) {
      throw new ApplicationError("CONSTRUCTION_NOT_FOUND", "Catalogue entry was not found");
    }
    const rotation: QuarterTurns = normaliseQuarterTurns(command.rotation);
    const footprint = rotatedFootprint(definition.footprint, rotation);
    const anchor = { x: command.anchorX, y: command.anchorY };

    const level = storedLevel(progressionDefinition, await progression.find(actor.playerId));
    const currencyId = parseCurrencyDefinitionId(definition.currencyDefinitionId);
    const wallet = await wallets.find(actor.playerId, currencyId);
    const occupied = await constructions.listBounds(farmId);

    // The cells the footprint would cover, as the ground and the farm actually are. A cell off the
    // farm's own tile set simply does not exist here, which is what "outside the island" means.
    const wanted = cellsInBounds({
      minX: anchor.x - Math.floor((footprint.widthCells - 1) / 2),
      maxX: anchor.x - Math.floor((footprint.widthCells - 1) / 2) + footprint.widthCells - 1,
      minY: anchor.y - Math.floor((footprint.depthCells - 1) / 2),
      maxY: anchor.y - Math.floor((footprint.depthCells - 1) / 2) + footprint.depthCells - 1
    });
    const cells: ConstructionCell[] = [];
    for (const cell of wanted) {
      const tile = await tiles.find(farmId, cell.x, cell.y);
      cells.push({
        x: cell.x,
        y: cell.y,
        owned: tile !== null,
        // A construction may only stand on the farm's own tile set, which is land; the wider island's
        // terrain classification is the client's, and nothing here trusts it.
        terrain: tile === null ? ("WATER" as const) : ("LAND" as const),
        capabilities: tile === null ? [] : this.capabilitiesFor(definition),
        occupied: false
      });
    }

    const refusal = constructionRefusal({
      definition,
      footprint,
      cells,
      occupied,
      playerLevel: level,
      balance: wallet?.balance ?? 0
    });
    if (refusal !== null) {
      const mapped = refusalError(refusal);
      throw new ApplicationError(mapped.code as never, mapped.message);
    }

    const now = clock.now();
    const construction = createConstructionInstance({
      id: ids.newConstructionId(),
      farmId,
      definition,
      anchor,
      rotation,
      builtByPlayerId: actor.playerId,
      createdAt: now
    });
    const currency = this.currencyDefinition(definition, currencies);
    const debit = economyService.prepareMutation(
      actor,
      wallet ?? this.emptyWallet(actor.playerId, currency.id),
      currency,
      {
        // The price is the definition's own number. A client cannot send one, and there is no branch
        // here that reads one. The ledger points at the construction the money paid for.
        delta: -definition.price,
        reason: "CONSTRUCTION",
        referenceId: construction.id,
        requestId: command.requestId
      }
    );
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: PLACE_CONSTRUCTION_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: construction.id,
      responseJson: JSON.stringify({ constructionId: construction.id }),
      status: "COMPLETED",
      createdAt: now
    };

    try {
      await constructions.placeAtomically({ construction, economy: debit }, record);
      return construction;
    } catch (error: unknown) {
      const raced = await idempotency.find(actor.playerId, PLACE_CONSTRUCTION_OPERATION, command.requestId);
      if (raced !== null) return this.replay(constructions, raced, fingerprint);
      if (error instanceof ApplicationError) throw error;
      // The batch rolled back as one unit, so a lost race left the wallet exactly as it was. Which
      // stable error the player sees is decided by re-reading the ground they contended over.
      const racedOccupied = await constructions.listBounds(farmId);
      const recheck = constructionRefusal({
        definition,
        footprint,
        cells,
        occupied: racedOccupied,
        playerLevel: level,
        balance: wallet?.balance ?? 0
      });
      if (recheck === "OCCUPIED") {
        throw new ApplicationError("CONSTRUCTION_OCCUPIED", "Something is already there");
      }
      throw error;
    }
  }

  /** A replayed request returns exactly what the first one built, or says the receipt is not this one. */
  private async replay(
    constructions: ConstructionRepository,
    record: IdempotencyRecord,
    fingerprint: string
  ): Promise<ConstructionInstance> {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request id was already used for another payload");
    }
    const construction = await constructions.findById(record.resourceId as never);
    if (construction === null) {
      throw new ApplicationError("CONSTRUCTION_NOT_FOUND", "The recorded construction no longer exists");
    }
    return construction;
  }

  private currencyDefinition(
    definition: ConstructionDefinition,
    currencies: CurrencyDefinitionRepository
  ): CurrencyDefinition {
    const currency = currencies.findById(parseCurrencyDefinitionId(definition.currencyDefinitionId));
    if (currency === null) {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }
    return currency;
  }

  private emptyWallet(playerId: PlayerId, currencyId: CurrencyDefinition["id"]): Wallet {
    return {
      playerId,
      currencyDefinitionId: currencyId,
      balance: 0,
      version: 1,
      updatedAt: this.dependencies.clock.now()
    };
  }

  /**
   * The capabilities the ground would have to offer.
   *
   * A farm tile is land the catalogue has sold, so it carries the land capabilities the world map
   * already derives for LAND cells; a tile outside the farm is not owned and fails before this is
   * read. The capability check therefore becomes the *definition's* question - "is this a thing that
   * belongs on owned land?" - which is the rule V13 can enforce honestly.
   */
  private capabilitiesFor(definition: ConstructionDefinition): readonly string[] {
    return [
      "WALK",
      "BUILD",
      "FARM",
      "FORESTRY",
      "LIVESTOCK",
      "ROAD",
      "DECORATION",
      definition.capability
    ];
  }
}

/**
 * The constructions on a farm, for the world to draw and the shop to collide with.
 *
 * Read-only, and any member may look: seeing what stands on the farm is not a privileged act, and the
 * row itself carries no secrets.
 */
export class ListFarmConstructions {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly constructions: ConstructionRepository
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<readonly ConstructionInstance[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership === null) {
      throw new ApplicationError("NOT_AUTHORIZED", "Farm membership is required");
    }
    return this.constructions.listByFarm(parseFarmId(farmId));
  }
}
