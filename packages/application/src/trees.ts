import {
  assertTilePlantable,
  assertValidCoordinate,
  calculateTreeProduction,
  canHarvestTree,
  createFarmTile,
  createTreeInstance,
  createXpAward,
  DomainError,
  isTreeUnlocked,
  isUsableLand,
  landOriginFor,
  parseItemDefinitionId,
  parseTreeDefinitionId,
  parseTreeInstanceId,
  normaliseQuarterTurns,
  requiredLevelForTree,
  type FarmId,
  type ItemDefinitionId,
  type PlayerId,
  type ProgressionDefinition,
  type TileCoordinate,
  type TreeDefinition,
  type TreeInstance,
  type TreePhase,
  type XpAward
} from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { InventoryService } from "./inventory";
import {
  assertStoredXpAward,
  emptyProgression,
  progressionView,
  storedLevel,
  type XpAwardView
} from "./progression";
import type {
  ActorContext,
  Clock,
  CropInstanceRepository,
  FarmMemberRepository,
  FarmRepository,
  FarmTileRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  InventoryRepository,
  ItemDefinitionRepository,
  PayloadFingerprint,
  PlantBatchReceiptRepository,
  ProgressionRepository,
  TilePlan,
  TileTerrainLookup,
  TreeDefinitionRepository,
  TreeHarvestBatchReceiptRepository,
  TreeHarvestSettlementRepository,
  TreeIdGenerator,
  TreeInstanceRepository
} from "./ports";

const PLANT_TREE_OPERATION = "PLANT_TREE";
const HARVEST_TREE_OPERATION = "HARVEST_TREE";
const HARVEST_TREE_AREA_OPERATION = "HARVEST_TREE_AREA_GROUP";
const REMOVE_TREE_OPERATION = "REMOVE_TREE";
export const MAX_HARVEST_TREE_AREA_GROUP = 25;

/** The area command is deliberately limited to repeating orchard fruit trees. */
const REPEATING_FRUIT_TREE_DEFINITION_IDS = new Set(["tree_apple", "tree_orange", "tree_peach"]);

/**
 * How many times a tree harvest re-reads progression after losing a race before giving up.
 *
 * The same number, and the same reasoning, as harvesting a crop: a lost race rolls the whole
 * settlement back, so retrying re-runs the command against fresh state instead of paying twice.
 */
const PROGRESSION_ATTEMPTS = 8;

export interface PlantTreeCommand extends TileCoordinate {
  readonly treeDefinitionId: string;
  /** The tile version the client read, or absent for a fresh natural-land cell (V14.5.2). */
  readonly expectedTileVersion?: number | undefined;
  readonly requestId: string;
}

/**
 * One tree, in the shape the client needs.
 *
 * Everything except the timestamps and the revision is derived here, from server time, so a client
 * can draw a countdown without ever deciding whether a tree is harvestable.
 */
export interface TreeState {
  readonly treeInstanceId: string;
  readonly definitionId: string;
  readonly tileX: number;
  readonly tileY: number;
  readonly plantedAt: string;
  readonly lastHarvestedAt: string | null;
  readonly readyAt: string | null;
  readonly secondsUntilReady: number;
  readonly ready: boolean;
  readonly phase: TreePhase;
  readonly growthStage: number;
  readonly growthProgress: number;
  readonly version: number;
  readonly storageState: "ACTIVE" | "STORED";
  readonly rotation: 0 | 1 | 2 | 3;
  readonly storedAt: string | null;
  readonly storedRemainingSeconds: number | null;
}

export class TreeStateProjector {
  constructor(
    private readonly definitions: TreeDefinitionRepository,
    private readonly clock: Clock
  ) {}

  project(tree: TreeInstance, serverTime = this.clock.now()): TreeState {
    const definition = this.definitions.findById(tree.treeDefinitionId);
    if (definition === null) {
      throw new ApplicationError("TREE_DEFINITION_NOT_FOUND", "Tree definition was not found");
    }
    // The level requirement gates planting, not reading: a tree already in the ground keeps growing
    // even if a later curve would have locked it.
    const production = calculateTreeProduction(definition, tree, serverTime);
    return {
      treeInstanceId: tree.id,
      definitionId: tree.treeDefinitionId,
      tileX: tree.tileX,
      tileY: tree.tileY,
      plantedAt: tree.plantedAt,
      lastHarvestedAt: tree.lastHarvestedAt,
      readyAt: production.readyAt,
      secondsUntilReady: production.secondsUntilReady,
      ready: production.ready,
      phase: production.phase,
      growthStage: production.stage,
      growthProgress: production.progress,
      version: tree.version,
      storageState: tree.storageState,
      rotation: tree.rotation,
      storedAt: tree.storedAt,
      storedRemainingSeconds: tree.storedRemainingSeconds
    };
  }

  projectMany(trees: readonly TreeInstance[], serverTime = this.clock.now()): readonly TreeState[] {
    return trees.map((tree) => this.project(tree, serverTime));
  }
}

/**
 * Planting a tree, and everything it has to change at once.
 *
 * A tree occupies a tile the same way a crop does, so it checks the same things the crop planting
 * checks and one more: the tile must hold no crop *and* no tree. The sapling comes from the tree
 * definition, never from the command, and exactly one is spent inside the planting transaction.
 */
export interface PlantTreeDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly tiles: FarmTileRepository;
  readonly trees: TreeInstanceRepository;
  readonly crops: CropInstanceRepository;
  readonly inventory: InventoryRepository;
  readonly idempotency: IdempotencyRepository;
  readonly definitions: TreeDefinitionRepository;
  readonly progression: ProgressionRepository;
  readonly progressionDefinition: ProgressionDefinition;
  /** What the ground physically is, from the island's own geography. */
  readonly terrain: TileTerrainLookup;
  readonly inventoryService: InventoryService;
  readonly ids: TreeIdGenerator;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

