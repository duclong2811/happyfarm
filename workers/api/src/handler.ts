import {
  CreateFarm,
  CropStateProjector,
  GetFarmCrops,
  GetFarm,
  GetInventory,
  GetProgression,
  HarvestCrop,
  InventoryService,
  ListPlots,
  ListCropDefinitions,
  ListFarmTiles,
  PlantCrop,
  ApplicationError,
  BuyItem,
  EconomyService,
  SellItem,
  ExpandFarm,
  type ActorContext,
  type AuthenticationPort,
  type Clock,
  type CropDefinitionRepository,
  type CropIdGenerator,
  type CurrencyDefinitionRepository,
  type EconomyTransactionIdGenerator,
  type IdGenerator,
  type ItemDefinitionRepository,
  type PayloadFingerprint,
  type PlotDefinitionRepository,
  type PlotView,
  type ShopEntryRepository
} from "@happy-farm/application";
import {
  CreateFarmRequestSchema,
  FarmIdSchema,
  CropInstanceIdSchema,
  HarvestCropRequestSchema,
  BuyItemRequestSchema,
  ExpandFarmRequestSchema,
  SellItemRequestSchema,
  PlantCropRequestSchema,
  type ApiFailure,
  type ApiSuccess,
  type ErrorCode,
  type FarmDTO,
  type FarmTileDTO,
  type FarmMemberDTO,
  type CropStateDTO,
  type CropDefinitionDTO,
  type HarvestResultDTO,
  type InventoryEntryDTO,
  type PlayerProgressionDTO,
  type XpAwardDTO,
  type BuyItemResultDTO,
  type SellItemResultDTO,
  type ShopEntryDTO,
  type WalletDTO
  ,type PlotDTO,
  type ExpandFarmResultDTO
} from "@happy-farm/contracts";
import {
  parseCurrencyDefinitionId,
  parseFarmId,
  type ProgressionDefinition,
  type ShopEntry,
  type Wallet
} from "@happy-farm/domain";
import type { D1DatabaseLike } from "./d1-types";
import {
  D1CropRepository,
  D1HarvestSettlementRepository,
  D1EconomySettlementRepository,
  D1FarmExpansionRepository,
  D1WalletRepository,
  D1InventoryRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1FarmTileRepository,
  D1PlayerRepository,
  D1ProgressionRepository
} from "./d1-repositories";

const MAX_JSON_BODY_BYTES = 16_384;

export interface HandlerDependencies {
  readonly db: D1DatabaseLike;
  readonly authenticator: AuthenticationPort<Request>;
  readonly ids: IdGenerator & CropIdGenerator & EconomyTransactionIdGenerator;
  readonly fingerprints: PayloadFingerprint;
  readonly cropDefinitions: CropDefinitionRepository;
  readonly itemDefinitions: ItemDefinitionRepository;
  readonly currencyDefinitions: CurrencyDefinitionRepository;
  readonly shopEntries: ShopEntryRepository;
  readonly plotDefinitions: PlotDefinitionRepository;
  /** The levelling curve. Passed in rather than imported, so application code stays game-data free. */
  readonly progressionDefinition: ProgressionDefinition;
  readonly clock: Clock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function toFarmDTO(farm: {
  id: string;
  ownerPlayerId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}): FarmDTO {
  return { ...farm };
}

function toMemberDTO(member: {
  farmId: string;
  playerId: string;
  role: "OWNER" | "EDITOR" | "HELPER" | "VISITOR";
  createdAt: string;
}): FarmMemberDTO {
  return { ...member };
}

function toShopEntryDTO(entry: ShopEntry): ShopEntryDTO {
  return {
    shopEntryId: entry.id,
    itemDefinitionId: entry.itemDefinitionId,
    currencyId: entry.currencyDefinitionId,
    buyPrice: entry.buyPrice,
    sellPrice: entry.sellPrice,
    maxQuantityPerRequest: entry.maxQuantityPerRequest
  };
}

function toWalletDTO(wallet: Wallet): WalletDTO {
  return { currencyId: wallet.currencyDefinitionId, balance: wallet.balance };
}

/** Names the currency a plot is priced in, so the client can phrase the price without a label table. */
function toPlotDTO(view: PlotView, currencyDefinitions: CurrencyDefinitionRepository): PlotDTO {
  let currencyId;
  try {
    currencyId = parseCurrencyDefinitionId(view.currencyId);
  } catch {
    throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  }
  const currency = currencyDefinitions.findById(currencyId);
  if (currency === null) {
    throw new ApplicationError("CURRENCY_DEFINITION_NOT_FOUND", "Currency definition was not found");
  }
  return { ...view, currencyDisplayNameKey: currency.displayNameKey };
}

/**
 * Decodes a single percent-encoded path segment.
 *
 * decodeURIComponent throws URIError for malformed input such as a lone "%". That is a client
 * error, so it must be reported as INVALID_INPUT instead of escaping to the outer catch and
 * surfacing as INTERNAL_ERROR.
 */
function decodePathSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

async function parseJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength > MAX_JSON_BODY_BYTES) {
    throw new ApplicationError("INVALID_INPUT", "Request body is too large");
  }
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_JSON_BODY_BYTES) {
    throw new ApplicationError("INVALID_INPUT", "Request body is too large");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ApplicationError("INVALID_INPUT", "Malformed JSON");
  }
}

