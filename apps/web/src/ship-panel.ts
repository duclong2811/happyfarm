import type { FleetResponse, ShipRole } from "@happy-farm/contracts";
import { SHIP_REPAIR_GOLD_PER_HULL, SHIP_REPAIR_WOOD_PER_HULL } from "@happy-farm/game-data";
import type { MessageKey } from "./i18n";
import { createIcon } from "./icons";
import { shipModelId, shipModelForTier } from "./render/ship-models";

/**
 * The fleet's panel (docs/design/NAVAL.md, FLEET.md): opened by tapping the ship moored at the pier.
 *
 * A row of berths along the top - one per ship, and an empty one while the dock has room - picks the
 * ship the panel is about. It says what the fleet read says of that ship - its class and role, its
 * hull, where it is - and offers what can be done from there: set sail (the chart picks the place),
 * call it home, look round the place it reached, fight pirates that have struck, mend the hull, or
 * upgrade it up its own ladder. The empty berth offers a new ship of each role; the dock line offers
 * more berths. Every button is a request the server decides again; the panel only chooses which to
 * offer and words them. The one button that is not a request is the helm: sailing round home waters is
 * the player's own screen.
 */

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export type ShipActionKind = "FIGHT" | "SAIL" | "HELM" | "VISIT" | "COME_HOME" | "REPAIR" | "UPGRADE" | "BUILD" | "DOCK";

export interface ShipActionModel {
  readonly kind: ShipActionKind;
  readonly label: string;
  /** A second line: a price, a warning, a destination. */
  readonly detail: string | null;
  readonly enabled: boolean;
  /** The one action the panel leads with. */
  readonly primary: boolean;
  /** The ship it is for (sail, helm, repair, upgrade). */
  readonly shipId?: string;
  /** The role a new ship would have (build). */
  readonly role?: ShipRole;
}

/** What the panel is about: one of the player's ships, or the empty berth a new ship would take. */
export type FleetSelection = { readonly kind: "SHIP"; readonly shipId: string } | { readonly kind: "BERTH" };

export interface BerthChipModel {
  readonly selection: FleetSelection;
  readonly label: string;
  readonly detail: string;
  readonly selected: boolean;
  readonly away: boolean;
  readonly empty: boolean;
}

export interface ShipPanelModel {
  readonly berths: readonly BerthChipModel[];
  /** The dock, in words: its tier and how many berths are taken. */
  readonly dock: string;
  readonly name: string;
  /** The picture; null for the empty berth. */
  readonly modelId: string | null;
  /** The hull; null for the empty berth. */
  readonly hull: number | null;
  readonly hullMax: number;
  readonly stats: string;
  /** Where the ship is, in words. */
  readonly where: string;
  readonly actions: readonly ShipActionModel[];
  /** The next class, as one line, or null at the top of the ladder (and for the empty berth). */
  readonly next: string | null;
}

export interface ShipPanelInput {
  readonly fleet: FleetResponse;
  /** What the panel is about; null (or a ship no longer in the fleet) for the ship in hand. */
  readonly selected?: FleetSelection | null;
  /** The server's time now, by the offset the fleet read gave. */
  readonly serverNowMs: number;
  /** The player's level, or null when not yet read (the server still checks it). */
  readonly playerLevel: number | null;
  /** Whether pirates have struck this voyage and wait to be fought. */
  readonly ambushDue: boolean;
  /** Whether the ship can be taken by hand round home waters: drawn at the pier, in the 3D view. */
  readonly canHelm: boolean;
  readonly placeName: (slotId: string) => string;
  readonly translate: Translate;
}

type FleetShip = FleetResponse["ship"];
type Price = NonNullable<FleetResponse["next"]>["cost"];

function materialQuantity(materials: Price["materials"], itemDefinitionId: string): number {
  return materials.find((entry) => entry.itemDefinitionId === itemDefinitionId)?.quantity ?? 0;
}

function priceText(translate: Translate, cost: Price): string {
  const ore = materialQuantity(cost.materials, "item_ore");
  const wood = materialQuantity(cost.materials, "item_wood");
  return ore > 0 ? translate("shipPanel.buildCost", { gold: cost.gold, wood, ore }) : translate("shipPanel.costNoOre", { gold: cost.gold, wood });
}

/** Whether the fleet has room for a new ship: a free berth, or the lent rowboat to give way. */
function canBuild(fleet: FleetResponse): boolean {
  return fleet.dock.freeBerths > 0;
}

