import { describe, expect, it } from "vitest";
import type { PlayerProgressionDTO } from "@happy-farm/contracts";
import { createTranslator } from "../../apps/web/src/i18n";
import { progressionSummary } from "../../apps/web/src/progression";

const en = createTranslator("en");
const vi = createTranslator("vi");

function progression(overrides: Partial<PlayerProgressionDTO> = {}): PlayerProgressionDTO {
  return { level: 1, xp: 0, xpIntoLevel: 0, xpForNextLevel: 120, maxLevel: 50, ...overrides };
}

describe("progressionSummary", () => {
  it("formats a player who has earned nothing", () => {
    expect(progressionSummary(progression(), en)).toEqual({
      title: "Level 1",
      detail: "0 / 120 XP to level 2",
      fraction: 0
    });
  });

  it("phrases the same standing in Vietnamese without touching the numbers", () => {
    // Only the words change: level, experience span, and fraction all still come from the server's
    // own derivation, so the two languages cannot disagree about how far along the player is.
    expect(progressionSummary(progression({ level: 7, xp: 2600, xpIntoLevel: 80, xpForNextLevel: 840 }), vi)).toEqual({
      title: "Cấp 7",
      detail: "80 / 840 XP để lên cấp 8",
      fraction: 80 / 840
    });
  });

  it("turns the server's own span into a fraction", () => {
    expect(progressionSummary(progression({ xp: 4, xpIntoLevel: 4 }), en).fraction).toBeCloseTo(4 / 120, 12);
    expect(progressionSummary(progression({ level: 3, xp: 400, xpIntoLevel: 40 }), en).fraction).toBeCloseTo(
      1 / 3,
      12
    );
  });

  it("names the level a player is on and the one they are working towards", () => {
    const summary = progressionSummary(
      progression({ level: 7, xp: 2600, xpIntoLevel: 80, xpForNextLevel: 840 }),
      en
    );
    expect(summary.title).toBe("Level 7");
    expect(summary.detail).toBe("80 / 840 XP to level 8");
  });

  it("reports the cap instead of a level that does not exist", () => {
    expect(
      progressionSummary(
        progression({ level: 50, xp: 147_000, xpIntoLevel: 0, xpForNextLevel: 0 }),
        en
      )
    ).toEqual({ title: "Level 50", detail: "147000 XP \u00b7 highest level", fraction: 1 });
  });

  it("never reports a fraction outside 0..1, whatever the server sends", () => {
    // A span of zero at the cap is the normal case; the clamp also keeps a malformed or negative
    // span from producing NaN or a bar wider than its track.
    expect(progressionSummary(progression({ xpForNextLevel: 0, xpIntoLevel: 10 }), en).fraction).toBe(1);
    expect(progressionSummary(progression({ xpIntoLevel: 500, xpForNextLevel: 120 }), en).fraction).toBe(1);
    expect(progressionSummary(progression({ xpIntoLevel: -5, xpForNextLevel: 120 }), en).fraction).toBe(0);
    // The cap is also recognised from the level alone, in case a span is ever reported alongside it.
    expect(
      progressionSummary(
        progression({ level: 50, maxLevel: 50, xpIntoLevel: 60, xpForNextLevel: 120 }),
        en
      ).fraction
    ).toBe(1);
  });
});
