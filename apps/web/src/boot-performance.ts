/**
 * Opt-in boot diagnostics for local development.
 *
 * Enable with `?perf=1` in a Vite development page. Nothing is marked, logged, or exposed on the
 * normal path, and API diagnostics never include request bodies, headers, cookies, or response data.
 */

export const BOOT_PERF_STAGES = [
  "app_started",
  "session_resolved",
  "farm_loaded",
  "renderer_init_started",
  "first_3d_frame",
  "reconcile_started",
  "reconcile_finished",
  "warehouse_ready",
  "game_interactive"
] as const;

export type BootPerfStage = (typeof BOOT_PERF_STAGES)[number];

interface BootPerfRecord {
  readonly stage: BootPerfStage;
  readonly elapsedMs: number;
  readonly sincePreviousMs: number;
}

interface ApiPerfRecord {
  readonly method: string;
  readonly path: string;
  readonly status: number | "error";
  readonly elapsedMs: number;
}

export interface BootPerfParserIssue {
  readonly path: readonly (string | number)[];
  readonly code: string;
  readonly expected?: string;
  readonly received?: string;
}

export interface BootPerfParserDiagnostic {
  readonly requestId: number;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly issues: readonly BootPerfParserIssue[];
}

interface BootPerfWindow extends Window {
  __happyFarmBootPerf?: {
    readonly stages: BootPerfRecord[];
    readonly api: ApiPerfRecord[];
    readonly parserFailures: BootPerfParserDiagnostic[];
  };
}

export function bootPerfEnabledFor(search: string, isDev: boolean): boolean {
  return isDev && new URLSearchParams(search).get("perf") === "1";
}

const enabled =
  typeof window !== "undefined" &&
  bootPerfEnabledFor(window.location.search, import.meta.env.DEV);

if (enabled) {
  console.info("[happy-farm interaction]", {
    event: "diagnostics_enabled",
    mode: "development",
    query: "perf=1"
  });
}

let sequence = 0;
const apiStarts = new Map<number, number>();

function state(): {
  readonly stages: BootPerfRecord[];
  readonly api: ApiPerfRecord[];
  readonly parserFailures: BootPerfParserDiagnostic[];
} | null {
  if (!enabled) return null;
  const host = window as BootPerfWindow;
  if (host.__happyFarmBootPerf === undefined) {
    host.__happyFarmBootPerf = { stages: [], api: [], parserFailures: [] };
  }
  return host.__happyFarmBootPerf;
}

function elapsed(now: number): number {
  return Math.round(now * 100) / 100;
}

export function bootPerfMark(stage: BootPerfStage): void {
  if (!enabled) return;
  const now = performance.now();
  performance.mark(stage);
  const snapshot = state();
  if (snapshot === null) return;
  const previous = snapshot.stages.at(-1)?.elapsedMs ?? 0;
  const record = { stage, elapsedMs: elapsed(now), sincePreviousMs: elapsed(now - previous) };
  snapshot.stages.push(record);
  console.info(
    `[happy-farm boot] ${stage} +${String(record.elapsedMs)}ms (${String(record.sincePreviousMs)}ms since previous)`
  );
}

export function bootPerfApiStart(): number | null {
  if (!enabled) return null;
  const id = ++sequence;
  apiStarts.set(id, performance.now());
  return id;
}

export function bootPerfApiEnd(
  id: number | null,
  method: string,
  path: string,
  status: number | "error"
): void {
  if (id === null) return;
  const started = apiStarts.get(id);
  apiStarts.delete(id);
  if (started === undefined) return;
  const snapshot = state();
  if (snapshot === null) return;
  const record = { method, path, status, elapsedMs: elapsed(performance.now() - started) };
  snapshot.api.push(record);
  console.info(`[happy-farm api] ${method} ${path} ${String(status)} ${String(record.elapsedMs)}ms`);
}

const OPAQUE_IDENTIFIER = /^[a-z][a-z0-9-]*_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAFE_TYPE_LABEL = /^(?:any|array|bigint|boolean|date|function|integer|nan|never|null|number|object|string|symbol|undefined|unknown)$/;
const DYNAMIC_ROUTE_COLLECTIONS = new Set(["farms", "crops", "trees", "constructions", "ponds", "work-areas", "assignments", "jobs"]);

