import type { FleetResponse } from "@happy-farm/contracts";
import { SHIP_REPAIR_GOLD_PER_HULL, SHIP_REPAIR_WOOD_PER_HULL } from "@happy-farm/game-data";
import type { MessageKey } from "./i18n";
import { createIcon } from "./icons";
import { shipModelForTier } from "./render/ship-models";

/**
 * The ship's own panel (docs/design/NAVAL.md): opened by tapping the ship moored at the island's pier.
 *
 * It says what the fleet read says - the class, the hull, where the ship is - and offers what can be
 * done from there: set sail (the chart picks the place), call the ship home, look round the place it
 * reached, fight pirates that have struck, mend the hull, or build the next class. Every button is a
 * request the server decides again; the panel only chooses which to offer and words them.
 */

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export type ShipActionKind = "FIGHT" | "SAIL" | "VISIT" | "COME_HOME" | "REPAIR" | "BUILD";

export interface ShipActionModel {
  readonly kind: ShipActionKind;
  readonly label: string;
  /** A second line: a price, a warning, a destination. */
  readonly detail: string | null;
  readonly enabled: boolean;
  /** The one action the panel leads with. */
  readonly primary: boolean;
}

export interface ShipPanelModel {
  readonly name: string;
  readonly modelId: string;
  readonly hull: number;
  readonly hullMax: number;
  readonly stats: string;
  /** Where the ship is, in words. */
  readonly where: string;
  readonly actions: readonly ShipActionModel[];
  /** The next class, as one line, or null at the top of the ladder. */
  readonly next: string | null;
}

export interface ShipPanelInput {
  readonly fleet: FleetResponse;
  /** The server's time now, by the offset the fleet read gave. */
  readonly serverNowMs: number;
  /** The player's level, or null when not yet read (the server still checks it). */
  readonly playerLevel: number | null;
  /** Whether pirates have struck this voyage and wait to be fought. */
  readonly ambushDue: boolean;
  readonly placeName: (slotId: string) => string;
  readonly translate: Translate;
}

function materialQuantity(materials: readonly { readonly itemDefinitionId: string; readonly quantity: number }[], itemDefinitionId: string): number {
  return materials.find((entry) => entry.itemDefinitionId === itemDefinitionId)?.quantity ?? 0;
}