/** The selection as it stands: a ship still in the fleet, the empty berth while there is one, else the ship in hand. */
export function resolveSelection(fleet: FleetResponse, selected: FleetSelection | null | undefined): FleetSelection {
  if (selected?.kind === "SHIP" && fleet.ships.some((ship) => ship.shipId === selected.shipId)) return selected;
  if (selected?.kind === "BERTH" && canBuild(fleet)) return selected;
  return { kind: "SHIP", shipId: fleet.ship.shipId };
}

function className(translate: Translate, classId: string): string {
  return translate(`ship.class.${classId}` as MessageKey);
}

function roleName(translate: Translate, role: ShipRole): string {
  return translate(`ship.role.${role}` as MessageKey);
}

/** What the panel shows and offers for the fleet as it stands. Pure: no DOM, no requests. */
export function shipPanelModel(input: ShipPanelInput): ShipPanelModel {
  const { fleet, translate } = input;
  const selection = resolveSelection(fleet, input.selected);
  const stored = fleet.ships.filter((ship) => !ship.lent).length;
  const berths: BerthChipModel[] = fleet.ships.map((ship) => ({
    selection: { kind: "SHIP", shipId: ship.shipId },
    label: className(translate, ship.classId),
    detail: ship.lent ? translate("shipPanel.lent") : ship.away ? translate("shipPanel.away") : `${roleName(translate, ship.role)} · ${String(ship.hull)}/${String(ship.hullMax)}`,
    selected: selection.kind === "SHIP" && selection.shipId === ship.shipId,
    away: ship.away,
    empty: false
  }));
  if (canBuild(fleet)) {
    berths.push({
      selection: { kind: "BERTH" },
      label: translate("shipPanel.berthEmpty"),
      detail: translate("shipPanel.berthEmptyDetail"),
      selected: selection.kind === "BERTH",
      away: false,
      empty: true
    });
  }
  const dock = translate("shipPanel.dock", { tier: fleet.dock.tier, used: stored, berths: fleet.dock.berths });
  const dockAction = dockActionOf(input);

  if (selection.kind === "BERTH") {
    const replacing = fleet.ships.length === 1 && fleet.ships[0]?.lent === true;
    const actions: ShipActionModel[] = fleet.builds.map((build) => {
      const levelShort = input.playerLevel !== null && input.playerLevel < build.requiredPlayerLevel;
      return {
        kind: "BUILD",
        label: translate("shipPanel.buildNew", { name: className(translate, build.classId), role: roleName(translate, build.role) }),
        detail: levelShort ? translate("shipPanel.buildLevel", { level: build.requiredPlayerLevel }) : priceText(translate, build.cost),
        enabled: !levelShort,
        primary: false,
        role: build.role
      };
    });
    if (dockAction !== null) actions.push(dockAction);
    return {
      berths,
      dock,
      name: translate("shipPanel.berthEmpty"),
      modelId: null,
      hull: null,
      hullMax: 0,
      stats: replacing ? translate("shipPanel.replaceLent") : translate("shipPanel.berthEmptyStats"),
      where: dock,
      actions,
      next: null
    };
  }

  const ship = fleet.ships.find((entry) => entry.shipId === selection.shipId) ?? fleet.ship;
  const actions = shipActions(input, ship);
  // The dock is offered from the pier: a ship out at sea has its own business in the panel.
  if (dockAction !== null && !ship.away) actions.push(dockAction);
  const upgrade = ship.upgrade;
  return {
    berths,
    dock,
    name: className(translate, ship.classId),
    modelId: shipModelId(ship.classId) ?? shipModelForTier(ship.tier),
    hull: ship.hull,
    hullMax: ship.hullMax,
    stats: translate("shipPanel.stats", { role: roleName(translate, ship.role), speed: ship.speedTilesPerMinute, cannons: ship.cannons, hold: ship.hold }),
    where: whereOf(input, ship),
    actions,
    next:
      upgrade === null
        ? null
        : translate("shipPanel.nextStats", { name: className(translate, upgrade.classId), speed: upgrade.speedTilesPerMinute, hull: upgrade.hull, cannons: upgrade.cannons, hold: upgrade.hold })
  };
}

