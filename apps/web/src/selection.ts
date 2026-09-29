import type { CropDefinitionDTO, CropStateDTO, FarmTileDTO } from "@happy-farm/contracts";
import type { Translate } from "./i18n";

/**
 * What the action dock should say and offer for the tile the player has selected.
 *
 * Pure and clock-injectable: it reads the server's tile rows, crop rows, and crop catalogue, plus a
 * caller-supplied `now` used only to phrase the remaining growth time. Maturity is never recomputed
 * from that clock -- `kind` follows the server's `mature` flag -- so a wrong local clock can change
 * the countdown text and nothing else.
 *
 * Whether a plant request may be sent is `canPlant`, and it is true only when all four server-derived
 * preconditions hold: a bare soil tile the server reported with no crop on it, a chosen crop, that
 * crop unlocked at the player's level, and at least one seed of that crop in the inventory. The
 * server checks the same four again; this only stops the dock from offering a request that would be
 * refused, and `plantBlocked` says which one is missing.
 */
export interface SelectedCoordinate {
  readonly x: number;
  readonly y: number;
}

export type SelectionKind = "none" | "missing" | "empty" | "growing" | "mature";

/**
 * The first precondition the dock is missing, in the order a player would fix them.
 *
 * `no-crop` means nothing is chosen in the planting control, which is a state only reachable before
 * the catalogue has loaded.
 */
export type PlantBlockReason =
  | "no-tile"
  | "unlocked-land"
  | "terrain"
  | "occupied"
  | "no-crop"
  | "crop-locked"
  | "no-seed";

export interface SelectionView {
  readonly kind: SelectionKind;
  readonly coordinate: SelectedCoordinate | null;
  readonly terrainType: FarmTileDTO["terrainType"] | null;
  readonly crop: CropStateDTO | null;
  /** True only for bare soil holding the chosen, unlocked crop with at least one seed in inventory. */
  readonly canPlant: boolean;
  /** True only when the server's crop row says mature. */
  readonly canHarvest: boolean;
  /** True when the selected tile holds a crop at all: growing crops can be uprooted too. */
  readonly canUproot: boolean;
  /** Why `canPlant` is false, or null when it is true. */
  readonly plantBlocked: PlantBlockReason | null;
  /**
   * Whole seconds left before the server's own timing data says this crop matures, or null when the
   * crop is mature or the catalogue entry needed to phrase the countdown is unavailable.
   *
   * This is a display estimate built from `plantedAt` (server) and the catalogue duration (server),
   * never a second source of maturity.
   */
  readonly remainingSeconds: number | null;
}

/** The crop chosen in the planting control, and the two preconditions the catalogue decides. */
export interface SelectedCropState {
  readonly cropDefinitionId: string;
  /** False when the crop's required level is above the player's level. */
  readonly unlocked: boolean;
  /** How many of this crop's seeds the player's inventory holds. */
  readonly seedCount: number;
}

export interface SelectionInput {
  readonly tiles: readonly FarmTileDTO[];
  readonly crops: readonly CropStateDTO[];
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly selected: SelectedCoordinate | null;
  readonly selectedCrop: SelectedCropState | null;
  /** Current epoch milliseconds. Callers pass `Date.now()`; tests pass a fixed value. */
  readonly nowMs: number;
}

const NO_SELECTION: Omit<SelectionView, "kind" | "plantBlocked"> = {
  coordinate: null,
  terrainType: null,
  crop: null,
  canPlant: false,
  canHarvest: false,
  canUproot: false,
  remainingSeconds: null
};

function remainingGrowthSeconds(
  crop: CropStateDTO,
  definition: CropDefinitionDTO | undefined,
  nowMs: number
): number | null {
  if (definition === undefined) return null;
  const plantedMs = Date.parse(crop.plantedAt);
  const durationMs = definition.growthDurationSeconds * 1000;
  if (!Number.isFinite(plantedMs) || !Number.isFinite(nowMs)) return null;
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return null;
  const remainingMs = plantedMs + durationMs - nowMs;
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / 1000);
}

/**
 * The first reason an empty tile cannot be planted, or null when it can.
 *
 * The order matters for the message the player reads: an occupied tile is reported as occupied even
 * if the chosen crop is also locked, because that is the fact they can act on immediately.
 */
function plantBlocker(
  tile: FarmTileDTO,
  selectedCrop: SelectedCropState | null
): PlantBlockReason | null {
  if (tile.terrainType !== "SOIL") return "terrain";
  if (selectedCrop === null) return "no-crop";
  if (!selectedCrop.unlocked) return "crop-locked";
  if (!Number.isSafeInteger(selectedCrop.seedCount) || selectedCrop.seedCount < 1) return "no-seed";
  return null;
}

export function describeSelection(input: SelectionInput): SelectionView {
  if (input.selected === null) {
    return { kind: "none", ...NO_SELECTION, plantBlocked: "no-tile" };
  }

  const coordinate: SelectedCoordinate = { x: input.selected.x, y: input.selected.y };
  const tile = input.tiles.find((row) => row.x === coordinate.x && row.y === coordinate.y);
  if (tile === undefined) {
    return { kind: "missing", ...NO_SELECTION, coordinate, plantBlocked: "unlocked-land" };
  }

  const crop = input.crops.find((row) => row.tileX === coordinate.x && row.tileY === coordinate.y);
  if (crop === undefined) {
    const blocked = plantBlocker(tile, input.selectedCrop);
    return {
      kind: "empty",
      coordinate,
      terrainType: tile.terrainType,
      crop: null,
      canPlant: blocked === null,
      canHarvest: false,
      canUproot: false,
      plantBlocked: blocked,
      remainingSeconds: null
    };
  }

  if (crop.mature) {
    return {
      kind: "mature",
      coordinate,
      terrainType: tile.terrainType,
      crop,
      canPlant: false,
      canHarvest: true,
      canUproot: true,
      plantBlocked: "occupied",
      remainingSeconds: null
    };
  }

  const definition = input.cropDefinitions.find(
    (entry) => entry.cropDefinitionId === crop.definitionId
  );
  return {
    kind: "growing",
    coordinate,
    terrainType: tile.terrainType,
    crop,
    canPlant: false,
    canHarvest: false,
    canUproot: true,
    plantBlocked: "occupied",
    remainingSeconds: remainingGrowthSeconds(crop, definition, input.nowMs)
  };
}

/**
 * Turns the server-derived remaining seconds into a short, non-authoritative countdown label.
 *
 * Every phrase is a translation key: this is display text, and the number it is built from was
 * already decided by the server's `plantedAt` and the catalogue's duration.
 */
export function formatRemainingGrowth(seconds: number | null, t: Translate): string {
  if (seconds === null) return t("time.unknown");
  if (seconds <= 0) return t("time.readySoon");
  if (seconds < 60) return t("time.seconds", { count: seconds });
  const totalMinutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (totalMinutes < 60) {
    return remainingSeconds === 0
      ? t("time.minutes", { count: totalMinutes })
      : t("time.minutesSeconds", { minutes: totalMinutes, seconds: remainingSeconds });
  }
  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;
  if (totalHours < 24) {
    return remainingMinutes === 0
      ? t("time.hours", { count: totalHours })
      : t("time.hoursMinutes", { hours: totalHours, minutes: remainingMinutes });
  }
  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;
  return remainingHours === 0
    ? t("time.days", { count: totalDays })
    : t("time.daysHours", { days: totalDays, hours: remainingHours });
}
