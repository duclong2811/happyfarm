import type { GetWorldChartResponse, SeaRegionDTO } from "@happy-farm/contracts";
import type { MessageKey } from "./i18n";
import { createIcon } from "./icons";
import { archipelagoName, drawSeaChart, freePlaces, SEA_REGION_ORDER, slotAt, type ChartFrame } from "./sea-chart-view";

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
  /** Sails to a tapped place (W4: look only); offered for any place but home. */
  readonly visit: ((slotId: string) => void) | null;
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

export function openSeaChart(options: SeaChartModalOptions): SeaChartModal {
  const { host, translate } = options;
  let chart: GetWorldChartResponse | null = null;
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
  visitButton.addEventListener("click", () => {
    const visit = options.visit;
    if (visit === null || pickedSlotId === null) return;
    const slotId = pickedSlotId;
    close();
    visit(slotId);
  });
  pickRow.replaceChildren(picked, visitButton);
  const claimRow = document.createElement("div");
  claimRow.className = "sc-claim";
  claimRow.hidden = true;
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
  foot.replaceChildren(where, claimRow, pickRow, legend);
  card.replaceChildren(head, stage, foot);
  root.replaceChildren(card);

  function draw(): void {
    if (chart === null || closed) return;
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.round(stage.clientWidth * ratio));
    const height = Math.max(1, Math.round(stage.clientHeight * ratio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    frame = drawSeaChart(canvas, chart, { translate: (key, params) => translate(key as MessageKey, params === undefined ? undefined : { ...params }) });
  }

  function renderFoot(): void {
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
      chart = await options.load();
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
    visitButton.hidden = options.visit === null || hit === null || hit.slotId === chart.mySlotId;
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