function errorStatus(code: ErrorCode): number {
  switch (code) {
    case "INVALID_INPUT":
    case "TILE_INVALID":
    case "INVALID_QUANTITY":
      return 400;
    case "NOT_AUTHENTICATED":
      return 401;
    case "NOT_AUTHORIZED":
    case "FARM_PERMISSION_DENIED":
    case "CROP_LEVEL_REQUIRED":
    case "PLOT_LEVEL_REQUIRED":
      return 403;
    case "RESOURCE_NOT_FOUND":
    case "CROP_DEFINITION_NOT_FOUND":
    case "CROP_NOT_FOUND":
    case "ITEM_DEFINITION_NOT_FOUND":
    case "CURRENCY_DEFINITION_NOT_FOUND":
    case "SHOP_ENTRY_NOT_FOUND":
      return 404;
    case "CONFLICT_STALE_STATE":
    case "REQUEST_ALREADY_PROCESSED":
    case "TILE_OCCUPIED":
    case "TILE_NOT_PLANTABLE":
    case "IDEMPOTENCY_CONFLICT":
    case "CROP_NOT_MATURE":
    case "CROP_ALREADY_HARVESTED":
    case "INVENTORY_LIMIT_EXCEEDED":
    case "INSUFFICIENT_ITEMS":
    case "INSUFFICIENT_FUNDS":
    case "WALLET_LIMIT_EXCEEDED":
    case "ECONOMY_CONFLICT":
    case "PROGRESSION_CONFLICT":
    case "PLOT_LIMIT_REACHED":
      return 409;
    case "RATE_LIMITED":
      return 429;
    default:
      return 500;
  }
}

function failure(code: ErrorCode, requestId: string): Response {
  const body: ApiFailure = { ok: false, error: { code, requestId } };
  return jsonResponse(body, errorStatus(code));
}

