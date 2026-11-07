import {
  cellsInBounds,
  constructionRefusal,
  createFarmTile,
  createConstructionInstance,
  createStarterConstructionInstance,
  moveConstruction,
  normaliseQuarterTurns,
  moveRefusal,
  removalRefund,
  removalRefusal,
  restoreConstruction,
  rotationRefusal,
  rotatedFootprint,
  storageRefusal,
  storeConstruction,
  type ConstructionCell,
  type ConstructionDefinition,
  type ConstructionInstance,
  type ConstructionRefusal,
  type QuarterTurns
} from "@happy-farm/domain";
import {
  parseConstructionId,
  parseCurrencyDefinitionId,
  parseFarmId,
  type CurrencyDefinition,
  type ConstructionId,
  type FarmId,
  type FarmTile,
  type PlayerId,
  type Wallet
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { EconomyService } from "./economy";
import type {
  ActorContext,
  AquaculturePondRepository,
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
  TileTerrainLookup,
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
  /** What the ground physically is, from the island's own geography. */
  readonly terrain: TileTerrainLookup;
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
    const { cells, tilesToCreate } = await this.groundCells(farmId, wanted);

    const refusal = constructionRefusal({
      definition,
      footprint,
      cells,
      occupied,
      playerLevel: level,
      balance: wallet?.balance ?? 0
    });
    if (refusal !== null) {
      const mapped = constructionRefusalError(refusal);
      throw new ApplicationError(mapped.code as never, mapped.message);
    }

    const now = clock.now();
    const construction = createConstructionInstance({
      id: ids.newConstructionId(),
      farmId,
      definition,
      anchor,
      rotation,
      ownerPlayerId: actor.playerId,
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
      await constructions.placeAtomically({ construction, economy: debit, tiles: tilesToCreate }, record);
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
   * The ground under a footprint, as the server knows it.
   *
   * V14.5.2: the natural Home Island is already the player's land, so a missing `farm_tiles` row is
   * *not* a refusal. The island's own classifier decides what the ground is, and a footprint on valid
   * natural land gets its tile rows created with the placement (free - the only money is the asset's
   * own price). `farm_tiles` keeps recording the cells the farm has state on, which is what the crop
   * foreign key and the construction triggers read.
   *
   * Nothing here asks what the land is *for*. That was the old rule, and it is why a broadleaf tree
   * could be refused on land the player plainly owned: the ground had to be inside a district rather
   * than simply the player's.
   */
  private async groundCells(
    farmId: FarmId,
    wanted: readonly { readonly x: number; readonly y: number }[]
  ): Promise<{ readonly cells: readonly ConstructionCell[]; readonly tilesToCreate: readonly FarmTile[] }> {
    const cells: ConstructionCell[] = [];
    const tilesToCreate: FarmTile[] = [];
    const now = this.dependencies.clock.now();
    for (const cell of wanted) {
      const tile = await this.dependencies.tiles.find(farmId, cell.x, cell.y);
      const ground = this.dependencies.terrain.classify(cell);
      // A cell the farm has no row for yet is a fresh natural-land cell: the settlement creates the
      // row it needs, with no land charge.
      if (tile === null) tilesToCreate.push(createFarmTile(farmId, cell, "SOIL", now));
      cells.push({
        x: cell.x,
        y: cell.y,
        terrain: ground.terrain,
        shallowWater: ground.shallowWater,
        protectedGround: ground.protectedGround,
        occupied: false
      });
    }
    return { cells, tilesToCreate };
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
    private readonly constructions: ConstructionRepository,
    /**
     * The starter arrangement, when the host has one.
     *
     * Reading a farm's objects is where an older farm first meets V13.3: the seeder is version-guarded
     * and idempotent, so this is one extra `UPDATE ... WHERE version < ?` on the first read after the
     * migration and nothing at all after it. That is why no manual step is needed to see the new
     * island on a development database.
     */
    private readonly starterWorld?: { execute(farmId: FarmId): Promise<number> }
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
    await this.starterWorld?.execute(farmId);
    return this.constructions.listByFarm(parseFarmId(farmId));
  }
}

/**
 * Editing something the player already built: move it, turn it, take it down.
 *
 * One shape, three commands. Each resolves the actor, the farm and the object from the server's own
 * rows, checks the asset's own policy and the destination ground, and writes one atomic batch whose
 * receipt cannot exist without the effect it claims. Nothing about the object travels in a request
 * except *where the client wants it*: never a price, a refund, a footprint, an owner or a policy.
 *
 * Authorization is the farm gate placing already uses - OWNER or EDITOR - and then the object itself:
 * the person who built it, or the farm's owner, may change what stands on the farm. An editor may not
 * quietly move a colleague's work, and nobody outside the farm may touch any of it.
 */

export const MOVE_CONSTRUCTION_OPERATION = "MOVE_CONSTRUCTION";
export const ROTATE_CONSTRUCTION_OPERATION = "ROTATE_CONSTRUCTION";
export const REMOVE_CONSTRUCTION_OPERATION = "REMOVE_CONSTRUCTION";

export interface MoveConstructionCommand {
  readonly requestId: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly rotation: number;
  readonly expectedVersion: number;
}

export interface RotateConstructionCommand {
  readonly requestId: string;
  readonly rotation: number;
  readonly expectedVersion: number;
}

export interface RemoveConstructionCommand {
  readonly requestId: string;
  readonly expectedVersion: number;
}

export interface RemoveConstructionResult {
  readonly constructionId: ConstructionId;
  readonly refundAmount: number;
  readonly refundCurrencyDefinitionId: string;
}

export interface ConstructionEditDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly tiles: FarmTileRepository;
  /** What the ground physically is, from the island's own geography. */
  readonly terrain: TileTerrainLookup;
  readonly constructions: ConstructionRepository;
  readonly definitions: ConstructionDefinitionRepository;
  readonly wallets: WalletRepository;
  readonly currencies: CurrencyDefinitionRepository;
  readonly economyService: EconomyService;
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
  /** Optional only for hosts that do not mount aquaculture; production API supplies the guard. */
  readonly aquaculturePonds?: Pick<AquaculturePondRepository, "findByConstruction">;
}

/**
 * The stable external error for each way a placement or an edit can be refused.
 *
 * The client shows a *translated* sentence, not this code; the code exists so a tester, a log or a
 * support conversation can name exactly what happened.
 */
function constructionRefusalError(refusal: ConstructionRefusal): { readonly code: string; readonly message: string } {
  switch (refusal) {
    case "NOT_CONSTRUCTIBLE":
      return { code: "CONSTRUCTION_NOT_ALLOWED", message: "This cannot be built yet" };
    case "LEVEL_REQUIRED":
      return { code: "CONSTRUCTION_LEVEL_REQUIRED", message: "This requires a higher level" };
    case "INSUFFICIENT_FUNDS":
      return { code: "INSUFFICIENT_FUNDS", message: "Not enough gold" };
    case "OUTSIDE_ISLAND":
      return { code: "CONSTRUCTION_OUTSIDE_WORLD", message: "The footprint leaves the world" };
    case "BLOCKED":
      return { code: "CONSTRUCTION_BLOCKED", message: "The island keeps that ground" };
    case "INVALID_TERRAIN":
      return { code: "CONSTRUCTION_UNSUITABLE_GROUND", message: "That ground cannot carry this" };
    case "OCCUPIED":
      return { code: "CONSTRUCTION_OCCUPIED", message: "Something is already there" };
    case "NOT_MOVABLE":
      return { code: "CONSTRUCTION_NOT_MOVABLE", message: "This cannot be moved" };
    case "NOT_ROTATABLE":
      return { code: "CONSTRUCTION_NOT_ROTATABLE", message: "This cannot be turned" };
    case "NOT_STORABLE":
      return { code: "CONSTRUCTION_NOT_STORABLE", message: "This cannot be stored" };
    case "NOT_REMOVABLE":
      return { code: "CONSTRUCTION_NOT_REMOVABLE", message: "This cannot be removed" };
  }
}

/**
 * The farm, the actor's right to change it, and the object being changed.
 *
 * Extracted because all three commands need exactly this, and because the failure mode of getting it
 * subtly different in three places is the one that lets a player edit somebody else's island.
 */
async function loadEditableConstruction(
  dependencies: ConstructionEditDependencies,
  actor: ActorContext | null,
  farmId: FarmId,
  constructionId: string
): Promise<{ readonly construction: ConstructionInstance; readonly definition: ConstructionDefinition }> {
  if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
  if ((await dependencies.farms.findById(farmId)) === null) {
    throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
  }
  const membership = await dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
  if (membership?.role !== "OWNER" && membership?.role !== "EDITOR") {
    throw new ApplicationError("NOT_AUTHORIZED", "This farm does not allow editing");
  }
  const construction = await dependencies.constructions.findById(parseConstructionId(constructionId));
  if (construction === null || construction.farmId !== farmId) {
    throw new ApplicationError("RESOURCE_NOT_FOUND", "That object was not found on this farm");
  }
  // The object's own owner, or the farm's: an editor may not quietly move a colleague's work.
  if (construction.ownerPlayerId !== actor.playerId && membership.role !== "OWNER") {
    throw new ApplicationError("OBJECT_NOT_OWNED", "That object belongs to another player");
  }
  const definition = dependencies.definitions.findById(construction.entryId);
  if (definition === null) {
    throw new ApplicationError("CONSTRUCTION_NOT_FOUND", "Catalogue entry was not found");
  }
  return { construction, definition };
}

/**
 * The cells a footprint anchored here would cover.
 *
 * The same arithmetic `PlaceConstruction` does, in one place, so a preview, a placement and a move
 * cannot disagree about which ground a rectangle names.
 */
function wantedCells(
  anchor: { readonly x: number; readonly y: number },
  footprint: { readonly widthCells: number; readonly depthCells: number }
): readonly { readonly x: number; readonly y: number }[] {
  const startX = anchor.x - Math.floor((footprint.widthCells - 1) / 2);
  const startY = anchor.y - Math.floor((footprint.depthCells - 1) / 2);
  return cellsInBounds({
    minX: startX,
    maxX: startX + footprint.widthCells - 1,
    minY: startY,
    maxY: startY + footprint.depthCells - 1
  });
}

/** The ground under a footprint, read exactly as `PlaceConstruction` reads it. */
async function editGroundCells(
  dependencies: ConstructionEditDependencies,
  farmId: FarmId,
  wanted: readonly { readonly x: number; readonly y: number }[]
): Promise<{ readonly cells: readonly ConstructionCell[]; readonly tilesToCreate: readonly FarmTile[] }> {
  const cells: ConstructionCell[] = [];
  const tilesToCreate: FarmTile[] = [];
  const now = dependencies.clock.now();
  for (const cell of wanted) {
    const tile = await dependencies.tiles.find(farmId, cell.x, cell.y);
    const ground = dependencies.terrain.classify(cell);
    // A destination cell the farm has no row for yet is fresh natural land: it is not a refusal, and
    // the settlement writes the row it needs (V14.5.2).
    if (tile === null) tilesToCreate.push(createFarmTile(farmId, cell, "SOIL", now));
    cells.push({
      x: cell.x,
      y: cell.y,
      terrain: ground.terrain,
      shallowWater: ground.shallowWater,
      protectedGround: ground.protectedGround,
      occupied: false
    });
  }
  return { cells, tilesToCreate };
}

/**
 * Moving and turning: one use case, because a turn *is* a move whose anchor does not change.
 *
 * The command carries the version the client is looking at, and a stale version is refused outright
 * rather than merged - two tabs may not both win and leave a row neither of them chose. The object's
 * own rectangle is excluded from the collision check (it is not an obstacle to itself) and every
 * other object on the farm is not, so a move can neither overlap another building nor leave a ghost
 * of itself behind.
 */
export class RelocateConstruction {
  constructor(private readonly dependencies: ConstructionEditDependencies) {}

  async move(
    actor: ActorContext | null,
    farmId: FarmId,
    constructionId: string,
    command: MoveConstructionCommand
  ): Promise<ConstructionInstance> {
    return this.relocate(actor, farmId, constructionId, {
      operation: MOVE_CONSTRUCTION_OPERATION,
      requestId: command.requestId,
      rotation: command.rotation,
      expectedVersion: command.expectedVersion,
      anchor: { x: command.anchorX, y: command.anchorY }
    });
  }

  async rotate(
    actor: ActorContext | null,
    farmId: FarmId,
    constructionId: string,
    command: RotateConstructionCommand
  ): Promise<ConstructionInstance> {
    return this.relocate(actor, farmId, constructionId, {
      operation: ROTATE_CONSTRUCTION_OPERATION,
      requestId: command.requestId,
      rotation: command.rotation,
      expectedVersion: command.expectedVersion,
      // The anchor is the object's own: a turn never moves it.
      anchor: null
    });
  }

  private async relocate(
    actor: ActorContext | null,
    farmId: FarmId,
    constructionId: string,
    input: {
      readonly operation: string;
      readonly requestId: string;
      readonly rotation: number;
      readonly expectedVersion: number;
      readonly anchor: { readonly x: number; readonly y: number } | null;
    }
  ): Promise<ConstructionInstance> {
    const { constructions, idempotency, fingerprints, clock } = this.dependencies;
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const payload =
      input.anchor === null
        ? [input.operation, farmId, constructionId, input.rotation, input.expectedVersion]
        : [input.operation, farmId, constructionId, input.anchor.x, input.anchor.y, input.rotation, input.expectedVersion];
    const fingerprint = await fingerprints.hash(JSON.stringify(payload));
    const settled = await idempotency.find(actor.playerId, input.operation, input.requestId);
    if (settled !== null) return this.settledAnswer(settled, fingerprint, farmId, constructionId);

    const { construction, definition } = await loadEditableConstruction(
      this.dependencies,
      actor,
      farmId,
      constructionId
    );
    if (construction.version !== input.expectedVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "That object has changed since you looked at it");
    }
    const anchor = input.anchor ?? { x: construction.anchorX, y: construction.anchorY };
    const rotation: QuarterTurns = normaliseQuarterTurns(input.rotation);
    const footprint = rotatedFootprint(definition.footprint, rotation);
    const { cells, tilesToCreate } = await editGroundCells(
      this.dependencies,
      farmId,
      wantedCells(anchor, footprint)
    );
    const occupied = await constructions.listBounds(farmId);
    const check = { definition, footprint, cells, occupied, ignoreBounds: construction.bounds };
    const refusal = input.operation === ROTATE_CONSTRUCTION_OPERATION ? rotationRefusal(check) : moveRefusal(check);
    if (refusal !== null) {
      const mapped = constructionRefusalError(refusal);
      throw new ApplicationError(mapped.code as never, mapped.message);
    }

    const now = clock.now();
    const moved = moveConstruction(construction, { anchor, rotation, footprint, updatedAt: now });
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: input.operation,
      requestId: input.requestId,
      payloadFingerprint: fingerprint,
      resourceId: moved.id,
      responseJson: JSON.stringify({ constructionId: moved.id }),
      status: "COMPLETED",
      createdAt: now
    };
    try {
      await constructions.relocateAtomically(
        { construction: moved, expectedVersion: construction.version, tiles: tilesToCreate },
        record
      );
      return moved;
    } catch (error: unknown) {
      // A receipt written by a racing request is the truth: repeat the answer the first one gave.
      const raced = await idempotency.find(actor.playerId, input.operation, input.requestId);
      if (raced !== null) return this.settledAnswer(raced, fingerprint, farmId, constructionId);
      throw error;
    }
  }

  /** A request that already settled: the same object, and never a second move. */
  private async settledAnswer(
    record: IdempotencyRecord,
    fingerprint: string,
    farmId: FarmId,
    constructionId: string
  ): Promise<ConstructionInstance> {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request id was already used for another payload");
    }
    const construction = await this.dependencies.constructions.findById(parseConstructionId(constructionId));
    if (construction === null || construction.farmId !== farmId) {
      throw new ApplicationError("CONSTRUCTION_NOT_FOUND", "The recorded construction no longer exists");
    }
    return construction;
  }
}

