import { calculateTreeProduction, type FarmId } from "@happy-farm/domain";
import type { ActorContext, ActorJobRepository, FarmMemberRepository, FarmRepository, TreeDefinitionRepository, TreeInstanceRepository, WorkAreaRepository } from "./ports";
import { ApplicationError } from "./errors";

export interface OrchardVisualTargetSnapshot { readonly treeId: string; readonly treeDefinitionId: string; readonly tileX: number; readonly tileY: number; readonly lifecycleState: "READY"; }
export interface OrchardVisualAssignmentSnapshot {
  readonly actorJobId: string; readonly actorId: string; readonly farmId: FarmId;
  readonly workSkillId: "orchard.apple"; readonly executionMode: "RATE_PRODUCTION";
  readonly workArea: { readonly id: string; readonly cells: readonly { readonly x: number; readonly y: number }[] };
  readonly targets: readonly OrchardVisualTargetSnapshot[];
}

export class GetOrchardVisualSnapshot {
  constructor(private readonly farms: FarmRepository, private readonly members: FarmMemberRepository, private readonly jobs: ActorJobRepository, private readonly areas: WorkAreaRepository, private readonly trees: TreeInstanceRepository, private readonly definitions: TreeDefinitionRepository, private readonly clock: { now(): string }) {}
  async execute(actor: ActorContext | null, farmId: FarmId): Promise<readonly OrchardVisualAssignmentSnapshot[]> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    if (await this.farms.findById(farmId) === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    const membership = await this.members.findByFarmAndPlayer(farmId, actor.playerId);
    if (membership === null || membership.role === "VISITOR") throw new ApplicationError("NOT_AUTHORIZED", "The player cannot read this farm");
    const trees = await this.trees.listByFarm(farmId);
    const result: OrchardVisualAssignmentSnapshot[] = [];
    for (const job of await this.jobs.listByFarm(farmId)) {
      if (job.kind !== "ORCHARD" || job.targetDefinitionId !== "tree_apple" || job.executionMode !== "RATE_PRODUCTION" || !job.enabled) continue;
      const area = await this.areas.findById(job.workAreaId);
      if (area === null || area.farmId !== farmId || area.kind !== "ORCHARD") continue;
      const cells = await this.areas.listCells(area.id);
      const cellSet = new Set(cells.map((cell) => `${String(cell.x)},${String(cell.y)}`));
      const targets = trees.filter((tree) => tree.treeDefinitionId === "tree_apple" && cellSet.has(`${String(tree.tileX)},${String(tree.tileY)}`)).flatMap((tree) => {
        const definition = this.definitions.findById(tree.treeDefinitionId);
        if (definition === null || !calculateTreeProduction(definition, tree, this.clock.now()).ready) return [];
        return [{ treeId: tree.id, treeDefinitionId: tree.treeDefinitionId, tileX: tree.tileX, tileY: tree.tileY, lifecycleState: "READY" as const }];
      });
      result.push({ actorJobId: job.id, actorId: job.actorId, farmId, workSkillId: "orchard.apple", executionMode: "RATE_PRODUCTION", workArea: { id: area.id, cells }, targets });
    }
    return result;
  }
}
