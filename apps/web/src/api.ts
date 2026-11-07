import {
  BuyItemResultDTOSchema,
  CreateFarmResponseSchema,
  GetCropDefinitionsResponseSchema,
  GetBuildCatalogResponseSchema,
  GetFarmCropsResponseSchema,
  GetFarmResponseSchema,
  GetFarmTilesResponseSchema,
  GetInventoryResponseSchema,
  GetProgressionResponseSchema,
  GetTreeDefinitionsResponseSchema,
  GetFarmTreesResponseSchema,
  GetPlotsResponseSchema,
  GetShopResponseSchema,
  GetWalletResponseSchema,
  HarvestCropResponseSchema,
  HarvestCropAreaGroupResponseSchema,
  HarvestTreeResponseSchema,
  HarvestTreeAreaGroupResponseSchema,
  PlantCropResponseSchema,
  PlantCropAreaGroupResponseSchema,
  PlaceConstructionResponseSchema,
  GetFarmConstructionsResponseSchema,
  ConstructionEditResponseSchema,
  RemoveConstructionResponseSchema,
  GetWorldObjectsResponseSchema,
  GetFishingResponseSchema,
  GetActiveFishingResponseSchema,
  StartFishingResponseSchema,
  SettleFishingResponseSchema,
  CancelFishingResponseSchema,
  GetResourceNodesResponseSchema,
  GetWarehouseResponseSchema,
  GetActiveResourceActionResponseSchema,
  StartResourceActionResponseSchema,
  SettleResourceActionResponseSchema,
  CancelResourceActionResponseSchema,
  PlantTreeResponseSchema,
  PlantTreeAreaGroupResponseSchema,
  RemoveTreeResponseSchema,
  TreeManagementResponseSchema,
  UprootCropResponseSchema,
  SellItemResultDTOSchema
  ,ExpandFarmResponseSchema
  ,QuoteLandCellsResponseSchema
  ,BuyLandCellsResponseSchema
  ,GetSessionResponseSchema
  ,ListWorkAreasResponseSchema
  ,WorkAreaResponseSchema
  ,DeleteWorkAreaResponseSchema
  ,GetWorkersResponseSchema
  ,JobResponseSchema
  ,JobsResponseSchema
  ,DeleteJobResponseSchema
  ,CargoResponseSchema
  ,AutoPlanResponseSchema
  ,ActorControlResponseSchema
  ,AutoStepResponseSchema
  ,AutoReconcileResponseSchema
  ,ReconcileFarmProductionResponseSchema
  ,GetOrchardVisualSnapshotResponseSchema
  ,GetAquaculturePondsResponseSchema
  ,AquaculturePondResponseSchema
  ,ForestryConstructionChopResponseSchema
  ,GetNeighborResponseSchema
  ,NeighborTravelResponseSchema
  ,NeighborTalkResponseSchema
} from "@happy-farm/contracts";
import type {
  BuyItemResultDTO,
  CropDefinitionDTO,
  CropStateDTO,
  FarmDTO,
  FarmMemberDTO,
  FarmTileDTO,
  HarvestResultDTO,
  TreeHarvestResultDTO,
  HarvestTreeAreaGroupResponse,
  HarvestCropAreaGroupResponse,
  PlantCropAreaGroupResponse,
  PlantTreeAreaGroupResponse,
  InventoryEntryDTO,
  PlayerProgressionDTO,
  PlotDTO,
  ExpandFarmResultDTO,
  LandQuoteDTO,
  BuyLandCellsResultDTO,
  SellItemResultDTO,
  ShopEntryDTO,
  TreeDefinitionDTO,
  ConstructionDTO,
  BuildCatalogEntryDTO,
  TreeStateDTO,
  UprootCropResponse,
  RemoveTreeResponse,
  RemoveConstructionResponse,
  WorldObjectDefinitionDTO,
  FishDefinitionDTO,
  FishingActionDTO,
  FishingSpotDTO,
  FishingCatchDTO,
  ResourceActionDTO,
  ResourceNodeDTO,
  ResourceDropDTO,
  XpAwardDTO,
  WalletDTO,
  WarehouseStatusDTO,
  SessionPlayerDTO,
  WorkAreaDTO,
  WorkAreaSummaryDTO,
  WorkAreaKind,
  WorkAreaCellDTO,
  AquaculturePondDTO
  ,ForestryConstructionChopResponse
  ,ActorDTO
  ,JobDTO
  ,JobKind
  ,CargoDTO
  ,AutoPlanDTO
  ,ActorControlDTO
  ,AutoStepDTO
  ,AutoReconcileDTO
  ,NeighborSnapshotDTO
} from "@happy-farm/contracts";
import { bootPerfApiEnd, bootPerfApiStart, bootPerfApiValidationFailure } from "./boot-performance";

