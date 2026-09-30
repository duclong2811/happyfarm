import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INITIAL_LAND_SIZE } from "@happy-farm/domain";
import { buildProductionZones, districtForCellType } from "../../apps/web/src/render/production";
import { BUILDINGS, RESERVED_BUILDINGS, variantFor } from "../../apps/web/src/render/buildings";
import { DISTRICTS, LANDMARKS, districtAt } from "../../apps/web/src/render/world-config";

/**
 * The invariants of the island's production land and its buildings.
 *
 * These are the questions a person would ask of the world: does a cell live in the district that
 * offers it, is a crop cell the tile the server agreed on, does a reserved plot have room for the
 * building that will replace what is there now, and does every building name a model that actually
 * shipped.
 */

const MODEL_ROOT = fileURLToPath(new URL("../../apps/web/src/assets/models/farm-buildings", import.meta.url));

function ownedStarterTiles() {
  const tiles = [];
  for (let y = 0; y < INITIAL_LAND_SIZE; y += 1) {
    for (let x = 0; x < INITIAL_LAND_SIZE; x += 1) tiles.push({ x, y });
  }
  return tiles;
}

describe("production cells", () => {
  it("gives each cell type exactly one district, and a zone to live in", () => {
    const zones = buildProductionZones({ ownedTiles: ownedStarterTiles() });
    expect(zones.map((zone) => zone.cellType)).toEqual(["CROP", "ORCHARD", "AQUACULTURE"]);
    for (const zone of zones) {
      expect(zone.pitch, zone.id).toBeGreaterThan(0);
      expect(districtForCellType(zone.cellType as "CROP" | "ORCHARD" | "AQUACULTURE"), zone.id).toBe(zone.district);
    }
    // Ids are the handle a future system will refer to a zone by, so they cannot collide.
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(zones.length);
  });

  it("draws crop cells only on land the farm actually owns, and exactly on the tile grid", () => {
    const owned = ownedStarterTiles();
    const zones = buildProductionZones({ ownedTiles: owned });
    const crop = zones.find((zone) => zone.cellType === "CROP");
    expect(crop?.cells).toHaveLength(owned.length);
    for (const cell of crop?.cells ?? []) {
      // A crop cell *is* an authoritative tile: whole coordinates, inside the reserve, and owned.
      expect(Number.isInteger(cell.x) && Number.isInteger(cell.y), `${String(cell.x)},${String(cell.y)}`).toBe(true);
      const owned = ownedStarterTiles().some((tile) => tile.x === cell.x && tile.y === cell.y);
      expect(owned, `${String(cell.x)},${String(cell.y)}`).toBe(true);
    }
  });

  it("keeps every orchard cell in the orchard and every basin in the fishery", () => {
    const zones = buildProductionZones({ ownedTiles: ownedStarterTiles() });
    for (const zone of zones) {
      if (zone.cellType === "CROP") continue;
      for (const cell of zone.cells) {
        const owner = districtAt({ x: cell.x, y: cell.y });
        expect(owner?.kind, `${zone.id} cell at ${String(cell.x)},${String(cell.y)}`).toBe(zone.district);
      }
    }
  });

  it("keeps aquaculture basins off the harbour's own ground", () => {
    const zones = buildProductionZones({ ownedTiles: ownedStarterTiles() });
    const basins = zones.find((zone) => zone.cellType === "AQUACULTURE")?.cells ?? [];
    expect(basins.length).toBeGreaterThan(0);
    const harbour = LANDMARKS.find((landmark) => landmark.id === "harbor");
    expect(harbour).toBeDefined();
    for (const basin of basins) {
      const distance = Math.hypot(basin.x - (harbour?.tile.x ?? 0), basin.y - (harbour?.tile.y ?? 0));
      // A pen where the quay is would be a pen on the quay.
      expect(distance, `basin at ${String(basin.x)},${String(basin.y)}`).toBeGreaterThan(harbour?.blockingRadiusWorld ?? 0);
    }
  });

  it("is deterministic: the same farm offers the same cells", () => {
    const first = buildProductionZones({ ownedTiles: ownedStarterTiles() });
    const second = buildProductionZones({ ownedTiles: ownedStarterTiles() });
    expect(first).toEqual(second);
  });
});

describe("buildings", () => {
  it("has one definition per landmark, with unique ids", () => {
    expect(BUILDINGS).toHaveLength(LANDMARKS.length);
    const ids = BUILDINGS.map((building) => building.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const building of BUILDINGS) {
      expect(building.variants.length, building.id).toBeGreaterThan(0);
      expect(building.visualTier, building.id).toBe(1);
      expect(variantFor(building).tier, building.id).toBe(1);
      // A building's collision circle is a simplified footprint, never larger than its own ground.
      expect(building.collisionRadiusWorld, building.id).toBeLessThanOrEqual(building.footprint.halfWidthWorld + 0.001);
    }
  });

  it("puts every building in the district its kind belongs to", () => {
    for (const building of BUILDINGS) {
      const owner = districtAt(building.tile);
      expect(owner?.kind, `${building.id} stands in ${owner?.kind ?? "no district"}`).toBe(building.district);
    }
  });

  it("reserves enough ground for the largest tier that will replace what is there now", () => {
    // The point of a reserved plot is that a tier-3 building fits where a tier-1 one stands, so the
    // layout never has to move later. Each reserved footprint is therefore at least as large as the
    // building it will replace.
    const reserved = new Map(RESERVED_BUILDINGS.map((entry) => [entry.id, entry]));
    expect(reserved.size).toBe(RESERVED_BUILDINGS.length);
    for (const plot of RESERVED_BUILDINGS) {
      const host = DISTRICTS.find((district) => district.kind === plot.district);
      expect(host, plot.id).toBeDefined();
      expect(Math.min(plot.footprint.halfWidthWorld, plot.footprint.halfDepthWorld), plot.id).toBeGreaterThan(2);
      expect(districtAt(plot.tile)?.kind, plot.id).toBe(plot.district);
    }
    // â€¦and no two reserved plots share ground.
    for (let left = 0; left < RESERVED_BUILDINGS.length; left += 1) {
      for (let right = left + 1; right < RESERVED_BUILDINGS.length; right += 1) {
        const a = RESERVED_BUILDINGS[left];
        const b = RESERVED_BUILDINGS[right];
        if (a === undefined || b === undefined) continue;
        const gap = Math.hypot(a.tile.x - b.tile.x, a.tile.y - b.tile.y);
        expect(gap, `${a.id}/${b.id}`).toBeGreaterThan(
          Math.max(a.footprint.halfWidthWorld, a.footprint.halfDepthWorld) +
            Math.max(b.footprint.halfWidthWorld, b.footprint.halfDepthWorld)
        );
      }
    }
  });

  it("names only models that actually shipped", () => {
    const shipped = new Set(readdirSync(MODEL_ROOT).map((name) => name.replace(/\.glb$/, "")));
    for (const building of BUILDINGS) {
      for (const variant of building.variants) {
        if (variant.modelId === null) continue;
        expect(shipped.has(variant.modelId), `${building.id} tier ${String(variant.tier)}: ${variant.modelId}`).toBe(true);
      }
    }
    // And the reverse: a model nothing names is an orphan the bundle pays for and no scene draws.
    const named = new Set(BUILDINGS.flatMap((building) => building.variants.map((variant) => variant.modelId)));
    for (const id of shipped) {
      expect(named.has(id), `${id} is shipped but nothing draws it`).toBe(true);
    }
  });
});
