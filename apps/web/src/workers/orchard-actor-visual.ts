import { createOrchardVisualController, type OrchardVisualSnapshot, type OrchardVisualTarget } from "./orchard-visual";

export const ORCHARD_INTERACTION_DISTANCE = 0.9;

export interface OrchardActorMovementAdapter {
  readonly position: { readonly worldX: number; readonly worldZ: number } | null;
  readonly destination: { readonly worldX: number; readonly worldZ: number } | null;
  setDestination(destination: { readonly worldX: number; readonly worldZ: number }): void;
  clearDestination(): void;
}
export type OrchardTargetWorldTransform = (target: OrchardVisualTarget) => { readonly worldX: number; readonly worldZ: number };

export interface OrchardActorVisualAdapter {
  readonly controller: ReturnType<typeof createOrchardVisualController>;
  update(nowMs: number, visible: boolean, assigned: boolean, targets: readonly OrchardVisualTarget[]): OrchardVisualSnapshot;
  interruptManualMovement(): void;
  dispose(): void;
}

/** Presentation adapter: it requests movement from the existing Actor runtime and owns no economy. */
export function createOrchardActorVisualAdapter(
  movement: OrchardActorMovementAdapter,
  toWorld: OrchardTargetWorldTransform = (target) => ({ worldX: target.tileX, worldZ: target.tileY })
): OrchardActorVisualAdapter {
  const controller = createOrchardVisualController();
  let manualUntil = 0;
  function interactionPoint(target: OrchardVisualTarget): { worldX: number; worldZ: number } {
    return toWorld(target);
  }
  return {
    controller,
    update(nowMs, visible, assigned, targets) {
      const currentTarget = controller.snapshot().target;
      const targetPosition = currentTarget === null ? null : interactionPoint(currentTarget);
      const arrived = targetPosition !== null && movement.position !== null &&
        Math.hypot(targetPosition.worldX - movement.position.worldX, targetPosition.worldZ - movement.position.worldZ) <= ORCHARD_INTERACTION_DISTANCE;
      const snapshot = controller.update(nowMs, visible && nowMs >= manualUntil, targets, assigned, arrived);
      if (snapshot.state === "TRAVEL_TO_WORK" || snapshot.state === "TRAVEL_BETWEEN_TREES") {
        if (snapshot.target !== null && movement.destination === null) movement.setDestination(interactionPoint(snapshot.target));
      } else if (snapshot.state === "WORKING") {
        movement.clearDestination();
      }
      return snapshot;
    },
    interruptManualMovement() {
      manualUntil = Number.MAX_SAFE_INTEGER;
      controller.interrupt();
    },
    dispose() {
      controller.interrupt();
      movement.clearDestination();
    }
  };
}