function whereOf(input: ShipPanelInput, ship: FleetShip): string {
  const { fleet, translate } = input;
  const voyage = fleet.voyage;
  if (!ship.away || voyage === null) return translate("shipPanel.atHome");
  if (fleet.location === "AT_SEA") {
    const minutes = Math.max(1, Math.ceil((Date.parse(voyage.arrivesAt) - input.serverNowMs) / 60_000));
    return translate("shipPanel.atSea", { place: input.placeName(voyage.toSlotId), minutes });
  }
  return translate("shipPanel.atPlace", { place: input.placeName(voyage.toSlotId) });
}

function shipActions(input: ShipPanelInput, ship: FleetShip): ShipActionModel[] {
  const { fleet, translate } = input;
  const voyage = fleet.voyage;
  const pending = voyage?.ambush?.status === "PENDING";
  const actions: ShipActionModel[] = [];
  const shipId = ship.shipId;

  if (ship.away && voyage !== null) {
    if (input.ambushDue) {
      actions.push({ kind: "FIGHT", label: translate("shipPanel.fight"), detail: translate("shipPanel.fightDetail"), enabled: true, primary: true, shipId });
    }
    if (fleet.location === "AT_SEA") {
      actions.push({
        kind: "COME_HOME",
        label: translate("shipPanel.comeHome"),
        detail: input.ambushDue ? translate("shipPanel.comeHomeAmbush") : translate("shipPanel.comeHomeDetail"),
        enabled: true,
        primary: !input.ambushDue,
        shipId
      });
      return actions;
    }
    actions.push({ kind: "VISIT", label: translate("shipPanel.visit"), detail: input.placeName(voyage.toSlotId), enabled: !pending, primary: !input.ambushDue, shipId });
    actions.push({ kind: "SAIL", label: translate("shipPanel.sailOn"), detail: translate("shipPanel.sailDetail"), enabled: !pending, primary: false, shipId });
    actions.push({
      kind: "COME_HOME",
      label: translate("shipPanel.comeHome"),
      detail: input.ambushDue ? translate("shipPanel.comeHomeAmbush") : translate("shipPanel.comeHomeDetail"),
      enabled: true,
      primary: false,
      shipId
    });
    return actions;
  }

  // At the dock. While another ship is out, this one waits for it to come home before it sails.
  const otherAway = fleet.location !== "HOME";
  const sunk = ship.hull <= 0;
  actions.push({
    kind: "SAIL",
    label: translate("shipPanel.sail"),
    detail: otherAway ? translate("shipPanel.otherAway") : sunk ? translate("shipPanel.sunk") : translate("shipPanel.sailDetail"),
    enabled: !otherAway && !sunk,
    primary: !otherAway && !sunk,
    shipId
  });
  if (input.canHelm && !sunk && !otherAway) {
    actions.push({ kind: "HELM", label: translate("shipPanel.helm"), detail: translate("shipPanel.helmDetail"), enabled: true, primary: false, shipId });
  }
  const missing = ship.hullMax - ship.hull;
  if (missing > 0 && !ship.lent) {
    actions.push({
      kind: "REPAIR",
      label: translate("shipPanel.repair"),
      detail: translate("shipPanel.repairCost", { gold: Math.ceil(missing * SHIP_REPAIR_GOLD_PER_HULL), wood: Math.ceil(missing * SHIP_REPAIR_WOOD_PER_HULL) }),
      enabled: true,
      primary: sunk,
      shipId
    });
  }
  if (ship.upgrade !== null) {
    const next = ship.upgrade;
    const levelShort = input.playerLevel !== null && input.playerLevel < next.requiredPlayerLevel;
    actions.push({
      kind: "UPGRADE",
      label: translate("shipPanel.upgrade", { name: className(translate, next.classId) }),
      detail: levelShort ? translate("shipPanel.buildLevel", { level: next.requiredPlayerLevel }) : priceText(translate, next.cost),
      enabled: !levelShort,
      primary: false,
      shipId
    });
  }
  return actions;
}

function dockActionOf(input: ShipPanelInput): ShipActionModel | null {
  const { fleet, translate } = input;
  const next = fleet.dock.next;
  if (next === null) return null;
  const levelShort = input.playerLevel !== null && input.playerLevel < next.requiredPlayerLevel;
  return {
    kind: "DOCK",
    label: translate("shipPanel.dockUpgrade", { berths: next.berths }),
    detail: levelShort ? translate("shipPanel.buildLevel", { level: next.requiredPlayerLevel }) : priceText(translate, next.cost),
    enabled: !levelShort,
    primary: false
  };
}

