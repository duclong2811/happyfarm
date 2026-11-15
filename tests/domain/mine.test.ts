import { describe, expect, it } from "vitest";
import { mineAfterDig, mineAfterUpgrade, mineAvailableMilli, mineAvailableOre, mineCapacityMilli, openMineSlots } from "@happy-farm/domain";

const LEVEL1 = { orePerHour: 60, accumulationHours: 4 };
const LEVEL2 = { orePerHour: 90, accumulationHours: 4 };
const start = "2026-11-15T00:00:00.000Z";
const at = (minutes: number) => new Date(Date.parse(start) + minutes * 60_000).toISOString();

describe("mine accrual", () => {
  it("fills at its rate from server time and stops at four hours", () => {
    const mine = { level: 1, bankedMilli: 0, accruedSince: start };
    expect(mineAvailableOre(mine, LEVEL1, at(0))).toBe(0);
    expect(mineAvailableOre(mine, LEVEL1, at(30))).toBe(30);
    expect(mineAvailableOre(mine, LEVEL1, at(4 * 60))).toBe(240);
    expect(mineAvailableOre(mine, LEVEL1, at(7 * 24 * 60))).toBe(240);
    expect(mineCapacityMilli(LEVEL1)).toBe(240_000);
    // A clock that reads earlier than the accrual never makes ore negative.
    expect(mineAvailableMilli(mine, LEVEL1, at(-10))).toBe(0);
  });

  it("keeps what a dig could not take, and restarts the clock", () => {
    const mine = { level: 1, bankedMilli: 0, accruedSince: start };
    const after = mineAfterDig(mine, LEVEL1, at(60), 45);
    expect(after).toEqual({ level: 1, bankedMilli: 15_000, accruedSince: at(60) });
    expect(mineAvailableOre(after, LEVEL1, at(90))).toBe(45);
    expect(() => mineAfterDig(mine, LEVEL1, at(60), 61)).toThrow();
    expect(() => mineAfterDig(mine, LEVEL1, at(60), 0)).toThrow();
  });

  it("banks the old rate's ore on upgrade, then fills at the new rate", () => {
    const mine = { level: 1, bankedMilli: 0, accruedSince: start };
    const upgraded = mineAfterUpgrade(mine, LEVEL1, at(60));
    expect(upgraded).toEqual({ level: 2, bankedMilli: 60_000, accruedSince: at(60) });
    expect(mineAvailableOre(upgraded, LEVEL2, at(120))).toBe(150);
    // Fractions survive: 50 seconds at 60/h is 0.833 ore, kept in milli rather than rounded away.
    expect(mineAvailableMilli(mine, LEVEL1, new Date(Date.parse(start) + 50_000).toISOString())).toBe(833);
  });

  it("opens slots by player level", () => {
    expect(openMineSlots([1, 20, 50], 1)).toBe(1);
    expect(openMineSlots([1, 20, 50], 20)).toBe(2);
    expect(openMineSlots([1, 20, 50], 100)).toBe(3);
    expect(openMineSlots([1, 10, 20, 35, 50, 70], 36)).toBe(4);
  });
});
