import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  FORESTRY_PANEL_FIELD_KEYS,
  MINING_PANEL_FIELD_KEYS,
  miningPanelState
} from "../../apps/web/src/mining/panel";
import type { AutoStepDTO } from "@happy-farm/contracts";

const node = { nodeId: "node_stone_ridge", definitionId: "resource_ore" } as const;
const job = { jobId: "job_11111111-1111-4111-8111-111111111111", kind: "MINING" as const, targetDefinitionId: "resource_ore", enabled: true };
const area = { kind: "MINING" as const, cellCount: 1 };

describe("Mining panel profession boundary", () => {
  it("renders the Mining branch without Forestry fields", () => {
    const source = readFileSync(fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url)), "utf8");
    const miningStart = source.indexOf('if (unifiedMining) {');
    const forestryRows = source.indexOf('row(t("forestry.origin")', miningStart);
    expect(miningStart).toBeGreaterThan(-1);
    expect(forestryRows).toBeGreaterThan(miningStart);
    expect(source.slice(miningStart, forestryRows)).not.toContain("forestry.");
  });

  it("uses Mining fields only and leaves Forestry fields in the Forestry surface", () => {
    expect(MINING_PANEL_FIELD_KEYS.every((key) => !key.startsWith("forestry."))).toBe(true);
    expect(FORESTRY_PANEL_FIELD_KEYS).toEqual([
      "forestry.origin",
      "forestry.type",
      "forestry.product",
      "forestry.yield",
      "forestry.status",
      "forestry.level"
    ]);
  });

  it("does not offer setup while Auto reads are unavailable", () => {
    expect(miningPanelState({
      node,
      actor: null,
      jobs: [],
      workAreas: [],
      autoPlan: null,
      autoStep: null,
      dataReady: false,
      dataError: true
    })).toMatchObject({ status: "AUTO_ERROR", action: "NONE" });
  });

  it("offers area setup, then assignment for an existing area", () => {
    expect(miningPanelState({
      node,
      actor: null,
      jobs: [],
      workAreas: [],
      autoPlan: null,
      autoStep: null,
      dataReady: true,
      dataError: false
    })).toMatchObject({ status: "SETUP_REQUIRED", action: "SETUP_AREA" });
    expect(miningPanelState({
      node,
      actor: null,
      jobs: [],
      workAreas: [area],
      autoPlan: null,
      autoStep: null,
      dataReady: true,
      dataError: false
    })).toMatchObject({ status: "NO_ASSIGNMENT", action: "ASSIGN" });
  });

  it("derives Start, travel, mining and cargo-full from server job state", () => {
    const base = { node, jobs: [job], workAreas: [area], autoPlan: null, autoStep: null, dataReady: true, dataError: false };
    expect(miningPanelState({ ...base, actor: { controlMode: "PLAYER_CONTROLLED" } })).toMatchObject({ status: "READY", action: "START" });
    const travelling = { phase: "TRAVELLING", jobId: job.jobId, waitReason: null } as AutoStepDTO;
    expect(miningPanelState({ ...base, actor: { controlMode: "AUTO_CONTROLLED" }, autoStep: travelling })).toMatchObject({ status: "TRAVELLING", action: "STOP" });
    const carrying = {
      phase: "TRAVELLING",
      jobId: job.jobId,
      waitReason: null,
      to: { kind: "WAREHOUSE", x: null, y: null }
    } as AutoStepDTO;
    expect(miningPanelState({ ...base, actor: { controlMode: "AUTO_CONTROLLED" }, autoStep: carrying })).toMatchObject({ status: "CARRYING", action: "STOP" });
    const stopped = { phase: "STOPPED", jobId: job.jobId, waitReason: null } as AutoStepDTO;
    expect(miningPanelState({ ...base, actor: { controlMode: "AUTO_CONTROLLED" }, autoStep: stopped })).toMatchObject({ status: "STOPPED", action: "START" });
    const full = { phase: "WAITING", jobId: job.jobId, waitReason: "CARGO_FULL" } as AutoStepDTO;
    expect(miningPanelState({ ...base, actor: { controlMode: "AUTO_CONTROLLED" }, autoStep: full })).toMatchObject({ status: "CARGO_FULL", action: "STOP" });
  });

  it("does not call a plan-only MINE preview active mining", () => {
    const plan = {
      actorId: "actor_11111111-1111-4111-8111-111111111111",
      controlMode: "AUTO_CONTROLLED",
      action: { kind: "MINE" },
      jobId: job.jobId,
      waitReason: null,
      perAssignment: []
    } as never;
    expect(miningPanelState({
      node,
      jobs: [job],
      workAreas: [area],
      actor: { controlMode: "AUTO_CONTROLLED" },
      autoPlan: plan,
      autoStep: null,
      dataReady: true,
      dataError: false
    })).toMatchObject({ status: "WAITING", action: "STOP" });
  });
});
