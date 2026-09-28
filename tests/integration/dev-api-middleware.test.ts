import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { Connect, Plugin, ViteDevServer } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import viteConfig from "../../apps/web/vite.config";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const TOKEN = "middleware-token-0123456789";
const DEV_PLAYER_ID = "player_33333333-3333-4333-8333-333333333333";
const PLUGIN_NAME = "happy-farm-dev-api";
/** Mirrors MAX_JSON_BODY_BYTES in workers/api/src/handler.ts. */
const MAX_FORWARDED_BODY_BYTES = 16_384;

const VALID_DEV_VARS = [
  "DEV_AUTH_ENABLED=true",
  `DEV_AUTH_TOKEN=${TOKEN}`,
  `DEV_PLAYER_ID=${DEV_PLAYER_ID}`,
  "DEV_AUTH_ISSUER=https://dev.happy-farm.local",
  "DEV_AUTH_SUBJECT=dev-player-one",
  ""
].join("\n");

class FakeRequest extends EventEmitter {
  method = "GET";
  url = "/";
  headers: Record<string, string> = {};
  destroyed = false;
  readonly chunks: readonly string[];
  private pump: NodeJS.Immediate | null = null;

  constructor(options: {
    readonly url: string;
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
    readonly chunks?: readonly string[];
  }) {
    super();
    this.url = options.url;
    this.method = options.method ?? "GET";
    this.headers = options.headers ?? {};
    this.chunks = options.chunks ?? (options.body === undefined ? [] : [options.body]);
  }

  /**
   * A real `IncomingMessage` stays paused until something reads it, so the socket buffers the body
   * and no byte can arrive before the consumer is listening. This fake delivers its chunks only
   * once a `data` listener exists, which keeps the test independent of how long the middleware
   * takes to start reading: a cold host load takes real time, and emitting on a fixed tick used to
   * drop the body and hang the request.
   */
  override on(eventName: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(eventName, listener);
    if (eventName === "data") this.scheduleDelivery();
    return this;
  }

  destroy(): this {
    this.destroyed = true;
    return this;
  }

  private scheduleDelivery(): void {
    if (this.pump !== null) return;
    this.pump = setImmediate(() => {
      this.pump = null;
      for (const chunk of this.chunks) this.emit("data", new TextEncoder().encode(chunk));
      this.emit("end");
    });
  }
}

class FakeResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  writableFinished = false;
  destroyed = false;
  readonly headers: Record<string, string> = {};
  text = "";
  private settle = (): void => undefined;
  readonly finished = new Promise<void>((resolve) => {
    this.settle = resolve;
  });

  setHeader(key: string, value: string | number | readonly string[]): void {
    this.headers[key.toLowerCase()] = String(value);
  }

  /**
   * A real `ServerResponse` reports its flush through `finish`, and `close` when the peer goes
   * away. The middleware waits for that signal before tearing an oversized request down, so the
   * fake has to emit it instead of only recording the body.
   */
  end(chunk?: string | Uint8Array): void {
    this.text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk ?? new Uint8Array());
    this.headersSent = true;
    this.writableFinished = true;
    this.settle();
    this.emit("finish");
  }

  destroy(): this {
    this.destroyed = true;
    this.emit("close");
    return this;
  }
}

interface CallResult {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly destroyed: boolean;
}