export class PlantTree {
  constructor(private readonly dependencies: PlantTreeDependencies) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: PlantTreeCommand): Promise<TreeState> {
    const {
      farms,
      members,
      tiles,
      trees,
      crops,
      inventory,
      idempotency,
      definitions,
      progression,
      progressionDefinition,
      terrain,
      inventoryService,
      ids,
      fingerprints,
      clock
    } = this.dependencies;
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");

    const fingerprint = await fingerprints.hash(
      JSON.stringify([
        farmId,
        command.x,
        command.y,
        command.treeDefinitionId,
        command.expectedTileVersion
      ])
    );
    if ((await farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Planting is not allowed");
    }

    const existingRequest = await idempotency.find(actor.playerId, PLANT_TREE_OPERATION, command.requestId);
    if (existingRequest !== null) {
      return this.replay(existingRequest, fingerprint);
    }

    try {
      assertValidCoordinate({ x: command.x, y: command.y });
    } catch (error: unknown) {
      if (error instanceof DomainError) throw new ApplicationError("INVALID_INPUT", error.message);
      throw error;
    }
    // V14.5.2: valid natural Home Island land is free to use, with no ownership row required. The
    // island's classifier says whether the ground is usable; a fresh cell gets its tile row created
    // with the planting.
    const ground = terrain.classify({ x: command.x, y: command.y });
    if (!isUsableLand(landOriginFor(ground))) {
      throw new ApplicationError("TILE_NOT_PLANTABLE", "That ground cannot be planted");
    }
    const tile = await tiles.find(farmId, command.x, command.y);
    if (tile !== null) {
      try {
        assertTilePlantable(tile);
      } catch {
        throw new ApplicationError("TILE_NOT_PLANTABLE", "Tile is not plantable");
      }
      if (command.expectedTileVersion === undefined || tile.version !== command.expectedTileVersion) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Tile version does not match");
      }
    } else if (command.expectedTileVersion !== undefined) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Tile state changed");
    }
    // Both occupants are checked before anything is written, and the database enforces the same
    // rule across both tables, so a concurrent planting of the other kind cannot slip between them.
    if ((await crops.findAtTile(farmId, command.x, command.y)) !== null) {
      throw new ApplicationError("TILE_OCCUPIED", "Tile already has a crop");
    }
    if ((await trees.findAtTile(farmId, command.x, command.y)) !== null) {
      throw new ApplicationError("TILE_OCCUPIED", "Tile already has a tree");
    }

    let definitionId: TreeDefinition["id"];
    try {
      definitionId = parseTreeDefinitionId(command.treeDefinitionId);
    } catch {
      throw new ApplicationError("TREE_DEFINITION_NOT_FOUND", "Tree definition was not found");
    }
    const definition = definitions.findById(definitionId);
    if (definition === null) {
      throw new ApplicationError("TREE_DEFINITION_NOT_FOUND", "Tree definition was not found");
    }
    // Game data is a module constant for the life of a deployment, so the requirement read here is
    // the one this Worker enforces. The level comes from the same authoritative row the harvest
    // writes, derived from experience rather than from the cached column.
    const level = storedLevel(progressionDefinition, await progression.find(actor.playerId));
    if (!isTreeUnlocked(definition, level)) {
      throw new ApplicationError(
        "TREE_LEVEL_REQUIRED",
        `Tree ${definition.id} requires level ${String(requiredLevelForTree(definition))}; player is level ${String(level)}`
      );
    }

    const sapling = await inventory.find(actor.playerId, definition.saplingItemDefinitionId);
    if (sapling === null || sapling.quantity < 1) {
      throw new ApplicationError("INSUFFICIENT_ITEMS", "Planting requires a sapling for this tree");
    }
    const saplingRemoval = inventoryService.prepareRemoval(
      actor.playerId,
      definition.saplingItemDefinitionId,
      1
    );

    const now = clock.now();
    const tilePlan: TilePlan =
      tile === null
        ? { kind: "CREATE", tile: createFarmTile(farmId, { x: command.x, y: command.y }, "SOIL", now) }
        : { kind: "EXISTING", version: tile.version };
    const tree = createTreeInstance(
      ids.newTreeInstanceId(),
      farmId,
      command.x,
      command.y,
      definition.id,
      actor.playerId,
      now
    );
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: PLANT_TREE_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: tree.id,
      responseJson: JSON.stringify({ treeInstanceId: tree.id }),
      status: "COMPLETED",
      createdAt: now
    };

    try {
      await trees.plantAtomically(tree, tilePlan, saplingRemoval, sapling, record);
      return new TreeStateProjector(definitions, clock).project(tree, now);
    } catch (error: unknown) {
      const racedRequest = await idempotency.find(actor.playerId, PLANT_TREE_OPERATION, command.requestId);
      if (racedRequest !== null) return this.replay(racedRequest, fingerprint);
      if ((await crops.findAtTile(farmId, command.x, command.y)) !== null) {
        throw new ApplicationError("TILE_OCCUPIED", "Tile already has a crop");
      }
      if ((await trees.findAtTile(farmId, command.x, command.y)) !== null) {
        throw new ApplicationError("TILE_OCCUPIED", "Tile already has a tree");
      }
      const currentTile = await tiles.find(farmId, command.x, command.y);
      if (currentTile !== null) {
        if (currentTile.terrainType !== "SOIL") {
          throw new ApplicationError("TILE_NOT_PLANTABLE", "Tile is not plantable");
        }
        if (tilePlan.kind === "EXISTING" && currentTile.version !== tilePlan.version) {
          throw new ApplicationError("CONFLICT_STALE_STATE", "Tile version does not match");
        }
      }
      // The batch rolls back as one unit, so a lost race leaves the sapling exactly where it was.
      const currentSapling = await inventory.find(actor.playerId, definition.saplingItemDefinitionId);
      if (currentSapling === null || currentSapling.quantity < 1) {
        throw new ApplicationError("INSUFFICIENT_ITEMS", "Planting requires a sapling for this tree");
      }
      if (currentSapling.version !== sapling.version) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Inventory changed concurrently");
      }
      throw error;
    }
  }

  private async replay(record: IdempotencyRecord, fingerprint: string): Promise<TreeState> {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    const tree = await this.dependencies.trees.findById(parseTreeInstanceId(record.resourceId));
    if (tree === null) throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    return new TreeStateProjector(this.dependencies.definitions, this.dependencies.clock).project(tree);
  }
}

