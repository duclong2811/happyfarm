import { DomainError } from "./errors";

/**
 * A mine's output, in closed form.
 *
 * A mine fills at its level's rate, from the moment it was last emptied or upgraded, until it holds
 * a fixed number of hours of output. Nothing ticks: the amount is computed from server time when it
 * is read, so a player away for a week finds exactly a full mine and no process ran meanwhile.
 *
 * Amounts are kept in thousandths of an ore (`milli`) so that digging part of a mine - the warehouse
 * had room for only some of it - or upgrading in the middle of an hour never rounds ore away.
 */

export const MILLI_PER_ORE = 1000;
const MS_PER_HOUR = 3_600_000;

export interface MineAccrual {
  readonly level: number;
  /** Ore already banked, in milli-ore, at `accruedSince`. */
  readonly bankedMilli: number;
  readonly accruedSince: string;
}

export interface MineRate {
  readonly orePerHour: number;
  readonly accumulationHours: number;
}

function instant(value: string): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new DomainError("INVALID_INSTANT", "Mine time is invalid");
  return ms;
}

/** How much a mine can hold, in milli-ore. */
export function mineCapacityMilli(rate: MineRate): number {
  return Math.round(rate.orePerHour * rate.accumulationHours * MILLI_PER_ORE);
}

/** What the mine holds at `now`, in milli-ore: banked plus what accrued since, capped. */
export function mineAvailableMilli(accrual: MineAccrual, rate: MineRate, now: string): number {
  if (!Number.isSafeInteger(accrual.bankedMilli) || accrual.bankedMilli < 0) {
    throw new DomainError("INVALID_RESOURCE", "Mine balance is invalid");
  }
  const elapsed = Math.max(0, instant(now) - instant(accrual.accruedSince));
  // milli-ore per millisecond = orePerHour * 1000 / 3,600,000.
  const accrued = Math.floor((elapsed * rate.orePerHour * MILLI_PER_ORE) / MS_PER_HOUR);
  return Math.min(mineCapacityMilli(rate), accrual.bankedMilli + accrued);
}

/** Whole ore a dig could take at `now`. */
export function mineAvailableOre(accrual: MineAccrual, rate: MineRate, now: string): number {
  return Math.floor(mineAvailableMilli(accrual, rate, now) / MILLI_PER_ORE);
}

/**
 * The mine after digging `take` whole ore at `now`. What was not taken (the warehouse was short, or
 * the fraction of an ore) stays banked, and the clock restarts from `now`.
 */
export function mineAfterDig(accrual: MineAccrual, rate: MineRate, now: string, take: number): MineAccrual {
  const available = mineAvailableMilli(accrual, rate, now);
  if (!Number.isSafeInteger(take) || take <= 0 || take * MILLI_PER_ORE > available) {
    throw new DomainError("INVALID_RESOURCE", "Cannot dig more ore than the mine holds");
  }
  return { level: accrual.level, bankedMilli: available - take * MILLI_PER_ORE, accruedSince: now };
}

/**
 * The mine one level up at `now`. Everything mined so far at the old rate is banked first, so an
 * upgrade never costs the player ore they had already earned; from `now` it fills at the new rate.
 */
export function mineAfterUpgrade(accrual: MineAccrual, oldRate: MineRate, now: string): MineAccrual {
  return { level: accrual.level + 1, bankedMilli: mineAvailableMilli(accrual, oldRate, now), accruedSince: now };
}

/** How many slots a player of `playerLevel` has opened, from the slot ladder. */
export function openMineSlots(slotLevels: readonly number[], playerLevel: number): number {
  return slotLevels.filter((required) => playerLevel >= required).length;
}
