import { describe, expect, it } from "vitest";
import { ApplicationError, assertTrustedAutoEventTime, autoTransitionId } from "@happy-farm/application";

describe("Auto Plant semantic boundary", () => {
  const context = {
    actorId: "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    assignmentId: "job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    x: 9,
    y: 26,
    eventTime: "2026-10-05T00:01:00.000Z"
  } as const;

  it("keeps economic identity stable when HTTP request identity changes", () => {
    expect(autoTransitionId({ ...context, kind: "PLANT" })).toBe(autoTransitionId({ ...context, kind: "PLANT" }));
    expect(autoTransitionId({ ...context, kind: "PLANT" }).length).toBeLessThanOrEqual(100);
  });

  it("rejects future and pre-watermark event times", () => {
    expect(() => { assertTrustedAutoEventTime({ eventTime: "2026-10-05T00:02:00.000Z", serverNow: context.eventTime, simulationAt: null }); }).toThrow(ApplicationError);
    expect(() => { assertTrustedAutoEventTime({ eventTime: "2026-10-04T23:59:00.000Z", serverNow: context.eventTime, simulationAt: context.eventTime }); }).toThrow(ApplicationError);
  });
});
