import type { FleetResponse, GetWorldChartResponse, SeaRegionDTO } from "@happy-farm/contracts";
import type { MessageKey } from "./i18n";
import { createIcon } from "./icons";
import { archipelagoName, chartShips, drawChartShips, drawSeaChart, freePlaces, SEA_REGION_ORDER, slotAt, type ChartFrame } from "./sea-chart-view";

/**
 * The "Chart" window: the world's sea chart over the game.
 *
 * It shows what the server says - the reader's own chart, which places are taken, which is the
 * reader's - and sends nothing but a sea name when an island without a place asks for one, or a place
 * when the reader sails to it. Closing it returns the screen to the farm; nothing in it changes the
 * farm.
 */

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface SeaChartModalOptions {
  readonly host: HTMLElement;
  readonly translate: Translate;
  readonly load: () => Promise<GetWorldChartResponse>;
  /** Asks the server for a place in `region`; offered only when the reader's island has none. */
  readonly claim: ((region: SeaRegionDTO) => Promise<void>) | null;
  /** Looks at the place where the ship lies (W4: look only). */
  readonly visit: ((slotId: string) => void) | null;
  /** The player's ship and voyage (W5a); null when ships are not available. */
  readonly loadFleet: (() => Promise<FleetResponse>) | null;
  /** Sets sail for a tapped place. */
  readonly sail: ((slotId: string) => Promise<void>) | null;
  /** Builds the next class of ship at the dock, answering with the fleet as it now stands. */
  readonly buildShip: (() => Promise<FleetResponse>) | null;
  readonly describeError: (error: unknown) => string;
  readonly onClose?: () => void;
}

export interface SeaChartModal {
  close(): void;
}

/** Where the reader's island lies, in words: "the Fog Isles, Northern Sea". */
export function describeMySlot(chart: GetWorldChartResponse, translate: Translate): string | null {
  if (chart.mySlotId === null) return null;
  for (const entry of chart.regions) {
    for (const archipelago of entry.archipelagos) {
      if (archipelago.slots.some((slot) => slot.slotId === chart.mySlotId)) {
        return translate("chart.you", {
          archipelago: translate("chart.archipelago", { name: archipelagoName(entry.region, archipelago.index) }),
          region: translate(`chart.region.${entry.region}` as MessageKey)
        });
      }
    }
  }
  return null;
}

/** What a tap on one place says. */
export function describeSlot(chart: GetWorldChartResponse, slotId: string, translate: Translate): string | null {
  for (const entry of chart.regions) {
    for (const archipelago of entry.archipelagos) {
      const slot = archipelago.slots.find((candidate) => candidate.slotId === slotId);
      if (slot === undefined) continue;
      const name = translate("chart.archipelago", { name: archipelagoName(entry.region, archipelago.index) });
      if (slot.mine) return translate("chart.slot.mine", { archipelago: name });
      if (slot.claimed) {
        return slot.name === null ? translate("chart.slot.settled", { archipelago: name }) : translate("chart.slot.named", { name: slot.name, archipelago: name });
      }
      return translate("chart.slot.wild", { archipelago: name });
    }
  }
  return null;
}

/** What a tapped place offers, given where the ship is. Display only: the server decides it all again. */
export type PlaceAction =
  | { readonly kind: "NONE" }
  | { readonly kind: "VISIT" }
  | { readonly kind: "AT_SEA" }
  | { readonly kind: "SAIL"; readonly minutes: number };

function slotPosition(chart: GetWorldChartResponse, slotId: string | null): { readonly x: number; readonly z: number } | null {
  if (slotId === null) return null;
  for (const entry of chart.regions) {
    for (const archipelago of entry.archipelagos) {
      const slot = archipelago.slots.find((candidate) => candidate.slotId === slotId);
      if (slot !== undefined) return { x: slot.x, z: slot.z };
    }
  }
  return null;
}

export function placeAction(chart: GetWorldChartResponse, fleet: FleetResponse | null, slotId: string): PlaceAction {
  if (fleet === null || slotId === chart.mySlotId) return { kind: "NONE" };
  if (fleet.location === "AT_SEA") return { kind: "AT_SEA" };
  if (fleet.location === "AT_PLACE" && fleet.voyage?.toSlotId === slotId) return { kind: "VISIT" };
  const from = slotPosition(chart, fleet.location === "AT_PLACE" ? (fleet.voyage?.toSlotId ?? null) : chart.mySlotId);
  const to = slotPosition(chart, slotId);
  if (from === null || to === null) return { kind: "NONE" };
  // The same rule as the server's (at least a minute), shown rounded up; the server's time is the one kept.
  const minutes = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.z - from.z) / fleet.ship.speedTilesPerMinute));
  return { kind: "SAIL", minutes };
}