/** Same-origin base: the Vite dev server forwards `/api/*` to the development Worker. */
export const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    /** The original failure, for development inspection. Never rendered in the game UI. */
    cause?: unknown
  ) {
    super(`${code} (HTTP ${String(status)})`, cause === undefined ? undefined : { cause });
    this.name = "ApiError";
  }
}

/**
 * Structural stand-in for a contract schema. Every server payload is still validated by the
 * `@happy-farm/contracts` zod schemas; the browser never trusts an unchecked response body.
 */
export interface Validator<T> {
  parse(value: unknown): T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSuccessEnvelope(value: unknown): value is { ok: true; data: unknown } {
  return isRecord(value) && value.ok === true && "data" in value;
}

function isFailureEnvelope(value: unknown): value is { ok: false; error: { code: string } } {
  if (!isRecord(value) || value.ok !== false || !isRecord(value.error)) return false;
  return typeof value.error.code === "string";
}

function settlementValidator<T>(inner: Validator<T>): Validator<{ readonly settlement: T }> {
  return {
    parse(value: unknown): { readonly settlement: T } {
      if (!isRecord(value)) throw new Error("Malformed settlement response");
      return { settlement: inner.parse(value.settlement) };
    }
  };
}

export interface CreateFarmResult {
  readonly farm: FarmDTO;
  readonly membership: FarmMemberDTO;
}
export interface PlantCropBody {
  readonly requestId: string;
  readonly cropDefinitionId: string;
  readonly x: number;
  readonly y: number;
  /** Absent on a fresh natural-land cell: there is no tile row to version yet (V14.5.2). */
  readonly expectedTileVersion?: number | undefined;
}
export interface HarvestBody {
  readonly requestId: string;
  readonly expectedCropVersion: number;
}

/** Uprooting carries the same two fields as harvesting and nothing that could name a reward. */
export type UprootBody = HarvestBody;
export interface PlantTreeBody {
  readonly requestId: string;
  readonly treeDefinitionId: string;
  readonly x: number;
  readonly y: number;
  /** Absent on a fresh natural-land cell: there is no tile row to version yet (V14.5.2). */
  readonly expectedTileVersion?: number | undefined;
}
/** Harvesting one tree cycle carries the same two fields as harvesting a crop. */
export interface TreeHarvestBody {
  readonly requestId: string;
  readonly expectedTreeVersion: number;
}
export interface ShopCommandBody {
  readonly requestId: string;
  readonly shopEntryId: string;
  readonly quantity: number;
}

/** Everything a harvest returns: what it produced, and the experience it earned. */
export interface HarvestOutcome {
  readonly harvest: HarvestResultDTO;
  readonly progression: XpAwardDTO;
}

/**
 * Browser client for the development API.
 *
 * Only the bearer credential is supplied by the browser. `playerId`, issuer, subject, prices,
 * rewards, and tile/crop versions are server-owned; every command resends the server-provided
 * version so optimistic concurrency stays authoritative.
 */
export class ApiClient {
  private authHeaders(): Record<string, string> {
    return {};
  }

  private static jsonHeaders(): Record<string, string> {
    return { "content-type": "application/json" };
  }

  private async request<T>(path: string, init: RequestInit, validate: Validator<T>): Promise<T> {
    const method = init.method ?? "GET";
    const perfId = bootPerfApiStart();
    let status: number | "error" = "error";
    try {
      // `same-origin` is the default, and it is stated here because the session is a cookie: the
      // guest credential must travel with every request to this origin and never to another one.
      const response = await fetch(`${API_BASE}${path}`, { ...init, credentials: "same-origin" });
      status = response.status;
      let payload: unknown = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      if (isFailureEnvelope(payload)) throw new ApiError(payload.error.code, response.status);
      if (!response.ok || !isSuccessEnvelope(payload)) {
        throw new ApiError("INTERNAL_ERROR", response.status);
      }
      try {
        return validate.parse(payload.data);
      } catch (error: unknown) {
        if (error instanceof ApiError) throw error;
        // A response that fails its contract is a server/client mismatch, not a sentence for the
        // player. The validator's own structure (zod paths, expected values) is kept as the error's
        // cause for development tools and is never returned, logged to the HUD, or shown in the game.
        bootPerfApiValidationFailure(perfId, method, path, response.status, error);
        throw new ApiError("INVALID_RESPONSE", response.status, error);
      }
    } finally {
      bootPerfApiEnd(perfId, method, path, status);
    }
  }

  private get<T>(path: string, validate: Validator<T>): Promise<T> {
    return this.request(path, { headers: this.authHeaders() }, validate);
  }

