import { describe, expect, it } from "vitest";
import {
  BoxGeometry,
  Group,
  InstancedMesh,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  Vector2,
  Vector3
} from "three";
import type { BuildCatalogEntryDTO, ConstructionDTO, WorldObjectDefinitionDTO } from "@happy-farm/contracts";
import { buildInstancedObjects } from "../../apps/web/src/render/scenery";
import { CONSTRUCTION_IDS_KEY, constructionIdFromHits, tapTargetFor } from "../../apps/web/src/render/object-picking";
import { objectObstacles, objectPolicy, starterVisual } from "../../apps/web/src/world-objects";

/**
 * The island's hundreds of objects are drawn in batches, and a click still finds exactly one of them.
 *
 * V13.3.1 promotes the forest, the buildings and the set dressing, so a mesh per object would be a
 * draw call per tree - the CPU regression this project already paid for once. They are drawn as
 * instanced batches instead, and this file is the net under that: a raycast against a batch reports
 * an *instance index*, and the batch has to turn it back into the row the player meant, through a
 * rebuild, a move, a store and a removal.
 */

const pitch = 1.08;
const frame = { originTileX: 5.5, originTileY: 5.5, pitch };

function row(overrides: Partial<ConstructionDTO> = {}): ConstructionDTO {
  return {
    constructionId: "construct_11111111-1111-4111-8111-111111111111",
    farmId: "farm_11111111-1111-4111-8111-111111111111",
    entryId: "world.tree_pine",
    category: "WORLD_OBJECT",
    anchorX: 1,
    anchorY: 1,
    rotation: 0,
    footprint: { widthCells: 1, depthCells: 1 },
    state: "ACTIVE",
    source: "STARTER",
    placementKey: "starter.pine.001",
    paidAmount: 0,
    costAmount: 0,
    costCurrencyDefinitionId: "currency_gold",
    createdAt: "2026-10-01T00:00:00.000Z",
    storedAt: null,
    version: 1,
    ...overrides
  };
}

/** One unit cube at the origin, so an instance's matrix is exactly its placement. */
function model(): Group {
  const group = new Group();
  group.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial()));
  group.updateMatrixWorld(true);
  return group;
}

interface Placement {
  readonly id: string;
  readonly worldX: number;
  readonly worldZ: number;
}

function buildBatch(placements: readonly Placement[]): { readonly group: Group; readonly batch: InstancedMesh } {
  const group = new Group();
  buildInstancedObjects(
    group,
    model(),
    placements.map((placement) => ({
      worldX: placement.worldX,
      worldY: 0,
      worldZ: placement.worldZ,
      rotationY: 0,
      sizeWorld: 1
    })),
    false,
    placements.map((placement) => placement.id)
  );
  const batch: Object3D | undefined = group.children[0];
  if (!(batch instanceof InstancedMesh)) throw new Error("expected an instanced batch");
  return { group, batch: batch as InstancedMesh };
}

/** A ray straight down onto one instance, through a real raycaster. */
function hitInstance(group: Group, x: number, z: number): string | null {
  const camera = new PerspectiveCamera(60, 1, 0.1, 100);
  camera.position.set(x, 10, z);
  camera.lookAt(new Vector3(x, 0, z));
  camera.updateMatrixWorld(true);
  const raycaster = new Raycaster();
  raycaster.setFromCamera(new Vector2(0, 0), camera);
  return constructionIdFromHits(raycaster.intersectObjects(group.children, true));
}