export interface PlantTreeAreaCell extends TileCoordinate {
  readonly expectedTileVersion?: number | undefined;
}

export interface PlantTreeAreaGroupCommand {
  readonly requestId: string;
  readonly treeDefinitionId: string;
  readonly cells: readonly PlantTreeAreaCell[];
}

export type PlantTreeAreaSkipReason = "OCCUPIED" | "NOT_PLANTABLE" | "STALE" | "NO_SEEDS" | "LEVEL" | "NOT_FOUND";

export interface PlantTreeAreaCellResult {
  readonly x: number;
  readonly y: number;
  readonly status: "PLANTED" | "SKIPPED";
  readonly treeInstanceId: string | null;
  readonly reason: PlantTreeAreaSkipReason | null;
}

export interface PlantTreeAreaGroupResult {
  readonly results: readonly PlantTreeAreaCellResult[];
  readonly plantedCount: number;
  readonly skippedCount: number;
}

export const MAX_PLANT_TREE_AREA_GROUP = 25;
const PLANT_TREE_AREA_OPERATION = "PLANT_TREE_AREA_GROUP";

/** Bounded tree planting that delegates each cell to the existing authoritative PlantTree command. */
export class PlantTreeAreaGroup {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly plantTree: PlantTree,
    private readonly receipts: PlantBatchReceiptRepository,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId, command: PlantTreeAreaGroupCommand): Promise<PlantTreeAreaGroupResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if (command.cells.length === 0 || command.cells.length > MAX_PLANT_TREE_AREA_GROUP) {
      throw new ApplicationError("INVALID_INPUT", "The planting group size is invalid");
    }
    if ((await this.farms.findById(farmId)) === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") throw new ApplicationError("NOT_AUTHORIZED", "Planting is not allowed");
    const keys = command.cells.map((cell) => `${String(cell.x)},${String(cell.y)}`);
    if (new Set(keys).size !== keys.length) throw new ApplicationError("INVALID_INPUT", "A planting group cannot contain a duplicate cell");
    const fingerprint = await this.fingerprints.hash(JSON.stringify([
      farmId,
      command.treeDefinitionId,
      command.cells.map((cell) => [cell.x, cell.y, cell.expectedTileVersion])
    ]));
    const existing = await this.receipts.find(actor.playerId, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const results: PlantTreeAreaCellResult[] = [];
    for (let index = 0; index < command.cells.length; index += 1) {
      const cell = command.cells[index];
      if (cell === undefined) continue;
      try {
        const planted = await this.plantTree.execute(actor, farmId, {
          treeDefinitionId: command.treeDefinitionId,
          x: cell.x,
          y: cell.y,
          ...(cell.expectedTileVersion === undefined ? {} : { expectedTileVersion: cell.expectedTileVersion }),
          requestId: await this.derivedRequestId(command.requestId, index)
        });
        results.push({ x: cell.x, y: cell.y, status: "PLANTED", treeInstanceId: planted.treeInstanceId, reason: null });
      } catch (error: unknown) {
        const reason = plantingTreeSkipReason(error);
        if (reason === null) throw error;
        results.push({ x: cell.x, y: cell.y, status: "SKIPPED", treeInstanceId: null, reason });
      }
    }
    const response = {
      results,
      plantedCount: results.filter((result) => result.status === "PLANTED").length,
      skippedCount: results.filter((result) => result.status === "SKIPPED").length
    } satisfies PlantTreeAreaGroupResult;
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: PLANT_TREE_AREA_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: String(farmId),
      responseJson: JSON.stringify(response),
      status: "COMPLETED",
      createdAt: this.clock.now()
    };
    if (await this.receipts.save(record)) return response;
    const raced = await this.receipts.find(actor.playerId, command.requestId);
    if (raced !== null) return this.replay(raced, fingerprint);
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "The planting group could not be recorded");
  }

  private async derivedRequestId(groupRequestId: string, index: number): Promise<string> {
    const digest = await this.fingerprints.hash(`${groupRequestId}:${String(index)}`);
    return `tree-plant-area-${digest.slice(0, 70)}`;
  }

  private replay(record: IdempotencyRecord, fingerprint: string): PlantTreeAreaGroupResult {
    if (record.payloadFingerprint !== fingerprint) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    try {
      const value = JSON.parse(record.responseJson) as PlantTreeAreaGroupResult;
      if (!Array.isArray(value.results) || !Number.isSafeInteger(value.plantedCount) || !Number.isSafeInteger(value.skippedCount)) throw new Error("invalid stored result");
      return value;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored planting group result is unavailable");
    }
  }
}

function plantingTreeSkipReason(error: unknown): PlantTreeAreaSkipReason | null {
  if (!(error instanceof ApplicationError)) return null;
  switch (error.code) {
    case "TILE_OCCUPIED": return "OCCUPIED";
    case "TILE_NOT_PLANTABLE": return "NOT_PLANTABLE";
    case "CONFLICT_STALE_STATE": return "STALE";
    case "INSUFFICIENT_ITEMS": return "NO_SEEDS";
    case "TREE_LEVEL_REQUIRED": return "LEVEL";
    case "TREE_DEFINITION_NOT_FOUND": return "NOT_FOUND";
    default: return null;
  }
}

export interface HarvestTreeCommand {
  readonly treeInstanceId: string;
  readonly expectedTreeVersion: number;
  readonly requestId: string;
}

/** What one harvest cycle produced, without the experience it earned. */
export interface TreeHarvestResult {
  readonly treeInstanceId: string;
  readonly itemDefinitionId: string;
  readonly quantityAdded: number;
}

/** The whole stored command result: also the replay payload and the API response body. */
export interface HarvestTreeResult {
  readonly harvest: TreeHarvestResult;
  readonly progression: XpAwardView;
}

