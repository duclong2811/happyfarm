import { describe, expect, it } from "vitest";
import {
  ACTOR_KINDS,
  CONTROL_MODES,
  DomainError,
  MAIN_CHARACTER_KIND,
  MAX_JOBS_PER_ACTOR,
  WORK_AREA_KINDS,
  actorAcceptsWork,
  assertActorVersion,
  assertJobVersion,
  isMainCharacter,
  JOB_KINDS,
  jobKindMatchesArea,
  jobKindSupportsTargets,
  jobTargetFitsShape,
  nextJobPriority,
  parseActorId,
  parseActorKind,
  parseControlMode,
  parseJobId,
  parseJobKind,
  planJobReorder,
  prioritiesFor
} from "../../packages/domain/src/index";

/**
 * The actor and job rules that are decisions rather than plumbing.
 *
 * A job names a profession in the *same* words its work area does, a target from the game-data
 * namespace that profession uses, and a place in a dense order; an actor is the thing that does work,
 * and is not a player.
 */

describe("actors", () => {
  it("names the actor vocabulary, and only the Main Character exists today", () => {
    expect(ACTOR_KINDS).toEqual(["MAIN_CHARACTER", "NPC_WORKER", "VEHICLE", "SHIP"]);
    expect(MAIN_CHARACTER_KIND).toBe("MAIN_CHARACTER");
    expect(CONTROL_MODES).toEqual(["PLAYER_CONTROLLED", "AUTO_CONTROLLED"]);
    expect(parseActorKind("MAIN_CHARACTER")).toBe("MAIN_CHARACTER");
    expect(parseControlMode("AUTO_CONTROLLED")).toBe("AUTO_CONTROLLED");
    expect(() => parseActorKind("GOAT")).toThrow(DomainError);
    expect(() => parseControlMode("PLAYER_CONTROL")).toThrow(DomainError);
  });

  it("tells an actor from a player, and the Main Character from the rest", () => {
    expect(isMainCharacter({ kind: "MAIN_CHARACTER" })).toBe(true);
    expect(isMainCharacter({ kind: "SHIP" })).toBe(false);
    // A person can farm, gather and mine; a ship or a cart will not, and that is a capability answer.
    expect(actorAcceptsWork("MAIN_CHARACTER")).toBe(true);
    expect(actorAcceptsWork("SHIP")).toBe(false);
    expect(parseActorId("actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "actor_aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    );
    expect(() => parseActorId("player_11111111-1111-4111-8111-111111111111")).toThrow(DomainError);
    expect(parseJobId("job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb")).toBe(
      "job_bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
    );
  });
});

describe("job kinds and targets", () => {
  it("uses exactly the work-area vocabulary, so compatibility is equality", () => {
    expect(JOB_KINDS).toEqual(WORK_AREA_KINDS);
    expect(parseJobKind("MINING")).toBe("MINING");
    expect(() => parseJobKind("MIXED")).toThrow(DomainError);
    expect(jobKindMatchesArea("ORCHARD", "ORCHARD")).toBe(true);
    expect(jobKindMatchesArea("ORCHARD", "FARM")).toBe(false);
  });

  it("asks each profession for a target from its own game-data namespace", () => {
    expect(jobTargetFitsShape("FARM", "crop_rice")).toBe(true);
    expect(jobTargetFitsShape("FARM", "tree_apple")).toBe(false);
    expect(jobTargetFitsShape("ORCHARD", "tree_orange")).toBe(true);
    expect(jobTargetFitsShape("MINING", "resource_iron")).toBe(true);
    expect(jobTargetFitsShape("FORESTRY", "resource_wildwood")).toBe(true);
    expect(jobTargetFitsShape("ORCHARD", "crop_rice")).toBe(false);
  });

  it("refuses a target for a profession the game cannot describe yet", () => {
    expect(jobKindSupportsTargets("FARM")).toBe(true);
    expect(jobKindSupportsTargets("MINING")).toBe(true);
    // Livestock and aquaculture have no automation behind them, so they are refused rather than
    // stored as jobs nothing could ever honour.
    expect(jobKindSupportsTargets("LIVESTOCK")).toBe(false);
    expect(jobKindSupportsTargets("AQUACULTURE")).toBe(false);
    expect(jobTargetFitsShape("LIVESTOCK", "resource_stone")).toBe(false);
  });
});

describe("job order", () => {
  it("counts priorities from one, densely", () => {
    expect(prioritiesFor(0)).toEqual([]);
    expect(prioritiesFor(3)).toEqual([1, 2, 3]);
    expect(() => prioritiesFor(MAX_JOBS_PER_ACTOR + 1)).toThrow(DomainError);
  });

  it("appends a new job after every existing one, and refuses past the cap", () => {
    expect(nextJobPriority([])).toBe(1);
    expect(nextJobPriority([1, 2, 3, 4])).toBe(5);
    // A gap that somehow survived can never be fallen into: the new job goes after the highest.
    expect(nextJobPriority([1, 3])).toBe(4);
    expect(() =>
      nextJobPriority(Array.from({ length: MAX_JOBS_PER_ACTOR }, (_value, index) => index + 1))
    ).toThrow(DomainError);
  });

  it("accepts exactly a permutation of the current jobs", () => {
    const current = ["job_a", "job_b", "job_c"] as never[];
    expect(planJobReorder(current, ["job_c", "job_a", "job_b"] as never[])).toEqual([
      "job_c",
      "job_a",
      "job_b"
    ]);
    expect(() => planJobReorder(current, ["job_a", "job_b"] as never[])).toThrow(DomainError);
    expect(() => planJobReorder(current, ["job_a", "job_a", "job_c"] as never[])).toThrow(DomainError);
    expect(() => planJobReorder(current, ["job_a", "job_b", "job_z"] as never[])).toThrow(DomainError);
  });
});

describe("versions", () => {
  it("refuses an edit made against a version that has already moved", () => {
    expect(() => {
      assertJobVersion({ version: 2 }, 2);
    }).not.toThrow();
    expect(() => {
      assertJobVersion({ version: 2 }, 1);
    }).toThrow(DomainError);
    expect(() => {
      assertActorVersion({ version: 3 }, 3);
    }).not.toThrow();
    expect(() => {
      assertActorVersion({ version: 3 }, 4);
    }).toThrow(DomainError);
  });
});