describe("instanced world objects", () => {
  it("resolves each instance to its own row", () => {
    const { group } = buildBatch([
      { id: "construct_a", worldX: 0, worldZ: 0 },
      { id: "construct_b", worldX: 3, worldZ: 0 }
    ]);
    expect(hitInstance(group, 0, 0)).toBe("construct_a");
    expect(hitInstance(group, 3, 0)).toBe("construct_b");
    // Between them there is nothing to hit, so the click is a ground click - the panel the brief's
    // QA saw open on a tree does not open on the grass beside it.
    expect(hitInstance(group, 1.5, 0)).toBeNull();
  });

  it("keeps the mapping through a rebuild, a move and a removal", () => {
    const first = buildBatch([
      { id: "construct_a", worldX: 0, worldZ: 0 },
      { id: "construct_b", worldX: 3, worldZ: 0 }
    ]);
    expect(hitInstance(first.group, 0, 0)).toBe("construct_a");

    // A rebuild after a move: same rows, new ground. The old spot resolves to nothing, the new one
    // to the same object.
    const moved = buildBatch([
      { id: "construct_a", worldX: 6, worldZ: 0 },
      { id: "construct_b", worldX: 3, worldZ: 0 }
    ]);
    expect(hitInstance(moved.group, 0, 0)).toBeNull();
    expect(hitInstance(moved.group, 6, 0)).toBe("construct_a");

    // A rebuild after a removal: the row is gone, so its instance is gone with it - and the batch's
    // own table is what says so, not a stale index.
    const removed = buildBatch([{ id: "construct_b", worldX: 3, worldZ: 0 }]);
    expect(hitInstance(removed.group, 6, 0)).toBeNull();
    expect(hitInstance(removed.group, 3, 0)).toBe("construct_b");
    expect((removed.batch.userData as Record<string, unknown>)[CONSTRUCTION_IDS_KEY]).toEqual(["construct_b"]);
  });

  it("does not render a stored object, so there is nothing there to select", () => {
    // Storage is a state of the same row; the layer that draws is handed only what stands, which is
    // the same filter the collision world and the cell map use.
    const standing = [row(), row({ constructionId: "construct_stored", state: "STORED", storedAt: "2026-10-02T00:00:00.000Z" })];
    const active = standing.filter((entry) => entry.state === "ACTIVE");
    const { batch } = buildBatch(active.map((entry, index) => ({ id: entry.constructionId, worldX: index * 3, worldZ: 0 })));
    expect(active).toHaveLength(1);
    expect((batch.userData as Record<string, unknown>)[CONSTRUCTION_IDS_KEY]).toEqual(["construct_11111111-1111-4111-8111-111111111111"]);
    // And a stored object contributes no collision either.
    expect(objectObstacles(standing, frame, new Map())).toHaveLength(1);
  });

  it("keeps the ground click a ground click while a placement is in hand", () => {
    // The one interaction rule the editor rests on: while something is being placed or moved, every
    // tap belongs to the placement, even if an object is under the pointer.
    expect(tapTargetFor({ objectPickingEnabled: false, constructionId: "construct_a" })).toBe("GROUND");
    expect(tapTargetFor({ objectPickingEnabled: true, constructionId: "construct_a" })).toBe("OBJECT");
    expect(tapTargetFor({ objectPickingEnabled: true, constructionId: null })).toBe("GROUND");
  });
});

describe("the island's arrangement of a row", () => {
  it("draws a promoted pine with the model and size it grew as", () => {
    // A forest is a family of models and a scatter of sizes. The row carries identity and position;
    // the arrangement carries what it looked like, keyed by the row's stable placement key - which is
    // what keeps a moved tree the same tree.
    const visual = starterVisual("starter.pine.001");
    expect(visual).toBeDefined();
    expect(visual?.modelId).toMatch(/^tree_pine_/);
    expect(visual?.sizeWorld).toBeGreaterThan(2);
    // A bought object has no arrangement and falls through to its catalogue entry.
    expect(starterVisual(null)).toBeUndefined();
    expect(starterVisual("not.a.placement")).toBeUndefined();
  });

  it("offers the promoted objects the same actions as anything else", () => {
    const definitions = new Map<string, WorldObjectDefinitionDTO>([
      [
        "world.tree_pine",
        {
          id: "world.tree_pine",
          displayNameKey: "object.tree_pine.name",
          modelId: "tree_pine_2",
          landmarkKind: null,
          sizeWorld: 3.8,
          collisionRadiusWorld: 0.5,
          footprint: { widthCells: 1, depthCells: 1 },
          allowedTerrain: ["LAND"],
          movable: true,
          rotatable: true,
          storable: true,
          removable: true,
          removalRefundRate: 0.5
        }
      ]
    ]);
    const policy = objectPolicy(row(), definitions, [] as readonly BuildCatalogEntryDTO[]);
    expect(policy).toMatchObject({ movable: true, rotatable: true, storable: true, removable: true, price: 0 });
  });
});
