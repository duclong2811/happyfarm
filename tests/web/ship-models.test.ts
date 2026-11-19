import { BoxGeometry, Group, Mesh, MeshStandardMaterial, MeshLambertMaterial, Box3 } from "three";
import { describe, expect, it } from "vitest";
import { PIRATE_SHIPS, SHIP_CLASSES } from "@happy-farm/game-data";
import { fitShipModel, SHARED_SHIP_GEOMETRY, SHIP_DRAFT_SHARE, shipModelForTier, shipModelId } from "../../apps/web/src/render/ship-models";
import { MODEL_SPECS } from "../../tools/asset-pipeline/node/specs.mjs";

const SHIPPED = new Set(MODEL_SPECS.map((spec) => spec.id));

/** A stand-in model: 10 long on z, 2 wide, 4 tall, base at y = 0, like a generated ship. */
function stubShip(): Group {
  const geometry = new BoxGeometry(2, 4, 10);
  geometry.translate(0, 2, 0);
  const root = new Group();
  root.add(new Mesh(geometry, new MeshStandardMaterial({ color: 0x884422 })));
  return root;
}

describe("ship models", () => {
  it("gives every ship class and every pirate a model the pipeline ships", () => {
    for (const shipClass of SHIP_CLASSES) {
      const id = shipModelId(shipClass.id);
      expect(id, shipClass.id).not.toBeNull();
      expect(SHIPPED.has(id ?? ""), shipClass.id).toBe(true);
      expect(shipModelForTier(shipClass.tier), shipClass.id).toBe(id);
    }
    for (const pirate of PIRATE_SHIPS) {
      expect(shipModelId(pirate.id), pirate.id).toBe(pirate.id);
      expect(SHIPPED.has(pirate.id), pirate.id).toBe(true);
    }
    expect(shipModelId("ship_class_unknown")).toBeNull();
    expect(shipModelForTier(0)).toBe("ship_rowboat");
    expect(shipModelForTier(9)).toBe("ship_frigate");
  });

  it("fits a model to a length, bow toward +x, sunk to its waterline", () => {
    const source = stubShip();
    const fitted = fitShipModel(source, 20);
    fitted.updateMatrixWorld(true);
    const box = new Box3().setFromObject(fitted);
    expect(box.max.x - box.min.x).toBeCloseTo(20, 5);
    expect(box.max.z - box.min.z).toBeCloseTo(4, 5);
    expect(box.min.y).toBeCloseTo(-SHIP_DRAFT_SHARE * 20, 5);
    // The source is untouched, and the copy shares its geometry: a scene must not dispose it.
    expect(source.scale.x).toBe(1);
    const sourceMesh = source.children[0] as Mesh;
    let copyMesh: Mesh | null = null;
    fitted.traverse((node) => {
      if (node instanceof Mesh) copyMesh = node;
    });
    expect(copyMesh).not.toBeNull();
    const mesh = copyMesh as unknown as Mesh;
    expect(mesh.geometry).toBe(sourceMesh.geometry);
    expect(mesh.material).toBe(sourceMesh.material);
    expect(mesh.userData[SHARED_SHIP_GEOMETRY]).toBe(true);
  });

  it("hazes a tinted copy with its own materials, leaving the library's alone", () => {
    const source = stubShip();
    const sourceMaterial = (source.children[0] as Mesh).material as MeshStandardMaterial;
    const fitted = fitShipModel(source, 10, { haze: 0xffffff, amount: 0.5 });
    let material: unknown = null;
    fitted.traverse((node) => {
      if (node instanceof Mesh) material = node.material;
    });
    expect(material).toBeInstanceOf(MeshLambertMaterial);
    expect(material).not.toBe(sourceMaterial);
    const hazed = material as MeshLambertMaterial;
    expect(hazed.fog).toBe(false);
    // Halfway from the model's colour to white, in the same colour space three keeps.
    expect(hazed.color.r).toBeCloseTo((sourceMaterial.color.r + 1) / 2, 5);
    expect(sourceMaterial.color.getHex()).toBe(0x884422);
  });
});
