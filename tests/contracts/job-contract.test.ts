import { describe, expect, it } from "vitest";
import {
  ACTOR_KINDS as CONTRACT_ACTOR_KINDS,
  CONTROL_MODES as CONTRACT_CONTROL_MODES,
  CreateJobRequestSchema,
  JOB_KINDS as CONTRACT_JOB_KINDS,
  MAX_JOBS_PER_ACTOR as CONTRACT_MAX_JOBS,
  ReorderJobsRequestSchema,
  SetJobEnabledRequestSchema,
  UpdateJobTargetRequestSchema
} from "@happy-farm/contracts";
import {
  ACTOR_KINDS,
  CONTROL_MODES,
  JOB_KINDS,
  MAX_JOBS_PER_ACTOR,
  WORK_AREA_KINDS
} from "@happy-farm/domain";

/**
 * The actor/job wire contract and the domain must not drift.
 *
 * Both packages are leaves that keep their own copy of two vocabularies and one bound. This is the
 * seam: if a profession or a limit is widened on one side only, the failure is here rather than a
 * client sending something the server quietly rejects.
 */

describe("the actor/job contract matches the domain", () => {
  it("keeps the same actor kinds, control modes and job bound", () => {
    expect(CONTRACT_ACTOR_KINDS).toEqual(ACTOR_KINDS);
    expect(CONTRACT_CONTROL_MODES).toEqual(CONTROL_MODES);
    expect(CONTRACT_MAX_JOBS).toBe(MAX_JOBS_PER_ACTOR);
  });

  it("names exactly the work-area professions a job may use", () => {
    expect(CONTRACT_JOB_KINDS).toEqual(WORK_AREA_KINDS);
    expect(JOB_KINDS).toEqual(WORK_AREA_KINDS);
  });
});

describe("job requests", () => {
  it("accepts a well-formed assignment and refuses a client-supplied owner or control mode", () => {
    expect(
      CreateJobRequestSchema.safeParse({
        requestId: "job_contract_01",
        workAreaId: "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "FARM",
        targetDefinitionId: "crop_carrot"
      }).success
    ).toBe(true);

    const withOwner = CreateJobRequestSchema.safeParse({
      requestId: "job_contract_02",
      workAreaId: "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      kind: "FARM",
      targetDefinitionId: "crop_carrot",
      ownerPlayerId: "player_11111111-1111-4111-8111-111111111111",
      controlMode: "AUTO_CONTROLLED"
    });
    expect(withOwner.success).toBe(false);
  });

  it("refuses a profession outside the vocabulary", () => {
    expect(
      CreateJobRequestSchema.safeParse({
        requestId: "job_contract_03",
        workAreaId: "workarea_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        kind: "MIXED",
        targetDefinitionId: "crop_carrot"
      }).success
    ).toBe(false);
  });

  it("requires a version on every edit and a bounded, id-shaped order", () => {
    expect(SetJobEnabledRequestSchema.safeParse({ requestId: "job_state_01", enabled: false }).success).toBe(false);
    expect(UpdateJobTargetRequestSchema.safeParse({ requestId: "job_target_01", targetDefinitionId: "crop_carrot" }).success).toBe(false);
    expect(
      ReorderJobsRequestSchema.safeParse({
        requestId: "job_order_01",
        orderedJobIds: ["not-a-job-id"],
        expectedVersion: 1
      }).success
    ).toBe(false);
    expect(
      ReorderJobsRequestSchema.safeParse({
        requestId: "job_order_02",
        orderedJobIds: ["job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"],
        expectedVersion: 1
      }).success
    ).toBe(true);
  });
});
