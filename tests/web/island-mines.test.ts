import { describe, expect, it } from "vitest";
import type { MineDTO } from "@happy-farm/contracts";
import { mineOreAt, minePanelView, minePieces, mineScale, mineSecondsUntilFull } from "../../apps/web/src/mines/model";
import { buildInteractionIndex } from "../../apps/web/src/interaction/registry";
import { interactionActivation } from "../../apps/web/src/interaction/selection";
import { interactionActionKey } from "../../apps/web/src/interaction/model";
import { resourceModelUrl } from "../../apps/web/src/render/model-urls";

const MINE: MineDTO = {
  slot: 0,
  x: 12,
  y: -12,
  level: 1,
  orePerHour: 60,
  capacityOre: 240,
  availableMilli: 30_000,
  nextLevel: {
    level: 2,
    orePerHour: 90,
    requiredPlayerLevel: 8,
    currencyId: "currency_gold",
    gold: 500,
    materials: [
      { itemDefinitionId: "item_wood", quantity: 80 },
      { itemDefinitionId: "item_ore", quantity: 150 }
    ]
  }
};
const READ_AT = Date.parse("2026-11-15T00:00:00.000Z");
const minutes = (count: number) => READ_AT + count * 60_000;

function panel(overrides: Partial<Parameters<typeof minePanelView>[0]> = {}) {
  return minePanelView({
    mine: MINE,
    readAtMs: READ_AT,
    nowMs: READ_AT,
    owner: true,
    playerLevel: 8,
    gold: 1_000,
    held: (item) => (item === "item_wood" ? 100 : 200),
    busy: false,
    ...overrides
  });
}

describe("a mine, as the page reads it", () => {
  it("counts up from the server's reading at the mine's own rate, and stops at capacity", () => {
    expect(mineOreAt(MINE, READ_AT, READ_AT)).toBe(30);
    expect(mineOreAt(MINE, READ_AT, minutes(30))).toBe(60);
    expect(mineOreAt(MINE, READ_AT, minutes(10_000))).toBe(240);
    // A local clock behind the reading never takes ore away.
    expect(mineOreAt(MINE, READ_AT, minutes(-30))).toBe(30);
    expect(mineSecondsUntilFull(MINE, READ_AT, READ_AT)).toBe(210 * 60);
    expect(mineSecondsUntilFull(MINE, READ_AT, minutes(500))).toBe(0);
  });

  it("offers the dig only to the owner of a mine with ore in it", () => {
    expect(panel().digBlocker).toBeNull();
    expect(panel({ mine: { ...MINE, availableMilli: 400 } }).digBlocker).toBe("EMPTY");
    expect(panel({ owner: false }).digBlocker).toBe("NOT_OWNER");
    expect(panel({ busy: true }).digBlocker).toBe("BUSY");
  });

  it("says why an upgrade is not offered, in the order a player can fix it", () => {
    expect(panel().upgrade?.blocker).toBeNull();
    expect(panel({ playerLevel: 7 }).upgrade?.blocker).toBe("LEVEL");
    expect(panel({ held: () => 10 }).upgrade?.blocker).toBe("MATERIALS");
    expect(panel({ held: () => 10 }).upgrade?.materials.map((entry) => entry.enough)).toEqual([false, false]);
    expect(panel({ gold: 499 }).upgrade?.blocker).toBe("GOLD");
    expect(panel({ owner: false }).upgrade?.blocker).toBe("NOT_OWNER");
    expect(panel({ mine: { ...MINE, level: 10, nextLevel: null } }).upgrade).toBeNull();
  });

  it("draws richer rocks and a bigger cluster as it levels up, never losing a rock", () => {
    let previous = minePieces(1);
    expect(previous).toHaveLength(3);
    for (let level = 2; level <= 10; level += 1) {
      const pieces = minePieces(level);
      expect(pieces.slice(0, previous.length)).toEqual(previous);
      expect(pieces.length).toBeGreaterThan(previous.length);
      expect(mineScale(level)).toBeGreaterThan(mineScale(level - 1));
      previous = pieces;
    }
    for (const piece of minePieces(10)) expect(resourceModelUrl(piece.modelId), piece.modelId).toBeTypeOf("string");
  });
});

describe("a mine, as something the player can use", () => {
  const index = buildInteractionIndex({
    crops: [],
    trees: [],
    constructions: [],
    cropDefinitions: [],
    treeDefinitions: [],
    worldObjects: new Map(),
    buildCatalog: [],
    mines: [{ slot: 2, x: 6, y: -15, level: 3 }],
    nowMs: READ_AT
  });

  it("is one DIG_MINE target per opened mine, keyed by slot", () => {
    const target = index.targets.find((candidate) => candidate.key === "mine:2");
    expect(target).toMatchObject({ kind: "ISLAND_MINE", action: "DIG_MINE", targetId: "2", nameKey: "mine.name" });
    expect(interactionActionKey("DIG_MINE")).toBe("interaction.digMine");
  });

  it("activates as a dig of that slot - the server decides how much", () => {
    const target = index.targets.find((candidate) => candidate.key === "mine:2");
    if (target === undefined) throw new Error("mine target missing");
    const candidate = { ...target, distanceWorld: 1, facing: 1 };
    expect(interactionActivation(candidate, candidate)).toMatchObject({ kind: "DIG_MINE", slot: 2 });
  });
});