/** What the panel shows and offers for the fleet as it stands. Pure: no DOM, no requests. */
export function shipPanelModel(input: ShipPanelInput): ShipPanelModel {
  const { fleet, translate } = input;
  const ship = fleet.ship;
  const name = translate(`ship.class.${ship.classId}` as MessageKey);
  const voyage = fleet.voyage;
  const pending = voyage?.ambush?.status === "PENDING";
  const actions: ShipActionModel[] = [];
  let where: string;

  if (input.ambushDue) {
    actions.push({ kind: "FIGHT", label: translate("shipPanel.fight"), detail: translate("shipPanel.fightDetail"), enabled: true, primary: true });
  }
  if (fleet.location === "HOME" || voyage === null) {
    where = translate("shipPanel.atHome");
    const sunk = ship.hull <= 0;
    actions.push({
      kind: "SAIL",
      label: translate("shipPanel.sail"),
      detail: sunk ? translate("shipPanel.sunk") : translate("shipPanel.sailDetail"),
      enabled: !sunk,
      primary: !input.ambushDue && !sunk
    });
    const missing = ship.hullMax - ship.hull;
    if (missing > 0) {
      actions.push({
        kind: "REPAIR",
        label: translate("shipPanel.repair"),
        detail: translate("shipPanel.repairCost", { gold: Math.ceil(missing * SHIP_REPAIR_GOLD_PER_HULL), wood: Math.ceil(missing * SHIP_REPAIR_WOOD_PER_HULL) }),
        enabled: true,
        primary: sunk
      });
    }
    if (fleet.next !== null) {
      const next = fleet.next;
      const levelShort = input.playerLevel !== null && input.playerLevel < next.requiredPlayerLevel;
      actions.push({
        kind: "BUILD",
        label: translate("shipPanel.build", { name: translate(`ship.class.${next.classId}` as MessageKey) }),
        detail: levelShort
          ? translate("shipPanel.buildLevel", { level: next.requiredPlayerLevel })
          : translate("shipPanel.buildCost", {
              gold: next.cost.gold,
              wood: materialQuantity(next.cost.materials, "item_wood"),
              ore: materialQuantity(next.cost.materials, "item_ore")
            }),
        enabled: !levelShort,
        primary: false
      });
    }
  } else if (fleet.location === "AT_SEA") {
    const minutes = Math.max(1, Math.ceil((Date.parse(voyage.arrivesAt) - input.serverNowMs) / 60_000));
    where = translate("shipPanel.atSea", { place: input.placeName(voyage.toSlotId), minutes });
    actions.push({
      kind: "COME_HOME",
      label: translate("shipPanel.comeHome"),
      detail: input.ambushDue ? translate("shipPanel.comeHomeAmbush") : translate("shipPanel.comeHomeDetail"),
      enabled: true,
      primary: !input.ambushDue
    });
  } else {
    where = translate("shipPanel.atPlace", { place: input.placeName(voyage.toSlotId) });
    actions.push({
      kind: "VISIT",
      label: translate("shipPanel.visit"),
      detail: input.placeName(voyage.toSlotId),
      enabled: !pending,
      primary: !input.ambushDue
    });
    actions.push({ kind: "SAIL", label: translate("shipPanel.sailOn"), detail: translate("shipPanel.sailDetail"), enabled: !pending, primary: false });
    actions.push({
      kind: "COME_HOME",
      label: translate("shipPanel.comeHome"),
      detail: input.ambushDue ? translate("shipPanel.comeHomeAmbush") : translate("shipPanel.comeHomeDetail"),
      enabled: true,
      primary: false
    });
  }

  const next = fleet.next === null
    ? null
    : translate("shipPanel.nextStats", {
        name: translate(`ship.class.${fleet.next.classId}` as MessageKey),
        speed: fleet.next.speedTilesPerMinute,
        hull: fleet.next.hull,
        cannons: fleet.next.cannons
      });
  return {
    name,
    modelId: shipModelForTier(ship.tier),
    hull: ship.hull,
    hullMax: ship.hullMax,
    stats: translate("shipPanel.stats", { speed: ship.speedTilesPerMinute, cannons: ship.cannons }),
    where,
    actions,
    next
  };
}

export interface ShipPanelOptions {
  readonly host: HTMLElement;
  readonly translate: Translate;
  /** The panel's model as things stand now; asked again on every refresh. */
  readonly model: () => ShipPanelModel | null;
  /** Fills the ship's picture. */
  readonly picture: (modelId: string, image: HTMLImageElement) => void;
  /** Runs an action. It resolves once the request is answered; the panel then refreshes itself. */
  readonly act: (kind: ShipActionKind) => Promise<void>;
  readonly describeError: (error: unknown) => string;
  readonly onClose: () => void;
}

export interface ShipPanel {
  /** Redraws from the latest fleet (after a request, or as a voyage's minutes pass). */
  refresh(): void;
  close(): void;
}

