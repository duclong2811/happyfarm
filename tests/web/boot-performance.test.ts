import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BOOT_PERF_STAGES, bootPerfEnabledFor } from "../../apps/web/src/boot-performance";

const MAIN = fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url));
const SCENE = fileURLToPath(new URL("../../apps/web/src/render/scene.ts", import.meta.url));

describe("boot performance diagnostics", () => {
  it("enables diagnostics only for development pages with perf=1", () => {
    expect(bootPerfEnabledFor("?perf=1", true)).toBe(true);
    expect(bootPerfEnabledFor("?perf=0", true)).toBe(false);
    expect(bootPerfEnabledFor("?perf=1", false)).toBe(false);
  });

  it("keeps the requested stage vocabulary stable", () => {
    expect(BOOT_PERF_STAGES).toEqual([
      "app_started",
      "session_resolved",
      "farm_loaded",
      "renderer_init_started",
      "first_3d_frame",
      "reconcile_started",
      "reconcile_finished",
      "warehouse_ready",
      "game_interactive"
    ]);
  });

  it("marks session, farm, renderer, and interactive boundaries", () => {
    const main = readFileSync(MAIN, "utf8");
    const scene = readFileSync(SCENE, "utf8");
    for (const stage of BOOT_PERF_STAGES) {
      expect(main.includes(`bootPerfMark("${stage}")`) || scene.includes(`bootPerfMark("${stage}")`), stage).toBe(true);
    }
    expect(scene).toContain("options.onFirstFrame?.()");
  });

  it("logs the first pointer before the layered world picker and preserves its trace id", () => {
    const scene = readFileSync(SCENE, "utf8");
    const pointerLog = scene.indexOf('"pointer_received"');
    const pickerCall = scene.indexOf("const directWorldTarget = raycastWorldTargetAt(event.clientX, event.clientY, false);");
    expect(pointerLog).toBeGreaterThanOrEqual(0);
    expect(pickerCall).toBeGreaterThan(pointerLog);
    expect(scene).toContain('"object_picker_result"');
    expect(scene).toContain("options.onObjectSelected?.(picked.id, traceId)");
    expect(scene).toContain("prioritizeWorldPick({");
  });
});
