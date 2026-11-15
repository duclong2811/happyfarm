import { resourceNodes, type ResourceNodeData } from "@happy-farm/game-data";
import { GameDataResourceCatalogue } from "../../workers/api/src/runtime";

/**
 * The resource catalogue as it stood before island mines: the old ore ridge active again.
 *
 * Island mines retired `node_stone_ridge` from what players are served (`active: false`), but the
 * hold-to-mine and Auto-mining engine stays in the code so actions and assignments recorded before the
 * change still settle. The tests that hold that engine's rules use this catalogue; nothing shipped does.
 */
export const LEGACY_MINING_NODES: readonly ResourceNodeData[] = resourceNodes
  .filter((node) => node.active !== false || node.id === "node_stone_ridge")
  .map((node) => (node.id === "node_stone_ridge" ? { ...node, active: true } : node));

export function legacyMiningResourceCatalogue(): GameDataResourceCatalogue {
  return new GameDataResourceCatalogue(LEGACY_MINING_NODES);
}