/**
 * Harvesting one cycle of a tree.
 *
 * The difference from a crop harvest is the whole point of the feature and is confined to two
 * places: the tree is not removed, and the revision that identifies the cycle advances, so the *next*
 * cycle is a different revision and can be harvested again. Everything else — the server-time
 * readiness check, the award computed from the progression row, the retry on a lost race, the
 * inventory capacity check, the stored receipt that makes a replay return the original answer — is
 * the crop harvest's shape, because a repeating cycle is still one authoritative reward per cycle.
 */
export class HarvestTree {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly trees: TreeInstanceRepository,
    private readonly inventory: InventoryRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly settlement: TreeHarvestSettlementRepository,
    private readonly definitions: TreeDefinitionRepository,
    private readonly inventoryService: InventoryService,
    private readonly progression: ProgressionRepository,
    private readonly progressionDefinition: ProgressionDefinition,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: HarvestTreeCommand
  ): Promise<HarvestTreeResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let treeId;
    try {
      treeId = parseTreeInstanceId(command.treeInstanceId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Tree instance ID is invalid");
    }
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([farmId, treeId, command.expectedTreeVersion])
    );

    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Harvesting is not allowed");
    }

    const existing = await this.idempotency.find(actor.playerId, HARVEST_TREE_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const tree = await this.trees.findById(treeId);
    if (tree === null || tree.farmId !== farmId) {
      throw new ApplicationError("TREE_NOT_FOUND", "Tree was not found");
    }
    if (tree.version !== command.expectedTreeVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Tree version does not match");
    }
    const definition = this.definitions.findById(tree.treeDefinitionId);
    if (definition === null) {
      throw new ApplicationError("TREE_DEFINITION_NOT_FOUND", "Tree definition was not found");
    }
    // Readiness is the server's answer, from its own clock and the tree's timestamps. A client that
    // believes a tree is ready has no way to say so here.
    if (!canHarvestTree(tree, definition, this.clock.now())) {
      throw new ApplicationError("TREE_NOT_READY", "Tree is not ready to harvest");
    }
    const addition = this.inventoryService.prepareAddition(
      actor.playerId,
      definition.harvest.itemDefinitionId,
      definition.harvest.baseQuantity
    );
    await this.assertCapacity(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.maxQuantity);

    const harvest: TreeHarvestResult = {
      treeInstanceId: tree.id,
      itemDefinitionId: addition.itemDefinitionId,
      quantityAdded: addition.quantity
    };

    for (let attempt = 0; attempt < PROGRESSION_ATTEMPTS; attempt += 1) {
      const stored = await this.progression.find(actor.playerId);
      const current = stored ?? emptyProgression(actor.playerId, this.clock.now());
      let award: XpAward;
      try {
        award = createXpAward(this.progressionDefinition, current, definition.harvest.xp, this.clock.now());
      } catch {
        throw new ApplicationError("INTERNAL_ERROR", "Stored player progression is invalid");
      }
      const result: HarvestTreeResult = {
        harvest,
        progression: {
          xpAwarded: award.xpAwarded,
          leveledUp: award.leveledUp,
          progression: progressionView(this.progressionDefinition, award.xpAfter)
        }
      };
      const record: IdempotencyRecord = {
        actorPlayerId: actor.playerId,
        operation: HARVEST_TREE_OPERATION,
        requestId: command.requestId,
        payloadFingerprint: fingerprint,
        resourceId: tree.id,
        responseJson: JSON.stringify(result),
        status: "COMPLETED",
        createdAt: this.clock.now()
      };

      try {
        await this.settlement.settleTreeHarvestAtomically(tree, addition, award, record);
        return result;
      } catch (error: unknown) {
        if (error instanceof ApplicationError && error.code === "PROGRESSION_CONFLICT") continue;
        const raced = await this.idempotency.find(actor.playerId, HARVEST_TREE_OPERATION, command.requestId);
        if (raced !== null) return this.replay(raced, fingerprint);
        const currentTree = await this.trees.findById(treeId);
        if (currentTree === null) {
          throw new ApplicationError("TREE_NOT_FOUND", "Tree was not found");
        }
        // The revision moved under this caller, which means this cycle was settled by someone else:
        // the tree now regrows, so the honest stable answer is that it is not ready.
        if (currentTree.version !== command.expectedTreeVersion) {
          throw new ApplicationError("TREE_NOT_READY", "Tree cycle was already harvested");
        }
        await this.assertCapacity(addition.playerId, addition.itemDefinitionId, addition.quantity, addition.maxQuantity);
        throw error;
      }
    }
    throw new ApplicationError("PROGRESSION_CONFLICT", "Player progression changed concurrently");
  }

  private async assertCapacity(
    playerId: PlayerId,
    itemId: ItemDefinitionId,
    delta: number,
    maximum: number
  ): Promise<void> {
    const current = await this.inventory.find(playerId, itemId);
    if (current !== null && current.quantity > maximum - delta) {
      throw new ApplicationError("INVENTORY_LIMIT_EXCEEDED", "Inventory limit would be exceeded");
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): HarvestTreeResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      const harvest = value.harvest;
      if (typeof harvest !== "object" || harvest === null) throw new Error("invalid stored result");
      const fields = harvest as Record<string, unknown>;
      if (
        fields.treeInstanceId !== record.resourceId ||
        typeof fields.treeInstanceId !== "string" ||
        typeof fields.itemDefinitionId !== "string" ||
        !Number.isSafeInteger(fields.quantityAdded) ||
        (fields.quantityAdded as number) <= 0
      ) {
        throw new Error("invalid stored result");
      }
      parseTreeInstanceId(fields.treeInstanceId);
      parseItemDefinitionId(fields.itemDefinitionId);
      assertStoredXpAward(value.progression);
      return value as unknown as HarvestTreeResult;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}

export interface HarvestTreeAreaGroupCommand {
  readonly requestId: string;
  readonly trees: readonly HarvestTreeAreaCandidate[];
}

export interface HarvestTreeAreaCandidate {
  readonly treeInstanceId: string;
  readonly expectedTreeVersion: number;
}

