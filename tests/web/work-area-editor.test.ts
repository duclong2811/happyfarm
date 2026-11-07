import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  MAX_WORK_AREA_CELLS,
  addDraftCells,
  applyDraftClick,
  cellFitsKind,
  draftCellList,
  normalizeNameInput,
  rectangleCells,
  rectanglePreview,
  toggleDraftCell,
  workAreaEditScene,
  workAreaListSignature
} from "../../apps/web/src/work-areas/model";

/**
 * The work-area editor's pure half, and the one thing that makes it affordable.
 *
 * A rectangle is how a finger picks cells; the stored model is the explicit list. These tests pin the
 * conversion, the cap, the naming rules, and - the performance half - that nothing on the farm's
 * ordinary load path or the growth poll ever asks for a work area.
 */

const MAIN = fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url));

function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `main.ts declares ${signature}`).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("work-area cell selection", () => {
  it("turns two corners into the explicit cells between them, both corners included", () => {
    const { cells, overflow } = rectangleCells({ x: 2, y: 3 }, { x: 4, y: 5 });
    expect(overflow).toBe(0);
    expect(cells).toEqual([
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 },
      { x: 2, y: 4 },
      { x: 3, y: 4 },
      { x: 4, y: 4 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
      { x: 4, y: 5 }
    ]);
  });

  it("does not care which corner came first", () => {
    expect(rectangleCells({ x: 4, y: 5 }, { x: 2, y: 3 }).cells).toEqual(
      rectangleCells({ x: 2, y: 3 }, { x: 4, y: 5 }).cells
    );
  });

  it("stops a drag that would cover more than the cap and reports the overflow", () => {
    const { cells, overflow } = rectangleCells({ x: 0, y: 0 }, { x: 40, y: 40 });
    expect(cells).toHaveLength(MAX_WORK_AREA_CELLS);
    expect(overflow).toBe(41 * 41 - MAX_WORK_AREA_CELLS);
  });

  it("adds and removes one cell per tap and never grows past the cap", () => {
    const one = toggleDraftCell(new Set<string>(), { x: 1, y: 1 });
    expect(draftCellList(one)).toEqual([{ x: 1, y: 1 }]);
    expect(draftCellList(toggleDraftCell(one, { x: 1, y: 1 }))).toEqual([]);

    const full = new Set<string>(
      Array.from({ length: MAX_WORK_AREA_CELLS }, (_value, index) => `${String(index)},0`)
    );
    expect(toggleDraftCell(full, { x: 999, y: 0 }).size).toBe(MAX_WORK_AREA_CELLS);
    expect(addDraftCells(full, [{ x: 999, y: 0 }]).size).toBe(MAX_WORK_AREA_CELLS);
  });

  it("returns the draft in the order the server normalises to", () => {
    const draft = addDraftCells(new Set<string>(), [
      { x: 5, y: 1 },
      { x: 1, y: 2 },
      { x: 2, y: 1 }
    ]);
    expect(draftCellList(draft)).toEqual([
      { x: 2, y: 1 },
      { x: 5, y: 1 },
      { x: 1, y: 2 }
    ]);
  });
});

describe("work-area naming", () => {
  it("trims and normalises, and accepts Unicode up to the cap", () => {
    expect(normalizeNameInput("  East Field  ")).toEqual({ value: "East Field", problem: null });
    expect(normalizeNameInput("Cánh đồng").value).toBe("Cánh đồng");
    expect(normalizeNameInput("🌱".repeat(40)).problem).toBe(null);
  });

  it("refuses empty, whitespace-only and over-long names", () => {
    expect(normalizeNameInput("").problem).toBe("EMPTY");
    expect(normalizeNameInput("   ").problem).toBe("EMPTY");
    expect(normalizeNameInput("a".repeat(41)).problem).toBe("TOO_LONG");
  });
});

describe("the management list re-renders only when it changed", () => {
  const area = { workAreaId: "workarea_1", displayName: "East Field", kind: "FARM", cellCount: 4, version: 1 };

  it("is stable for an unchanged list and changes for anything a player can see", () => {
    const base = workAreaListSignature([area]);
    expect(workAreaListSignature([{ ...area }])).toBe(base);
    expect(workAreaListSignature([{ ...area, version: 2 }])).not.toBe(base);
    expect(workAreaListSignature([{ ...area, displayName: "West Field" }])).not.toBe(base);
    expect(workAreaListSignature([{ ...area, kind: "ORCHARD" }])).not.toBe(base);
    expect(workAreaListSignature([{ ...area, cellCount: 5 }])).not.toBe(base);
    expect(workAreaListSignature([])).not.toBe(base);
  });
});

