import type { MineDTO } from "@happy-farm/contracts";

/**
 * Island mines, as the page reads them. Pure: no DOM, no network, no clock of its own.
 *
 * Every number starts as the server's - what a mine held at the server's `readAt` - and the page only
 * extrapolates forward with the mine's own rate, capped at its capacity, so a full mine reads full
 * without polling. The dig and the upgrade are still the server's to decide: these views only say
 * whether a button is worth offering and why not.
 */

export const MINE_ORE_ITEM_ID = "item_ore";
const MILLI_PER_ORE = 1000;
const MS_PER_HOUR = 3_600_000;

/** What the mine holds at `nowMs`, in thousandths of an ore. A clock behind `readAt` adds nothing. */
export function mineMilliAt(mine: Pick<MineDTO, "availableMilli" | "orePerHour" | "capacityOre">, readAtMs: number, nowMs: number): number {
  const elapsed = Math.max(0, nowMs - readAtMs);
  const accrued = Math.floor((elapsed * mine.orePerHour * MILLI_PER_ORE) / MS_PER_HOUR);
  return Math.min(mine.capacityOre * MILLI_PER_ORE, mine.availableMilli + accrued);
}

/** Whole ore a dig could take at `nowMs` (before the warehouse is asked). */
export function mineOreAt(mine: Pick<MineDTO, "availableMilli" | "orePerHour" | "capacityOre">, readAtMs: number, nowMs: number): number {
  return Math.floor(mineMilliAt(mine, readAtMs, nowMs) / MILLI_PER_ORE);
}

/** Seconds until the mine is full and stops filling; zero when it already is. */
export function mineSecondsUntilFull(mine: Pick<MineDTO, "availableMilli" | "orePerHour" | "capacityOre">, readAtMs: number, nowMs: number): number {
  const missing = mine.capacityOre * MILLI_PER_ORE - mineMilliAt(mine, readAtMs, nowMs);
  if (missing <= 0) return 0;
  return Math.ceil((missing * MS_PER_HOUR) / (mine.orePerHour * MILLI_PER_ORE) / 1000);
}

export type MineDigBlocker = "EMPTY" | "NOT_OWNER" | "BUSY";
export type MineUpgradeBlocker = "NOT_OWNER" | "LEVEL" | "MATERIALS" | "GOLD" | "BUSY";

export interface MineMaterialView {
  readonly itemDefinitionId: string;
  readonly quantity: number;
  readonly held: number;
  readonly enough: boolean;
}

export interface MinePanelView {
  readonly slot: number;
  readonly level: number;
  readonly orePerHour: number;
  readonly ore: number;
  readonly capacity: number;
  /** 0..1, for the fill bar. */
  readonly fill: number;
  readonly secondsUntilFull: number;
  readonly digBlocker: MineDigBlocker | null;
  readonly upgrade: {
    readonly level: number;
    readonly orePerHour: number;
    readonly requiredPlayerLevel: number;
    readonly gold: number;
    readonly materials: readonly MineMaterialView[];
    readonly blocker: MineUpgradeBlocker | null;
  } | null;
}

export interface MinePanelInput {
  readonly mine: MineDTO;
  readonly readAtMs: number;
  readonly nowMs: number;
  /** Only the owner may dig or upgrade; a visitor reads the same mine. */
  readonly owner: boolean;
  readonly playerLevel: number;
  readonly gold: number;
  readonly held: (itemDefinitionId: string) => number;
  readonly busy: boolean;
}