  private post<T>(path: string, body: unknown, validate: Validator<T>): Promise<T> {
    return this.request(
      path,
      { method: "POST", headers: ApiClient.jsonHeaders(), body: JSON.stringify(body) },
      validate
    );
  }


  createFarm(name: string): Promise<CreateFarmResult> {
    return this.post("/farms", { name }, CreateFarmResponseSchema);
  }

  /**
   * Who this browser is, establishing a guest session on a first visit.
   *
   * The server sets the guest cookie on this response; the page keeps no credential of its own and
   * could not forge one. A host without a session endpoint answers `RESOURCE_NOT_FOUND`, which the
   * boot treats as "use the plain API", the way the development bridge works.
   */
  getSession(): Promise<{ readonly player: SessionPlayerDTO }> {
    return this.get("/session", GetSessionResponseSchema);
  }

  getFarm(farmId: string): Promise<CreateFarmResult> {
    return this.get(`/farms/${encodeURIComponent(farmId)}`, GetFarmResponseSchema);
  }

  getTiles(farmId: string): Promise<{ readonly tiles: FarmTileDTO[] }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/tiles`, GetFarmTilesResponseSchema);
  }

  getCrops(farmId: string): Promise<{ readonly crops: CropStateDTO[] }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/crops`, GetFarmCropsResponseSchema);
  }

  /** The crops this deployment can plant, which is what the planting control is built from. */
  getCropDefinitions(): Promise<{ readonly definitions: CropDefinitionDTO[] }> {
    return this.get("/crop-definitions", GetCropDefinitionsResponseSchema);
  }

  /** The trees this deployment can plant, which is what the tree planting choices are built from. */
  getTreeDefinitions(): Promise<{ readonly definitions: TreeDefinitionDTO[] }> {
    return this.get("/tree-definitions", GetTreeDefinitionsResponseSchema);
  }

  /**
   * What this deployment lets a player place, and what the catalogue says it costs.
   *
   * The build panel is built from this rather than from a list compiled into the bundle, so an entry
   * the server adds appears without a client release. Nothing here buys anything: placing is a command
   * the server does not accept yet, and the panel is a catalogue rather than a shop.
   */
  getBuildCatalog(): Promise<{ readonly entries: BuildCatalogEntryDTO[] }> {
    return this.get("/build-catalog", GetBuildCatalogResponseSchema);
  }

  getTrees(farmId: string): Promise<{ readonly trees: TreeStateDTO[] }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/trees`, GetFarmTreesResponseSchema);
  }

  plantTree(farmId: string, body: PlantTreeBody): Promise<{ readonly tree: TreeStateDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/trees`, body, PlantTreeResponseSchema);
  }

  plantTreeArea(
    farmId: string,
    body: { readonly requestId: string; readonly treeDefinitionId: string; readonly cells: readonly { readonly x: number; readonly y: number; readonly expectedTileVersion?: number }[] }
  ): Promise<PlantTreeAreaGroupResponse> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/trees/plant-area`, body, PlantTreeAreaGroupResponseSchema);
  }

  /**
   * Harvests one cycle of a tree. The tree survives; the response carries the fruit and the award,
   * and the next read of the farm reports the tree regrowing at its next revision.
   */
  harvestTree(
    farmId: string,
    treeInstanceId: string,
    body: TreeHarvestBody
  ): Promise<{ readonly harvest: TreeHarvestResultDTO; readonly progression: XpAwardDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/trees/${encodeURIComponent(treeInstanceId)}/harvest`,
      body,
      HarvestTreeResponseSchema
    );
  }

  harvestTreeArea(
    farmId: string,
    body: {
      readonly requestId: string;
      readonly trees: readonly { readonly treeInstanceId: string; readonly expectedTreeVersion: number }[];
    }
  ): Promise<HarvestTreeAreaGroupResponse> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/trees/harvest-area`,
      body,
      HarvestTreeAreaGroupResponseSchema
    );
  }

  /** Removes a tree. No reward, no refund: the server only confirms what it removed. */
  removeTree(
    farmId: string,
    treeInstanceId: string,
    body: TreeHarvestBody
  ): Promise<RemoveTreeResponse> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/trees/${encodeURIComponent(treeInstanceId)}/remove`,
      body,
      RemoveTreeResponseSchema
    );
  }

  moveTree(
    farmId: string,
    treeInstanceId: string,
    body: { readonly requestId: string; readonly expectedTreeVersion: number; readonly x: number; readonly y: number; readonly rotation: 0 | 1 | 2 | 3; readonly expectedTileVersion?: number }
  ): Promise<{ readonly tree: TreeStateDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/trees/${encodeURIComponent(treeInstanceId)}/move`, body, TreeManagementResponseSchema);
  }

  rotateTree(
    farmId: string,
    treeInstanceId: string,
    body: { readonly requestId: string; readonly expectedTreeVersion: number; readonly rotation: 0 | 1 | 2 | 3 }
  ): Promise<{ readonly tree: TreeStateDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/trees/${encodeURIComponent(treeInstanceId)}/rotate`, body, TreeManagementResponseSchema);
  }

  storeTree(
    farmId: string,
    treeInstanceId: string,
    body: { readonly requestId: string; readonly expectedTreeVersion: number }
  ): Promise<{ readonly tree: TreeStateDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/trees/${encodeURIComponent(treeInstanceId)}/store`, body, TreeManagementResponseSchema);
  }

  restoreTree(
    farmId: string,
    treeInstanceId: string,
    body: { readonly requestId: string; readonly expectedTreeVersion: number; readonly x: number; readonly y: number; readonly rotation: 0 | 1 | 2 | 3; readonly expectedTileVersion?: number }
  ): Promise<{ readonly tree: TreeStateDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/trees/${encodeURIComponent(treeInstanceId)}/restore`, body, TreeManagementResponseSchema);
  }

  plantCrop(farmId: string, body: PlantCropBody): Promise<{ readonly crop: CropStateDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/crops`, body, PlantCropResponseSchema);
  }

  plantCropArea(
    farmId: string,
    body: { readonly requestId: string; readonly cropDefinitionId: string; readonly cells: readonly { readonly x: number; readonly y: number; readonly expectedTileVersion?: number }[] }
  ): Promise<PlantCropAreaGroupResponse> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/crops/plant-area`, body, PlantCropAreaGroupResponseSchema);
  }

  /**
   * Builds one thing the player has paid for.
   *
   * The body names a catalogue entry and a cell; the server decides the price, the level, the
   * footprint, the ground and the collisions. The request id makes the command idempotent, so a
   * double click creates one building and one charge.
   */
  placeConstruction(
    farmId: string,
    body: {
      readonly requestId: string;
      readonly entryId: string;
      readonly anchorX: number;
      readonly anchorY: number;
      readonly rotation: 0 | 1 | 2 | 3;
    }
  ): Promise<{ readonly construction: ConstructionDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/constructions`,
      body,
      PlaceConstructionResponseSchema
    );
  }

  /** Everything built on a farm, for the world to draw after a reload. */
  getFarmConstructions(farmId: string): Promise<{ readonly constructions: ConstructionDTO[] }> {
    return this.get(
      `/farms/${encodeURIComponent(farmId)}/constructions`,
      GetFarmConstructionsResponseSchema
    );
  }

  getAquaculturePonds(farmId: string): Promise<{ readonly ponds: AquaculturePondDTO[] }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/aquaculture/ponds`, GetAquaculturePondsResponseSchema);
  }

  chopForestryConstruction(
    farmId: string,
    constructionId: string,
    body: { readonly requestId: string; readonly expectedForestryVersion: number }
  ): Promise<ForestryConstructionChopResponse> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/forestry/constructions/${encodeURIComponent(constructionId)}/chop`,
      body,
      ForestryConstructionChopResponseSchema
    );
  }

  stockAquaculturePond(
    farmId: string,
    pondId: string,
    body: { readonly requestId: string; readonly expectedPondVersion: number; readonly quantity: number }
  ): Promise<{ readonly pond: AquaculturePondDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/aquaculture/ponds/${encodeURIComponent(pondId)}/stock`,
      body,
      AquaculturePondResponseSchema
    );
  }

  harvestAquaculturePond(
    farmId: string,
    pondId: string,
    body: { readonly requestId: string; readonly expectedPondVersion: number; readonly quantity: number }
  ): Promise<{ readonly pond: AquaculturePondDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/aquaculture/ponds/${encodeURIComponent(pondId)}/harvest`,
      body,
      AquaculturePondResponseSchema
    );
  }

  withdrawAquaculturePond(
    farmId: string,
    pondId: string,
    body: { readonly requestId: string; readonly expectedPondVersion: number; readonly quantity: number }
  ): Promise<{ readonly pond: AquaculturePondDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/aquaculture/ponds/${encodeURIComponent(pondId)}/withdraw`,
      body,
      AquaculturePondResponseSchema
    );
  }

  /**
   * The definitions of the island's own objects.
   *
   * Read-only reference data, fetched once with the catalogues: it is what lets the client draw and
   * describe a starter tree - or the mill - that the player never bought.
   */
  getWorldObjects(): Promise<{ readonly objects: WorldObjectDefinitionDTO[] }> {
    return this.get("/world-objects", GetWorldObjectsResponseSchema);
  }

  /**
   * Fishing.
   *
   * The catalogue is static game data: the client draws the spots and names the species from it. The
   * three commands are the same server-authoritative shape as everything else - start names a spot,
   * settle names the server's own action, and cancel gives it up. In between there is no request at
   * all: the wait is served by the server's clock and the client's own countdown.
   */
  getFishing(): Promise<{ readonly spots: FishingSpotDTO[]; readonly fish: FishDefinitionDTO[] }> {
    return this.get("/fishing", GetFishingResponseSchema);
  }

  getActiveFishing(): Promise<{ readonly action: FishingActionDTO | null }> {
    return this.get("/fishing/active", GetActiveFishingResponseSchema);
  }

  startFishing(body: { readonly requestId: string; readonly spotId: string }): Promise<{ readonly action: FishingActionDTO }> {
    return this.post("/fishing/start", body, StartFishingResponseSchema);
  }

  settleFishing(
    actionId: string,
    body: { readonly requestId: string; readonly expectedActionVersion: number }
  ): Promise<{ readonly catch: FishingCatchDTO; readonly progression: XpAwardDTO }> {
    return this.post(`/fishing/${encodeURIComponent(actionId)}/settle`, body, SettleFishingResponseSchema);
  }

  cancelFishing(
    actionId: string,
    body: { readonly requestId: string; readonly expectedActionVersion: number }
  ): Promise<{ readonly cancelled: true }> {
    return this.post(`/fishing/${encodeURIComponent(actionId)}/cancel`, body, CancelFishingResponseSchema);
  }

  /**
   * Resource nodes.
   *
   * The catalogue folds the actor's own zone's availability into the placements, so the page draws a
   * depleted node and counts it down locally; the server re-checks the node, the level, the clock and
   * the drop when a gather starts or settles. Read at load, refreshed after a gather - never polled.
   */
  getResourceNodes(): Promise<{ readonly nodes: ResourceNodeDTO[] }> {
    return this.get("/resource-nodes", GetResourceNodesResponseSchema);
  }

  getActiveResourceAction(): Promise<{ readonly action: ResourceActionDTO | null }> {
    return this.get("/resource-actions/active", GetActiveResourceActionResponseSchema);
  }

  startResourceAction(body: {
    readonly requestId: string;
    readonly nodeId: string;
  }): Promise<{ readonly action: ResourceActionDTO }> {
    return this.post("/resource-actions/start", body, StartResourceActionResponseSchema);
  }

  settleResourceAction(
    actionId: string,
    body: { readonly requestId: string; readonly expectedActionVersion: number }
  ): Promise<{
    readonly drop: ResourceDropDTO;
    readonly node: { readonly nodeId: string; readonly availableAt: string };
    readonly progression: XpAwardDTO;
  }> {
    return this.post(
      `/resource-actions/${encodeURIComponent(actionId)}/settle`,
      body,
      SettleResourceActionResponseSchema
    );
  }

  cancelResourceAction(
    actionId: string,
    body: { readonly requestId: string; readonly expectedActionVersion: number }
  ): Promise<{ readonly cancelled: true }> {
    return this.post(
      `/resource-actions/${encodeURIComponent(actionId)}/cancel`,
      body,
      CancelResourceActionResponseSchema
    );
  }

  /** Puts one object into storage: out of the world, still the player's. */
  storeConstruction(
    farmId: string,
    constructionId: string,
    body: { readonly requestId: string; readonly expectedVersion: number }
  ): Promise<{ readonly construction: ConstructionDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/constructions/${encodeURIComponent(constructionId)}/store`,
      body,
      ConstructionEditResponseSchema
    );
  }

  /** Puts a stored object back on the island, at ground the player chose. Nothing is charged. */
  restoreConstruction(
    farmId: string,
    constructionId: string,
    body: {
      readonly requestId: string;
      readonly anchorX: number;
      readonly anchorY: number;
      readonly rotation: 0 | 1 | 2 | 3;
      readonly expectedVersion: number;
    }
  ): Promise<{ readonly construction: ConstructionDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/constructions/${encodeURIComponent(constructionId)}/restore`,
      body,
      ConstructionEditResponseSchema
    );
  }

  /**
   * Picks something up and puts it down somewhere else.
   *
   * `expectedVersion` is the row the client is looking at: the server refuses a move built on a stale
   * copy rather than overwriting whatever changed it. Nothing about the object's price, refund or
   * footprint travels - only where the player wants it.
   */
  moveConstruction(
    farmId: string,
    constructionId: string,
    body: {
      readonly requestId: string;
      readonly anchorX: number;
      readonly anchorY: number;
      readonly rotation: 0 | 1 | 2 | 3;
      readonly expectedVersion: number;
    }
  ): Promise<{ readonly construction: ConstructionDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/constructions/${encodeURIComponent(constructionId)}/move`,
      body,
      ConstructionEditResponseSchema
    );
  }

  /** Turns something in place. The anchor does not change, so only the rotation travels. */
  rotateConstruction(
    farmId: string,
    constructionId: string,
    body: { readonly requestId: string; readonly rotation: 0 | 1 | 2 | 3; readonly expectedVersion: number }
  ): Promise<{ readonly construction: ConstructionDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/constructions/${encodeURIComponent(constructionId)}/rotate`,
      body,
      ConstructionEditResponseSchema
    );
  }

  /** Takes something down. The refund is the server's own number, returned rather than predicted. */
  removeConstruction(
    farmId: string,
    constructionId: string,
    body: { readonly requestId: string; readonly expectedVersion: number }
  ): Promise<RemoveConstructionResponse> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/constructions/${encodeURIComponent(constructionId)}/remove`,
      body,
      RemoveConstructionResponseSchema
    );
  }

  harvestCrop(
    farmId: string,
    cropInstanceId: string,
    body: HarvestBody
  ): Promise<HarvestOutcome> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/crops/${encodeURIComponent(cropInstanceId)}/harvest`,
      body,
      HarvestCropResponseSchema
    );
  }

  harvestCropArea(
    farmId: string,
    body: {
      readonly requestId: string;
      readonly crops: readonly { readonly cropInstanceId: string; readonly expectedCropVersion: number }[];
    }
  ): Promise<HarvestCropAreaGroupResponse> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/crops/harvest-area`,
      body,
      HarvestCropAreaGroupResponseSchema
    );
  }

  getInventory(): Promise<{ readonly items: InventoryEntryDTO[] }> {
    return this.get("/inventory", GetInventoryResponseSchema);
  }

  /**
   * Removes a crop the player planted by mistake. The server decides whether the crop is there, at
   * the expected version, and on a farm this actor owns; the response only confirms what it removed.
   */
  uprootCrop(
    farmId: string,
    cropInstanceId: string,
    body: UprootBody
  ): Promise<UprootCropResponse> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/crops/${encodeURIComponent(cropInstanceId)}/uproot`,
      body,
      UprootCropResponseSchema
    );
  }

  getProgression(): Promise<{ readonly progression: PlayerProgressionDTO }> {
    return this.get("/progression", GetProgressionResponseSchema);
  }

  getShop(): Promise<{ readonly entries: ShopEntryDTO[] }> {
    return this.get("/shop", GetShopResponseSchema);
  }

  getWallet(): Promise<{ readonly wallets: WalletDTO[] }> {
    return this.get("/wallet", GetWalletResponseSchema);
  }

  /**
   * The Home Island warehouse: how much the island is holding and what the next tier costs.
   *
   * A bounded read made with the other account state - on load and after an action that changed what
   * the island holds - never on a timer.
   */
  getWarehouse(): Promise<{ readonly warehouse: WarehouseStatusDTO }> {
    return this.get("/warehouse", GetWarehouseResponseSchema);
  }

  reconcileProduction(farmId: string, requestId: string) {
    return this.post(`/farms/${encodeURIComponent(farmId)}/production/reconcile`, { requestId }, ReconcileFarmProductionResponseSchema);
  }

  getOrchardVisualSnapshot(farmId: string) {
    return this.get(`/farms/${encodeURIComponent(farmId)}/orchard/visual`, GetOrchardVisualSnapshotResponseSchema);
  }

  /** Buys the next warehouse tier. The client sends a request id and nothing else the server needs. */
  upgradeWarehouse(requestId: string): Promise<{ readonly warehouse: WarehouseStatusDTO }> {
    return this.post("/warehouse/upgrade", { requestId }, GetWarehouseResponseSchema);
  }

  /**
   * Work areas: player-named groups of cells a future Job may be asked to work.
   *
   * Read only when the management panel is opened or a mutation answers - never on boot, never on the
   * growth poll. The body carries a name, a kind and the cells the player drew; the server derives the
   * farm, the role and the zone from the authenticated actor and the route.
   */
  getWorkAreas(farmId: string): Promise<{ readonly workAreas: WorkAreaSummaryDTO[] }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/work-areas`, ListWorkAreasResponseSchema);
  }

  getWorkArea(farmId: string, workAreaId: string): Promise<{ readonly workArea: WorkAreaDTO }> {
    return this.get(
      `/farms/${encodeURIComponent(farmId)}/work-areas/${encodeURIComponent(workAreaId)}`,
      WorkAreaResponseSchema
    );
  }

  createWorkArea(
    farmId: string,
    body: {
      readonly requestId: string;
      readonly kind: WorkAreaKind;
      readonly name: string;
      readonly cells: readonly WorkAreaCellDTO[];
    }
  ): Promise<{ readonly workArea: WorkAreaDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/work-areas`, body, WorkAreaResponseSchema);
  }

  renameWorkArea(
    farmId: string,
    workAreaId: string,
    body: { readonly requestId: string; readonly name: string; readonly expectedVersion: number }
  ): Promise<{ readonly workArea: WorkAreaDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/work-areas/${encodeURIComponent(workAreaId)}/rename`,
      body,
      WorkAreaResponseSchema
    );
  }

  replaceWorkAreaCells(
    farmId: string,
    workAreaId: string,
    body: { readonly requestId: string; readonly cells: readonly WorkAreaCellDTO[]; readonly expectedVersion: number }
  ): Promise<{ readonly workArea: WorkAreaDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/work-areas/${encodeURIComponent(workAreaId)}/cells`,
      body,
      WorkAreaResponseSchema
    );
  }

  deleteWorkArea(
    farmId: string,
    workAreaId: string,
    body: { readonly requestId: string; readonly expectedVersion: number }
  ): Promise<{ readonly workAreaId: string }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/work-areas/${encodeURIComponent(workAreaId)}/delete`,
      body,
      DeleteWorkAreaResponseSchema
    );
  }

  /**
   * The farm owner's worker panel: the Main Character and its configured jobs.
   *
   * Read when the panel is opened and after a mutation - never on boot, never on the growth poll.
   * Creating a job plants nothing: it is configuration, and the server does no work for one.
   */
  getWorkers(farmId: string): Promise<{ readonly actor: ActorDTO; readonly jobs: JobDTO[] }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/workers`, GetWorkersResponseSchema);
  }

  /**
   * The plan: what Auto would do next, and why.
   *
   * A read that answers even while the player is driving, so the panel can show what Auto *would* do
   * before it is switched on. Read when the panel is opened and after an Auto action, never on a
   * timer - the resolver is not a poller, and neither is this.
   */
  getAutoPlan(farmId: string): Promise<{ readonly plan: AutoPlanDTO }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/auto-plan`, AutoPlanResponseSchema);
  }

  /**
   * Advance Auto by one bounded step.
   *
   * The body is a request id and nothing else: the server re-resolves, records a walk with the time it
   * lands, or performs exactly one authoritative settlement. The client animates what comes back and
   * asks again when the server said to - which is why a modified client cannot rush a walk or a
   * harvest, and why nothing here is a poll.
   */
  advanceAuto(farmId: string, body: { readonly requestId: string }): Promise<{ readonly step: AutoStepDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/auto/step`, body, AutoStepResponseSchema);
  }

  /**
   * Ask the server to reconcile Auto time that passed while nobody was watching.
   *
   * Sent once when the game is entered or resumed, never on a timer: the server decides how much
   * elapsed time may be settled and answers with exactly how far the timeline now is. The body is a
   * request id and nothing else, so a client can never claim elapsed time or a simulated instant.
   */
  reconcileAuto(
    farmId: string,
    body: { readonly requestId: string }
  ): Promise<{ readonly reconciliation: AutoReconcileDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/auto/reconcile`, body, AutoReconcileResponseSchema);
  }

  /**
   * START_AUTO / STOP_AUTO on the farm owner's Main Character.
   *
   * The body is the intent and the actor version the client read; the server derives the actor, the
   * mode and the write. Switching control plants nothing, spends nothing and moves nobody.
   */
  setActorControl(
    farmId: string,
    body: { readonly requestId: string; readonly startAuto: boolean; readonly expectedVersion: number }
  ): Promise<{ readonly actor: ActorControlDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/workers/control`, body, ActorControlResponseSchema);
  }

  /**
   * One assignment's supply policy.
   *
   * `autoPurchaseSupplies` is the one boolean Auto may spend gold under; `funding` (optional) is the
   * emergency whitelist - the resources Auto may sell, in the order given, when the purse is short.
   * Omitting `funding` leaves it untouched.
   */
  setAssignmentPolicy(
    farmId: string,
    jobId: string,
    body: {
      readonly requestId: string;
      readonly autoPurchaseSupplies: boolean;
      readonly expectedVersion: number;
      readonly funding?: { readonly enabled: boolean; readonly items: readonly string[] };
    }
  ): Promise<{ readonly job: JobDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/assignments/${encodeURIComponent(jobId)}/policy`,
      body,
      JobResponseSchema
    );
  }

  createJob(
    farmId: string,
    body: {
      readonly requestId: string;
      readonly workAreaId: string;
      readonly kind: JobKind;
      readonly targetDefinitionId: string;
    }
  ): Promise<{ readonly job: JobDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/jobs`, body, JobResponseSchema);
  }

  reorderJobs(
    farmId: string,
    body: { readonly requestId: string; readonly orderedJobIds: readonly string[]; readonly expectedVersion: number }
  ): Promise<{ readonly jobs: JobDTO[] }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/jobs/order`, body, JobsResponseSchema);
  }

  updateJobTarget(
    farmId: string,
    jobId: string,
    body: { readonly requestId: string; readonly targetDefinitionId: string; readonly expectedVersion: number }
  ): Promise<{ readonly job: JobDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/jobs/${encodeURIComponent(jobId)}/target`,
      body,
      JobResponseSchema
    );
  }

  setJobEnabled(
    farmId: string,
    jobId: string,
    body: { readonly requestId: string; readonly enabled: boolean; readonly expectedVersion: number }
  ): Promise<{ readonly job: JobDTO }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/jobs/${encodeURIComponent(jobId)}/enabled`,
      body,
      JobResponseSchema
    );
  }

  deleteJob(
    farmId: string,
    jobId: string,
    body: { readonly requestId: string; readonly expectedVersion: number }
  ): Promise<{ readonly jobId: string }> {
    return this.post(
      `/farms/${encodeURIComponent(farmId)}/jobs/${encodeURIComponent(jobId)}/delete`,
      body,
      DeleteJobResponseSchema
    );
  }

  /**
   * What the farm owner's Main Character is carrying.
   *
   * A separate container from the warehouse: these goods are *being carried*, not stored. Read with
   * the worker panel - never on boot and never on a timer.
   */
  getActorCargo(farmId: string): Promise<{ readonly cargo: CargoDTO }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/cargo`, CargoResponseSchema);
  }

  /**
   * Moves everything carried into the Home Warehouse, or nothing.
   *
   * The body is the cargo version the client read; the server derives the destination from the farm's
   * owner and refuses the whole transfer if the warehouse cannot take all of it.
   */
  unloadCargo(
    farmId: string,
    body: { readonly requestId: string; readonly expectedVersion: number }
  ): Promise<{ readonly cargo: CargoDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/cargo/unload`, body, CargoResponseSchema);
  }

  getPlots(farmId: string): Promise<{ readonly plots: PlotDTO[] }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/plots`, GetPlotsResponseSchema);
  }

  expandFarm(farmId: string, requestId: string): Promise<{ readonly expansion: ExpandFarmResultDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/plots`, { requestId }, ExpandFarmResponseSchema);
  }

  /**
   * The server's own price and eligibility for a set of cells.
   *
   * A read, asked once when the player enters single-cell mode or when a footprint needs pricing - not
   * per pointer move, which is why the client holds the answer and never computes a price itself.
   */
  quoteLandCells(
    farmId: string,
    cells: readonly { readonly x: number; readonly y: number }[]
  ): Promise<{ readonly quote: LandQuoteDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/land/quote`, { cells }, QuoteLandCellsResponseSchema);
  }

  /** Buys cells the server priced and validated; the client sends coordinates and a request id only. */
  buyLandCells(
    farmId: string,
    body: { readonly requestId: string; readonly cells: readonly { readonly x: number; readonly y: number }[] }
  ): Promise<{ readonly purchase: BuyLandCellsResultDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/land/cells`, body, BuyLandCellsResponseSchema);
  }

  buy(body: ShopCommandBody): Promise<{ readonly settlement: BuyItemResultDTO }> {
    return this.post("/shop/buy", body, settlementValidator(BuyItemResultDTOSchema));
  }

  sell(body: ShopCommandBody): Promise<{ readonly settlement: SellItemResultDTO }> {
    return this.post("/shop/sell", body, settlementValidator(SellItemResultDTOSchema));
  }

  getNeighbor(): Promise<{ readonly neighbor: NeighborSnapshotDTO }> {
    return this.get("/neighbor", GetNeighborResponseSchema);
  }

  travelNeighbor(body: { readonly requestId: string; readonly expectedVersion: number; readonly destination: "HOME_ISLAND" | "NEIGHBOR_ISLAND"; readonly islandId?: string }): Promise<{ readonly neighbor: NeighborSnapshotDTO }> {
    return this.post("/neighbor/travel", body, NeighborTravelResponseSchema);
  }

  talkNeighbor(body: { readonly requestId: string; readonly expectedVersion: number }): Promise<{ readonly neighbor: NeighborSnapshotDTO; readonly dialogueKey: string }> {
    return this.post("/neighbor/talk", body, NeighborTalkResponseSchema);
  }
}