/**
 * Taking something down: the row, the receipt, and - when the asset's policy returns anything - the
 * refund ledger row, all in one batch.
 *
 * The refund is computed here from the *definition*, never from the request, and it settles through
 * the same economy service every other movement uses, so it cannot skip the ledger or invent a
 * balance. A removal that returns nothing writes no ledger row at all (the ledger refuses a zero
 * delta), which is why the receipt points at the ledger row when there is one and at the vanished
 * object when there is not.
 */
export class RemoveConstruction {
  constructor(private readonly dependencies: ConstructionEditDependencies) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    constructionId: string,
    command: RemoveConstructionCommand
  ): Promise<RemoveConstructionResult> {
    const { constructions, idempotency, fingerprints, clock, wallets, currencies, economyService } = this.dependencies;
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const fingerprint = await fingerprints.hash(
      JSON.stringify([REMOVE_CONSTRUCTION_OPERATION, farmId, constructionId, command.expectedVersion])
    );
    const settled = await idempotency.find(actor.playerId, REMOVE_CONSTRUCTION_OPERATION, command.requestId);
    if (settled !== null) {
      if (settled.payloadFingerprint !== fingerprint) {
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request id was already used for another payload");
      }
      return JSON.parse(settled.responseJson) as RemoveConstructionResult;
    }

    const { construction, definition } = await loadEditableConstruction(
      this.dependencies,
      actor,
      farmId,
      constructionId
    );
    if (construction.version !== command.expectedVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "That object has changed since you looked at it");
    }
    if (definition.category === "AQUACULTURE" && this.dependencies.aquaculturePonds !== undefined) {
      const pond = await this.dependencies.aquaculturePonds.findByConstruction(farmId, construction.id);
      if (pond?.cohorts.some((cohort) => cohort.quantity > 0) === true) {
        throw new ApplicationError("AQUACULTURE_POND_NOT_EMPTY", "Harvest or withdraw every fish before removing the cage");
      }
    }
    const refusal = removalRefusal(definition);
    if (refusal !== null) {
      const mapped = constructionRefusalError(refusal);
      throw new ApplicationError(mapped.code as never, mapped.message);
    }

    const currencyId = parseCurrencyDefinitionId(definition.currencyDefinitionId);
    const currency = currencies.findById(currencyId);
    if (currency === null) {
      throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
    }
    // A share of what this object actually cost its owner. A seeded object cost nothing, so removing
    // it pays nothing back however much the catalogue would charge for a new one.
    const amount = removalRefund(construction, definition);
    const now = clock.now();
    const refund =
      amount > 0
        ? economyService.prepareMutation(
            actor,
            (await wallets.find(actor.playerId, currencyId)) ?? {
              playerId: actor.playerId,
              currencyDefinitionId: currencyId,
              balance: 0,
              version: 1,
              updatedAt: now
            },
            currency,
            {
              delta: amount,
              reason: "CONSTRUCTION_REFUND",
              referenceId: construction.id,
              requestId: command.requestId
            }
          )
        : null;
    const result: RemoveConstructionResult = {
      constructionId: construction.id,
      refundAmount: refund?.delta ?? 0,
      refundCurrencyDefinitionId: definition.currencyDefinitionId
    };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: REMOVE_CONSTRUCTION_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      // With a refund the receipt points at the ledger row, which is what a half-applied removal
      // would be missing; without one it points at the object, which must be gone.
      resourceId: refund?.transactionId ?? construction.id,
      responseJson: JSON.stringify(result),
      status: "COMPLETED",
      createdAt: now
    };
    try {
      await constructions.removeAtomically(
        { farmId, constructionId: construction.id, expectedVersion: construction.version, refund },
        record
      );
      return result;
    } catch (error: unknown) {
      const raced = await idempotency.find(actor.playerId, REMOVE_CONSTRUCTION_OPERATION, command.requestId);
      if (raced !== null) return JSON.parse(raced.responseJson) as RemoveConstructionResult;
      throw error;
    }
  }
}

