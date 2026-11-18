/**
 * The activity tray: a small column at the side of the screen that shows the work in progress -
 * an area planting or harvest, a cast, a gather, the island's mines filling - so the player can close
 * the panel that started it and still follow it.
 *
 * `activityTrayItems` is pure: it reads what the client already holds (the server's answers and the
 * local clock) and says what to show. It decides nothing about the game; every number comes from the
 * server or from the server's rate applied to elapsed time, as the panels already do.
 * `renderActivityTray` draws the items, updating each card in place so a tick never rebuilds the DOM
 * under the player's pointer.
 */

export type ActivityKind = "AREA_PLANT" | "AREA_HARVEST" | "FISHING" | "GATHER" | "MINES";
export type ActivityTone = "active" | "ready" | "done" | "warn";

export interface ActivityItem {
  readonly id: string;
  readonly kind: ActivityKind;
  readonly icon: string;
  readonly title: string;
  readonly detail: string;
  /** 0..1, or null for no bar. */
  readonly fraction: number | null;
  readonly tone: ActivityTone;
}

export interface AreaActivity {
  readonly operation: "PLANT" | "HARVEST";
  readonly phase: "RUNNING" | "SYNCING" | "DONE";
  readonly fraction: number;
  readonly completedCells: number;
  readonly totalCells: number;
  readonly succeeded: number;
  readonly skipped: number;
}

/** A timed action (a cast or a gather) as the server reported it, and when this client first saw it. */
export interface TimedActivity {
  readonly id: string;
  readonly startedAt: string;
  readonly readyAt: string;
  readonly secondsUntilReady: number;
  readonly seenAtMs: number;
  /** For a gather: the resource's display name. */
  readonly name?: string;
}

export interface MinesActivity {
  readonly ore: number;
  readonly capacity: number;
  readonly milli: number;
  readonly capacityMilli: number;
  readonly secondsUntilFull: number;
}

export interface ActivityTrayInput {
  readonly nowMs: number;
  readonly area: AreaActivity | null;
  readonly fishing: TimedActivity | null;
  readonly gather: TimedActivity | null;
  readonly mines: MinesActivity | null;
}

export type Translate = (key: string, params?: Readonly<Record<string, string | number>>) => string;

/**
 * How far along a timed action is, from the server's own duration and its "seconds until ready" at
 * the moment this client first saw it - so a skewed device clock cannot move the bar.
 */
export function timedFraction(action: TimedActivity, nowMs: number): { readonly fraction: number; readonly secondsLeft: number } {
  const totalMs = Math.max(1, Date.parse(action.readyAt) - Date.parse(action.startedAt));
  const leftMs = Math.max(0, action.seenAtMs + action.secondsUntilReady * 1000 - nowMs);
  return { fraction: Math.min(1, Math.max(0, 1 - leftMs / totalMs)), secondsLeft: Math.ceil(leftMs / 1000) };
}

