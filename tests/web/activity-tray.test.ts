import { describe, expect, it } from "vitest";
import { activityTrayItems, timedFraction, type ActivityTrayInput, type TimedActivity } from "../../apps/web/src/activity-tray";

/**
 * The activity tray's model: what the side tray shows for an area task, a cast, a gather and the
 * mines. It only reads what the client holds; these pin the wording inputs, the bars and the tones.
 */

const t = (key: string, params?: Readonly<Record<string, string | number>>): string =>
  params === undefined ? key : `${key}${JSON.stringify(params)}`;

const NOW = Date.parse("2026-11-18T12:00:00.000Z");
const empty: ActivityTrayInput = { nowMs: NOW, area: null, fishing: null, gather: null, mines: null };

function cast(secondsUntilReady: number, seenAtMs = NOW): TimedActivity {
  // A 15-second cast, as the server reports it; the device clock is deliberately an hour off.
  return { id: "fishact_1", startedAt: "2026-11-18T13:00:00.000Z", readyAt: "2026-11-18T13:00:15.000Z", secondsUntilReady, seenAtMs };
}

describe("the activity tray", () => {
  it("shows nothing when nothing is under way", () => {
    expect(activityTrayItems(empty, t)).toEqual([]);
  });

  it("follows a running area planting with its percentage and confirmed cells", () => {
    const [item] = activityTrayItems({ ...empty, area: { operation: "PLANT", phase: "RUNNING", fraction: 0.425, completedCells: 30, totalCells: 80, succeeded: 30, skipped: 0 } }, t);
    expect(item).toMatchObject({ id: "area", kind: "AREA_PLANT", tone: "active", fraction: 0.425 });
    expect(item?.title).toBe('activity.areaPlant{"percent":42}');
    expect(item?.detail).toBe('activity.areaCells{"completed":30,"total":80}');
  });

  it("reports a finished area task in green, or as a warning when cells were skipped", () => {
    const done = activityTrayItems({ ...empty, area: { operation: "HARVEST", phase: "DONE", fraction: 1, completedCells: 40, totalCells: 40, succeeded: 40, skipped: 0 } }, t)[0];
    expect(done).toMatchObject({ kind: "AREA_HARVEST", tone: "done", fraction: 1, title: "activity.areaHarvestDone" });
    const skipped = activityTrayItems({ ...empty, area: { operation: "PLANT", phase: "DONE", fraction: 1, completedCells: 40, totalCells: 40, succeeded: 35, skipped: 5 } }, t)[0];
    expect(skipped).toMatchObject({ tone: "warn", detail: 'activity.areaResultSkipped{"done":35,"skipped":5}' });
  });

  it("times a cast from the server's duration and when it was seen, whatever the device clock says", () => {
    expect(timedFraction(cast(15), NOW)).toEqual({ fraction: 0, secondsLeft: 15 });
    expect(timedFraction(cast(15), NOW + 6000)).toEqual({ fraction: 0.4, secondsLeft: 9 });
    // Seen half-way through (a refresh mid-cast): the bar starts at half.
    expect(timedFraction(cast(7.5), NOW).fraction).toBeCloseTo(0.5, 5);
    expect(timedFraction(cast(15), NOW + 60_000)).toEqual({ fraction: 1, secondsLeft: 0 });
    const ready = activityTrayItems({ ...empty, fishing: cast(15), nowMs: NOW + 20_000 }, t)[0];
    expect(ready).toMatchObject({ kind: "FISHING", tone: "ready", detail: "activity.fishingReady", fraction: 1 });
  });

  it("names the resource being gathered", () => {
    const [item] = activityTrayItems({ ...empty, gather: { ...cast(10), id: "resact_1", name: "Gỗ" } }, t);
    expect(item).toMatchObject({ kind: "GATHER", title: 'activity.gather{"name":"Gỗ"}', tone: "active" });
  });

  it("fills the mines toward their capacity and calls them ready when one is full", () => {
    const filling = activityTrayItems({ ...empty, mines: { ore: 12, capacity: 40, milli: 12_500, capacityMilli: 40_000, secondsUntilFull: 3600 } }, t)[0];
    expect(filling).toMatchObject({ kind: "MINES", tone: "active", title: 'activity.mines{"percent":31}', detail: 'activity.minesFilling{"ore":12,"capacity":40}' });
    const full = activityTrayItems({ ...empty, mines: { ore: 40, capacity: 40, milli: 40_000, capacityMilli: 40_000, secondsUntilFull: 0 } }, t)[0];
    expect(full).toMatchObject({ tone: "ready", fraction: 1, detail: 'activity.minesFull{"ore":40}' });
  });

  it("lists the work in a stable order: area, cast, gather, mines", () => {
    const items = activityTrayItems({
      nowMs: NOW,
      area: { operation: "PLANT", phase: "RUNNING", fraction: 0.1, completedCells: 0, totalCells: 10, succeeded: 0, skipped: 0 },
      fishing: cast(10),
      gather: { ...cast(10), id: "resact_1" },
      mines: { ore: 1, capacity: 40, milli: 1000, capacityMilli: 40_000, secondsUntilFull: 100 }
    }, t);
    expect(items.map((item) => item.id)).toEqual(["area", "fishing", "gather", "mines"]);
  });
});