export function openShipPanel(options: ShipPanelOptions): ShipPanel {
  const { host, translate } = options;
  let closed = false;
  let busy = false;

  const root = document.createElement("div");
  root.id = "ship-panel";
  root.className = "ship-panel";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "ship-panel-title");
  const card = document.createElement("div");
  card.className = "sp-card";
  const head = document.createElement("header");
  head.className = "sp-head";
  const title = document.createElement("h2");
  title.id = "ship-panel-title";
  title.textContent = translate("shipPanel.title");
  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "panel-close sp-close";
  closeButton.setAttribute("aria-label", translate("shipPanel.close"));
  closeButton.title = translate("shipPanel.close");
  closeButton.appendChild(createIcon("close", 18));
  head.replaceChildren(title, closeButton);

  const body = document.createElement("div");
  body.className = "sp-body";
  const picture = document.createElement("img");
  picture.className = "sp-picture";
  picture.alt = "";
  const facts = document.createElement("div");
  facts.className = "sp-facts";
  const name = document.createElement("h3");
  name.className = "sp-name";
  const hullRow = document.createElement("div");
  hullRow.className = "sp-hull";
  const hullLabel = document.createElement("span");
  hullLabel.textContent = translate("shipPanel.hull");
  const hullTrack = document.createElement("span");
  hullTrack.className = "sp-hull-track";
  const hullFill = document.createElement("span");
  hullFill.className = "sp-hull-fill";
  hullTrack.appendChild(hullFill);
  const hullText = document.createElement("span");
  hullText.className = "sp-hull-text";
  hullRow.replaceChildren(hullLabel, hullTrack, hullText);
  const stats = document.createElement("p");
  stats.className = "sp-stats";
  const where = document.createElement("p");
  where.className = "sp-where";
  facts.replaceChildren(name, hullRow, stats, where);
  body.replaceChildren(picture, facts);

  const actionList = document.createElement("div");
  actionList.className = "sp-actions";
  const next = document.createElement("p");
  next.className = "sp-next";
  const status = document.createElement("p");
  status.className = "sp-status";
  status.setAttribute("aria-live", "polite");
  card.replaceChildren(head, body, actionList, next, status);
  root.appendChild(card);
  host.appendChild(root);

  let pictured: string | null = null;

  function refresh(): void {
    if (closed) return;
    const model = options.model();
    if (model === null) {
      close();
      return;
    }
    name.textContent = model.name;
    if (pictured !== model.modelId) {
      pictured = model.modelId;
      options.picture(model.modelId, picture);
    }
    const share = model.hullMax <= 0 ? 0 : Math.max(0, Math.min(1, model.hull / model.hullMax));
    hullFill.style.width = `${String(Math.round(share * 100))}%`;
    hullFill.classList.toggle("is-low", share < 0.35);
    hullText.textContent = `${String(model.hull)}/${String(model.hullMax)}`;
    stats.textContent = model.stats;
    where.textContent = model.where;
    next.textContent = model.next ?? "";
    next.hidden = model.next === null;
    actionList.replaceChildren(
      ...model.actions.map((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `sp-action${action.primary ? " is-primary" : ""}`;
        button.dataset.action = action.kind;
        button.disabled = busy || !action.enabled;
        const label = document.createElement("span");
        label.className = "sp-action-label";
        label.textContent = action.label;
        button.appendChild(label);
        if (action.detail !== null) {
          const detail = document.createElement("span");
          detail.className = "sp-action-detail";
          detail.textContent = action.detail;
          button.appendChild(detail);
        }
        button.addEventListener("click", () => {
          void run(action.kind);
        });
        return button;
      })
    );
  }

  async function run(kind: ShipActionKind): Promise<void> {
    if (busy || closed) return;
    busy = true;
    status.textContent = translate("shipPanel.working");
    refresh();
    try {
      await options.act(kind);
      status.textContent = "";
    } catch (error: unknown) {
      status.textContent = options.describeError(error);
    } finally {
      busy = false;
      refresh();
    }
  }

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };
  // The minutes to arrival count down while the panel is open; nothing is asked of the server.
  const ticker = window.setInterval(refresh, 15_000);
  closeButton.addEventListener("click", () => {
    close();
  });
  root.addEventListener("click", (event) => {
    if (event.target === root) close();
  });
  window.addEventListener("keydown", onKey);

  function close(): void {
    if (closed) return;
    closed = true;
    window.clearInterval(ticker);
    window.removeEventListener("keydown", onKey);
    root.remove();
    options.onClose();
  }

  refresh();
  closeButton.focus();
  return { refresh, close };
}