/**
 * The starter arrangement, as the application layer sees it.
 *
 * A plain shape rather than a game-data import: this package owns rules, not content, so the layout
 * is handed in by the host exactly as the catalogue and the progression curve are.
 */
export interface StarterPlacementInput {
  readonly key: string;
  readonly definitionId: string;
  /** The seed version this placement arrived in. A farm already past it is never given it again. */
  readonly version: number;
  readonly tile: { readonly x: number; readonly y: number };
  readonly rotation: QuarterTurns;
}

export interface StarterWorldDefinition {
  readonly version: number;
  readonly placements: readonly StarterPlacementInput[];
}

export const SEED_STARTER_WORLD_OPERATION = "SEED_STARTER_WORLD";

/**
 * Giving a farm its starter objects, exactly once.
 *
 * Three properties matter and all three come from the database rather than from this code being
 * careful:
 *
 * * **Once.** The farm's `starter_world_version` is stamped by the same batch that inserts the rows,
 *   with a `WHERE version < ?` predicate. A second caller - a race, a retry, two browser tabs - finds
 *   the version already current and inserts nothing.
 * * **Idempotent per object.** Each placement carries a stable key and a unique `(farm, key)` index,
 *   so even a partly-applied pass cannot produce two of the same tree.
 * * **Never a reset.** Seeding only ever *adds* rows. It never looks at an object that already exists,
 *   so a tree the player moved, stored or removed is never put back where it started.
 *
 * Existing farms take this path the first time their constructions are read, which is why the local
 * development farm needs no manual step: it is given the arrangement it never had, once.
 */