describe("Vite development API bridge", () => {
  let databaseDir = "";
  let devVarsPath = "";
  let middleware: Connect.NextHandleFunction | null = null;
  let nextCalls = 0;
  let warnings: string[] = [];

  beforeEach(() => {
    // The bindings live in the temp directory, never in `workers/api/.dev.vars`: that file holds
    // the developer's real token, and a run interrupted before `afterEach` must not replace it with
    // this fixture.
    databaseDir = mkdtempSync(join(tmpdir(), "happy-farm-middleware-"));
    devVarsPath = join(databaseDir, ".dev.vars");
    writeFileSync(devVarsPath, VALID_DEV_VARS, "utf8");
    process.env.DEV_VARS_PATH = devVarsPath;
    process.env.DEV_DATABASE_PATH = join(databaseDir, "dev-local.sqlite");

    nextCalls = 0;
    warnings = [];
    // Vite's `PluginOption` may also be an array or a promise; the config under test is a flat list.
    const plugins = (viteConfig.plugins ?? []) as unknown as readonly Plugin[];
    const plugin = plugins.find((entry) => entry.name === PLUGIN_NAME);
    if (plugin === undefined) throw new Error(`missing Vite plugin ${PLUGIN_NAME}`);
    const { configureServer } = plugin;
    if (typeof configureServer !== "function") throw new Error("the dev API plugin cannot configure a server");
    // Vite's hook accepts a plugin context as `this`; the hook under test ignores it.
    const runConfigureServer = configureServer as unknown as (this: unknown, target: ViteDevServer) => void;
    const server = {
      config: {
        root: join(REPO_ROOT, "apps", "web"),
        logger: {
          info: () => undefined,
          warn: (message: string) => warnings.push(message),
          error: (message: string) => warnings.push(`error: ${message}`)
        }
      },
      middlewares: {
        use: (handler: Connect.NextHandleFunction) => {
          middleware = handler;
        }
      },
      ssrLoadModule: (absolutePath: string) => import(pathToFileURL(absolutePath).href)
    } as unknown as ViteDevServer;
    runConfigureServer.call(plugin, server);
    expect(middleware).not.toBeNull();
  });

  afterEach(() => {
    delete process.env.DEV_VARS_PATH;
    delete process.env.DEV_DATABASE_PATH;
    try {
      rmSync(databaseDir, { recursive: true, force: true });
    } catch {
      // Windows can hold the database file briefly; the temp directory is disposable.
    }
  });

  async function call(
    method: string,
    url: string,
    options: {
      readonly token?: string;
      readonly body?: unknown;
      readonly rawChunks?: readonly string[];
      readonly declaredContentLength?: string;
    } = {}
  ): Promise<CallResult> {
    const handler = middleware;
    if (handler === null) throw new Error("middleware was not installed");
    const headers: Record<string, string> = {};
    if (options.token !== undefined) headers.authorization = `Bearer ${options.token}`;
    if (options.declaredContentLength !== undefined) {
      headers["content-length"] = options.declaredContentLength;
    }
    const request = new FakeRequest({
      url,
      method,
      headers,
      ...(options.rawChunks !== undefined
        ? { chunks: options.rawChunks }
        : options.body === undefined
          ? {}
          : { body: JSON.stringify(options.body) })
    });
    if (options.body !== undefined) headers["content-type"] = "application/json";
    const response = new FakeResponse();
    handler(
      request as unknown as IncomingMessage,
      response as unknown as ServerResponse,
      () => {
        nextCalls += 1;
      }
    );
    await response.finished;
    // Let the middleware run its own async tail (for example tearing an oversized request down)
    // before the test observes the request it was handed.
    await new Promise<void>((resolve) => {
      setImmediate(resolve);
    });
    let body: unknown = null;
    try {
      body = JSON.parse(response.text);
    } catch {
      body = null;
    }
    return { status: response.statusCode, headers: response.headers, body, destroyed: request.destroyed };
  }

  it("passes non-API requests through to the other middlewares", () => {
    const handler = middleware;
    if (handler === null) throw new Error("middleware was not installed");
    handler(
      new FakeRequest({ url: "/src/main.ts" }) as unknown as IncomingMessage,
      new FakeResponse() as unknown as ServerResponse,
      () => {
        nextCalls += 1;
      }
    );
    expect(nextCalls).toBe(1);
  });

  it("strips the /api prefix and forwards the development API response", async () => {
    const health = await call("GET", "/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ ok: true, data: { status: "ok" } });
    expect(health.headers["content-type"]).toContain("json");
  });

  it("does not let the proxy bypass authentication", async () => {
    const anonymous = await call("GET", "/api/wallet");
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ ok: false, error: { code: "NOT_AUTHENTICATED" } });

    const wrong = await call("GET", "/api/wallet", { token: "not-the-dev-token" });
    expect(wrong.status).toBe(401);
  });

  it("forwards headers and JSON bodies to the real development Worker", async () => {
    const bootstrap = await call("POST", "/api/__dev/bootstrap", { token: TOKEN });
    expect(bootstrap.status).toBe(200);
    expect(bootstrap.body).toMatchObject({ ok: true, data: { player: { playerId: DEV_PLAYER_ID, created: true } } });

    const farm = await call("POST", "/api/farms", { token: TOKEN, body: { name: "Middleware Farm" } });
    expect(farm.status).toBe(201);
    expect(farm.body).toMatchObject({ ok: true, data: { farm: { name: "Middleware Farm", ownerPlayerId: DEV_PLAYER_ID } } });

    const created = (farm.body as { data?: { farm?: { id?: string } } }).data?.farm?.id ?? "";
    const tiles = await call("GET", `/api/farms/${created}/tiles`, { token: TOKEN });
    expect(tiles.status).toBe(200);
    expect((tiles.body as { data?: { tiles?: unknown[] } }).data?.tiles).toHaveLength(36);
    expect(warnings).toEqual([]);
  });

  it("still refuses a client-supplied body on the bootstrap route", async () => {
    const blocked = await call("POST", "/api/__dev/bootstrap", { token: TOKEN, body: { playerId: "player_evil" } });
    expect(blocked.status).toBe(400);
    expect(blocked.body).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
  });

  it("refuses a declared oversized body from the header alone, without reading the body", async () => {
    // No chunk is ever emitted, so waiting for the body could not complete. Answering 400 here is
    // what proves the refusal came from the declared content-length and nothing was buffered.
    const declared = await call("POST", "/api/farms", {
      token: TOKEN,
      declaredContentLength: String(MAX_FORWARDED_BODY_BYTES + 1)
    });
    expect(declared.status).toBe(400);
    expect(declared.body).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    expect(declared.destroyed).toBe(true);
    expect(warnings.some((entry) => entry.includes("refused a request body over"))).toBe(true);
  });

  it("stops buffering a streamed body once it crosses the limit", async () => {
    const chunk = "x".repeat(4_096);
    const streamed = await call("POST", "/api/farms", {
      token: TOKEN,
      rawChunks: [chunk, chunk, chunk, chunk, chunk, chunk]
    });
    expect(streamed.status).toBe(400);
    expect(streamed.body).toMatchObject({ ok: false, error: { code: "INVALID_INPUT" } });
    // The upload was abandoned and torn down rather than drained to the end.
    expect(streamed.destroyed).toBe(true);
    expect(warnings.some((entry) => entry.includes("refused a request body over"))).toBe(true);
  });

  it("forwards a body that only reaches the limit, leaving the verdict to the worker", async () => {
    const atLimit = await call("POST", "/api/farms", {
      token: TOKEN,
      rawChunks: ["y".repeat(MAX_FORWARDED_BODY_BYTES)]
    });
    expect(atLimit.destroyed).toBe(false);
    expect(warnings.some((entry) => entry.includes("refused a request body over"))).toBe(false);
  });
});
