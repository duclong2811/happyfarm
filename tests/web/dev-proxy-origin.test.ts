import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { originForRequest, toWebRequest } from "../../apps/web/vite.config";
import { rejectsCrossOriginRequest } from "../../workers/api/src/origin-guard";

/**
 * The development bridge must hand the Worker the request the browser actually made.
 *
 * The API refuses an unsafe request whose `Origin` header names a different origin than the request
 * itself - the rule that stops another site from driving a cookie-borne mutation. Rebuilding every
 * proxied request as `http://localhost` (no port) made a page served at `http://localhost:5173` look
 * like another site, so every POST from the browser was answered `NOT_AUTHENTICATED` while GETs sailed
 * through: the shell loaded, the wallet read 0, and the world never started.
 *
 * These tests hold the bridge to the browser's own origin, and hold the guard to its job.
 */

function proxiedMessage(headers: Record<string, string>): IncomingMessage {
  // The middleware only reads `url`, `method` and `headers` from the Node request.
  return { url: "/api/farms", method: "POST", headers } as unknown as IncomingMessage;
}

function proxied(request: IncomingMessage): Request {
  return toWebRequest(request, new Uint8Array());
}

describe("the development proxy's request origin", () => {
  it("takes the origin from the Host the browser used, port and all", () => {
    expect(originForRequest(proxiedMessage({ host: "localhost:5173" }))).toBe("http://localhost:5173");
    expect(originForRequest(proxiedMessage({ host: "127.0.0.1:5174" }))).toBe("http://127.0.0.1:5174");
    expect(originForRequest(proxiedMessage({ host: "192.168.1.20:5173" }))).toBe("http://192.168.1.20:5173");
  });

  it("falls back to a placeholder when there is no usable Host", () => {
    expect(originForRequest(proxiedMessage({}))).toBe("http://localhost");
    expect(originForRequest(proxiedMessage({ host: "" }))).toBe("http://localhost");
    expect(originForRequest(proxiedMessage({ host: "not a host:" }))).toBe("http://localhost");
  });

  it("rebuilds the request at that origin, with the API prefix stripped and the query kept", () => {
    const request = toWebRequest(
      { url: "/api/farms/123/tiles?x=1", method: "GET", headers: { host: "localhost:5173" } } as unknown as IncomingMessage,
      new Uint8Array()
    );
    expect(new URL(request.url).origin).toBe("http://localhost:5173");
    expect(new URL(request.url).pathname).toBe("/farms/123/tiles");
    expect(new URL(request.url).search).toBe("?x=1");
  });
});

describe("the browser's own POST survives the guard", () => {
  it("is not treated as cross-origin", () => {
    // This is the exact request the browser made when it failed: a POST from the page's own origin.
    const request = proxied(proxiedMessage({ host: "localhost:5173", origin: "http://localhost:5173" }));
    expect(rejectsCrossOriginRequest(request)).toBe(false);
  });

  it("still refuses a mutation the browser says came from another site", () => {
    const foreign = proxied(proxiedMessage({ host: "localhost:5173", origin: "http://evil.example" }));
    expect(rejectsCrossOriginRequest(foreign)).toBe(true);
    // And a request with no Origin at all is left alone: curl and the smoke tests are not the threat.
    expect(rejectsCrossOriginRequest(proxied(proxiedMessage({ host: "localhost:5173" })))).toBe(false);
  });
});
