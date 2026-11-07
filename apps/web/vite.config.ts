import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import type { DevApiHost } from "../../workers/api/dev/api-host";
import { createHostCache, isServerSourceChange } from "./dev-api-host-cache";

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

/**
 * The origin the browser used, read from the `Host` header it sent.
 *
 * The request handed to the Worker has to describe *the same request the browser made*, and that
 * includes its origin. The API compares a browser's `Origin` header against the request's own origin -
 * a cross-site unsafe request is refused before it is authenticated - so a bridge that rebuilds every
 * request as `http://localhost` makes a page served at `http://localhost:5173` look like another site:
 * every POST (create the farm, plant, harvest, trade, edit an object) was answered
 * `NOT_AUTHENTICATED`, while safe GETs went through. The deployed Worker sees the real origin, so this
 * is a development-bridge fidelity bug, not a rule to relax.
 *
 * A missing or unusable `Host` falls back to a placeholder, which is what a bare HTTP/1.0 client or a
 * unit test gets; such a request carries no `Origin` either, so the guard leaves it alone.
 */
export function originForRequest(request: IncomingMessage): string {
  const host = request.headers.host;
  if (typeof host !== "string" || host.length === 0 || host.length > 255) return "http://localhost";
  try {
    return new URL(`http://${host}`).origin;
  } catch {
    return "http://localhost";
  }
}

/** The same request, in the Worker's own terms: real origin, `/api` prefix stripped. */
export function toWebRequest(request: IncomingMessage, body: Uint8Array<ArrayBuffer>): Request {
  const url = new URL(request.url ?? "/", originForRequest(request));
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
      /**
       * The host is cached per generation, and a server-side edit retires it. `createDevApiHost`
       * captures `createHandler` when it is built, so a host memoized for the life of the dev server
       * would keep serving the routes and schemas from before the edit - the "stale worker"
       * failures of V14.5.1C and V14.5.2A. See `dev-api-host-cache.ts`.
       */
      const hostCache = createHostCache<DevApiHost>(() =>
        server.ssrLoadModule(resolve(repoRoot, HOST_MODULE)).then((loaded: unknown) => {
          const factory = loaded as {
            createDevApiHost: (options: { repoRoot: string }) => DevApiHost;
          };
          const host = factory.createDevApiHost({ repoRoot });
          if (host.farmOwnershipRepair.farmsRemoved > 0) {
            // A local database from before one-farm-per-player. The runner kept the farm the last
            // session was playing and removed the duplicates the old bootstrap left behind, because
            // the unique index that makes "one player, one farm" true cannot be created over them.
            server.config.logger.warn(
              `[dev-api] repaired ${String(host.farmOwnershipRepair.farmsRemoved)} abandoned duplicate farm(s) in the local database; kept ${host.farmOwnershipRepair.keptFarmIds.join(", ")}`
            );
          }
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
        })
      );

      const serverSourceRoots = [
        resolve(repoRoot, "workers"),
        resolve(repoRoot, "packages"),
        resolve(repoRoot, "database")
      ];
      server.watcher.on("all", (_event, file) => {
        if (!isServerSourceChange(file, serverSourceRoots)) return;
        // Drop both caches: the host instance *and* the SSR modules it was built from, so the next
        // request builds a host from the edited source instead of Vite's cached copy of it.
        hostCache.invalidate();
        server.moduleGraph.invalidateAll();
        server.config.logger.info(
          "[dev-api] server source changed; rebuilding the API host on the next request"
        );
      });

      server.middlewares.use((request, response, next) => {
        const url = request.url;
        if (url === undefined || !url.startsWith(`${API_PREFIX}/`)) {
          next();
          return;
        }
        void (async () => {
          hostCache.begin();
          try {
            const host = await hostCache.get();
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
          } finally {
            hostCache.end();
          }
        })();
      });
    }
  };
}

export default defineConfig({
  plugins: [devApiPlugin()],
  /**
   * The development server watches the tree for hot reloads.
   *
   * Two things are deliberate here, both from the V12 recovery audit:
   *
   * * **Native watching, never polling.** `usePolling` is absent and must stay absent. Polling walks
   *   the whole tree on a timer, and on a repository this size that alone can hold a core at full
   *   load. Vite's default watcher uses the platform's own change notifications, which cost nothing
   *   while nothing changes.
   * * **Build output and tool caches are ignored.** `dist/`, coverage, Wrangler's scratch state and
   *   the temporary directories a build or a screenshot pass writes into are not source. A watcher
   *   that follows them into a build re-triggers itself once per file it just produced.
   */
  server: {
    watch: {
      ignored: ["**/dist/**", "**/coverage/**", "**/.wrangler/**", "**/tmp/**", "**/.tmp/**"]
    }
  },
  build: {
    outDir: "dist",
    // Keep item thumbnails as cacheable, hashed files even when their SVG payload is small.
    // Other assets retain Vite's normal inline threshold.
    assetsInlineLimit: (filePath, content) =>
      filePath.replaceAll("\\", "/").includes("/src/assets/items/")
        ? false
        : content.byteLength < 4096
  }
});
