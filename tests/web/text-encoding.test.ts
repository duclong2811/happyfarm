import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guards against UTF-8 text that was once saved through a Windows-1252 editor ("Äang hoÃ n táº¥t"
 * instead of "Đang hoàn tất") and against internal identifiers leaking into player-facing labels.
 */
const SOURCES = ["apps/web/src/i18n.ts", "apps/web/src/main.ts", "apps/web/src/mining/panel.ts"];
// Sequences UTF-8 Vietnamese produces when it is mis-decoded as Windows-1252. None of them is valid
// Vietnamese on its own ("BÃI" is, so a bare "Ã" is not on the list).
const MOJIBAKE = /Ã[\u0080-¿ ]|Â·|Ä[\u0080-¿‘’“”]|á[º»]|Æ°|â€/u;

describe("player-facing text encoding", () => {
  for (const file of SOURCES) {
    it(`${file} contains no mis-decoded UTF-8`, () => {
      const lines = readFileSync(resolve(process.cwd(), file), "utf8").split("\n");
      const broken = lines.map((line, index) => ({ line: index + 1, text: line })).filter(({ text }) => MOJIBAKE.test(text));
      expect(broken).toEqual([]);
    });
  }

  it("never shows an internal zone id as a button label", () => {
    const main = readFileSync(resolve(process.cwd(), "apps/web/src/main.ts"), "utf8");
    expect(main).not.toMatch(/make\([^)]*"[^"]*HOME_ISLAND[^"]*"\)/u);
  });
});
