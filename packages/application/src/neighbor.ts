import type { FarmId, PlayerId, NeighborNpcState } from "@happy-farm/domain";
import { ApplicationError } from "./errors";
import type { ActorContext, Clock, FarmMemberRepository, FarmRepository, NeighborRepository } from "./ports";

export interface NeighborIslandRecord { readonly id: string; readonly farmId: FarmId; readonly centerX: number; readonly centerZ: number; readonly dockX: number; readonly dockZ: number; readonly npcX: number; readonly npcZ: number; }
export interface NeighborNpcRecord extends NeighborNpcState { readonly islandId: string; readonly npcId: string; readonly displayNameKey: string; }
export interface NeighborVisitRecord { readonly playerId: PlayerId; readonly farmId: FarmId; readonly currentPlace: "HOME_ISLAND" | "NEIGHBOR_ISLAND"; readonly currentIslandId: string | null; readonly version: number; }
export interface NeighborArchipelagoIsland extends NeighborIslandRecord { readonly slot: "MOC" | "KIM" | "THUY"; readonly seed: number; readonly templateVersion: number; }
export interface NeighborArchipelagoNpc extends NeighborNpcRecord { readonly slot: "MOC" | "KIM" | "THUY"; readonly jobKey: string; readonly cycle: number; readonly nextActionAt: string; }
export interface NeighborSnapshot { readonly island: NeighborIslandRecord; readonly npc: NeighborNpcRecord; readonly visit: NeighborVisitRecord; readonly islands?: readonly NeighborArchipelagoIsland[]; readonly npcs?: readonly NeighborArchipelagoNpc[]; }

export class NeighborService {
  constructor(private readonly farms: FarmRepository, private readonly members: FarmMemberRepository, private readonly repository: NeighborRepository, private readonly clock: Clock) {}
  private async owner(actor: ActorContext | null): Promise<{ farmId: FarmId; playerId: PlayerId }> {
    if (actor === null) throw new ApplicationError("NOT_AUTHENTICATED", "Authentication is required");
    const farm = await this.farms.findByOwner(actor.playerId);
    if (farm === null) throw new ApplicationError("RESOURCE_NOT_FOUND", "Farm was not found");
    if (await this.members.findByFarmAndPlayer(farm.id, actor.playerId) === null) throw new ApplicationError("NOT_AUTHORIZED", "Farm access is not allowed");
    return { farmId: farm.id, playerId: actor.playerId };
  }
  async snapshot(actor: ActorContext | null): Promise<NeighborSnapshot> {
    const owner = await this.owner(actor); const now = this.clock.now();
    await this.repository.ensure(owner.farmId, now); await this.repository.reconcile(owner.farmId, now);
    return this.repository.snapshot(owner.farmId, owner.playerId);
  }
  async travel(actor: ActorContext | null, input: { requestId: string; expectedVersion: number; destination: "HOME_ISLAND" | "NEIGHBOR_ISLAND"; islandId?: string | undefined }): Promise<NeighborSnapshot> {
    const owner = await this.owner(actor); const now = this.clock.now();
    await this.repository.ensure(owner.farmId, now); await this.repository.reconcile(owner.farmId, now);
    if (input.destination === "NEIGHBOR_ISLAND" && input.islandId !== undefined) {
      const allowed = new Set([
        `neighbor_island_${owner.farmId}`,
        `neighbor_island_${owner.farmId}_kim`,
        `neighbor_island_${owner.farmId}_thuy`
      ]);
      if (!allowed.has(input.islandId)) throw new ApplicationError("NOT_AUTHORIZED", "That neighbour island is not available");
    }
    const fingerprint = JSON.stringify({ destination: input.destination, islandId: input.islandId ?? null, expectedVersion: input.expectedVersion });
    if (await this.repository.findTravelReplay(owner.playerId, input.requestId, fingerprint)) return this.repository.snapshot(owner.farmId, owner.playerId);
    const current = await this.repository.visit(owner.farmId, owner.playerId);
    if (current.version !== input.expectedVersion) throw new ApplicationError("CONFLICT_STALE_STATE", "Neighbour visit is stale");
    if (current.currentPlace !== input.destination || (input.islandId !== undefined && current.currentIslandId !== input.islandId)) await this.repository.travelAtomically(owner.farmId, owner.playerId, current, input, now);
    return this.repository.snapshot(owner.farmId, owner.playerId);
  }
  async talk(actor: ActorContext | null, input: { requestId: string; expectedVersion: number }): Promise<{ readonly snapshot: NeighborSnapshot; readonly dialogueKey: string }> {
    const owner = await this.owner(actor); const now = this.clock.now();
    await this.repository.ensure(owner.farmId, now); await this.repository.reconcile(owner.farmId, now);
    const current = await this.repository.visit(owner.farmId, owner.playerId);
    if (current.currentPlace !== "NEIGHBOR_ISLAND") throw new ApplicationError("NOT_AUTHORIZED", "The neighbour is not nearby");
    if (current.version !== input.expectedVersion) throw new ApplicationError("CONFLICT_STALE_STATE", "Neighbour visit is stale");
    return { snapshot: await this.repository.snapshot(owner.farmId, owner.playerId), dialogueKey: "neighbor.dialogue.progress" };
  }
}