export class SeedStarterWorld {
  constructor(
    private readonly dependencies: {
      readonly farms: FarmRepository;
      readonly constructions: ConstructionRepository;
      readonly definitions: ConstructionDefinitionRepository;
      readonly world: StarterWorldDefinition;
      readonly ids: ConstructionIdGenerator;
      readonly clock: Clock;
    }
  ) {}

  /** Seeds if the farm is behind, and reports how many objects it created. */
  async execute(farmId: FarmId): Promise<number> {
    const { farms, constructions, definitions, world, ids, clock } = this.dependencies;
    const state = await farms.starterWorldState(farmId);
    if (state === null) return 0;
    if (state.version >= world.version) return 0;

    const now = clock.now();
    const instances: ConstructionInstance[] = [];
    for (const placement of world.placements) {
      // Additive: a farm already at version N is given only what N+1 and later added. Replaying a
      // version the farm already has would collide with its own rows - and, worse, would try to put
      // back an object the player had moved, stored or removed.
      if (placement.version <= state.version) continue;
      const definition = definitions.findById(placement.definitionId);
      if (definition === null) {
        // A layout naming a definition this build does not ship is a deployment mistake, and it must
        // be loud rather than quietly producing an island with a hole in it.
        throw new ApplicationError("INTERNAL_ERROR", `Starter placement names an unknown definition: ${placement.definitionId}`);
      }
      instances.push(
        createStarterConstructionInstance({
          id: ids.newConstructionId(),
          farmId,
          definition,
          placementKey: placement.key,
          anchor: placement.tile,
          rotation: placement.rotation,
          // A starter object is the farm's, and a farm's authority is its owner's.
          ownerPlayerId: state.ownerPlayerId,
          createdAt: now
        })
      );
    }
    return constructions.seedAtomically({
      farmId,
      version: world.version,
      constructions: instances,
      seededAt: now
    });
  }
}

