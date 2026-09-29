import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import type { DevApiHost } from "../../workers/api/dev/api-host";

/**
 * Serves the development API on the same origin as the UI.
 *
 * The middleware forwards `/api/*` to the real development Worker entrypoint
 * (`workers/api/dev/api-host.ts` -> `workers/api/src/dev-index.ts`) with the prefix stripped.
 * Same-origin keeps the development bearer token out of URLs and avoids wildcard CORS.
 *
 * This file is Node-side development tooling and is never part of the browser bundle, so the
 * `workers/api` reference below does not create a runtime dependency from the frontend to server
 * code. The host module is loaded lazily by path rather than imported at module scope.
 */
const API_PREFIX = "/api";
const HOST_MODULE = "workers/api/dev/api-host.ts";

/**
 * Upper bound on how much of a request body the proxy is willing to buffer.
 *
 * Mirrors MAX_JSON_BODY_BYTES in workers/api/src/handler.ts, which stays the authority on the
 * exact limit. This only stops the development server from holding an unbounded stream in memory,
 * and the rejection reuses the worker error code so the proxy stays transparent to the UI.
 */
const MAX_FORWARDED_BODY_BYTES = 16_384;

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return merged;
}

class RequestBodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds the development proxy limit");
    this.name = "RequestBodyTooLargeError";
  }
}

function tooLargeResponse(): Response {
  // Mirrors the worker failure envelope, requestId included, so a refusal from the proxy parses
  // in the UI exactly like any other API error.
  return new Response(
    JSON.stringify({ ok: false, error: { code: "INVALID_INPUT", requestId: crypto.randomUUID() } }),
    { status: 400, headers: { "content-type": "application/json" } }
  );
}

/**
 * Buffers a request body without ever holding more than MAX_FORWARDED_BODY_BYTES in memory.
 *
 * A declared content-length over the limit is refused before a single byte is read. A chunked body
 * that crosses the limit while arriving is abandoned rather than buffered, and the middleware then
 * tears the request down once it has flushed the rejection.
 */
function readRequestBody(request: IncomingMessage): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const declared = request.headers["content-length"];
    if (declared !== undefined) {
      const declaredLength = Number(declared);
      if (!Number.isFinite(declaredLength) || declaredLength > MAX_FORWARDED_BODY_BYTES) {
        reject(new RequestBodyTooLargeError());
        return;
      }
    }

    const chunks: Uint8Array[] = [];
    let total = 0;

    function detach(): void {
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("error", onError);
    }

    function onData(chunk: Uint8Array): void {
      total += chunk.byteLength;
      if (total > MAX_FORWARDED_BODY_BYTES) {
        detach();
        reject(new RequestBodyTooLargeError());
        return;
      }
      chunks.push(chunk);
    }

    function onEnd(): void {
      detach();
      resolve(concatChunks(chunks));
    }

    function onError(error: Error): void {
      detach();
      reject(error);
    }

    request.on("data", onData);
    request.on("end", onEnd);
    request.on("error", onError);
  });
}

function toWebRequest(request: IncomingMessage, body: Uint8Array<ArrayBuffer>): Request {
  const url = new URL(request.url ?? "/", "http://localhost");
  url.pathname = url.pathname.slice(API_PREFIX.length) || "/";
  const headers = new Headers();
  for (const [key, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const method = request.method ?? "GET";
  const init: RequestInit = { method, headers };
  if (body.byteLength > 0 && method !== "GET" && method !== "HEAD") {
    init.body = body;
  }
  return new Request(url, init);
}

function isLoopbackRequest(request: IncomingMessage): boolean {
  const host = request.headers.host;
  if (host === undefined) return false;
  try {
    const hostname = new URL(`http://${host}`).hostname;
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

async function respond(response: ServerResponse, apiResponse: Response): Promise<void> {
  response.statusCode = apiResponse.status;
  apiResponse.headers.forEach((value, key) => {
    response.setHeader(key, value);
  });
  const payload = new Uint8Array(await apiResponse.arrayBuffer());
  response.setHeader("content-length", String(payload.byteLength));
  response.end(payload);
}

/**
 * Resolves once the pending response has actually been flushed off the process.
 *
 * `request.destroy()` tears down the shared socket, and because the refused body is deliberately
 * never read that teardown becomes a reset rather than a graceful close. Waiting for the flush
 * first keeps the refusal from being truncated on its way back to the browser. The wait must be
 * registered before `respond` runs, which is what makes the `finish` event observable at all.
 */
function flushOf(response: ServerResponse): Promise<void> {
  if (response.writableFinished || response.destroyed) return Promise.resolve();
  return new Promise((resolve) => {
    response.once("finish", resolve);
    response.once("close", resolve);
  });
}

function devApiPlugin(): Plugin {
  return {
    name: "happy-farm-dev-api",
    apply: "serve",
    configureServer(server: ViteDevServer) {
      const repoRoot = resolve(server.config.root, "..", "..");
      let hostPromise: Promise<DevApiHost> | null = null;

      const loadHost = (): Promise<DevApiHost> => {
        hostPromise ??= server
          .ssrLoadModule(resolve(repoRoot, HOST_MODULE))
          .then((loaded: unknown) => {
            const factory = loaded as {
              createDevApiHost: (options: { repoRoot: string }) => DevApiHost;
            };
            const host = factory.createDevApiHost({ repoRoot });
            server.config.logger.info(
              `[dev-api] database ${host.databasePath}${
                host.appliedMigrations.length > 0
                  ? ` (applied ${String(host.appliedMigrations.length)} migration(s))`
                  : ""
              }`
            );
            if (!host.configured) {
              server.config.logger.warn(
                "[dev-api] workers/api/.dev.vars is missing a development identity; every request will fail closed with NOT_AUTHENTICATED."
              );
            }
            return host;
          });
        return hostPromise;
      };

      server.middlewares.use((request, response, next) => {
        const url = request.url;
        if (url === undefined || !url.startsWith(`${API_PREFIX}/`)) {
          next();
          return;
        }
        void (async () => {
          try {
            const host = await loadHost();
            const workerRequest = toWebRequest(request, await readRequestBody(request));
            await respond(
              response,
              await (isLoopbackRequest(request)
                ? host.handleTrustedBrowserRequest(workerRequest)
                : host.handle(workerRequest))
            );
          } catch (error: unknown) {
            if (error instanceof RequestBodyTooLargeError) {
              server.config.logger.warn(
                `[dev-api] refused a request body over ${String(MAX_FORWARDED_BODY_BYTES)} bytes without buffering it`
              );
              try {
                const flush = flushOf(response);
                await respond(response, tooLargeResponse());
                await flush;
              } finally {
                // The rejection has been flushed, so the sender can now be stopped: a declared
                // content-length was refused before it was read, and a chunked body must not be
                // drained to the end just to be able to answer.
                request.destroy();
              }
              return;
            }
            server.config.logger.error(`[dev-api] request failed: ${String(error)}`);
            if (!response.headersSent) {
              response.statusCode = 500;
              response.setHeader("content-type", "application/json");
            }
            response.end(JSON.stringify({ ok: false, error: { code: "INTERNAL_ERROR" } }));
          }
        })();
      });
    }
  };
}

export default defineConfig({
  plugins: [devApiPlugin()],
  build: {
    outDir: "dist"
  }
});
