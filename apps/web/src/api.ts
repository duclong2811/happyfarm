import {
  BuyItemResultDTOSchema,
  CreateFarmResponseSchema,
  GetCropDefinitionsResponseSchema,
  GetFarmCropsResponseSchema,
  GetFarmResponseSchema,
  GetFarmTilesResponseSchema,
  GetInventoryResponseSchema,
  GetProgressionResponseSchema,
  GetShopResponseSchema,
  GetWalletResponseSchema,
  HarvestCropResponseSchema,
  PlantCropResponseSchema,
  SellItemResultDTOSchema
} from "@happy-farm/contracts";
import type {
  BuyItemResultDTO,
  CropDefinitionDTO,
  CropStateDTO,
  FarmDTO,
  FarmMemberDTO,
  FarmTileDTO,
  HarvestResultDTO,
  InventoryEntryDTO,
  PlayerProgressionDTO,
  SellItemResultDTO,
  ShopEntryDTO,
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
  constructor(private readonly token: string) {}

  private authHeaders(): Record<string, string> {
    return { authorization: `Bearer ${this.token}` };
  }

  private static jsonHeaders(token: string): Record<string, string> {
    return { authorization: `Bearer ${token}`, "content-type": "application/json" };
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
      { method: "POST", headers: ApiClient.jsonHeaders(this.token), body: JSON.stringify(body) },
      validate
    );
  }

  bootstrap(): Promise<DevBootstrapStatus> {
    return this.post("/__dev/bootstrap", undefined, bootstrapValidator).catch((error: unknown) => {
      // A body-less POST is required, so retry without a JSON content-type when that is the cause.
      if (error instanceof ApiError && error.code === "INVALID_INPUT") {
        return this.request("/__dev/bootstrap", { method: "POST", headers: this.authHeaders() }, bootstrapValidator);
      }
      throw error;
    });
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

  getProgression(): Promise<{ readonly progression: PlayerProgressionDTO }> {
    return this.get("/progression", GetProgressionResponseSchema);
  }

  getShop(): Promise<{ readonly entries: ShopEntryDTO[] }> {
    return this.get("/shop", GetShopResponseSchema);
  }

  getWallet(): Promise<{ readonly wallets: WalletDTO[] }> {
    return this.get("/wallet", GetWalletResponseSchema);
  }

  buy(body: ShopCommandBody): Promise<{ readonly settlement: BuyItemResultDTO }> {
    return this.post("/shop/buy", body, settlementValidator(BuyItemResultDTOSchema));
  }

  sell(body: ShopCommandBody): Promise<{ readonly settlement: SellItemResultDTO }> {
    return this.post("/shop/sell", body, settlementValidator(SellItemResultDTOSchema));
  }
}