describe("work areas stay off the farm's hot paths", () => {
  it("reads them only from the two panels that show them, and never from a farm load or the growth poll", () => {
    const source = readFileSync(MAIN, "utf8");
    // The work-area panel lists them; the worker panel needs their names to say where a job works.
    expect(source.split("getWorkAreas(").length - 1).toBe(2);
    expect(functionBody(source, "async function loadWorkAreas(")).toContain("getWorkAreas(");
    expect(functionBody(source, "async function loadWorkers(")).toContain("getWorkAreas(");

    for (const signature of [
      "async function refreshFarm(",
      "async function refreshGrowth(",
      "async function refreshAccount("
    ]) {
      const body = functionBody(source, signature);
      expect(body, signature).not.toContain("WorkArea");
      expect(body, signature).not.toContain("workArea");
    }
  });

  it("loads them when the panel opens and after a mutation, and nowhere else", () => {
    const source = readFileSync(MAIN, "utf8");
    const load = functionBody(source, "async function loadWorkAreas(");
    expect(load).toContain("api().getWorkAreas(");
    // The panel's open is the only trigger; there is no boot read and no timer.
    expect(source).toContain('if (panels.active === "workAreas") void loadWorkAreas();');
    expect(source.split("loadWorkAreas()").length - 1).toBeLessThan(8);
  });
});

/**
 * V16.2.2A.1: the selection itself.
 *
 * The click rule is one pure function because a player has to be able to predict it: a selected cell
 * is removed, an unselected one starts a rectangle, and the second corner fills it. Everything the
 * editor draws is derived from the same draft - never stored as a rectangle.
 */

/** The editor's stand-in for the island: everything with a non-negative x can be worked. */
const fits = (cell: { readonly x: number; readonly y: number }): boolean => cell.x >= 0;

function scene(mode: "CREATE" | "CELLS" | "RENAME", draft: readonly string[], corner: { x: number; y: number } | null, hover: { x: number; y: number } | null) {
  return workAreaEditScene({ mode, draft: new Set(draft), corner, hover, fits });
}

describe("the deterministic click rule", () => {
  it("adds an unselected valid cell and arms it as the first corner", () => {
    const result = applyDraftClick({ draft: new Set<string>(), corner: null }, { x: 1, y: 1 }, true);
    expect(result.kind).toBe("APPLIED");
    if (result.kind !== "APPLIED") return;
    expect(result.corner).toBe("ARMED");
    expect(draftCellList(result.next.draft)).toEqual([{ x: 1, y: 1 }]);
    expect(result.next.corner).toEqual({ x: 1, y: 1 });
  });

  it("removes an already-selected cell and drops any armed corner", () => {
    const result = applyDraftClick(
      { draft: new Set(["1,1"]), corner: { x: 9, y: 9 } },
      { x: 1, y: 1 },
      true
    );
    expect(result.kind).toBe("APPLIED");
    if (result.kind !== "APPLIED") return;
    expect(result.corner).toBe("CLEARED");
    expect(draftCellList(result.next.draft)).toEqual([]);
    expect(result.next.corner).toBe(null);
  });

  it("refuses ground the kind cannot use, without changing the draft", () => {
    const result = applyDraftClick({ draft: new Set<string>(), corner: null }, { x: -5, y: 1 }, false);
    expect(result).toEqual({ kind: "REFUSED", reason: "INVALID", next: { draft: new Set<string>(), corner: null } });
  });

  it("refuses a fresh cell once the cap is reached", () => {
    const full = new Set<string>(Array.from({ length: MAX_WORK_AREA_CELLS }, (_value, index) => `${String(index)},0`));
    const result = applyDraftClick({ draft: full, corner: null }, { x: 999, y: 0 }, true);
    expect(result.kind).toBe("REFUSED");
    if (result.kind === "REFUSED") expect(result.reason).toBe("CAP");
  });

  it("fills the rectangle on the second click, keeping only the cells that fit", () => {
    const armed = { draft: new Set(["2,2"]), corner: { x: 2, y: 2 } };
    const result = applyDraftClick(armed, { x: 4, y: 3 }, true);
    expect(result.kind).toBe("APPLIED");
    if (result.kind !== "APPLIED") return;
    expect(result.corner).toBe("CLEARED");
    expect(result.next.corner).toBe(null);
    expect(draftCellList(result.next.draft)).toEqual([
      { x: 2, y: 2 },
      { x: 3, y: 2 },
      { x: 4, y: 2 },
      { x: 2, y: 3 },
      { x: 3, y: 3 },
      { x: 4, y: 3 }
    ]);

    const mixesGround = applyDraftClick(
      { draft: new Set<string>(), corner: { x: -1, y: 0 } },
      { x: 1, y: 0 },
      false
    );
    // Only the corner cell fits; the refused ground in between is not added.
    if (mixesGround.kind === "APPLIED") expect(draftCellList(mixesGround.next.draft)).toEqual([]);
  });

  it("stops a rectangle at the cap and says it was cut short", () => {
    const full = new Set<string>(Array.from({ length: MAX_WORK_AREA_CELLS - 1 }, (_value, index) => `${String(index)},50`));
    const result = applyDraftClick({ draft: full, corner: { x: 0, y: 0 } }, { x: 3, y: 0 }, true);
    expect(result.kind).toBe("APPLIED");
    if (result.kind !== "APPLIED") return;
    expect(result.truncated).toBe(true);
    expect(result.next.draft.size).toBe(MAX_WORK_AREA_CELLS);
  });
});