export const STORE_CONSTRUCTION_OPERATION = "STORE_CONSTRUCTION";
export const RESTORE_CONSTRUCTION_OPERATION = "RESTORE_CONSTRUCTION";

export interface StoreConstructionCommand {
  readonly requestId: string;
  readonly expectedVersion: number;
}

export interface RestoreConstructionCommand {
  readonly requestId: string;
  readonly anchorX: number;
  readonly anchorY: number;
  readonly rotation: number;
  readonly expectedVersion: number;
}

/**
 * Putting an object into storage: out of the world, still the player's, still itself.
 *
 * Not a removal and not a sale. The row keeps its id, its cost basis and its version chain, and it
 * stops occupying ground because its state says so - which is what makes storing a mill and placing
 * it again later impossible to turn into two mills.
 */
export class StoreConstruction {
  constructor(private readonly dependencies: ConstructionEditDependencies) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    constructionId: string,
    command: StoreConstructionCommand
  ): Promise<ConstructionInstance> {
    const { constructions, idempotency, fingerprints, clock } = this.dependencies;
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const fingerprint = await fingerprints.hash(
      JSON.stringify([STORE_CONSTRUCTION_OPERATION, farmId, constructionId, command.expectedVersion])
    );
    const settled = await idempotency.find(actor.playerId, STORE_CONSTRUCTION_OPERATION, command.requestId);
    if (settled !== null) {
      if (settled.payloadFingerprint !== fingerprint) {
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request id was already used for another payload");
      }
      return this.settledAnswer(farmId, constructionId);
    }

    const { construction, definition } = await loadEditableConstruction(
      this.dependencies,
      actor,
      farmId,
      constructionId
    );
    if (construction.version !== command.expectedVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "That object has changed since you looked at it");
    }
    if (construction.state === "STORED") return construction;
    const refusal = storageRefusal(definition);
    if (refusal !== null) {
      const mapped = constructionRefusalError(refusal);
      throw new ApplicationError(mapped.code as never, mapped.message);
    }

    const now = clock.now();
    const stored = storeConstruction(construction, now);
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: STORE_CONSTRUCTION_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: stored.id,
      responseJson: JSON.stringify({ constructionId: stored.id }),
      status: "COMPLETED",
      createdAt: now
    };
    try {
      await constructions.setStoredAtomically(
        { construction: stored, expectedVersion: construction.version, tiles: [] },
        record
      );
      return stored;
    } catch (error: unknown) {
      const raced = await idempotency.find(actor.playerId, STORE_CONSTRUCTION_OPERATION, command.requestId);
      if (raced !== null) return this.settledAnswer(farmId, constructionId);
      throw error;
    }
  }

  private async settledAnswer(farmId: FarmId, constructionId: string): Promise<ConstructionInstance> {
    const construction = await this.dependencies.constructions.findById(parseConstructionId(constructionId));
    if (construction === null || construction.farmId !== farmId) {
      throw new ApplicationError("CONSTRUCTION_NOT_FOUND", "The recorded construction no longer exists");
    }
    return construction;
  }
}

