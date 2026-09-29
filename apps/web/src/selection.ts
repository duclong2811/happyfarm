import type {
  CropDefinitionDTO,
  CropStateDTO,
  FarmTileDTO,
  TreeDefinitionDTO,
  TreeStateDTO
} from "@happy-farm/contracts";
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

export type SelectionKind = "none" | "missing" | "empty" | "growing" | "mature" | "tree";

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
  | "no-seed"
  | "tree-locked"
  | "no-sapling";

export interface SelectionView {
  readonly kind: SelectionKind;
  readonly coordinate: SelectedCoordinate | null;
  readonly terrainType: FarmTileDTO["terrainType"] | null;
  readonly crop: CropStateDTO | null;
  /** The tree on the selected tile, in the server's terms; null when the tile holds none. */
  readonly tree: TreeStateDTO | null;
  /** True only for bare soil holding the chosen, unlocked crop with at least one seed in inventory. */
  readonly canPlant: boolean;
  /** True only when the server's crop row says mature. */
  readonly canHarvest: boolean;
  /** True when the selected tile holds a crop at all: growing crops can be uprooted too. */
  readonly canUproot: boolean;
  /** True only when the server's tree row says the current cycle is ready. */
  readonly canHarvestTree: boolean;
  /** True when the selected tile holds a tree at all: a tree can always be removed, ready or not. */
  readonly canRemoveTree: boolean;
  /**
   * Which catalogue the planting control should read for this selection, or null when the tile is
   * not plantable. The dock sends the matching command; the server checks both again.
   */
  readonly plantOption: "crop" | "tree" | null;
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

/** The tree chosen in the planting control, and the two preconditions the catalogue decides. */
export interface SelectedTreeState {
  readonly treeDefinitionId: string;
  /** False when the tree's required level is above the player's level. */
  readonly unlocked: boolean;
  /** How many of this tree's saplings the player's inventory holds. */
  readonly saplingCount: number;
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
  readonly trees: readonly TreeStateDTO[];
  readonly cropDefinitions: readonly CropDefinitionDTO[];
  readonly treeDefinitions: readonly TreeDefinitionDTO[];
  readonly selected: SelectedCoordinate | null;
  readonly selectedCrop: SelectedCropState | null;
  readonly selectedTree: SelectedTreeState | null;
  /** Current epoch milliseconds. Callers pass `Date.now()`; tests pass a fixed value. */
  readonly nowMs: number;
}

const NO_SELECTION: Omit<SelectionView, "kind" | "plantBlocked"> = {
  coordinate: null,
  terrainType: null,
  crop: null,
  tree: null,
  canPlant: false,
  canHarvest: false,
  canUproot: false,
  canHarvestTree: false,
  canRemoveTree: false,
  plantOption: null,
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
  selectedCrop: SelectedCropState | null,
  selectedTree: SelectedTreeState | null
): { readonly reason: PlantBlockReason | null; readonly option: "crop" | "tree" | null } {
  if (tile.terrainType !== "SOIL") return { reason: "terrain", option: null };
  if (selectedTree !== null) {
    if (!selectedTree.unlocked) return { reason: "tree-locked", option: null };
    if (!Number.isSafeInteger(selectedTree.saplingCount) || selectedTree.saplingCount < 1) {
      return { reason: "no-sapling", option: null };
    }
    return { reason: null, option: "tree" };
  }
  if (selectedCrop === null) return { reason: "no-crop", option: null };
  if (!selectedCrop.unlocked) return { reason: "crop-locked", option: null };
  if (!Number.isSafeInteger(selectedCrop.seedCount) || selectedCrop.seedCount < 1) {
    return { reason: "no-seed", option: null };
  }
  return { reason: null, option: "crop" };
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
  const tree = input.trees.find((row) => row.tileX === coordinate.x && row.tileY === coordinate.y);
  if (tree !== undefined) {
    // A tree owns the tile whether or not it is bearing fruit, so every planting precondition is
    // closed and the dock offers the tree's own actions instead.
    const definition = input.treeDefinitions.find(
      (entry) => entry.treeDefinitionId === tree.definitionId
    );
    const remaining = tree.ready
      ? null
      : Math.max(0, tree.secondsUntilReady);
    return {
      kind: "tree",
      coordinate,
      terrainType: tile.terrainType,
      crop: null,
      tree,
      canPlant: false,
      canHarvest: false,
      canUproot: false,
      canHarvestTree: tree.ready,
      canRemoveTree: true,
      plantOption: null,
      plantBlocked: "occupied",
      remainingSeconds: definition === undefined ? remaining : remaining
    };
  }

  if (crop === undefined) {
    const blocked = plantBlocker(tile, input.selectedCrop, input.selectedTree);
    return {
      kind: "empty",
      coordinate,
      terrainType: tile.terrainType,
      crop: null,
      tree: null,
      canPlant: blocked.reason === null,
      canHarvest: false,
      canUproot: false,
      canHarvestTree: false,
      canRemoveTree: false,
      plantOption: blocked.option,
      plantBlocked: blocked.reason,
      remainingSeconds: null
    };
  }

  if (crop.mature) {
    return {
      kind: "mature",
      coordinate,
      terrainType: tile.terrainType,
      crop,
      tree: null,
      canPlant: false,
      canHarvest: true,
      canUproot: true,
      canHarvestTree: false,
      canRemoveTree: false,
      plantOption: null,
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
    tree: null,
    canPlant: false,
    canHarvest: false,
    canUproot: true,
    canHarvestTree: false,
    canRemoveTree: false,
    plantOption: null,
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