export type HarvestTreeAreaSkipReason =
  | "NOT_READY"
  | "NOT_REPEATABLE"
  | "INVENTORY_FULL"
  | "WAREHOUSE_FULL"
  | "STALE"
  | "NOT_OWNED"
  | "NOT_FOUND"
  | "NOT_ACTIVE";

export interface HarvestTreeAreaTreeResult {
  readonly treeInstanceId: string;
  readonly status: "HARVESTED" | "SKIPPED";
  readonly itemDefinitionId: string | null;
  readonly quantityAdded: number;
  readonly reason: HarvestTreeAreaSkipReason | null;
}

export interface HarvestTreeAreaGroupResult {
  readonly results: readonly HarvestTreeAreaTreeResult[];
  readonly harvestedCount: number;
  readonly skippedCount: number;
  readonly products: readonly { readonly itemDefinitionId: string; readonly quantity: number }[];
}

/**
 * Bounded estate-management harvest orchestration.
 *
 * This is intentionally a group of the existing one-tree settlement, not a second reward path. Each
 * tree is re-read and settled with its own derived idempotency key, so a lost response can retry a
 * partially completed group without paying a cycle twice. The group receipt is only a replay envelope;
 * it never grants inventory by itself. This route is the explicit Toàn cảnh management contract: it
 * has no player position input and never treats client coordinates as proof of proximity. The server
 * owns the work boundary (25 trees), readiness, ownership, versions and every settlement. Character
 * range remains a separate single-tree interaction contract.
 */
export class HarvestTreeAreaGroup {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly trees: TreeInstanceRepository,
    private readonly definitions: TreeDefinitionRepository,
    private readonly harvestTree: HarvestTree,
    private readonly receipts: TreeHarvestBatchReceiptRepository,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: HarvestTreeAreaGroupCommand
  ): Promise<HarvestTreeAreaGroupResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if (command.trees.length === 0 || command.trees.length > MAX_HARVEST_TREE_AREA_GROUP) {
      throw new ApplicationError("INVALID_INPUT", "The harvest group size is invalid");
    }
    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Harvesting is not allowed");
    }
    const parsedCandidates = command.trees.map((candidate) => {
      try {
        return {
          treeInstanceId: parseTreeInstanceId(candidate.treeInstanceId),
          expectedTreeVersion: candidate.expectedTreeVersion
        };
      } catch {
        throw new ApplicationError("INVALID_INPUT", "Tree instance ID is invalid");
      }
    });
    if (new Set(parsedCandidates.map((candidate) => candidate.treeInstanceId)).size !== parsedCandidates.length) {
      throw new ApplicationError("INVALID_INPUT", "A harvest group cannot contain a duplicate tree");
    }

    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([farmId, parsedCandidates.map((candidate) => [candidate.treeInstanceId, candidate.expectedTreeVersion])])
    );
    const existing = await this.receipts.find(actor.playerId, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const results: HarvestTreeAreaTreeResult[] = [];
    for (let index = 0; index < parsedCandidates.length; index += 1) {
      const candidate = parsedCandidates[index];
      if (candidate === undefined) continue;
      const tree = await this.trees.findById(candidate.treeInstanceId);
      const definition = tree === null ? null : this.definitions.findById(tree.treeDefinitionId);
      if (
        tree !== null &&
        tree.farmId === farmId &&
        (definition === null || !REPEATING_FRUIT_TREE_DEFINITION_IDS.has(tree.treeDefinitionId))
      ) {
        results.push({
          treeInstanceId: candidate.treeInstanceId,
          status: "SKIPPED",
          itemDefinitionId: null,
          quantityAdded: 0,
          reason: "NOT_REPEATABLE"
        });
        continue;
      }

      try {
        const result = await this.harvestTree.execute(actor, farmId, {
          treeInstanceId: candidate.treeInstanceId,
          expectedTreeVersion: candidate.expectedTreeVersion,
          requestId: await this.derivedRequestId(command.requestId, index)
        });
        results.push({
          treeInstanceId: result.harvest.treeInstanceId,
          status: "HARVESTED",
          itemDefinitionId: result.harvest.itemDefinitionId,
          quantityAdded: result.harvest.quantityAdded,
          reason: null
        });
      } catch (error: unknown) {
        const reason = batchSkipReason(error);
        if (reason === null) throw error;
        results.push({
          treeInstanceId: candidate.treeInstanceId,
          status: "SKIPPED",
          itemDefinitionId: null,
          quantityAdded: 0,
          reason
        });
      }
    }

    const products = new Map<string, number>();
    for (const result of results) {
      if (result.itemDefinitionId === null) continue;
      products.set(result.itemDefinitionId, (products.get(result.itemDefinitionId) ?? 0) + result.quantityAdded);
    }
    const response: HarvestTreeAreaGroupResult = {
      results,
      harvestedCount: results.filter((result) => result.status === "HARVESTED").length,
      skippedCount: results.filter((result) => result.status === "SKIPPED").length,
      products: [...products.entries()].map(([itemDefinitionId, quantity]) => ({ itemDefinitionId, quantity }))
    };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: HARVEST_TREE_AREA_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: String(farmId),
      responseJson: JSON.stringify(response),
      status: "COMPLETED",
      createdAt: this.clock.now()
    };
    if (await this.receipts.save(record)) return response;
    const raced = await this.receipts.find(actor.playerId, command.requestId);
    if (raced !== null) return this.replay(raced, fingerprint);
    throw new ApplicationError("IDEMPOTENCY_CONFLICT", "The harvest group could not be recorded");
  }

  private async derivedRequestId(groupRequestId: string, index: number): Promise<string> {
    const digest = await this.fingerprints.hash(`${groupRequestId}:${String(index)}`);
    return `tree-area-${digest.slice(0, 72)}`;
  }

  private replay(record: IdempotencyRecord, fingerprint: string): HarvestTreeAreaGroupResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as HarvestTreeAreaGroupResult;
      if (!Array.isArray(value.results) || !Number.isSafeInteger(value.harvestedCount) || !Number.isSafeInteger(value.skippedCount) || !Array.isArray(value.products)) {
        throw new Error("invalid stored result");
      }
      return value;
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored harvest group result is unavailable");
    }
  }
}

