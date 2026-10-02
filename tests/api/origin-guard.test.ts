import { describe, expect, it } from "vitest";
import { rejectsCrossOriginRequest } from "../../workers/api/src/origin-guard";

/**
 * The CSRF rule for cookie-borne sessions.
 *
 * A guest credential is a cookie, and a cookie is what a browser sends without a page asking. The
 * guard is what stops another site from driving a mutation with it: an unsafe request a browser says
 * came from a different origin is refused, while a safe read and a non-browser client (curl, a smoke
 * test) are left alone.
 */
function request(method: string, origin?: string): Request {
  return new Request("https://happyfarm-staging.longfx.trade/api/farms", {
    method,
    ...(origin === undefined ? {} : { headers: { origin } })
  });
}

describe("cross-origin mutation guard", () => {
  it("rejects an unsafe request whose Origin is another site", () => {
    expect(rejectsCrossOriginRequest(request("POST", "https://evil.example"))).toBe(true);
    expect(rejectsCrossOriginRequest(request("POST", "null"))).toBe(true);
    expect(rejectsCrossOriginRequest(request("PUT", "http://happyfarm-staging.longfx.trade"))).toBe(true);
    expect(rejectsCrossOriginRequest(request("DELETE", "https://happyfarm-staging.longfx.trade.evil.test"))).toBe(true);
  });

  it("allows an unsafe request from this very origin", () => {
    expect(rejectsCrossOriginRequest(request("POST", "https://happyfarm-staging.longfx.trade"))).toBe(false);
    expect(rejectsCrossOriginRequest(request("PATCH", "https://happyfarm-staging.longfx.trade"))).toBe(false);
  });

  it("leaves safe methods and requests without an Origin alone", () => {
    expect(rejectsCrossOriginRequest(request("GET", "https://evil.example"))).toBe(false);
    expect(rejectsCrossOriginRequest(request("HEAD", "https://evil.example"))).toBe(false);
    // curl and server-to-server clients send no Origin; the rule is about browsers, and a
    // non-browser client cannot be protected by it.
    expect(rejectsCrossOriginRequest(request("POST"))).toBe(false);
  });
});