describe("what the editor draws", () => {
  it("draws nothing at all while renaming", () => {
    expect(scene("RENAME", ["1,1"], null, null)).toBe(null);
  });

  it("draws an existing area's committed cells as the draft as soon as it opens", () => {
    const state = scene("CELLS", ["1,1", "2,1"], null, null);
    expect(state?.draft).toEqual([
      { x: 1, y: 1 },
      { x: 2, y: 1 }
    ]);
    expect(state?.preview).toEqual([]);
  });

  it("previews the rectangle between the corner and the hovered cell, splitting refused ground", () => {
    const state = scene("CREATE", ["5,5"], { x: -1, y: 0 }, { x: 1, y: 0 });
    expect(state?.preview).toEqual([{ x: 0, y: 0 }, { x: 1, y: 0 }]);
    expect(state?.invalid).toEqual([{ x: -1, y: 0 }]);
    expect(state?.corner).toEqual({ x: -1, y: 0 });
  });

  it("marks a refused cell under the pointer before any corner is taken", () => {
    expect(scene("CREATE", [], null, { x: -2, y: 0 })?.invalid).toEqual([{ x: -2, y: 0 }]);
    expect(scene("CREATE", [], null, { x: 2, y: 0 })?.invalid).toEqual([]);
  });

  it("never stores a rectangle: the editor state is cells only", () => {
    const state = scene("CREATE", ["1,1"], { x: 0, y: 0 }, { x: 2, y: 2 });
    expect(Object.keys(state ?? {}).sort()).toEqual(["corner", "draft", "hover", "invalid", "preview"]);
    expect(JSON.stringify(state)).not.toContain("rect");
  });
});

describe("preview helpers", () => {
  it("maps a kind onto the client's capability vocabulary", () => {
    expect(cellFitsKind("FARM", ["WALK", "FARM"])).toBe(true);
    expect(cellFitsKind("ORCHARD", ["FARM"])).toBe(true);
    expect(cellFitsKind("MINING", ["WALK", "MINING"])).toBe(true);
    expect(cellFitsKind("MINING", ["FARM"])).toBe(false);
  });

  it("bounds a preview so one stray gesture cannot build an enormous request", () => {
    const huge = rectanglePreview({ x: 0, y: 0 }, { x: 500, y: 500 }, () => true);
    expect(huge.valid).toHaveLength(MAX_WORK_AREA_CELLS);
  });
});

describe("the hotfix keeps the editor's input its own", () => {
  const MAIN = fileURLToPath(new URL("../../apps/web/src/main.ts", import.meta.url));

  it("routes an estate click to the draft before anything else can claim it", () => {
    const source = readFileSync(MAIN, "utf8");
    const select = functionBody(source, "function selectCell(");
    const draftAt = select.indexOf("editWorkAreaDraftAt(");
    const assignAt = select.indexOf("state.selected = { x, y };");
    expect(draftAt).toBeGreaterThan(-1);
    expect(assignAt).toBeGreaterThan(-1);
    // The editor's branch returns before the ordinary selection, walking, planting or object handling.
    expect(draftAt).toBeLessThan(assignAt);
    expect(select.slice(draftAt, assignAt)).toContain("return;");
  });

  it("drives hover and the rectangle preview from the renderer's hover, with no request", () => {
    const source = readFileSync(MAIN, "utf8");
    expect(source).toContain("onCellHovered:");
    const hover = functionBody(source, "function onWorkAreaHover(");
    expect(hover).toContain("syncWorkAreaScene()");
    expect(hover).not.toContain("api()");
    expect(hover).not.toContain("fetch");
  });

  it("shows the lattice only while editing, and takes it away when the editor closes", () => {
    const scene = readFileSync(fileURLToPath(new URL("../../apps/web/src/render/scene.ts", import.meta.url)), "utf8");
    const setEdit = functionBody(scene, "setWorkAreaEdit(state: WorkAreaEditState | null): void {");
    expect(setEdit).toContain("workAreaGridGroup.visible = editing");
    expect(setEdit).toContain("disposeWorkAreaGrid()");
    const main = readFileSync(MAIN, "utf8");
    const cancel = functionBody(main, "function cancelWorkAreaEditor(");
    expect(cancel).toContain("scene?.setWorkAreaEdit(null)");
    expect(main).not.toContain("setWorkAreaDraft");
  });
});