/** The ship in one line, and the next class's price. */
export function describeFleet(fleet: FleetResponse, translate: Translate): { readonly ship: string; readonly next: string | null } {
  const name = (classId: string): string => translate(`ship.class.${classId}` as MessageKey);
  const ship = translate("chart.ship", {
    name: name(fleet.ship.classId),
    speed: fleet.ship.speedTilesPerMinute,
    hull: fleet.ship.hull,
    hullMax: fleet.ship.hullMax
  });
  const next = fleet.next;
  if (next === null) return { ship, next: null };
  const quantity = (itemDefinitionId: string): number => next.cost.materials.find((entry) => entry.itemDefinitionId === itemDefinitionId)?.quantity ?? 0;
  return {
    ship,
    next: translate("chart.shipBuild", {
      name: name(next.classId),
      gold: next.cost.gold,
      wood: quantity("item_wood"),
      ore: quantity("item_ore"),
      level: next.requiredPlayerLevel
    })
  };
}

export function openSeaChart(options: SeaChartModalOptions): SeaChartModal {
  const { host, translate } = options;
  let chart: GetWorldChartResponse | null = null;
  let fleet: FleetResponse | null = null;
  /** The chart without its ships, drawn once per size; the ships are laid over it every second. */
  let base: HTMLCanvasElement | null = null;
  /** Server time minus this device's, from the read: ships sail by the server's clock. */
  let clockOffsetMs = 0;
  let shipTimer: number | null = null;
  let frame: ChartFrame | null = null;
  let closed = false;

  const root = document.createElement("div");
  root.id = "sea-chart";
  root.className = "sea-chart";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "sea-chart-title");

  const card = document.createElement("div");
  card.className = "sc-card";
  const head = document.createElement("header");
  head.className = "sc-head";
  const title = document.createElement("h2");
  title.id = "sea-chart-title";
  title.textContent = translate("chart.title");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "panel-close sc-close";
  closeButton.setAttribute("aria-label", translate("chart.close"));
  closeButton.title = translate("chart.close");
  closeButton.appendChild(createIcon("close", 18));
  head.replaceChildren(title, closeButton);

  const stage = document.createElement("div");
  stage.className = "sc-stage";
  const canvas = document.createElement("canvas");
  canvas.className = "sc-canvas";
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", translate("chart.title"));
  const status = document.createElement("div");
  status.className = "sc-status";
  stage.replaceChildren(canvas, status);

  const foot = document.createElement("footer");
  foot.className = "sc-foot";
  const where = document.createElement("p");
  where.className = "sc-where";
  const pickRow = document.createElement("div");
  pickRow.className = "sc-pick-row";
  const picked = document.createElement("p");
  picked.className = "sc-pick";
  picked.setAttribute("aria-live", "polite");
  picked.textContent = translate("chart.hint");
  const visitButton = document.createElement("button");
  visitButton.type = "button";
  visitButton.className = "sc-visit";
  visitButton.textContent = translate("chart.visit");
  visitButton.hidden = true;
  let pickedSlotId: string | null = null;
  let pickedAction: PlaceAction = { kind: "NONE" };
  visitButton.addEventListener("click", () => {
    if (pickedSlotId === null) return;
    const slotId = pickedSlotId;
    if (pickedAction.kind === "VISIT" && options.visit !== null) {
      const visit = options.visit;
      close();
      visit(slotId);
      return;
    }
    if (pickedAction.kind === "SAIL" && options.sail !== null) {
      const sail = options.sail;
      visitButton.disabled = true;
      sail(slotId).then(
        () => {
          close();
        },
        (error: unknown) => {
          visitButton.disabled = false;
          picked.textContent = options.describeError(error);
        }
      );
    }
  });
  pickRow.replaceChildren(picked, visitButton);
  const claimRow = document.createElement("div");
  claimRow.className = "sc-claim";
  claimRow.hidden = true;
  const shipRow = document.createElement("div");
  shipRow.className = "sc-ship";
  shipRow.hidden = true;
  const shipText = document.createElement("p");
  shipText.className = "sc-ship-text";
  const buildButton = document.createElement("button");
  buildButton.type = "button";
  buildButton.className = "sc-ship-build";
  buildButton.addEventListener("click", () => {
    const build = options.buildShip;
    if (build === null) return;
    buildButton.disabled = true;
    build().then(
      (next) => {
        fleet = next;
        renderShip();
        picked.textContent = translate("chart.shipBuilt", { name: translate(`ship.class.${next.ship.classId}` as MessageKey) });
      },
      (error: unknown) => {
        buildButton.disabled = false;
        picked.textContent = options.describeError(error);
      }
    );
  });
  shipRow.replaceChildren(shipText, buildButton);
  const legend = document.createElement("ul");
  legend.className = "sc-legend";
  for (const [kind, key] of [["mine", "chart.legend.mine"], ["settled", "chart.legend.settled"], ["wild", "chart.legend.wild"]] as const) {
    const item = document.createElement("li");
    const swatch = document.createElement("span");
    swatch.className = `sc-swatch sc-swatch-${kind}`;
    swatch.setAttribute("aria-hidden", "true");
    item.replaceChildren(swatch, document.createTextNode(translate(key)));
    legend.appendChild(item);
  }
  foot.replaceChildren(where, claimRow, shipRow, pickRow, legend);
  card.replaceChildren(head, stage, foot);
  root.replaceChildren(card);

  function draw(): void {
    if (chart === null || closed) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(stage.clientWidth * ratio));
    const height = Math.max(1, Math.round(stage.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    base ??= document.createElement("canvas");
    base.width = width;
    base.height = height;
    frame = drawSeaChart(base, chart, { translate: (key, params) => translate(key as MessageKey, params === undefined ? undefined : { ...params }) });
    drawShips();
  }

  /** Lays the ships at sea, where they are now, over the drawn chart. Cheap: one copy and a few ships. */
  function drawShips(): void {
    if (chart === null || frame === null || base === null || closed) return;
    const context = canvas.getContext("2d");
    if (context === null) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(base, 0, 0);
    drawChartShips(canvas, frame, chartShips(chart, Date.now() + clockOffsetMs));
  }

  function renderShip(): void {
    shipRow.hidden = fleet === null;
    if (fleet === null) return;
    const text = describeFleet(fleet, translate);
    shipText.textContent = text.ship;
    buildButton.hidden = text.next === null || options.buildShip === null;
    buildButton.textContent = text.next ?? "";
    buildButton.disabled = fleet.location !== "HOME";
    buildButton.title = fleet.location === "HOME" ? "" : translate("chart.shipAway");
  }

  function renderFoot(): void {
    renderShip();
    if (chart === null) return;
    const mine = describeMySlot(chart, translate);
    where.textContent = mine ?? (options.claim === null ? "" : translate("chart.noPlace"));
    where.hidden = where.textContent === "";
    claimRow.hidden = mine !== null || options.claim === null;
    if (claimRow.hidden) {
      claimRow.replaceChildren();
      return;
    }
    const places = freePlaces(chart);
    claimRow.replaceChildren(
      ...SEA_REGION_ORDER.map((region) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "sc-claim-region";
        button.dataset.region = region;
        button.textContent = translate(`chart.region.${region}` as MessageKey);
        button.disabled = places[region] === 0;
        button.addEventListener("click", () => {
          const claim = options.claim;
          if (claim === null) return;
          for (const control of claimRow.querySelectorAll("button")) control.disabled = true;
          claim(region).then(
            () => {
              void load();
            },
            (error: unknown) => {
              picked.textContent = options.describeError(error);
              renderFoot();
            }
          );
        });
        return button;
      })
    );
  }

  async function load(): Promise<void> {
    status.hidden = false;
    status.replaceChildren(document.createTextNode(translate("chart.loading")));
    try {
      const [loadedChart, loadedFleet] = await Promise.all([options.load(), options.loadFleet === null ? Promise.resolve(null) : options.loadFleet().catch(() => null)]);
      chart = loadedChart;
      fleet = loadedFleet;
      clockOffsetMs = loadedChart.readAt === undefined ? 0 : Date.parse(loadedChart.readAt) - Date.now();
    } catch (error: unknown) {
      if (closed) return;
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = translate("chart.retry");
      retry.addEventListener("click", () => {
        void load();
      });
      const text = document.createElement("p");
      text.textContent = `${translate("chart.failed")} ${options.describeError(error)}`;
      status.replaceChildren(text, retry);
      return;
    }
    if (closed) return;
    status.hidden = true;
    draw();
    renderFoot();
    // Ships move by themselves, from the times the read gave: no further request while the chart is open.
    if (shipTimer === null && (chart.voyages?.length ?? 0) > 0) shipTimer = window.setInterval(drawShips, 1000);
  }

  canvas.addEventListener("click", (event) => {
    if (chart === null || frame === null) return;
    const box = canvas.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) return;
    const px = ((event.clientX - box.left) / box.width) * canvas.width;
    const py = ((event.clientY - box.top) / box.height) * canvas.height;
    const hit = slotAt(chart, frame, px, py, Math.max(18 * (canvas.width / box.width), 90 * frame.scale));
    picked.textContent = hit === null ? translate("chart.hint") : (describeSlot(chart, hit.slotId, translate) ?? translate("chart.hint"));
    pickedSlotId = hit?.slotId ?? null;
    pickedAction = hit === null ? { kind: "NONE" } : placeAction(chart, fleet, hit.slotId);
    visitButton.hidden = pickedAction.kind === "NONE";
    visitButton.disabled = pickedAction.kind === "AT_SEA";
    visitButton.textContent =
      pickedAction.kind === "VISIT"
        ? translate("chart.visit")
        : pickedAction.kind === "SAIL"
          ? translate("chart.sail", { minutes: pickedAction.minutes })
          : translate("chart.atSea");
  });

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  const onResize = (): void => {
    draw();
  };
  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });
  closeButton.addEventListener("click", () => {
    close();
  });

  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("resize", onResize);
    if (shipTimer !== null) window.clearInterval(shipTimer);
    shipTimer = null;
    root.remove();
    options.onClose?.();
  }

  host.appendChild(root);
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", onResize);
  closeButton.focus();
  void load();
  return { close };
}