export function createHandler(dependencies: HandlerDependencies) {
  const players = new D1PlayerRepository(dependencies.db);
  const farms = new D1FarmRepository(dependencies.db);
  const members = new D1FarmMemberRepository(dependencies.db);
  const tiles = new D1FarmTileRepository(dependencies.db);
  const crops = new D1CropRepository(dependencies.db);
  const inventory = new D1InventoryRepository(dependencies.db);
  const harvestSettlement = new D1HarvestSettlementRepository(dependencies.db);
  const wallets = new D1WalletRepository(dependencies.db);
  const economySettlement = new D1EconomySettlementRepository(dependencies.db);
  const farmExpansionSettlement = new D1FarmExpansionRepository(dependencies.db);
  const progressions = new D1ProgressionRepository(dependencies.db);
  const unlockedLand = {
    async isUnlocked(farmId: Parameters<typeof tiles.find>[0], coordinate: { x: number; y: number }) {
      return (await tiles.find(farmId, coordinate.x, coordinate.y)) !== null;
    }
  };
  const createFarm = new CreateFarm(players, farms, dependencies.ids, dependencies.clock);
  const getFarm = new GetFarm(farms, members);
  const projector = new CropStateProjector(dependencies.cropDefinitions, dependencies.clock);
  const plantCrop = new PlantCrop(
    farms,
    members,
    tiles,
    crops,
    crops,
    dependencies.cropDefinitions,
    progressions,
    dependencies.progressionDefinition,
    unlockedLand,
    dependencies.ids,
    dependencies.fingerprints,
    dependencies.clock
  );
  const getFarmCrops = new GetFarmCrops(farms, members, crops, projector);
  const listCropDefinitions = new ListCropDefinitions(dependencies.cropDefinitions);
  const listFarmTiles = new ListFarmTiles(farms, members, tiles);
  const inventoryService = new InventoryService(dependencies.itemDefinitions, dependencies.clock);
  const harvestCrop = new HarvestCrop(
    farms,
    members,
    crops,
    inventory,
    crops,
    harvestSettlement,
    dependencies.cropDefinitions,
    inventoryService,
    progressions,
    dependencies.progressionDefinition,
    dependencies.fingerprints,
    dependencies.clock
  );
  const getProgression = new GetProgression(
    dependencies.progressionDefinition,
    progressions,
    dependencies.clock
  );
  const getInventory = new GetInventory(inventory);
  const shopDependencies = {
    shops: dependencies.shopEntries,
    currencies: dependencies.currencyDefinitions,
    wallets,
    inventory,
    idempotency: crops,
    settlement: economySettlement,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    inventoryService,
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  };
  const buyItem = new BuyItem(shopDependencies);
  const sellItem = new SellItem(shopDependencies);
  const listPlots = new ListPlots(dependencies.plotDefinitions, farms, members, tiles);
  const expandFarm = new ExpandFarm({
    farms,
    members,
    tiles,
    plots: dependencies.plotDefinitions,
    progressions,
    progressionDefinition: dependencies.progressionDefinition,
    currencies: dependencies.currencyDefinitions,
    wallets,
    idempotency: crops,
    settlement: farmExpansionSettlement,
    economyService: new EconomyService(dependencies.ids, dependencies.clock),
    fingerprints: dependencies.fingerprints,
    clock: dependencies.clock
  });

  return async function handle(request: Request): Promise<Response> {
    const requestId = crypto.randomUUID();
    const url = new URL(request.url);

    try {
      if (request.method === "GET" && url.pathname === "/health") {
        return jsonResponse({ ok: true, data: { status: "ok" } });
      }

      const actor: ActorContext | null = await dependencies.authenticator.authenticate(request);

      if (request.method === "POST" && url.pathname === "/farms") {
        const parsed = CreateFarmRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) {
          return failure("INVALID_INPUT", requestId);
        }
        const result = await createFarm.execute(actor, parsed.data);
        const body: ApiSuccess<{ farm: FarmDTO; membership: FarmMemberDTO }> = {
          ok: true,
          data: { farm: toFarmDTO(result.farm), membership: toMemberDTO(result.ownerMembership) }
        };
        return jsonResponse(body, 201);
      }

      if (request.method === "GET" && url.pathname === "/inventory") {
        const items = await getInventory.execute(actor);
        const body: ApiSuccess<{ items: InventoryEntryDTO[] }> = { ok: true, data: { items: [...items] } };
        return jsonResponse(body);
      }

      if (request.method === "GET" && url.pathname === "/shop") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const entries: ShopEntryDTO[] = dependencies.shopEntries.list().map(toShopEntryDTO);
        const body: ApiSuccess<{ entries: ShopEntryDTO[] }> = { ok: true, data: { entries } };
        return jsonResponse(body);
      }

      if (request.method === "GET" && url.pathname === "/wallet") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const balances: WalletDTO[] = (await wallets.listByPlayer(actor.playerId)).map(toWalletDTO);
        const body: ApiSuccess<{ wallets: WalletDTO[] }> = { ok: true, data: { wallets: balances } };
        return jsonResponse(body);
      }

      if (request.method === "GET" && url.pathname === "/progression") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const view: PlayerProgressionDTO = await getProgression.execute(actor);
        const body: ApiSuccess<{ progression: PlayerProgressionDTO }> = {
          ok: true,
          data: { progression: view }
        };
        return jsonResponse(body);
      }

      if (request.method === "GET" && url.pathname === "/crop-definitions") {
        if (actor === null) return failure("NOT_AUTHENTICATED", requestId);
        const definitions: CropDefinitionDTO[] = [...listCropDefinitions.execute(actor)];
        const body: ApiSuccess<{ definitions: CropDefinitionDTO[] }> = {
          ok: true,
          data: { definitions }
        };
        return jsonResponse(body);
      }

      if (request.method === "POST" && (url.pathname === "/shop/buy" || url.pathname === "/shop/sell")) {
        const schema = url.pathname === "/shop/buy" ? BuyItemRequestSchema : SellItemRequestSchema;
        const parsed = schema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        if (url.pathname === "/shop/buy") {
          const settlement: BuyItemResultDTO = await buyItem.execute(actor, parsed.data);
          return jsonResponse({ ok: true, data: { settlement } });
        }
        const settlement: SellItemResultDTO = await sellItem.execute(actor, parsed.data);
        return jsonResponse({ ok: true, data: { settlement } });
      }

      const harvestRoute = /^\/farms\/([^/]+)\/crops\/([^/]+)\/harvest$/.exec(url.pathname);
      if (request.method === "POST" && harvestRoute?.[1] !== undefined && harvestRoute[2] !== undefined) {
        const decodedFarmId = decodePathSegment(harvestRoute[1]);
        const decodedCropId = decodePathSegment(harvestRoute[2]);
        if (
          decodedFarmId === null ||
          decodedCropId === null ||
          !FarmIdSchema.safeParse(decodedFarmId).success ||
          !CropInstanceIdSchema.safeParse(decodedCropId).success
        ) {
          return failure("INVALID_INPUT", requestId);
        }
        const parsed = HarvestCropRequestSchema.safeParse(await parseJson(request));
        if (!parsed.success) return failure("INVALID_INPUT", requestId);
        const result = await harvestCrop.execute(actor, parseFarmId(decodedFarmId), {
          ...parsed.data,
          cropInstanceId: decodedCropId
        });
        const body: ApiSuccess<{ harvest: HarvestResultDTO; progression: XpAwardDTO }> = {
          ok: true,
          data: result
        };
        return jsonResponse(body);
      }

      const cropRoute = /^\/farms\/([^/]+)\/crops$/.exec(url.pathname);
      if (cropRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(cropRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmId = parseFarmId(decodedId);
        if (request.method === "POST") {
          const parsed = PlantCropRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const crop = await plantCrop.execute(actor, farmId, parsed.data);
          const body: ApiSuccess<{ crop: CropStateDTO }> = { ok: true, data: { crop } };
          return jsonResponse(body, 201);
        }
        if (request.method === "GET") {
          const cropStates = await getFarmCrops.execute(actor, farmId);
          const body: ApiSuccess<{ crops: CropStateDTO[] }> = { ok: true, data: { crops: [...cropStates] } };
          return jsonResponse(body);
        }
      }

      const plotsRoute = /^\/farms\/([^/]+)\/plots$/.exec(url.pathname);
      if (plotsRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(plotsRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) return failure("INVALID_INPUT", requestId);
        const farmId = parseFarmId(decodedId);
        if (request.method === "GET") {
          const plots: PlotDTO[] = (await listPlots.execute(actor, farmId)).map((view) =>
            toPlotDTO(view, dependencies.currencyDefinitions)
          );
          return jsonResponse({ ok: true, data: { plots } });
        }
        if (request.method === "POST") {
          const parsed = ExpandFarmRequestSchema.safeParse(await parseJson(request));
          if (!parsed.success) return failure("INVALID_INPUT", requestId);
          const expansion: ExpandFarmResultDTO = await expandFarm.execute(actor, farmId, parsed.data);
          return jsonResponse({ ok: true, data: { expansion } });
        }
      }

      const match = /^\/farms\/([^/]+)$/.exec(url.pathname);
      const tilesRoute = /^\/farms\/([^/]+)\/tiles$/.exec(url.pathname);
      if (request.method === "GET" && tilesRoute?.[1] !== undefined) {
        const decodedId = decodePathSegment(tilesRoute[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const farmTiles = await listFarmTiles.execute(actor, parseFarmId(decodedId));
        const body: ApiSuccess<{ tiles: FarmTileDTO[] }> = { ok: true, data: { tiles: [...farmTiles] } };
        return jsonResponse(body);
      }

      if (request.method === "GET" && match?.[1] !== undefined) {
        const decodedId = decodePathSegment(match[1]);
        if (decodedId === null || !FarmIdSchema.safeParse(decodedId).success) {
          return failure("INVALID_INPUT", requestId);
        }
        const result = await getFarm.execute(actor, parseFarmId(decodedId));
        const body: ApiSuccess<{ farm: FarmDTO; membership: FarmMemberDTO }> = {
          ok: true,
          data: { farm: toFarmDTO(result.farm), membership: toMemberDTO(result.membership) }
        };
        return jsonResponse(body);
      }

      return failure("RESOURCE_NOT_FOUND", requestId);
    } catch (error: unknown) {
      if (error instanceof ApplicationError) {
        return failure(error.code, requestId);
      }
      return failure("INTERNAL_ERROR", requestId);
    }
  };
}
