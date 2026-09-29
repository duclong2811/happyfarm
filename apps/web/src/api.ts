import {
  BuyItemResultDTOSchema,
  CreateFarmResponseSchema,
  GetCropDefinitionsResponseSchema,
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
  PlantTreeResponseSchema,
  RemoveTreeResponseSchema,
  UprootCropResponseSchema,
  SellItemResultDTOSchema
  ,ExpandFarmResponseSchema
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
  TreeStateDTO,
  UprootCropResponse,
  RemoveTreeResponse,
  XpAwardDTO,
  WalletDTO
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

export interface DevBootstrapStatus {
  readonly player: { readonly playerId: string; readonly status: string; readonly created: boolean };
}

const bootstrapValidator: Validator<DevBootstrapStatus> = {
  parse(value: unknown): DevBootstrapStatus {
    if (!isRecord(value) || !isRecord(value.player)) throw new Error("Malformed bootstrap response");
    const { playerId, status, created } = value.player;
    if (typeof playerId !== "string" || typeof status !== "string" || typeof created !== "boolean") {
      throw new Error("Malformed bootstrap response");
    }
    return { player: { playerId, status, created } };
  }
};

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
    const response = await fetch(`${API_BASE}${path}`, init);
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

  bootstrap(): Promise<DevBootstrapStatus> {
    return this.request("/__dev/bootstrap", { method: "POST", headers: this.authHeaders() }, bootstrapValidator);
  }

  createFarm(name: string): Promise<CreateFarmResult> {
    return this.post("/farms", { name }, CreateFarmResponseSchema);
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
