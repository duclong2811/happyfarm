import {
  assertTilePlantable,
  assertValidCoordinate,
  calculateTreeProduction,
  canHarvestTree,
  createTreeInstance,
  createXpAward,
  DomainError,
  isTreeUnlocked,
  parseItemDefinitionId,
  parseTreeDefinitionId,
  parseTreeInstanceId,
  requiredLevelForTree,
  type FarmId,
  type ItemDefinitionId,
  type PlayerId,
  type ProgressionDefinition,
  type TileCoordinate,
  type TreeDefinition,
  type TreeInstance,
  type TreePhase,
  type UnlockedLandPolicy,
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
  ProgressionRepository,
  TreeDefinitionRepository,
  TreeHarvestSettlementRepository,
  TreeIdGenerator,
  TreeInstanceRepository
} from "./ports";

const PLANT_TREE_OPERATION = "PLANT_TREE";
const HARVEST_TREE_OPERATION = "HARVEST_TREE";
const REMOVE_TREE_OPERATION = "REMOVE_TREE";

/**
 * How many times a tree harvest re-reads progression after losing a race before giving up.
 *
 * The same number, and the same reasoning, as harvesting a crop: a lost race rolls the whole
 * settlement back, so retrying re-runs the command against fresh state instead of paying twice.
 */
const PROGRESSION_ATTEMPTS = 8;

export interface PlantTreeCommand extends TileCoordinate {
  readonly treeDefinitionId: string;
  readonly expectedTileVersion: number;
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
  readonly readyAt: string;
  readonly secondsUntilReady: number;
  readonly ready: boolean;
  readonly phase: TreePhase;
  readonly growthStage: number;
  readonly growthProgress: number;
  readonly version: number;
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
      version: tree.version
    };
  }

  projectMany(trees: readonly TreeInstance[]): readonly TreeState[] {
    const serverTime = this.clock.now();
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
  readonly unlockedLand: UnlockedLandPolicy;
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
      unlockedLand,
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
    const tile = await tiles.find(farmId, command.x, command.y);
    if (tile === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Tile was not found");
    if (!(await unlockedLand.isUnlocked(farmId, command))) {
      throw new ApplicationError("INVALID_INPUT", "Tile is outside unlocked land");
    }
    try {
      assertTilePlantable(tile);
    } catch {
      throw new ApplicationError("TILE_NOT_PLANTABLE", "Tile is not plantable");
    }
    if (tile.version !== command.expectedTileVersion) {
      throw new ApplicationError("CONFLICT_STALE_STATE", "Tile version does not match");
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
      await trees.plantAtomically(tree, command.expectedTileVersion, saplingRemoval, sapling, record);
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
      if (currentTile === null) {
        throw new ApplicationError("RESOURCE_NOT_FOUND", "Tile was not found");
      }
      if (currentTile.terrainType !== "SOIL") {
        throw new ApplicationError("TILE_NOT_PLANTABLE", "Tile is not plantable");
      }
      if (currentTile.version !== command.expectedTileVersion) {
        throw new ApplicationError("CONFLICT_STALE_STATE", "Tile version does not match");
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