export interface ShipPanelOptions {
  readonly host: HTMLElement;
  readonly translate: Translate;
  /** The ship the panel opens on; null for the ship in hand. */
  readonly initial?: FleetSelection | null;
  /** The panel's model for a selection as things stand now; asked again on every refresh. */
  readonly model: (selected: FleetSelection | null) => ShipPanelModel | null;
  /** Fills the ship's picture. */
  readonly picture: (modelId: string, image: HTMLImageElement) => void;
  /** Runs an action. It resolves once the request is answered; the panel then refreshes itself. */
  readonly act: (action: ShipActionModel) => Promise<void>;
  /** The player picked another berth (the host may draw that ship at the pier). */
  readonly onSelect?: (selected: FleetSelection) => void;
  readonly describeError: (error: unknown) => string;
  readonly onClose: () => void;
}

export interface ShipPanel {
  /** Redraws from the latest fleet (after a request, or as a voyage's minutes pass). */
  refresh(): void;
  /** Points the panel at a ship (a new one just built, say). */
  select(selected: FleetSelection): void;
  close(): void;
}

export function openShipPanel(options: ShipPanelOptions): ShipPanel {
  const { host, translate } = options;
  let closed = false;
  let busy = false;
  let selected: FleetSelection | null = options.initial ?? null;

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

  const berthRow = document.createElement("div");
  berthRow.className = "sp-berths";
  berthRow.setAttribute("role", "tablist");
  berthRow.setAttribute("aria-label", translate("shipPanel.berths"));
  const dockLine = document.createElement("p");
  dockLine.className = "sp-dock";

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
  card.replaceChildren(head, berthRow, dockLine, body, actionList, next, status);
  root.appendChild(card);
  host.appendChild(root);

  let pictured: string | null = null;

  function refresh(): void {
    if (closed) return;
    const model = options.model(selected);
    if (model === null) {
      close();
      return;
    }
    berthRow.replaceChildren(
      ...model.berths.map((berth) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = `sp-berth${berth.selected ? " is-selected" : ""}${berth.away ? " is-away" : ""}${berth.empty ? " is-empty" : ""}`;
        chip.setAttribute("role", "tab");
        chip.setAttribute("aria-selected", berth.selected ? "true" : "false");
        chip.disabled = busy;
        const label = document.createElement("span");
        label.className = "sp-berth-label";
        label.textContent = berth.label;
        const detail = document.createElement("span");
        detail.className = "sp-berth-detail";
        detail.textContent = berth.detail;
        chip.replaceChildren(label, detail);
        chip.addEventListener("click", () => {
          select(berth.selection);
        });
        return chip;
      })
    );
    dockLine.textContent = model.dock;
    name.textContent = model.name;
    picture.hidden = model.modelId === null;
    if (model.modelId !== null && pictured !== model.modelId) {
      pictured = model.modelId;
      options.picture(model.modelId, picture);
    }
    hullRow.hidden = model.hull === null;
    if (model.hull !== null) {
      const share = model.hullMax <= 0 ? 0 : Math.max(0, Math.min(1, model.hull / model.hullMax));
      hullFill.style.width = `${String(Math.round(share * 100))}%`;
      hullFill.classList.toggle("is-low", share < 0.35);
      hullText.textContent = `${String(model.hull)}/${String(model.hullMax)}`;
    }
    stats.textContent = model.stats;
    where.textContent = model.where;
    where.hidden = model.where === model.dock;
    next.textContent = model.next ?? "";
    next.hidden = model.next === null;
    actionList.replaceChildren(
      ...model.actions.map((action) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = `sp-action${action.primary ? " is-primary" : ""}`;
        button.dataset.action = action.kind;
        if (action.role !== undefined) button.dataset.role = action.role;
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
          void run(action);
        });
        return button;
      })
    );
  }

  function select(next: FleetSelection): void {
    if (closed || busy) return;
    selected = next;
    status.textContent = "";
    options.onSelect?.(next);
    refresh();
  }

  async function run(action: ShipActionModel): Promise<void> {
    if (busy || closed) return;
    busy = true;
    status.textContent = translate("shipPanel.working");
    refresh();
    try {
      await options.act(action);
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
  return {
    refresh,
    select(next: FleetSelection): void {
      selected = next;
      refresh();
    },
    close
  };
}
