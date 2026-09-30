import { worldCellAt, type WorldCell } from "./world-cell";
import type { WorldCellMap } from "./world-cell";

/**
 * What a player may do with the cell they selected.
 *
 * One resolver, asked by the dock, by the debug overlay and by tests, so the answer to "what is this
 * cell for" is given once. It is a *resolver*, not an executor: it reports what is possible and why
 * something is not, and the caller decides. Selecting a cell never performs an action - the brief's
 * rule, and the reason a mis-click can never plant a crop or harvest one.
 *
 * Actions that belong to systems the game has not built yet are reported as `enabled: false` with a
 * reason, never as working buttons: a timber cell today says "managed woodland: no system yet",
 * which is true, rather than pretending to fell a tree.
 */

export type CellActionId =
  | "MOVE"
  | "PLANT"
  | "HARVEST"
  | "UPROOT"
  | "TIMBER"
  | "MINE"
  | "AQUACULTURE";

export interface CellAction {
  readonly id: CellActionId;
  readonly enabled: boolean;
  /** Why the action is unavailable, or null when it is available. Never shown as raw coordinates. */
  readonly reason: string | null;
}

export interface CellActionContext {
  /** True while the server has reported a crop definition the player may plant. */
  readonly canPlant: boolean;
  /** The farm's own row on this cell, from the server's projection. */
  readonly crop: { readonly mature: boolean } | null;
  readonly tree: { readonly ready: boolean } | null;
}

const NOT_IMPLEMENTED = "not implemented yet";

/**
 * Every action this cell offers, in the order a player would think of them.
 *
 * Movement comes first because it is the one action that works everywhere, and because it is what a
 * click does: the rest are offered by the dock, one deliberate choice at a time.
 */
export function getAvailableCellActions(
  cell: WorldCell | null,
  context: CellActionContext,
  map?: WorldCellMap
): readonly CellAction[] {
  // Off the map is not a cell: there is nothing to walk to, plant on, or inspect.
  if (cell === null || (map !== undefined && worldCellAt(map, cell.x, cell.z) === null)) return [];

  const actions: CellAction[] = [];

  if (cell.terrain === "WATER") {
    actions.push({ id: "MOVE", enabled: false, reason: "open water" });
  } else if (cell.terrain === "BLOCKED") {
    actions.push({ id: "MOVE", enabled: false, reason: "a building stands here" });
  } else {
    actions.push({ id: "MOVE", enabled: true, reason: null });
  }

  switch (cell.productionCapability) {
    case "CROP": {
      const occupied = context.crop !== null || context.tree !== null;
      actions.push({
        id: "PLANT",
        enabled: context.canPlant && !occupied,
        reason: occupied ? "something is already growing here" : context.canPlant ? null : "no seed selected"
      });
      if (context.crop !== null) {
        actions.push({
          id: "HARVEST",
          enabled: context.crop.mature,
          reason: context.crop.mature ? null : "not ready yet"
        });
        actions.push({ id: "UPROOT", enabled: true, reason: null });
      }
      if (context.tree !== null) {
        actions.push({ id: "HARVEST", enabled: context.tree.ready, reason: context.tree.ready ? null : "not ready yet" });
        actions.push({ id: "UPROOT", enabled: true, reason: null });
      }
      break;
    }
    case "TIMBER":
      actions.push({ id: "TIMBER", enabled: false, reason: NOT_IMPLEMENTED });
      break;
    case "MINING":
      actions.push({ id: "MINE", enabled: false, reason: NOT_IMPLEMENTED });
      break;
    case "AQUACULTURE":
      actions.push({ id: "AQUACULTURE", enabled: false, reason: NOT_IMPLEMENTED });
      break;
    case "NONE":
      break;
  }

  return actions;
}

/**
 * The message key that names what a cell *is*, for the dock's one line of context.
 *
 * A key rather than a sentence: the dock is bilingual and the render layer does not decide what
 * language a player reads. This is also why no coordinate appears: the player is told they selected
 * farmland, never that they selected `20, 5`.
 */
export type CellLandKey =
  | "cell.land.farmland"
  | "cell.land.agriculture"
  | "cell.land.forestry"
  | "cell.land.mining"
  | "cell.land.civic"
  | "cell.land.wild"
  | "cell.land.water"
  | "cell.land.aquaculture"
  | "cell.land.shore"
  | "cell.land.road"
  | "cell.land.building"
  | "cell.land.open";

export function cellLandKey(cell: WorldCell): CellLandKey {
  if (cell.terrain === "WATER") return cell.zone === "AQUACULTURE" ? "cell.land.aquaculture" : "cell.land.water";
  if (cell.terrain === "SHORE") return "cell.land.shore";
  if (cell.occupancy === "BUILDING") return "cell.land.building";
  if (cell.road !== null) return "cell.land.road";
  switch (cell.zone) {
    case "AGRICULTURE":
      return cell.productionCapability === "CROP" ? "cell.land.farmland" : "cell.land.agriculture";
    case "FORESTRY":
      return "cell.land.forestry";
    case "MINING":
      return "cell.land.mining";
    case "CIVIC":
      return "cell.land.civic";
    case "WILDERNESS":
      return "cell.land.wild";
    case "AQUACULTURE":
      return "cell.land.aquaculture";
    case "NONE":
      return "cell.land.open";
  }
}

/** The message key for one action's own label. */
export function cellActionKey(id: CellActionId): string {
  switch (id) {
    case "MOVE":
      return "cell.action.move";
    case "PLANT":
      return "cell.action.plant";
    case "HARVEST":
      return "cell.action.harvest";
    case "UPROOT":
      return "cell.action.uproot";
    case "TIMBER":
      return "cell.action.timber";
    case "MINE":
      return "cell.action.mine";
    case "AQUACULTURE":
      return "cell.action.aquaculture";
  }
}