function batchSkipReason(error: unknown): HarvestTreeAreaSkipReason | null {
  if (!(error instanceof ApplicationError)) return null;
  switch (error.code) {
    case "TREE_NOT_READY": return "NOT_READY";
    case "CONFLICT_STALE_STATE": return "STALE";
    case "INVENTORY_LIMIT_EXCEEDED": return "INVENTORY_FULL";
    case "WAREHOUSE_FULL": return "WAREHOUSE_FULL";
    case "NOT_AUTHORIZED": return "NOT_OWNED";
    case "TREE_NOT_FOUND": return "NOT_FOUND";
    case "TREE_NOT_ACTIVE":
    case "TREE_NOT_STORED": return "NOT_ACTIVE";
    default: return null;
  }
}

export interface RemoveTreeCommand {
  readonly treeInstanceId: string;
  readonly expectedTreeVersion: number;
  readonly requestId: string;
}

/** What removing a tree removed. There is no reward field, because there is no reward. */
export interface RemoveTreeResult {
  readonly treeInstanceId: string;
}

/**
 * Removes a tree the player no longer wants, freeing the tile.
 *
 * Deliberately the same shape as uprooting a crop: no reward, no refund, no experience, and the tree
 * is simply gone. Authorization is rechecked before the stored result of a replay is returned, so a
 * member whose access was revoked cannot read back an old removal.
 */
export class RemoveTree {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly trees: TreeInstanceRepository,
    private readonly idempotency: IdempotencyRepository,
    private readonly fingerprints: PayloadFingerprint,
    private readonly clock: Clock
  ) {}

  async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    command: RemoveTreeCommand
  ): Promise<RemoveTreeResult> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let treeId;
    try {
      treeId = parseTreeInstanceId(command.treeInstanceId);
    } catch {
      throw new ApplicationError("INVALID_INPUT", "Tree instance ID is invalid");
    }
    const fingerprint = await this.fingerprints.hash(
      JSON.stringify([farmId, treeId, command.expectedTreeVersion])
    );

    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") {
      throw new ApplicationError("NOT_AUTHORIZED", "Removing a tree is not allowed");
    }

    const existing = await this.idempotency.find(actor.playerId, REMOVE_TREE_OPERATION, command.requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const tree = await this.trees.findById(treeId);
    // A tree in another farm is not this farm's tree: the route names a farm, and the row has to
    // agree with it before anything is deleted.
    if (tree === null || tree.farmId !== farmId) {
      throw new ApplicationError("TREE_NOT_FOUND", "Tree was not found");
    }
    if (tree.version !== command.expectedTreeVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Tree version does not match");
    }

    const result: RemoveTreeResult = { treeInstanceId: tree.id };
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation: REMOVE_TREE_OPERATION,
      requestId: command.requestId,
      payloadFingerprint: fingerprint,
      resourceId: tree.id,
      responseJson: JSON.stringify(result),
      status: "COMPLETED",
      createdAt: this.clock.now()
    };

    try {
      await this.trees.removeAtomically(tree, command.expectedTreeVersion, record);
      return result;
    } catch (error: unknown) {
      const raced = await this.idempotency.find(actor.playerId, REMOVE_TREE_OPERATION, command.requestId);
      if (raced !== null) return this.replay(raced, fingerprint);
      const current = await this.trees.findById(treeId);
      if (current === null) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Tree changed concurrently");
      }
      if (current.version !== command.expectedTreeVersion) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Tree version does not match");
      }
      throw error;
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): RemoveTreeResult {
    if (record.payloadFingerprint !== fingerprint) {
      throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    }
    try {
      const value = JSON.parse(record.responseJson) as Record<string, unknown>;
      if (value.treeInstanceId !== record.resourceId || typeof value.treeInstanceId !== "string") {
        throw new Error("invalid stored result");
      }
      parseTreeInstanceId(value.treeInstanceId);
      return { treeInstanceId: value.treeInstanceId };
    } catch {
      throw new ApplicationError("INTERNAL_ERROR", "Stored command result is unavailable");
    }
  }
}

export const MOVE_TREE_OPERATION = "MOVE_TREE";
export const ROTATE_TREE_OPERATION = "ROTATE_TREE";
export const STORE_TREE_OPERATION = "STORE_TREE";
export const RESTORE_TREE_OPERATION = "RESTORE_TREE";

export interface TreeMoveCommand {
  readonly treeInstanceId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly expectedTileVersion?: number | undefined;
  readonly expectedTreeVersion: number;
  readonly requestId: string;
}

export interface TreeRotateCommand {
  readonly treeInstanceId: string;
  readonly rotation: number;
  readonly expectedTreeVersion: number;
  readonly requestId: string;
}

export interface TreeStoreCommand {
  readonly treeInstanceId: string;
  readonly expectedTreeVersion: number;
  readonly requestId: string;
}

export interface TreeRestoreCommand {
  readonly treeInstanceId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly expectedTileVersion?: number | undefined;
  readonly expectedTreeVersion: number;
  readonly requestId: string;
}

export interface TreeManagementDependencies {
  readonly farms: FarmRepository;
  readonly members: FarmMemberRepository;
  readonly tiles: FarmTileRepository;
  readonly trees: TreeInstanceRepository;
  readonly crops: CropInstanceRepository;
  readonly constructions: { listBounds(farmId: FarmId): Promise<readonly { readonly minX: number; readonly maxX: number; readonly minY: number; readonly maxY: number }[]> };
  readonly terrain: TileTerrainLookup;
  readonly definitions: TreeDefinitionRepository;
  readonly idempotency: IdempotencyRepository;
  readonly fingerprints: PayloadFingerprint;
  readonly clock: Clock;
}

/**
 * Management is deliberately separate from forestry CHOP. It only changes the tree row and its
 * occupancy; it never touches saplings, wood, Warehouse, or economy state.
 */
export class ManageTree {
  constructor(private readonly dependencies: TreeManagementDependencies) {}

