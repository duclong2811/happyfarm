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
  HarvestTreeResponseSchema,
  PlantCropResponseSchema,
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
  GetActiveResourceActionResponseSchema,
  StartResourceActionResponseSchema,
  SettleResourceActionResponseSchema,
  CancelResourceActionResponseSchema,
  PlantTreeResponseSchema,
  RemoveTreeResponseSchema,
  UprootCropResponseSchema,
  SellItemResultDTOSchema
  ,ExpandFarmResponseSchema
  ,GetSessionResponseSchema
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
  InventoryEntryDTO,
  PlayerProgressionDTO,
  PlotDTO,
  ExpandFarmResultDTO,
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
  SessionPlayerDTO
} from "@happy-farm/contracts";

/** Same-origin base: the Vite dev server forwards `/api/*` to the development Worker. */
export const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number
  ) {
    super(`${code} (HTTP ${String(status)})`);
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
  readonly expectedTileVersion: number;
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
  readonly expectedTileVersion: number;
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
    // `same-origin` is the default, and it is stated here because the session is a cookie: the
    // guest credential must travel with every request to this origin and never to another one.
    const response = await fetch(`${API_BASE}${path}`, { ...init, credentials: "same-origin" });
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
    return validate.parse(payload.data);
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

  plantCrop(farmId: string, body: PlantCropBody): Promise<{ readonly crop: CropStateDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/crops`, body, PlantCropResponseSchema);
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

  getPlots(farmId: string): Promise<{ readonly plots: PlotDTO[] }> {
    return this.get(`/farms/${encodeURIComponent(farmId)}/plots`, GetPlotsResponseSchema);
  }

  expandFarm(farmId: string, requestId: string): Promise<{ readonly expansion: ExpandFarmResultDTO }> {
    return this.post(`/farms/${encodeURIComponent(farmId)}/plots`, { requestId }, ExpandFarmResponseSchema);
  }

  buy(body: ShopCommandBody): Promise<{ readonly settlement: BuyItemResultDTO }> {
    return this.post("/shop/buy", body, settlementValidator(BuyItemResultDTOSchema));
  }

  sell(body: ShopCommandBody): Promise<{ readonly settlement: SellItemResultDTO }> {
    return this.post("/shop/sell", body, settlementValidator(SellItemResultDTOSchema));
  }
}
