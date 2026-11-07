import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { settleIndependentReads } from "../../apps/web/src/account-bootstrap";

const source = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8").replaceAll("\r\n", "\n");

function section(startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, startMarker).toBeGreaterThan(-1);
  expect(end, endMarker).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("non-blocking farm bootstrap", () => {
  it("loads minimum world data before renderer startup and defers settlement/account hydration", () => {
    const load = section("async function loadFarm(", "let productionReconcileInFlight");
    expect(load).toContain("await Promise.all([refreshFishing(), refreshResources(), refreshFarm()]);");
    expect(load).not.toContain("reconcileProductionOnce");
    expect(load).not.toContain("reconcileAutoOnce");
    expect(load).not.toContain("await refreshAccount();");

    const boot = section("async function boot(", "void run(boot);");
    expect(boot.indexOf("enable3D();")).toBeLessThan(boot.indexOf("startInitialEconomicBootstrap(context);"));
  });

  it("keeps reconciliation and account reads single-flight", () => {
    expect(source).toContain("let productionReconcileInFlight: Promise<boolean> | null = null;");
    expect(source).toContain("let autoReconcileInFlight: Promise<boolean> | null = null;");
    expect(source).toContain("let accountRefreshInFlight: Promise<void> | null = null;");
    const production = section("async function reconcileProductionOnce()", "async function reconcileAutoOnce()");
    expect(production).not.toContain("await refreshAccount();");
    expect(source).toContain("showReturnPopupOnce");
  });

  it("does not allow stale account state to issue economic commands", () => {
    expect(source).toContain("function economicStateReady(): boolean");
    expect(source).toContain("function requireEconomicState(): boolean");
    expect(source).toContain("if (!economicStateReady() || farmId === null || autoStepBusy || !autoIsDriving()) return;");
    expect(source).toContain("submit.disabled = !economicStateReady() || !canSubmit || marketTradePending;");
    expect(source).toContain("reconciliationPending = true;");
    expect(source).toContain("if (!economicStateReady()) {");
    expect(source).toContain("fishingTimer = null;");
    expect(source).toContain("gatherTimer = null;");
  });

  it("uses only the server reconciliation result for the return popup", () => {
    expect(source).toContain("lastProductionItems = result.producedItems;");
    expect(source).toContain("lastProductionReconcileSucceeded = true;");
    expect(source).toContain("showReturnPopupOnce(Math.max(0, context.returnAt - context.previousActiveAt), lastProductionItems);");
    expect(source).toContain("const rows = producedItems.filter((item) => item.quantity > 0);");
    expect(source).not.toMatch(/awayMs\s*\*|awayDuration\s*\*|treeCount\s*\*/u);
  });

  it("recovers from reconciliation failure without holding the renderer", () => {
    const bootstrap = section("function startInitialEconomicBootstrap(", "async function plant(");
    expect(bootstrap).toContain("catch {");
    expect(bootstrap).toContain("setStatus(message(\"status.syncFailed\"), true);");
    expect(bootstrap).toContain("finally {");
    expect(bootstrap).toContain("reconciliationPending = false;");
    expect(source).toContain("bootPerfMark(\"renderer_init_started\")");
    expect(source).toContain("bootPerfMark(\"first_3d_frame\")");
  });

  it("keeps a successful build catalogue when an unrelated account read fails", () => {
    const refresh = section("async function refreshAccount()", "function setSceneState(");
    expect(refresh).toContain("settleIndependentReads(reads");
    expect(refresh).toContain("state.buildCatalog = result.entries;");
    expect(refresh).toContain("buildCatalogStatus = \"error\";");
    expect(refresh).toContain("if (firstFailure !== null) {");
    expect(refresh).toContain("throw firstFailure instanceof Error ? firstFailure : new Error");
  });

  it("commits a catalog before an unrelated deferred read completes", async () => {
    let releaseOther: (value: string) => void = () => undefined;
    const other = new Promise<string>((resolve) => { releaseOther = resolve; });
    let catalog: string | null = null;
    let failed = false;
    const joined = settleIndependentReads(
      { catalog: Promise.resolve("catalog-ready"), other },
      {
        catalog: {
          onFulfilled: (value) => { catalog = value; },
          onRejected: () => { failed = true; }
        },
        other: {
          onFulfilled: () => undefined,
          onRejected: () => { failed = true; }
        }
      }
    );
    await Promise.resolve();
    expect(catalog).toBe("catalog-ready");
    expect(failed).toBe(false);
    releaseOther("done");
    await joined;
  });

  it("settles a rejected catalog instead of leaving the caller in loading", async () => {
    let status: "loading" | "error" = "loading";
    await settleIndependentReads(
      { catalog: Promise.reject(new Error("catalog unavailable")) },
      {
        catalog: {
          onFulfilled: () => { status = "error"; },
          onRejected: () => { status = "error"; }
        }
      }
    );
    expect(status).toBe("error");
  });

  it("does not commit a response from an older farm refresh", async () => {
    let releaseOld: (value: string) => void = () => undefined;
    const oldRead = new Promise<string>((resolve) => { releaseOld = resolve; });
    let generation = 1;
    const requestGeneration = generation;
    let catalog: string | null = null;
    const joined = settleIndependentReads(
      { catalog: oldRead },
      { catalog: {
        onFulfilled: (value) => { if (requestGeneration === generation) catalog = value; },
        onRejected: () => undefined
      } }
    );
    generation = 2;
    releaseOld("old-catalog");
    await joined;
    expect(catalog).toBeNull();
  });
});
