import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MAIN = readFileSync(`${ROOT}/apps/web/src/main.ts`, "utf8");
const STYLES = readFileSync(`${ROOT}/apps/web/src/styles.css`, "utf8");
const FONT_PACKAGES = [
  {
    directory: `${ROOT}/node_modules/@fontsource-variable/baloo-2`,
    family: "Baloo 2 Variable",
    importPath: "@fontsource-variable/baloo-2/index.css"
  },
  {
    directory: `${ROOT}/node_modules/@fontsource-variable/nunito`,
    family: "Nunito Variable",
    importPath: "@fontsource-variable/nunito/index.css"
  }
] as const;

describe("self-hosted UI fonts", () => {
  it("imports the normal variable faces from the application entry point", () => {
    for (const font of FONT_PACKAGES) {
      expect(MAIN).toContain(`import "${font.importPath}";`);
    }
    expect(MAIN).not.toContain("wght-italic.css");
  });

  it("uses the Fontsource family names with locale-safe fallbacks", () => {
    expect(STYLES).toContain('--ui-font-display: "Baloo 2 Variable"');
    expect(STYLES).toContain('--ui-font-body: "Nunito Variable"');
    expect(STYLES).toContain('"Noto Sans KR"');
    expect(STYLES).toContain('"Noto Sans SC"');
  });

  it("keeps Vietnamese font faces and their local WOFF2 files available", () => {
    for (const font of FONT_PACKAGES) {
      const css = readFileSync(`${font.directory}/index.css`, "utf8");
      expect(css).toContain(`font-family: '${font.family}'`);
      expect(css).toContain("font-display: swap");
      expect(css).toContain("vietnamese-wght-normal.woff2");
      const sources = [...css.matchAll(/url\(\.\/files\/([^)]+)\)/g)]
        .map((match) => match[1])
        .filter((source): source is string => source !== undefined);
      expect(sources.length).toBeGreaterThan(0);
      for (const source of sources) {
        expect(statSync(`${font.directory}/files/${source}`).size, source).toBeGreaterThan(0);
      }
    }
  });
});