/** Keeps route shape while removing farm/player/entity identifiers and every query parameter. */
export function sanitizeBootPerfPath(path: string): string {
  const withoutQuery = path.split(/[?#]/u, 1)[0] ?? "";
  const segments = withoutQuery.split("/");
  let redactNext = false;
  return segments
    .map((segment) => {
      if (segment === "") return "";
      if (redactNext) {
        redactNext = false;
        return ":id";
      }
      let decoded = segment;
      try {
        decoded = decodeURIComponent(segment);
      } catch {
        return ":id";
      }
      if (DYNAMIC_ROUTE_COLLECTIONS.has(decoded)) redactNext = true;
      return OPAQUE_IDENTIFIER.test(decoded) ? ":id" : decoded;
    })
    .join("/");
}

function safeTypeLabel(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_TYPE_LABEL.test(value) ? value : undefined;
}

function parserIssues(error: unknown): readonly BootPerfParserIssue[] {
  if (typeof error !== "object" || error === null || !("issues" in error)) return [];
  const issues = (error as { readonly issues?: unknown }).issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue): BootPerfParserIssue[] => {
    if (typeof issue !== "object" || issue === null) return [];
    const record = issue as {
      readonly path?: unknown;
      readonly code?: unknown;
      readonly expected?: unknown;
      readonly received?: unknown;
      readonly message?: unknown;
    };
    const path = Array.isArray(record.path)
      ? record.path
          .filter(
            (part): part is string | number =>
              (typeof part === "string" && part.length <= 80) ||
              (typeof part === "number" && Number.isSafeInteger(part))
          )
          .slice(0, 20)
      : [];
    const diagnostic: BootPerfParserIssue = {
      path,
      code: typeof record.code === "string" && record.code.length <= 80 ? record.code : "unknown"
    };
    const expected = safeTypeLabel(record.expected);
    const receivedFromIssue = safeTypeLabel(record.received);
    const receivedFromMessage =
      typeof record.message === "string"
        ? safeTypeLabel(/\breceived ([a-z]+)\b/u.exec(record.message)?.[1])
        : undefined;
    const received = receivedFromIssue ?? receivedFromMessage;
    if (expected !== undefined) {
      return [{ ...diagnostic, expected, ...(received === undefined ? {} : { received }) }];
    }
    if (received !== undefined) return [{ ...diagnostic, received }];
    return [diagnostic];
  });
}

export function buildBootPerfParserDiagnostic(
  requestId: number,
  method: string,
  path: string,
  status: number,
  error: unknown
): BootPerfParserDiagnostic {
  return {
    requestId,
    method,
    path: sanitizeBootPerfPath(path),
    status,
    issues: parserIssues(error)
  };
}

/** Logs only opt-in development diagnostics; the normal user-facing error remains unchanged. */
export function bootPerfApiValidationFailure(
  id: number | null,
  method: string,
  path: string,
  status: number,
  error: unknown
): void {
  if (id === null) return;
  const diagnostic = buildBootPerfParserDiagnostic(id, method, path, status, error);
  const snapshot = state();
  if (snapshot === null) return;
  snapshot.parserFailures.push(diagnostic);
  console.error("[happy-farm api] parser", diagnostic);
}

/** Logs opt-in world-interaction diagnostics without changing game behaviour or network traffic. */
export function bootPerfInteractionDiagnostic(
  event: string,
  details: Readonly<Record<string, unknown>>
): void {
  if (!enabled) return;
  console.info("[happy-farm interaction]", event, details);
}

/** Creates a short-lived dev-only trace id for one world-object click. */
export function bootPerfInteractionTraceId(): string | null {
  if (!enabled) return null;
  return `object-${String(++sequence)}`;
}

/** Logs one step of a dev-only object-click trace without changing runtime behaviour. */
export function bootPerfInteractionTrace(
  traceId: string | null,
  event: string,
  details: Readonly<Record<string, unknown>>
): void {
  if (traceId === null) return;
  console.info("[happy-farm interaction]", { traceId, event, ...details });
}