  move(actor: ActorContext | null, farmId: FarmId, command: TreeMoveCommand): Promise<TreeState> {
    return this.execute(actor, farmId, MOVE_TREE_OPERATION, command.treeInstanceId, command.expectedTreeVersion, command.requestId, {
      kind: "MOVE", x: command.x, y: command.y, rotation: command.rotation, expectedTileVersion: command.expectedTileVersion
    });
  }

  rotate(actor: ActorContext | null, farmId: FarmId, command: TreeRotateCommand): Promise<TreeState> {
    return this.execute(actor, farmId, ROTATE_TREE_OPERATION, command.treeInstanceId, command.expectedTreeVersion, command.requestId, {
      kind: "ROTATE", rotation: command.rotation
    });
  }

  store(actor: ActorContext | null, farmId: FarmId, command: TreeStoreCommand): Promise<TreeState> {
    return this.execute(actor, farmId, STORE_TREE_OPERATION, command.treeInstanceId, command.expectedTreeVersion, command.requestId, {
      kind: "STORE"
    });
  }

  restore(actor: ActorContext | null, farmId: FarmId, command: TreeRestoreCommand): Promise<TreeState> {
    return this.execute(actor, farmId, RESTORE_TREE_OPERATION, command.treeInstanceId, command.expectedTreeVersion, command.requestId, {
      kind: "RESTORE", x: command.x, y: command.y, rotation: command.rotation, expectedTileVersion: command.expectedTileVersion
    });
  }

  private async execute(
    actor: ActorContext | null,
    farmId: FarmId,
    operation: string,
    treeInstanceId: string,
    expectedTreeVersion: number,
    requestId: string,
    input: {
      readonly kind: "MOVE" | "ROTATE" | "STORE" | "RESTORE";
      readonly x?: number;
      readonly y?: number;
      readonly rotation?: number;
      readonly expectedTileVersion?: number | undefined;
    }
  ): Promise<TreeState> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    let treeId: ReturnType<typeof parseTreeInstanceId>;
    try { treeId = parseTreeInstanceId(treeInstanceId); } catch { throw new ApplicationError("INVALID_INPUT", "Tree instance ID is invalid"); }
    if ((await this.dependencies.farms.findById(farmId)) === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    const membership = await this.dependencies.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership?.role !== "OWNER") throw new ApplicationError("NOT_AUTHORIZED", "Tree management is not allowed");

    const fingerprint = await this.dependencies.fingerprints.hash(JSON.stringify([
      operation, farmId, treeId, input.x, input.y, input.rotation, input.expectedTileVersion, expectedTreeVersion
    ]));
    const existing = await this.dependencies.idempotency.find(actor.playerId, operation, requestId);
    if (existing !== null) return this.replay(existing, fingerprint);

    const current = await this.dependencies.trees.findById(treeId);
    if (current === null || current.farmId !== farmId) throw new ApplicationError("TREE_NOT_FOUND", "Tree was not found");
    if (current.plantedByPlayerId !== actor.playerId) throw new ApplicationError("OBJECT_NOT_OWNED", "That tree belongs to another player");
    if (current.version !== expectedTreeVersion) throw new ApplicationError("CONFLICT_STALE_STATE", "Tree version does not match");
    if (input.kind !== "RESTORE") {
      const lifecycleDefinition = this.dependencies.definitions.findById(current.treeDefinitionId);
      if (lifecycleDefinition !== null && calculateTreeProduction(lifecycleDefinition, current, this.dependencies.clock.now()).phase === "DEPLETED") {
        throw new ApplicationError("TREE_NOT_ACTIVE", "A chopped tree must be cleared before it can be managed");
      }
    }
    if (input.kind === "MOVE" || input.kind === "STORE") {
      if (current.storageState !== "ACTIVE") throw new ApplicationError("TREE_NOT_ACTIVE", "The tree is already in storage");
    }
    if (input.kind === "RESTORE" && current.storageState !== "STORED") {
      throw new ApplicationError("TREE_NOT_STORED", "The tree is not in storage");
    }

    let next = current;
    let tile: TilePlan | null = null;
    const now = this.dependencies.clock.now();
    if (input.kind === "MOVE" || input.kind === "RESTORE") {
      const x = input.x as number;
      const y = input.y as number;
      await this.assertDestination(farmId, current, x, y, input.expectedTileVersion);
      const targetTile = await this.dependencies.tiles.find(farmId, x, y);
      tile = targetTile === null
        ? { kind: "CREATE", tile: createFarmTile(farmId, { x, y }, "SOIL", now) }
        : { kind: "EXISTING", version: targetTile.version };
      const rotation = normaliseQuarterTurns(input.rotation as number);
      next = { ...current, tileX: x, tileY: y, rotation, storageState: "ACTIVE", storedAt: null, version: current.version + 1, updatedAt: now };
      if (input.kind === "RESTORE" && current.storedRemainingSeconds !== null) {
        const definition = this.dependencies.definitions.findById(current.treeDefinitionId);
        if (definition === null) throw new ApplicationError("TREE_DEFINITION_NOT_FOUND", "Tree definition was not found");
        const cycleSeconds = current.lastHarvestedAt === null ? definition.firstReadySeconds : definition.regrowSeconds;
        const elapsedSeconds = Math.max(0, cycleSeconds - current.storedRemainingSeconds);
        const resumedAt = new Date(Date.parse(now) - elapsedSeconds * 1000).toISOString();
        next = current.lastHarvestedAt === null
          ? { ...next, plantedAt: resumedAt, storedRemainingSeconds: null }
          : { ...next, lastHarvestedAt: resumedAt, storedRemainingSeconds: null };
      } else {
        next = { ...next, storedRemainingSeconds: null };
      }
    } else if (input.kind === "ROTATE") {
      next = { ...current, rotation: normaliseQuarterTurns(input.rotation as number), version: current.version + 1, updatedAt: now };
    } else {
      const definition = this.dependencies.definitions.findById(current.treeDefinitionId);
      if (definition === null) throw new ApplicationError("TREE_DEFINITION_NOT_FOUND", "Tree definition was not found");
      const production = calculateTreeProduction(definition, current, now);
      if (production.phase === "DEPLETED") throw new ApplicationError("TREE_NOT_ACTIVE", "A chopped tree must be cleared before planting again");
      next = {
        ...current,
        storageState: "STORED",
        storedAt: now,
        storedRemainingSeconds: production.ready ? null : production.secondsUntilReady,
        version: current.version + 1,
        updatedAt: now
      };
    }