export function activityTrayItems(input: ActivityTrayInput, t: Translate): readonly ActivityItem[] {
  const items: ActivityItem[] = [];
  const area = input.area;
  if (area !== null) {
    const planting = area.operation === "PLANT";
    const done = area.phase === "DONE";
    items.push({
      id: "area",
      kind: planting ? "AREA_PLANT" : "AREA_HARVEST",
      icon: planting ? "🌱" : "🧺",
      title: done
        ? t(planting ? "activity.areaPlantDone" : "activity.areaHarvestDone")
        : t(planting ? "activity.areaPlant" : "activity.areaHarvest", { percent: Math.floor(area.fraction * 100) }),
      detail: done
        ? area.skipped > 0
          ? t("activity.areaResultSkipped", { done: area.succeeded, skipped: area.skipped })
          : t("activity.areaResult", { done: area.succeeded })
        : area.phase === "SYNCING"
          ? t("activity.areaSyncing")
          : t("activity.areaCells", { completed: area.completedCells, total: area.totalCells }),
      fraction: done ? 1 : area.fraction,
      tone: done ? (area.skipped > 0 ? "warn" : "done") : "active"
    });
  }
  if (input.fishing !== null) {
    const { fraction, secondsLeft } = timedFraction(input.fishing, input.nowMs);
    items.push({
      id: "fishing",
      kind: "FISHING",
      icon: "🎣",
      title: t("activity.fishing"),
      detail: secondsLeft > 0 ? t("activity.secondsLeft", { seconds: secondsLeft }) : t("activity.fishingReady"),
      fraction,
      tone: secondsLeft > 0 ? "active" : "ready"
    });
  }
  if (input.gather !== null) {
    const { fraction, secondsLeft } = timedFraction(input.gather, input.nowMs);
    items.push({
      id: "gather",
      kind: "GATHER",
      icon: "🪓",
      title: t("activity.gather", { name: input.gather.name ?? "" }),
      detail: secondsLeft > 0 ? t("activity.secondsLeft", { seconds: secondsLeft }) : t("activity.gatherReady"),
      fraction,
      tone: secondsLeft > 0 ? "active" : "ready"
    });
  }
  const mines = input.mines;
  if (mines !== null && mines.capacityMilli > 0) {
    const fraction = Math.min(1, mines.milli / mines.capacityMilli);
    const full = mines.secondsUntilFull <= 0;
    items.push({
      id: "mines",
      kind: "MINES",
      icon: "⛏️",
      title: t("activity.mines", { percent: Math.floor(fraction * 100) }),
      detail: full
        ? t("activity.minesFull", { ore: mines.ore })
        : t("activity.minesFilling", { ore: mines.ore, capacity: mines.capacity }),
      fraction,
      tone: full ? "ready" : "active"
    });
  }
  return items;
}

/**
 * Draws the items into the tray, keyed by id: an existing card has its text and bar updated, a new
 * one is added, a gone one removed. `onActivate` receives the item's kind when a card is pressed.
 */
export function renderActivityTray(tray: HTMLElement, items: readonly ActivityItem[], onActivate: (kind: ActivityKind) => void): void {
  tray.hidden = items.length === 0;
  const keep = new Set(items.map((item) => item.id));
  for (const card of [...tray.querySelectorAll<HTMLElement>(".activity-card")]) {
    if (!keep.has(card.dataset.activity ?? "")) card.remove();
  }
  items.forEach((item, index) => {
    let card = tray.querySelector<HTMLButtonElement>(`.activity-card[data-activity="${item.id}"]`);
    if (card === null) {
      card = document.createElement("button");
      card.type = "button";
      card.className = "activity-card";
      card.dataset.activity = item.id;
      const icon = document.createElement("span");
      icon.className = "activity-icon";
      icon.setAttribute("aria-hidden", "true");
      const body = document.createElement("span");
      body.className = "activity-body";
      const title = document.createElement("span");
      title.className = "activity-title";
      const detail = document.createElement("span");
      detail.className = "activity-detail";
      const bar = document.createElement("span");
      bar.className = "activity-bar";
      bar.setAttribute("role", "progressbar");
      bar.setAttribute("aria-valuemin", "0");
      bar.setAttribute("aria-valuemax", "100");
      const fill = document.createElement("span");
      fill.className = "activity-fill";
      bar.appendChild(fill);
      body.appendChild(title);
      body.appendChild(detail);
      body.appendChild(bar);
      card.appendChild(icon);
      card.appendChild(body);
      const kind = item.kind;
      card.addEventListener("click", () => {
        onActivate(kind);
      });
    }
    if (tray.children[index] !== card) tray.insertBefore(card, tray.children[index] ?? null);
    card.dataset.tone = item.tone;
    setText(card, ".activity-icon", item.icon);
    setText(card, ".activity-title", item.title);
    setText(card, ".activity-detail", item.detail);
    const bar = card.querySelector<HTMLElement>(".activity-bar");
    const fill = card.querySelector<HTMLElement>(".activity-fill");
    if (bar !== null) {
      bar.hidden = item.fraction === null;
      bar.setAttribute("aria-valuenow", String(Math.floor((item.fraction ?? 0) * 100)));
    }
    if (fill !== null) fill.style.width = `${String((item.fraction ?? 0) * 100)}%`;
    card.setAttribute("aria-label", `${item.title}. ${item.detail}`);
  });
}

function setText(root: Element, selector: string, text: string): void {
  const node = root.querySelector(selector);
  if (node !== null && node.textContent !== text) node.textContent = text;
}
