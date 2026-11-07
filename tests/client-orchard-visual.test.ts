import { describe, expect, it } from "vitest";
import { createOrchardActorVisualAdapter } from "../apps/web/src/workers/orchard-actor-visual";

const target = { treeInstanceId: "tree_a", tileX: 1, tileY: 1 };
function movement() {
  return { position: { worldX: 0, worldZ: 0 }, destination: null as { worldX: number; worldZ: number } | null,
    setDestination(next: { worldX: number; worldZ: number }) { this.destination = next; },
    clearDestination() { this.destination = null; } };
}

describe("Orchard actor visual adapter", () => {
  it("requests movement and never exposes an economic callback", () => {
    const move = movement();
    const adapter = createOrchardActorVisualAdapter(move);
    expect(adapter.update(0, true, true, [target]).state).toBe("TRAVEL_TO_WORK");
    expect(move.destination).toEqual({ worldX: 1, worldZ: 1 });
  });
  it("manual interruption clears Orchard control", () => {
    const move = movement();
    const adapter = createOrchardActorVisualAdapter(move);
    adapter.update(0, true, true, [target]);
    adapter.interruptManualMovement();
    expect(adapter.update(1000, true, true, [target]).state).toBe("IDLE");
  });
  it("hidden and empty states are idle without movement", () => {
    const move = movement();
    const adapter = createOrchardActorVisualAdapter(move);
    expect(adapter.update(0, false, true, [target]).state).toBe("IDLE");
    expect(adapter.update(1, true, true, []).state).toBe("IDLE");
    expect(move.destination).toBeNull();
  });
});