export function minePanelView(input: MinePanelInput): MinePanelView {
  const { mine } = input;
  const ore = mineOreAt(mine, input.readAtMs, input.nowMs);
  const next = mine.nextLevel;
  const materials = next === null
    ? []
    : next.materials.map((entry) => {
        const held = input.held(entry.itemDefinitionId);
        return { itemDefinitionId: entry.itemDefinitionId, quantity: entry.quantity, held, enough: held >= entry.quantity };
      });
  const upgradeBlocker: MineUpgradeBlocker | null = next === null
    ? null
    : !input.owner
      ? "NOT_OWNER"
      : input.playerLevel < next.requiredPlayerLevel
        ? "LEVEL"
        : materials.some((entry) => !entry.enough)
          ? "MATERIALS"
          : input.gold < next.gold
            ? "GOLD"
            : input.busy
              ? "BUSY"
              : null;
  return {
    slot: mine.slot,
    level: mine.level,
    orePerHour: mine.orePerHour,
    ore,
    capacity: mine.capacityOre,
    fill: mine.capacityOre <= 0 ? 0 : Math.min(1, mineMilliAt(mine, input.readAtMs, input.nowMs) / (mine.capacityOre * MILLI_PER_ORE)),
    secondsUntilFull: mineSecondsUntilFull(mine, input.readAtMs, input.nowMs),
    digBlocker: !input.owner ? "NOT_OWNER" : ore <= 0 ? "EMPTY" : input.busy ? "BUSY" : null,
    upgrade: next === null
      ? null
      : {
          level: next.level,
          orePerHour: next.orePerHour,
          requiredPlayerLevel: next.requiredPlayerLevel,
          gold: next.gold,
          materials,
          blocker: upgradeBlocker
        }
  };
}

/** One rock of a mine's cluster: which model, and where it sits around the mine's centre. */
export interface MinePiece {
  readonly modelId: string;
  readonly offsetX: number;
  readonly offsetZ: number;
  readonly scale: number;
  readonly rotationY: number;
}

/** The level-1 mine: one large face and two shoulders, the old ore ridge's silhouette. */
const BASE_PIECES: readonly MinePiece[] = [
  { modelId: "resource_stone", offsetX: 0, offsetZ: 0.05, scale: 2.4, rotationY: 0.18 },
  { modelId: "resource_stone", offsetX: -1.05, offsetZ: 0.22, scale: 1.55, rotationY: -0.32 },
  { modelId: "resource_stone", offsetX: 0.98, offsetZ: 0.08, scale: 1.42, rotationY: 0.52 }
];

/** What each level adds: richer ore showing through as the mine is worked deeper. */
const LEVEL_PIECES: readonly { readonly from: number; readonly piece: MinePiece }[] = [
  { from: 2, piece: { modelId: "resource_copper", offsetX: -0.55, offsetZ: 0.85, scale: 1.62, rotationY: 0.4 } },
  { from: 3, piece: { modelId: "resource_copper", offsetX: 0.6, offsetZ: 0.8, scale: 1.8, rotationY: -0.7 } },
  { from: 4, piece: { modelId: "resource_stone", offsetX: 0.2, offsetZ: -0.95, scale: 1.6, rotationY: 1.1 } },
  { from: 5, piece: { modelId: "resource_iron", offsetX: -1.45, offsetZ: -0.45, scale: 1.89, rotationY: 0.2 } },
  { from: 6, piece: { modelId: "resource_iron", offsetX: 1.5, offsetZ: -0.4, scale: 1.98, rotationY: -0.3 } },
  { from: 7, piece: { modelId: "resource_copper", offsetX: 0, offsetZ: 1.15, scale: 2.07, rotationY: 0.9 } },
  { from: 8, piece: { modelId: "resource_iron", offsetX: -0.85, offsetZ: -1.2, scale: 2.16, rotationY: -1 } },
  { from: 9, piece: { modelId: "resource_coal", offsetX: 0.95, offsetZ: -1.15, scale: 1.2, rotationY: 0.6 } },
  { from: 10, piece: { modelId: "resource_coal", offsetX: 1.55, offsetZ: 0.75, scale: 1.25, rotationY: -0.2 } }
];

/** The rocks a mine of `level` draws, in a fixed order so a level-up only ever adds. */
export function minePieces(level: number): readonly MinePiece[] {
  return [...BASE_PIECES, ...LEVEL_PIECES.filter((entry) => level >= entry.from).map((entry) => entry.piece)];
}

/** A mine grows a little with every level, on top of the pieces it gains. */
export function mineScale(level: number): number {
  return 1 + Math.max(0, Math.min(level, 10) - 1) * 0.05;
}

/** How far from the centre a tap on the ground still means this mine. */
export const MINE_PICK_RADIUS_WORLD = 2.6;