    const result = new TreeStateProjector(this.dependencies.definitions, this.dependencies.clock).project(next, now);
    const record: IdempotencyRecord = {
      actorPlayerId: actor.playerId,
      operation,
      requestId,
      payloadFingerprint: fingerprint,
      resourceId: next.id,
      responseJson: JSON.stringify(result),
      status: "COMPLETED",
      createdAt: now
    };
    try {
      await this.dependencies.trees.manageAtomically(next, current.version, tile, record);
      return result;
    } catch (error: unknown) {
      const raced = await this.dependencies.idempotency.find(actor.playerId, operation, requestId);
      if (raced !== null) return this.replay(raced, fingerprint);
      throw error;
    }
  }

  private async assertDestination(
    farmId: FarmId,
    current: TreeInstance,
    x: number,
    y: number,
    expectedTileVersion: number | undefined
  ): Promise<void> {
    try { assertValidCoordinate({ x, y }); } catch { throw new ApplicationError("INVALID_INPUT", "Tree destination is invalid"); }
    if (!isUsableLand(landOriginFor(this.dependencies.terrain.classify({ x, y })))) {
      throw new ApplicationError("TILE_NOT_PLANTABLE", "That ground cannot hold a tree");
    }
    const tile = await this.dependencies.tiles.find(farmId, x, y);
    if (tile !== null) {
      try { assertTilePlantable(tile); } catch { throw new ApplicationError("TILE_NOT_PLANTABLE", "That tile cannot hold a tree"); }
      if (expectedTileVersion !== undefined && tile.version !== expectedTileVersion) throw new ApplicationError("CONFLICT_STALE_STATE", "Tile version does not match");
    } else if (expectedTileVersion !== undefined) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Tile state changed");
    }
    const crop = await this.dependencies.crops.findAtTile(farmId, x, y);
    if (crop !== null) throw new ApplicationError("TILE_OCCUPIED", "Tile already has a crop");
    const tree = await this.dependencies.trees.findAtTile(farmId, x, y);
    if (tree !== null && tree.id !== current.id) throw new ApplicationError("TILE_OCCUPIED", "Tile already has a tree");
    const occupied = await this.dependencies.constructions.listBounds(farmId);
    if (occupied.some((bounds) => x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY)) {
      throw new ApplicationError("TILE_OCCUPIED", "Tile already has a construction");
    }
  }

  private replay(record: IdempotencyRecord, fingerprint: string): TreeState {
    if (record.payloadFingerprint !== fingerprint) throw new ApplicationError("IDEMPOTENCY_CONFLICT", "Request ID was used with a different payload");
    try {
      const value = JSON.parse(record.responseJson) as TreeState;
      if (value.treeInstanceId !== record.resourceId) throw new Error("invalid tree receipt");
      return value;
    } catch { throw new ApplicationError("INTERNAL_ERROR", "Stored tree management result is unavailable"); }
  }
}

/** One tree, in the shape the client needs to offer it as a planting choice. */
export interface TreeDefinitionView {
  readonly treeDefinitionId: string;
  readonly displayNameKey: string;
  readonly saplingItemDefinitionId: string;
  readonly saplingItemDisplayNameKey: string;
  readonly firstReadySeconds: number;
  readonly regrowSeconds: number;
  readonly growthStages: number;
  readonly harvestItemDefinitionId: string;
  readonly baseQuantity: number;
  readonly harvestXp: number;
  readonly requiredLevel: number;
}

/**
 * The tree catalogue.
 *
 * Reads are never gated by level and never filtered: a tree the player has not unlocked is still
 * listed, with the level it needs, so the client can show what to work towards instead of hiding it.
 */
export class ListTreeDefinitions {
  constructor(
    private readonly definitions: TreeDefinitionRepository,
    private readonly items: ItemDefinitionRepository
  ) {}

  execute(actor: ActorContext | null): readonly TreeDefinitionView[] {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    return this.definitions.list().map((definition) => {
      // The catalogue is also the client's only source for the sapling's name, so the sapling has to
      // be a real definition here. Game data refuses a tree whose sapling is missing, so a miss means
      // the deployment is internally inconsistent and the read fails rather than inventing a label.
      const sapling = this.items.findById(definition.saplingItemDefinitionId);
      if (sapling === null) {
        throw new ApplicationError("ITEM_DEFINITION_NOT_FOUND", "Sapling item definition was not found");
      }
      return {
        treeDefinitionId: definition.id,
        displayNameKey: definition.displayNameKey,
        saplingItemDefinitionId: definition.saplingItemDefinitionId,
        saplingItemDisplayNameKey: sapling.displayNameKey,
        firstReadySeconds: definition.firstReadySeconds,
        regrowSeconds: definition.regrowSeconds,
        growthStages: definition.growthStages,
        harvestItemDefinitionId: definition.harvest.itemDefinitionId,
        baseQuantity: definition.harvest.baseQuantity,
        harvestXp: definition.harvest.xp,
        requiredLevel: requiredLevelForTree(definition)
      };
    });
  }
}

/** Every tree on a farm, for a reader with any role on it. */
export class ListFarmTrees {
  constructor(
    private readonly farms: FarmRepository,
    private readonly members: FarmMemberRepository,
    private readonly trees: TreeInstanceRepository,
    private readonly projector: TreeStateProjector
  ) {}

  async execute(actor: ActorContext | null, farmId: FarmId): Promise<readonly TreeState[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if ((await this.farms.findById(farmId)) === null) {
      throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    }
    if ((await this.members.findByFarmAndPlayer(farmId, actor.playerId)) === null) {
      throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
    }
    return this.projector.projectMany(await this.trees.listByFarm(farmId));
  }
}
