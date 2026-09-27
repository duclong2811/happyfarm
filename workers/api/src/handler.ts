import {
  CreateFarm,
  CropStateProjector,
  GetFarmCrops,
  GetFarm,
  PlantCrop,
  ApplicationError,
  type ActorContext,
  type AuthenticationPort,
  type Clock,
  type CropDefinitionRepository,
  type CropIdGenerator,
  type IdGenerator,
  type PayloadFingerprint
} from "@happy-farm/application";
import {
  CreateFarmRequestSchema,
  FarmIdSchema,
  PlantCropRequestSchema,
  type ApiFailure,
  type ApiSuccess,
  type ErrorCode,
  type FarmDTO,
  type FarmMemberDTO,
  type CropStateDTO
} from "@happy-farm/contracts";
import { parseFarmId } from "@happy-farm/domain";
import type { D1DatabaseLike } from "./d1-types";
import {
  D1CropRepository,
  D1FarmMemberRepository,
  D1FarmRepository,
  D1FarmTileRepository,
  D1PlayerRepository
} from "./d1-repositories";

const MAX_JSON_BODY_BYTES = 16_384;

export interface HandlerDependencies {
  readonly db: D1DatabaseLike;
  readonly authenticator: AuthenticationPort<Request>;
  readonly ids: IdGenerator & CropIdGenerator;
  readonly fingerprints: PayloadFingerprint;
  readonly cropDefinitions: CropDefinitionRepository;
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
      return 400;
    case "NOT_AUTHENTICATED":
      return 401;
    case "NOT_AUTHORIZED":
    case "FARM_PERMISSION_DENIED":
      return 403;
    case "RESOURCE_NOT_FOUND":
    case "CROP_DEFINITION_NOT_FOUND":
      return 404;
    case "CONFLICT_STALE_STATE":
    case "REQUEST_ALREADY_PROCESSED":
    case "TILE_OCCUPIED":
    case "TILE_NOT_PLANTABLE":
    case "IDEMPOTENCY_CONFLICT":
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
    unlockedLand,
    dependencies.ids,
    dependencies.fingerprints,
    dependencies.clock
  );
  const getFarmCrops = new GetFarmCrops(farms, members, crops, projector);

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

      const cropRoute = /^\/farms\/([^/]+)\/crops$/.exec(url.pathname);
      if (cropRoute?.[1] !== undefined) {
        const decodedId = decodeURIComponent(cropRoute[1]);
        if (!FarmIdSchema.safeParse(decodedId).success) return failure("INVALID_INPUT", requestId);
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

      const match = /^\/farms\/([^/]+)$/.exec(url.pathname);
      if (request.method === "GET" && match?.[1] !== undefined) {
        const decodedId = decodeURIComponent(match[1]);
        if (!FarmIdSchema.safeParse(decodedId).success) {
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
