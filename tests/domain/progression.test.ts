import { describe, expect, it } from "vitest";
import {
  DomainError,
  createXpAward,
  cumulativeXpForLevel,
  levelForXp,
  levelProgress,
  type PlayerProgression
} from "@happy-farm/domain";
import { PLAYER_ONE_ID } from "../support/fixtures";

const definition = { maxLevel: 50, xpStep: 120 };
const NOW = "2026-09-28T00:00:00.000Z";

function progression(xp: number, level = levelForXp(definition, xp), version = 1): PlayerProgression {
  return { playerId: PLAYER_ONE_ID, level, xp, progressionVersion: version, updatedAt: NOW };
}

describe("player progression curve", () => {
  it("starts every player at level 1 with no experience", () => {
    expect(cumulativeXpForLevel(definition, 1)).toBe(0);
    expect(levelForXp(definition, 0)).toBe(1);
    expect(levelProgress(definition, 0)).toEqual({
      level: 1,
      xpIntoLevel: 0,
      xpForNextLevel: 120,
      isMaxLevel: false
    });
  });

  it("moves up exactly on the threshold, not one experience early or late", () => {
    expect(levelForXp(definition, 119)).toBe(1);
    expect(levelForXp(definition, 120)).toBe(2);
    expect(levelForXp(definition, 359)).toBe(2);
    expect(levelForXp(definition, 360)).toBe(3);
  });

  it("reports progress inside the current level", () => {
    expect(levelProgress(definition, 130)).toEqual({
      level: 2,
      xpIntoLevel: 10,
      xpForNextLevel: 240,
      isMaxLevel: false
    });
  });

  it("never moves a player back down as experience grows", () => {
    let previous = levelForXp(definition, 0);
    for (let xp = 0; xp <= 4_000; xp += 1) {
      const level = levelForXp(definition, xp);
      expect(level).toBeGreaterThanOrEqual(previous);
      // The level's threshold must have been reached, and the next one must not have been.
      expect(cumulativeXpForLevel(definition, level)).toBeLessThanOrEqual(xp);
      if (level < definition.maxLevel) {
        expect(cumulativeXpForLevel(definition, level + 1)).toBeGreaterThan(xp);
      }
      previous = level;
    }
  });

  it("caps at the maximum level and stops promising a next one", () => {
    const cap = cumulativeXpForLevel(definition, definition.maxLevel);
    expect(cap).toBe(147_000);
    expect(levelForXp(definition, cap)).toBe(50);
    expect(levelForXp(definition, cap + 1_000_000)).toBe(50);
    expect(levelProgress(definition, cap)).toEqual({
      level: 50,
      xpIntoLevel: 0,
      xpForNextLevel: 0,
      isMaxLevel: true
    });
  });

  it("rejects curve values and experience totals outside its domain", () => {
    expect(() => cumulativeXpForLevel(definition, 0)).toThrow(DomainError);
    expect(() => cumulativeXpForLevel(definition, 51)).toThrow(DomainError);
    expect(() => cumulativeXpForLevel(definition, 2.5)).toThrow(DomainError);
    expect(() => levelForXp(definition, -1)).toThrow(DomainError);
    expect(() => levelForXp(definition, 1.5)).toThrow(DomainError);
    expect(() => levelForXp({ maxLevel: 1, xpStep: 120 }, 0)).toThrow(DomainError);
    expect(() => levelForXp({ maxLevel: 50, xpStep: 0 }, 0)).toThrow(DomainError);
    expect(() => levelForXp({ maxLevel: 50, xpStep: 2.5 }, 0)).toThrow(DomainError);
  });
});

describe("experience awards", () => {
  it("carries the pre-state the settlement has to replace", () => {
    expect(createXpAward(definition, progression(100), 4, NOW)).toEqual({
      playerId: PLAYER_ONE_ID,
      xpBefore: 100,
      expectedProgressionVersion: 1,
      xpAfter: 104,
      levelAfter: 1,
      xpAwarded: 4,
      leveledUp: false,
      timestamp: NOW
    });
  });

  it("flags a level up only when the award crosses the threshold", () => {
    expect(createXpAward(definition, progression(116), 4, NOW).leveledUp).toBe(true);
    expect(createXpAward(definition, progression(116), 3, NOW).leveledUp).toBe(false);
    expect(createXpAward(definition, progression(120), 4, NOW).leveledUp).toBe(false);
  });

  it("refuses a stored row this curve could not have produced", () => {
    // A stored level that disagrees with the stored experience is corruption, not staleness.
    expect(() => createXpAward(definition, progression(100, 7), 4, NOW)).toThrow(DomainError);
    expect(() => createXpAward(definition, { ...progression(0), progressionVersion: 0 }, 4, NOW)).toThrow(
      DomainError
    );
    expect(() => createXpAward(definition, { ...progression(0), xp: -1 }, 4, NOW)).toThrow(DomainError);
  });

  it("refuses an award that is not a positive safe integer inside the documented bound", () => {
    for (const value of [0, -1, 1.5, 1_000_001, Number.MAX_SAFE_INTEGER]) {
      expect(() => createXpAward(definition, progression(0), value, NOW)).toThrow(DomainError);
    }
  });
});