/**
 * Taking an object back out of storage, at ground the player has chosen.
 *
 * The destination is checked exactly as a move's is - owned, free, the asset's own terrain - and the
 * row goes back to `ACTIVE` in one statement, so a failed restore leaves it in storage rather than
 * producing a half-placed object. Nothing is charged: the object was already paid for, or never was.
 */
export class RestoreConstruction {
  constructor(private readonly dependencies: ConstructionEditDependencies) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    constructionId: string,
    command: RestoreConstructionCommand
  ): Promise<ConstructionInstance> {
    const { constructions, idempotency, fingerprints, clock } = this.dependencies;
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const payload = [RESTORE_CONSTRUCTION_OPERATION, farmId, constructionId, command.anchorX, command.anchorY, command.rotation, command.expectedVersion];
    const fingerprint = await fingerprints.hash(JSON.stringify(payload));
    const settled = await idempotency.find(actor.playerId, RESTORE_CONSTRUCTION_OPERATION, command.requestId);
    if (settled !== null) {
      if (settled.payloadFingerprint !== fingerprint) {
        throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request id was already used for another payload");
      }
      return this.settledAnswer(farmId, constructionId);
    }

    const { construction, definition } = await loadEditableConstruction(
      this.dependencies,
      actor,
      farmId,
      constructionId
    );
    if (construction.version !== command.expectedVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "That object has changed since you looked at it");
    }
    if (construction.state !== "STORED") {
      throw new ApplicationError("CONSTRUCTION_NOT_STORED", "That object is not in storage");
    }
    const refusal = storageRefusal(definition);
    if (refusal !== null) {
      const mapped = constructionRefusalError(refusal);
      throw new ApplicationError(mapped.code as never, mapped.message);
    }

    const rotation: QuarterTurns = normaliseQuarterTurns(command.rotation);
    const footprint = rotatedFootprint(definition.footprint, rotation);
    const anchor = { x: command.anchorX, y: command.anchorY };
    const { cells, tilesToCreate } = await editGroundCells(
      this.dependencies,
      farmId,
      wantedCells(anchor, footprint)
    );
    // Every *other* active object is an obstacle; a stored one occupies nothing, which the repository's
    // occupancy list already reflects.
    const occupied = await constructions.listBounds(farmId);
    const groundRefusalResult = moveRefusal({ definition, footprint, cells, occupied });
    if (groundRefusalResult !== null) {
      const mapped = constructionRefusalError(groundRefusalResult);
      throw new ApplicationError(mapped.code as never, mapped.message);
    }

    const now = clock.now();
    const restored = restoreConstruction(construction, { anchor, rotation, footprint, updatedAt: now });
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: RESTORE_CONSTRUCTION_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: restored.id,
      responseJson: JSON.stringify({ constructionId: restored.id }),
      status: "COMPLETED",
      createdAt: now
    };
    try {
      await constructions.setStoredAtomically(
        { construction: restored, expectedVersion: construction.version, tiles: tilesToCreate },
        record
      );
      return restored;
    } catch (error: unknown) {
      const raced = await idempotency.find(actor.playerId, RESTORE_CONSTRUCTION_OPERATION, command.requestId);
      if (raced !== null) return this.settledAnswer(farmId, constructionId);
      throw error;
    }
  }

  private async settledAnswer(farmId: FarmId, constructionId: string): Promise<ConstructionInstance> {
    const construction = await this.dependencies.constructions.findById(parseConstructionId(constructionId));
    if (construction === null || construction.farmId !== farmId) {
      throw new ApplicationError("CONSTRUCTION_NOT_FOUND", "The recorded construction no longer exists");
    }
    return construction;
  }
}

