import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface ParserDiagnostic {
  readonly requestId: number;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly issues: readonly {
    readonly path: readonly (string | number)[];
    readonly code: string;
    readonly expected?: string;
    readonly received?: string;
  }[];
}

interface ErrorSpy {
  readonly mock: { readonly calls: readonly unknown[][] };
  mockRestore(): void;
}

interface ApiClientInstance {
  getInventory(): Promise<unknown>;
  getFarm(farmId: string): Promise<unknown>;
}

interface ApiModule {
  readonly ApiClient: new () => ApiClientInstance;
}

function envelope(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function validInventory(): unknown {
  return {
    items: [{ itemDefinitionId: "item_carrot_seed", displayNameKey: "item.carrot_seed.name", category: "SEED", quantity: 10 }]
  };
}

async function loadApi(): Promise<ApiModule> {
  vi.resetModules();
  vi.stubGlobal("window", { location: { search: "?perf=1" } });
  return import("../../apps/web/src/api");
}

describe("development API parser diagnostics", () => {
  let errorLog: ErrorSpy;

  beforeEach(() => {
    errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errorLog.mockRestore();
    vi.unstubAllGlobals();
  });

  it("identifies a malformed response by endpoint and Zod issue metadata", async () => {
    const { ApiClient } = await loadApi();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(envelope({
      items: [{ itemDefinitionId: "item_carrot_seed", displayNameKey: "item.carrot_seed.name", category: "SEED", quantity: "private-value" }]
    }))));

    await expect(new ApiClient().getInventory()).rejects.toMatchObject({ code: "INVALID_RESPONSE" });

    const call = errorLog.mock.calls.find(([label]) => label === "[happy-farm api] parser");
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({
      method: "GET",
      path: "/inventory",
      status: 200,
      issues: [{ path: ["items", 0, "quantity"], code: "invalid_type", expected: "number", received: "string" }]
    });
  });

  it("does not log a parser diagnostic for a valid response", async () => {
    const { ApiClient } = await loadApi();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(envelope(validInventory()))));

    await new ApiClient().getInventory();

    expect(errorLog).not.toHaveBeenCalledWith("[happy-farm api] parser", expect.anything());
  });

  it("redacts opaque identifiers, query secrets, and invalid values", async () => {
    const { buildBootPerfParserDiagnostic } = await import("../../apps/web/src/boot-performance");
    const diagnostic = buildBootPerfParserDiagnostic(
      17,
      "GET",
      "/farms/private-account/tiles?access_token=secret-token",
      200,
      { issues: [{ path: ["tiles", 0, "terrainType"], code: "invalid_value", expected: "string", received: "secret-response-value" }] }
    );

    expect(diagnostic.path).toBe("/farms/:id/tiles");
    expect(JSON.stringify(diagnostic)).not.toContain("private-account");
    expect(JSON.stringify(diagnostic)).not.toContain("secret-token");
    expect(JSON.stringify(diagnostic)).not.toContain("secret-response-value");
  });

  it("keeps concurrent parser failures distinguishable with request IDs", async () => {
    const { ApiClient } = await loadApi();
    let calls = 0;
    vi.stubGlobal("fetch", vi.fn(() => {
      calls += 1;
      const delay = calls === 1 ? 8 : 0;
      return new Promise<Response>((resolve) => {
        setTimeout(() => {
          resolve(envelope({
            items: [{ itemDefinitionId: "item_carrot_seed", displayNameKey: "item.carrot_seed.name", category: "SEED", quantity: "bad" }]
          }));
        }, delay);
      });
    }));

    await Promise.allSettled([new ApiClient().getInventory(), new ApiClient().getInventory()]);

    const diagnostics = errorLog.mock.calls
      .filter(([label]) => label === "[happy-farm api] parser")
      .map(([, diagnostic]) => diagnostic as ParserDiagnostic);
    expect(diagnostics).toHaveLength(2);
    expect(new Set(diagnostics.map((diagnostic) => diagnostic.requestId)).size).toBe(2);
    expect(diagnostics.every((diagnostic) => diagnostic.path === "/inventory" && diagnostic.status === 200)).toBe(true);
  });
});
