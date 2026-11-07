import type {
  ResourceActionDTO,
  ResourceNodeDTO,
  TreeDefinitionDTO,
  TreeStateDTO
} from "@happy-farm/contracts";

export type ResourcePanelStatus = "READY" | "REGENERATING" | "WORKING";

export interface ResourcePanelState {
  readonly profession: "FORESTRY" | "MINING";
  readonly origin: "NATURAL";
  readonly displayNameKey: string;
  readonly definitionId: string;
  readonly productItemDefinitionId: string;
  readonly productDisplayKey: string;
  readonly requiredLevel: number;
  readonly status: ResourcePanelStatus;
  readonly action: "CHOP" | "MINE" | null;
  readonly inRange: boolean;
  readonly secondsUntilReady: number;
  /** Server timestamp for the current action/regeneration boundary, when one exists. */
  readonly readyAt: string | null;
}

export type PlantedForestryPanelStatus = "GROWING" | "READY" | "DEPLETED" | "STORED";

export interface PlantedForestryPanelState {
  readonly origin: "PLANTED";
  readonly displayNameKey: string;
  readonly productItemDefinitionId: string;
  readonly productDisplayKey: string;
  readonly status: PlantedForestryPanelStatus;
  readonly action: "CHOP" | null;
  readonly inRange: boolean;
  readonly secondsUntilReady: number;
  /** Server timestamp for the growth boundary. Null after a one-shot harvest. */
  readonly readyAt: string | null;
  readonly needsCleanup: boolean;
}

/** Presentation-only state for a server-described resource node. Commands stay in main.ts/API. */
export function resourcePanelState(
  node: ResourceNodeDTO,
  activeAction: ResourceActionDTO | null,
  inRange: boolean
): ResourcePanelState {
  const working = activeAction?.status === "ACTIVE" && activeAction.nodeId === node.nodeId;
  const status: ResourcePanelStatus = working ? "WORKING" : node.available ? "READY" : "REGENERATING";
  return {
    profession: node.verb === "CHOP" ? "FORESTRY" : "MINING",
    origin: "NATURAL",
    displayNameKey: node.displayNameKey,
    definitionId: node.definitionId,
    productItemDefinitionId: node.dropItemDefinitionId,
    productDisplayKey: `item.${node.dropItemDefinitionId.replace(/^item_/, "")}.name`,
    requiredLevel: node.requiredLevel,
    status,
    action: status === "READY" ? node.verb : null,
    inRange,
    secondsUntilReady: working ? activeAction.secondsUntilReady : node.secondsUntilAvailable,
    readyAt: working ? activeAction.readyAt : node.availableAt
  };
}

/** Presentation-only state for a player-planted Wildwood tree. */
export function plantedForestryPanelState(
  tree: TreeStateDTO,
  definition: TreeDefinitionDTO,
  inRange: boolean
): PlantedForestryPanelState {
  const status: PlantedForestryPanelStatus =
    tree.storageState === "STORED" ? "STORED" : tree.phase === "DEPLETED" ? "DEPLETED" : tree.ready ? "READY" : "GROWING";
  return {
    origin: "PLANTED",
    displayNameKey: definition.displayNameKey,
    productItemDefinitionId: definition.harvestItemDefinitionId,
    productDisplayKey: `item.${definition.harvestItemDefinitionId.replace(/^item_/, "")}.name`,
    status,
    action: status === "READY" ? "CHOP" : null,
    inRange,
    secondsUntilReady: status === "GROWING" || status === "STORED" ? tree.secondsUntilReady : 0,
    readyAt: status === "GROWING" || status === "STORED" ? tree.readyAt : null,
    needsCleanup: status === "DEPLETED"
  };
}
