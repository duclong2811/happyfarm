import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { MODERN_UI_CLASS } from "../../apps/web/src/ui/components";

const read = (file: string): string => readFileSync(resolve(process.cwd(), file), "utf8");

describe("Modern B presentation", () => {
  it("is the active system: opted in on <html> and loaded after every older stylesheet", () => {
    expect(read("apps/web/index.html")).toMatch(new RegExp(`<html[^>]*class="${MODERN_UI_CLASS}"`, "u"));
    const main = read("apps/web/src/main.ts");
    const imports = [...main.matchAll(/^import "(\.\/[^"]+\.css)";$/gmu)].map((match) => match[1]);
    expect(imports.at(-1)).toBe("./ui/modern-b.css");
  });

  it("does not attach the legacy art-frame skins on top of it", () => {
    const components = read("apps/web/src/ui/components.ts");
    const modernBranch = /if \(modern\) \{[\s\S]*?return;\n {2}\}/u.exec(components)?.[0] ?? "";
    expect(modernBranch).not.toContain("ui-market-vibrant");
    expect(modernBranch).not.toContain("ui-inventory-shell");
    expect(read("apps/web/src/main.ts")).toContain("if (isModernUi()) return node;");
  });

  it("neutralises art borders and shows the line icons in the rail", () => {
    const css = read("apps/web/src/ui/modern-b.css");
    expect(css).toContain("border-image: none !important;");
    expect(css).toMatch(/\.module-launcher > span\[data-icon\] svg \{ display: block !important;/u);
  });

  it("opens the ferry panel only when the player taps the dock", () => {
    const main = read("apps/web/src/main.ts");
    expect(main).toContain('neighborSelectedTarget = state.neighbor.visit.currentPlace === "NEIGHBOR_ISLAND" ? "NPC" : null;');
    expect(main).not.toMatch(/getNeighbor\(\)\)\.neighbor;\n\s*neighborSelectedTarget = "DOCK";/u);
  });
});
