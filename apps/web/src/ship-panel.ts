import type { FleetResponse, ShipRole } from "@happy-farm/contracts";
import { SHIP_CLASSES, SHIP_REPAIR_GOLD_PER_HULL, SHIP_REPAIR_WOOD_PER_HULL } from "@happy-farm/game-data";
import type { MessageKey } from "./i18n";
import { createIcon } from "./icons";
import { shipModelId, shipModelForTier } from "./render/ship-models";

/**
 * The fleet's panel (docs/design/NAVAL.md, FLEET.md): opened by tapping the ship moored at the pier.
 *
 * Laid out like a game's shipyard rather than a form: a row of berth tiles along the top (each ship's
 * picture, its role's badge and its rank in stars; a "+" for a free berth; a lock for the berths the
 * next dock tier would add), the picked ship large on the left, its numbers as bars with icons, and
 * a few big buttons whose prices are resource icons that turn red when the island is short. Longer
 * explanations live in tooltips; only a warning that stops a button is written out.
 *
 * Every button is a request the server decides again; the panel only chooses which to offer and how to
 * draw them. The one button that is not a request is the helm: sailing round home waters is the
 * player's own screen.
 */

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export type ShipActionKind = "FIGHT" | "SAIL" | "HELM" | "VISIT" | "COME_HOME" | "REPAIR" | "UPGRADE" | "BUILD" | "DOCK";

/** The panel's pictures, drawn by the stylesheet (`assets/ui/fleet`). */
export type FleetIcon =
  | "gold"
  | "wood"
  | "ore"
  | "hull"
  | "speed"
  | "cannon"
  | "hold"
  | "role-FISHING"
  | "role-MERCHANT"
  | "role-WAR"
  | "sail"
  | "helm"
  | "repair"
  | "upgrade"
  | "anchor"
  | "lock"
  | "plus"
  | "fight"
  | "visit";

export interface CostChip {
  readonly icon: "gold" | "wood" | "ore";
  readonly amount: number;
  /** The island has less than this. */
  readonly short: boolean;
}

export interface ShipActionModel {
  readonly kind: ShipActionKind;
  /** One or two words. */
  readonly label: string;
  readonly icon: FleetIcon;
  readonly enabled: boolean;
  /** The one action the panel leads with. */
  readonly primary: boolean;
  /** What it costs, as resource chips; empty when free. */
  readonly cost: readonly CostChip[];
  /** The player level it waits for, or null when it is not locked. */
  readonly lockLevel: number | null;
  /** The longer explanation, for a tooltip. */
  readonly hint: string;
  /** The ship it is for (sail, helm, repair, upgrade). */
  readonly shipId?: string;
  /** The role a new ship would have (build). */
  readonly role?: ShipRole;
}

/** What the panel is about: one of the player's ships, the free berth, or the dock itself. */
export type FleetSelection = { readonly kind: "SHIP"; readonly shipId: string } | { readonly kind: "BERTH" } | { readonly kind: "DOCK" };

export interface BerthTileModel {
  readonly key: string;
  readonly selection: FleetSelection;
  readonly kind: "SHIP" | "FREE" | "LOCKED";
  readonly modelId: string | null;
  readonly role: ShipRole | null;
  readonly rank: number;
  readonly maxRank: number;
  /** The hull's share, 0 to 1; null for a tile with no ship. */
  readonly hull: number | null;
  readonly selected: boolean;
  readonly away: boolean;
  readonly lent: boolean;
  /** The tooltip: the class's name, or what the tile offers. */
  readonly title: string;
}

export interface StatModel {
  readonly icon: "hull" | "speed" | "cannon" | "hold";
  readonly label: string;
  readonly value: number;
  /** The hull's full, for the hull; else the largest any class has, so bars compare across the fleet. */
  readonly max: number;
  /** What the upgrade would make it; null without one (or when it would not change). */
  readonly next: number | null;
}

export interface ShipDetailModel {
  readonly kind: "SHIP";
  readonly key: string;
  readonly name: string;
  readonly role: ShipRole;
  readonly roleLabel: string;
  readonly rank: number;
  readonly maxRank: number;
  readonly modelId: string;
  readonly lent: boolean;
  readonly stats: readonly StatModel[];
  readonly status: { readonly icon: FleetIcon; readonly text: string; readonly tone: "calm" | "busy" | "alert" };
  /** Why the leading buttons are held back, in a few words; null when nothing is. */
  readonly warning: string | null;
  readonly actions: readonly ShipActionModel[];
  readonly upgrade: { readonly name: string; readonly rank: number; readonly action: ShipActionModel } | null;
}

export interface ShipyardCardModel {
  readonly role: ShipRole;
  readonly roleLabel: string;
  readonly name: string;
  readonly modelId: string;
  readonly stats: readonly StatModel[];
  readonly action: ShipActionModel;
}

export interface ShipyardModel {
  readonly kind: "SHIPYARD";
  readonly title: string;
  /** The lent rowboat gives way to the first ship of one's own. */
  readonly note: string | null;
  readonly cards: readonly ShipyardCardModel[];
}

export interface DockDetailModel {
  readonly kind: "DOCK";
  readonly tier: number;
  readonly berths: number;
  readonly next: { readonly tier: number; readonly berths: number; readonly action: ShipActionModel } | null;
}

export interface ShipPanelModel {
  readonly title: string;
  readonly berths: readonly BerthTileModel[];
  readonly dock: { readonly tier: number; readonly used: number; readonly berths: number; readonly selected: boolean; readonly canGrow: boolean };
  readonly detail: ShipDetailModel | ShipyardModel | DockDetailModel;
}

export interface Holdings {
  readonly gold: number;
  readonly wood: number;
  readonly ore: number;
}

export interface ShipPanelInput {
  readonly fleet: FleetResponse;
  /** What the panel is about; null (or a ship no longer in the fleet) for the ship in hand. */
  readonly selected?: FleetSelection | null;
  /** The server's time now, by the offset the fleet read gave. */
  readonly serverNowMs: number;
  /** The player's level, or null when not yet read (the server still checks it). */
  readonly playerLevel: number | null;
  /** The island's gold, wood and ore, to mark a price the island cannot pay; null when unknown. */
  readonly holdings?: Holdings | null;
  /** Whether pirates have struck this voyage and wait to be fought. */
  readonly ambushDue: boolean;
  /** Whether the ship can be taken by hand round home waters: drawn at the pier, in the 3D view. */
  readonly canHelm: boolean;
  readonly placeName: (slotId: string) => string;
  readonly translate: Translate;
}

type FleetShip = FleetResponse["ship"];
type Price = NonNullable<FleetResponse["next"]>["cost"];

/** The largest number any class has, so a bar reads the same across ships. */
const STAT_MAX = {
  speed: Math.max(...SHIP_CLASSES.map((entry) => entry.speedTilesPerMinute)),
  cannon: Math.max(...SHIP_CLASSES.map((entry) => entry.cannons)),
  hold: Math.max(...SHIP_CLASSES.map((entry) => entry.hold))
};

function ladderLength(role: ShipRole): number {
  return SHIP_CLASSES.filter((entry) => entry.role === role).length;
}

function materialQuantity(materials: Price["materials"], itemDefinitionId: string): number {
  return materials.find((entry) => entry.itemDefinitionId === itemDefinitionId)?.quantity ?? 0;
}

function costChips(price: { readonly gold: number; readonly wood: number; readonly ore: number }, holdings: Holdings | null | undefined): CostChip[] {
  const chips: CostChip[] = [];
  const add = (icon: CostChip["icon"], amount: number, have: number | undefined): void => {
    if (amount > 0) chips.push({ icon, amount, short: have !== undefined && have < amount });
  };
  add("gold", price.gold, holdings?.gold);
  add("wood", price.wood, holdings?.wood);
  add("ore", price.ore, holdings?.ore);
  return chips;
}

function priceChips(cost: Price, holdings: Holdings | null | undefined): CostChip[] {
  return costChips({ gold: cost.gold, wood: materialQuantity(cost.materials, "item_wood"), ore: materialQuantity(cost.materials, "item_ore") }, holdings);
}

/** Whether the fleet has room for a new ship: a free berth, or the lent rowboat to give way. */
function canBuild(fleet: FleetResponse): boolean {
  return fleet.dock.freeBerths > 0;
}

/** The selection as it stands: a ship still in the fleet, the free berth while there is one, the dock, else the ship in hand. */
export function resolveSelection(fleet: FleetResponse, selected: FleetSelection | null | undefined): FleetSelection {
  if (selected?.kind === "SHIP" && fleet.ships.some((ship) => ship.shipId === selected.shipId)) return selected;
  if (selected?.kind === "BERTH" && canBuild(fleet)) return selected;
  if (selected?.kind === "DOCK") return selected;
  return { kind: "SHIP", shipId: fleet.ship.shipId };
}

function className(translate: Translate, classId: string): string {
  return translate(`ship.class.${classId}` as MessageKey);
}

function roleName(translate: Translate, role: ShipRole): string {
  return translate(`ship.role.${role}` as MessageKey);
}

function modelOf(classId: string, tier: number): string {
  return shipModelId(classId) ?? shipModelForTier(tier);
}

function levelShort(input: ShipPanelInput, level: number): boolean {
  return input.playerLevel !== null && input.playerLevel < level;
}

/** What the panel shows and offers for the fleet as it stands. Pure: no DOM, no requests. */
export function shipPanelModel(input: ShipPanelInput): ShipPanelModel {
  const { fleet, translate } = input;
  const selection = resolveSelection(fleet, input.selected);
  const stored = fleet.ships.filter((ship) => !ship.lent).length;
  const berths: BerthTileModel[] = fleet.ships.map((ship) => ({
    key: ship.shipId,
    selection: { kind: "SHIP", shipId: ship.shipId },
    kind: "SHIP",
    modelId: modelOf(ship.classId, ship.tier),
    role: ship.role,
    rank: ship.rank,
    maxRank: ladderLength(ship.role),
    hull: ship.hullMax <= 0 ? 0 : Math.max(0, Math.min(1, ship.hull / ship.hullMax)),
    selected: selection.kind === "SHIP" && selection.shipId === ship.shipId,
    away: ship.away,
    lent: ship.lent,
    title: className(translate, ship.classId)
  }));
  if (canBuild(fleet)) {
    berths.push({
      key: "free",
      selection: { kind: "BERTH" },
      kind: "FREE",
      modelId: null,
      role: null,
      rank: 0,
      maxRank: 0,
      hull: null,
      selected: selection.kind === "BERTH",
      away: false,
      lent: false,
      title: translate("fleet.newShip")
    });
  }
  // The berths the next dock tier would add, locked: a tap shows the dock.
  const nextDock = fleet.dock.next;
  if (nextDock !== null) {
    for (let index = fleet.dock.berths; index < nextDock.berths; index += 1) {
      berths.push({
        key: `locked-${String(index)}`,
        selection: { kind: "DOCK" },
        kind: "LOCKED",
        modelId: null,
        role: null,
        rank: 0,
        maxRank: 0,
        hull: null,
        selected: selection.kind === "DOCK",
        away: false,
        lent: false,
        title: translate("fleet.growDock", { berths: nextDock.berths })
      });
    }
  }
  const dock = { tier: fleet.dock.tier, used: stored, berths: fleet.dock.berths, selected: selection.kind === "DOCK", canGrow: nextDock !== null };
  const title = translate("fleet.title");

  if (selection.kind === "DOCK") return { title, berths, dock, detail: dockDetail(input) };
  if (selection.kind === "BERTH") return { title, berths, dock, detail: shipyard(input) };
  const ship = fleet.ships.find((entry) => entry.shipId === selection.shipId) ?? fleet.ship;
  return { title, berths, dock, detail: shipDetail(input, ship) };
}

function stats(ship: { readonly hull: number; readonly hullMax: number; readonly speedTilesPerMinute: number; readonly cannons: number; readonly hold: number }, translate: Translate, upgrade: FleetShip["upgrade"]): StatModel[] {
  const changed = (now: number, next: number | undefined): number | null => (next === undefined || next === now ? null : next);
  return [
    { icon: "hull", label: translate("fleet.stat.hull"), value: ship.hull, max: ship.hullMax, next: changed(ship.hullMax, upgrade?.hull) },
    { icon: "speed", label: translate("fleet.stat.speed"), value: ship.speedTilesPerMinute, max: STAT_MAX.speed, next: changed(ship.speedTilesPerMinute, upgrade?.speedTilesPerMinute) },
    { icon: "cannon", label: translate("fleet.stat.cannons"), value: ship.cannons, max: STAT_MAX.cannon, next: changed(ship.cannons, upgrade?.cannons) },
    { icon: "hold", label: translate("fleet.stat.hold"), value: ship.hold, max: STAT_MAX.hold, next: changed(ship.hold, upgrade?.hold) }
  ];
}

function shipDetail(input: ShipPanelInput, ship: FleetShip): ShipDetailModel {
  const { fleet, translate } = input;
  const voyage = fleet.voyage;
  const pending = voyage?.ambush?.status === "PENDING";
  const actions: ShipActionModel[] = [];
  const shipId = ship.shipId;
  const action = (kind: ShipActionKind, icon: FleetIcon, label: MessageKey, hint: string, rest: Partial<ShipActionModel> = {}): ShipActionModel => ({
    kind,
    icon,
    label: translate(label),
    hint,
    enabled: true,
    primary: false,
    cost: [],
    lockLevel: null,
    shipId,
    ...rest
  });
  let status: ShipDetailModel["status"];
  let warning: string | null = null;

  if (ship.away && voyage !== null) {
    if (input.ambushDue) {
      actions.push(action("FIGHT", "fight", "fleet.action.fight", translate("shipPanel.fightDetail"), { primary: true }));
    }
    if (fleet.location === "AT_SEA") {
      const minutes = Math.max(1, Math.ceil((Date.parse(voyage.arrivesAt) - input.serverNowMs) / 60_000));
      status = input.ambushDue
        ? { icon: "fight", text: translate("fleet.status.ambush"), tone: "alert" }
        : { icon: "sail", text: translate("fleet.status.sea", { place: input.placeName(voyage.toSlotId), minutes }), tone: "busy" };
      actions.push(action("COME_HOME", "anchor", "fleet.action.home", translate(input.ambushDue ? "shipPanel.comeHomeAmbush" : "shipPanel.comeHomeDetail"), { primary: !input.ambushDue }));
    } else {
      status = input.ambushDue
        ? { icon: "fight", text: translate("fleet.status.ambush"), tone: "alert" }
        : { icon: "visit", text: translate("fleet.status.place", { place: input.placeName(voyage.toSlotId) }), tone: "busy" };
      actions.push(action("VISIT", "visit", "fleet.action.visit", input.placeName(voyage.toSlotId), { enabled: !pending, primary: !input.ambushDue }));
      actions.push(action("SAIL", "sail", "fleet.action.sailOn", translate("shipPanel.sailDetail"), { enabled: !pending }));
      actions.push(action("COME_HOME", "anchor", "fleet.action.home", translate(input.ambushDue ? "shipPanel.comeHomeAmbush" : "shipPanel.comeHomeDetail")));
    }
  } else {
    // At the dock. While another ship is out, this one waits for it to come home before it sails.
    const otherAway = fleet.location !== "HOME";
    const sunk = ship.hull <= 0;
    status = { icon: "anchor", text: translate("fleet.status.home"), tone: "calm" };
    if (otherAway) warning = translate("fleet.warn.otherAway");
    else if (sunk) warning = translate("fleet.warn.sunk");
    actions.push(action("SAIL", "sail", "fleet.action.sail", translate("shipPanel.sailDetail"), { enabled: !otherAway && !sunk, primary: !otherAway && !sunk }));
    if (input.canHelm && !sunk && !otherAway) actions.push(action("HELM", "helm", "fleet.action.helm", translate("shipPanel.helmDetail")));
    const missing = ship.hullMax - ship.hull;
    if (missing > 0 && !ship.lent) {
      actions.push(
        action("REPAIR", "repair", "fleet.action.repair", translate("fleet.stat.hull"), {
          primary: sunk,
          cost: costChips({ gold: Math.ceil(missing * SHIP_REPAIR_GOLD_PER_HULL), wood: Math.ceil(missing * SHIP_REPAIR_WOOD_PER_HULL), ore: 0 }, input.holdings)
        })
      );
    }
  }

  const next = ship.upgrade;
  const upgrade =
    next === null || ship.away
      ? null
      : {
          name: className(translate, next.classId),
          rank: next.rank,
          action: action("UPGRADE", "upgrade", "fleet.action.upgrade", translate("fleet.upgradeTo", { name: className(translate, next.classId) }), {
            enabled: !levelShort(input, next.requiredPlayerLevel),
            cost: priceChips(next.cost, input.holdings),
            lockLevel: levelShort(input, next.requiredPlayerLevel) ? next.requiredPlayerLevel : null
          })
        };
  return {
    kind: "SHIP",
    key: ship.shipId,
    name: className(translate, ship.classId),
    role: ship.role,
    roleLabel: roleName(translate, ship.role),
    rank: ship.rank,
    maxRank: ladderLength(ship.role),
    modelId: modelOf(ship.classId, ship.tier),
    lent: ship.lent,
    stats: stats(ship, translate, ship.away ? null : next),
    status,
    warning,
    actions,
    upgrade
  };
}

function shipyard(input: ShipPanelInput): ShipyardModel {
  const { fleet, translate } = input;
  const replacing = fleet.ships.length === 1 && fleet.ships[0]?.lent === true;
  return {
    kind: "SHIPYARD",
    title: translate("fleet.newShip"),
    note: replacing ? translate("fleet.replaceLent") : null,
    cards: fleet.builds.map((build) => {
      const locked = levelShort(input, build.requiredPlayerLevel);
      return {
        role: build.role,
        roleLabel: roleName(translate, build.role),
        name: className(translate, build.classId),
        modelId: modelOf(build.classId, build.tier),
        stats: stats({ hull: build.hull, hullMax: build.hull, speedTilesPerMinute: build.speedTilesPerMinute, cannons: build.cannons, hold: build.hold }, translate, null).slice(1),
        action: {
          kind: "BUILD",
          icon: "plus",
          label: translate("fleet.action.build"),
          hint: translate("shipPanel.buildNew", { name: className(translate, build.classId), role: roleName(translate, build.role) }),
          enabled: !locked,
          primary: false,
          cost: priceChips(build.cost, input.holdings),
          lockLevel: locked ? build.requiredPlayerLevel : null,
          role: build.role
        }
      };
    })
  };
}

function dockDetail(input: ShipPanelInput): DockDetailModel {
  const { fleet, translate } = input;
  const next = fleet.dock.next;
  return {
    kind: "DOCK",
    tier: fleet.dock.tier,
    berths: fleet.dock.berths,
    next:
      next === null
        ? null
        : {
            tier: next.tier,
            berths: next.berths,
            action: {
              kind: "DOCK",
              icon: "upgrade",
              label: translate("fleet.action.dock"),
              hint: translate("shipPanel.dockUpgrade", { berths: next.berths }),
              enabled: !levelShort(input, next.requiredPlayerLevel),
              primary: true,
              cost: priceChips(next.cost, input.holdings),
              lockLevel: levelShort(input, next.requiredPlayerLevel) ? next.requiredPlayerLevel : null
            }
          }
  };
}

export interface ShipPanelOptions {
  readonly host: HTMLElement;
  readonly translate: Translate;
  /** The ship the panel opens on; null for the ship in hand. */
  readonly initial?: FleetSelection | null;
  /** The panel's model for a selection as things stand now; asked again on every refresh. */
  readonly model: (selected: FleetSelection | null) => ShipPanelModel | null;
  /** Fills a ship's picture. */
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

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Appends children one by one. (`Element.append` is avoided: the monorepo's Worker types declare an
 * `Element` whose `append` takes HTML text, and the two merge.)
 */
function put(parent: HTMLElement, ...children: readonly Node[]): void {
  for (const child of children) parent.appendChild(child);
}

function icon(name: FleetIcon, className = "fl-icon"): HTMLSpanElement {
  const node = element("span", className);
  node.dataset.icon = name;
  node.setAttribute("aria-hidden", "true");
  return node;
}

/** Rank as stars: filled up to `rank`, hollow to the top of the ladder. */
function stars(rank: number, max: number): HTMLSpanElement {
  const row = element("span", "fl-stars");
  row.setAttribute("aria-label", `${String(rank)}/${String(max)}`);
  for (let index = 1; index <= max; index += 1) row.appendChild(element("span", index <= rank ? "fl-star is-on" : "fl-star"));
  return row;
}

function formatAmount(amount: number): string {
  return amount >= 10_000 ? `${String(Math.round(amount / 100) / 10)}k` : String(amount);
}

function chipsOf(cost: readonly CostChip[]): HTMLSpanElement {
  const row = element("span", "fl-cost");
  for (const chip of cost) {
    const node = element("span", `fl-chip${chip.short ? " is-short" : ""}`);
    put(node, icon(chip.icon, "fl-chip-icon"), element("span", "fl-chip-amount", formatAmount(chip.amount)));
    row.appendChild(node);
  }
  return row;
}

export function openShipPanel(options: ShipPanelOptions): ShipPanel {
  const { host, translate } = options;
  let closed = false;
  let busy = false;
  let selected: FleetSelection | null = options.initial ?? null;

  const root = element("div", "ship-panel fleet-panel");
  root.id = "ship-panel";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "ship-panel-title");
  const card = element("div", "fl-card");
  const head = element("header", "fl-head");
  const title = element("h2", "fl-title");
  title.id = "ship-panel-title";
  const dockBadge = element("button", "fl-dock");
  dockBadge.type = "button";
  const closeButton = element("button", "panel-close fl-close");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", translate("shipPanel.close"));
  closeButton.title = translate("shipPanel.close");
  closeButton.appendChild(createIcon("close", 18));
  head.replaceChildren(title, dockBadge, closeButton);
  const berthRow = element("div", "fl-berths");
  berthRow.setAttribute("role", "tablist");
  berthRow.setAttribute("aria-label", translate("shipPanel.berths"));
  const detail = element("div", "fl-detail");
  const status = element("p", "fl-status");
  status.setAttribute("aria-live", "polite");
  card.replaceChildren(head, berthRow, detail, status);
  root.appendChild(card);
  host.appendChild(root);

  // Pictures are drawn once per place and model, and kept across redraws.
  const pictures = new Map<string, { readonly modelId: string; readonly image: HTMLImageElement }>();
  function picture(key: string, modelId: string, className: string): HTMLImageElement {
    const known = pictures.get(key);
    if (known !== undefined && known.modelId === modelId) {
      known.image.className = className;
      return known.image;
    }
    const image = element("img", className);
    image.alt = "";
    image.draggable = false;
    options.picture(modelId, image);
    pictures.set(key, { modelId, image });
    return image;
  }

  function actionButton(action: ShipActionModel, extra = ""): HTMLButtonElement {
    const button = element("button", `fl-button${action.primary ? " is-primary" : ""}${action.lockLevel !== null ? " is-locked" : ""}${extra}`);
    button.type = "button";
    button.dataset.action = action.kind;
    if (action.role !== undefined) button.dataset.role = action.role;
    button.title = action.hint;
    button.disabled = busy || !action.enabled;
    const top = element("span", "fl-button-top");
    put(top, icon(action.lockLevel !== null ? "lock" : action.icon, "fl-button-icon"), element("span", "fl-button-label", action.lockLevel !== null ? translate("fleet.lockLevel", { level: action.lockLevel }) : action.label));
    button.appendChild(top);
    if (action.cost.length > 0 && action.lockLevel === null) button.appendChild(chipsOf(action.cost));
    button.addEventListener("click", () => {
      void run(action);
    });
    return button;
  }

  function statRows(rows: readonly StatModel[], compact = false): HTMLDivElement {
    const list = element("div", `fl-stats${compact ? " is-compact" : ""}`);
    for (const stat of rows) {
      const row = element("div", `fl-stat is-${stat.icon}`);
      row.title = stat.label;
      const track = element("span", "fl-stat-track");
      const share = (value: number): string => `${String(Math.round(Math.max(0, Math.min(1, stat.max <= 0 ? 0 : value / stat.max)) * 100))}%`;
      if (stat.next !== null && !compact && stat.icon !== "hull") {
        const ghost = element("span", "fl-stat-next");
        ghost.style.width = share(stat.next);
        track.appendChild(ghost);
      }
      const fill = element("span", `fl-stat-fill${stat.icon === "hull" && stat.value / Math.max(1, stat.max) < 0.35 ? " is-low" : ""}`);
      fill.style.width = share(stat.value);
      track.appendChild(fill);
      const value = element("span", "fl-stat-value", stat.icon === "hull" && !compact ? `${String(stat.value)}/${String(stat.max)}` : String(stat.value));
      if (stat.next !== null && !compact) value.appendChild(element("span", "fl-stat-gain", `+${String(stat.next - (stat.icon === "hull" ? stat.max : stat.value))}`));
      put(row, icon(stat.icon, "fl-stat-icon"), ...(compact ? [] : [track]), value);
      list.appendChild(row);
    }
    return list;
  }

  function renderShip(model: ShipDetailModel): HTMLElement[] {
    const stage = element("div", `fl-stage is-${model.role.toLowerCase()}`);
    put(stage, picture(`stage:${model.key}`, model.modelId, "fl-stage-picture"));
    const plate = element("div", "fl-plate");
    const badge = icon(`role-${model.role}`, "fl-role");
    badge.title = model.roleLabel;
    put(plate, badge, element("span", "fl-name", model.name), stars(model.rank, model.maxRank));
    stage.appendChild(plate);
    if (model.lent) stage.appendChild(element("span", "fl-ribbon", translate("fleet.lent")));

    const info = element("div", "fl-info");
    const statusLine = element("p", `fl-where is-${model.status.tone}`);
    put(statusLine, icon(model.status.icon, "fl-where-icon"), element("span", "", model.status.text));
    put(info, statusLine, statRows(model.stats));
    if (model.upgrade !== null) {
      const upgrade = element("div", "fl-upgrade");
      const label = element("div", "fl-upgrade-label");
      put(label, icon("upgrade", "fl-upgrade-icon"), element("span", "fl-upgrade-name", model.upgrade.name), stars(model.upgrade.rank, model.maxRank));
      put(upgrade, label, actionButton(model.upgrade.action, " is-upgrade"));
      info.appendChild(upgrade);
    }
    if (model.warning !== null) {
      const warning = element("p", "fl-warning");
      put(warning, icon("lock", "fl-warning-icon"), element("span", "", model.warning));
      put(info, warning);
    }
    const actions = element("div", "fl-actions");
    put(actions, ...model.actions.map((action) => actionButton(action)));
    put(info, actions);
    // The ship on the left, everything about it - and every button - on the right, so a phone held
    // sideways sees the whole panel without scrolling.
    const top = element("div", "fl-ship");
    put(top, stage, info);
    return [top];
  }

  function renderShipyard(model: ShipyardModel): HTMLElement[] {
    const heading = element("h3", "fl-heading", model.title);
    const nodes: HTMLElement[] = [heading];
    if (model.note !== null) nodes.push(element("p", "fl-note", model.note));
    const cards = element("div", "fl-yard");
    for (const entry of model.cards) {
      const cardNode = element("div", `fl-yard-card is-${entry.role.toLowerCase()}${entry.action.lockLevel !== null ? " is-locked" : ""}`);
      const pictureBox = element("div", "fl-yard-picture");
      pictureBox.appendChild(picture(`yard:${entry.role}`, entry.modelId, "fl-yard-image"));
      const badge = icon(`role-${entry.role}`, "fl-role");
      badge.title = entry.roleLabel;
      pictureBox.appendChild(badge);
      put(cardNode, pictureBox, element("span", "fl-yard-role", entry.roleLabel), element("span", "fl-yard-name", entry.name), statRows(entry.stats, true), actionButton(entry.action));
      cards.appendChild(cardNode);
    }
    nodes.push(cards);
    return nodes;
  }

  function renderDock(model: DockDetailModel): HTMLElement[] {
    const box = element("div", "fl-dock-card");
    const art = element("div", "fl-dock-art");
    art.appendChild(icon("anchor", "fl-dock-anchor"));
    const facts = element("div", "fl-dock-facts");
    const tiers = element("p", "fl-dock-tiers");
    put(tiers, element("span", "fl-dock-tier", translate("fleet.dockTier", { tier: model.tier })));
    if (model.next !== null) put(tiers, element("span", "fl-dock-arrow", "→"), element("span", "fl-dock-tier is-next", translate("fleet.dockTier", { tier: model.next.tier })));
    const slots = element("div", "fl-dock-slots");
    const total = model.next?.berths ?? model.berths;
    for (let index = 0; index < total; index += 1) slots.appendChild(icon(index < model.berths ? "anchor" : "plus", index < model.berths ? "fl-dock-slot" : "fl-dock-slot is-new"));
    put(facts, tiers, slots);
    if (model.next === null) facts.appendChild(element("p", "fl-note", translate("fleet.dockMax")));
    put(box, art, facts);
    const nodes: HTMLElement[] = [box];
    if (model.next !== null) {
      const actions = element("div", "fl-actions");
      actions.appendChild(actionButton(model.next.action));
      nodes.push(actions);
    }
    return nodes;
  }

  function refresh(): void {
    if (closed) return;
    const model = options.model(selected);
    if (model === null) {
      close();
      return;
    }
    title.textContent = model.title;
    dockBadge.replaceChildren(icon("anchor", "fl-dock-icon"), element("span", "fl-dock-text", `${String(model.dock.used)}/${String(model.dock.berths)}`));
    dockBadge.classList.toggle("is-selected", model.dock.selected);
    dockBadge.classList.toggle("can-grow", model.dock.canGrow);
    dockBadge.title = translate("fleet.dockTier", { tier: model.dock.tier });
    dockBadge.disabled = busy;
    berthRow.replaceChildren(
      ...model.berths.map((berth) => {
        const tile = element("button", `fl-tile is-${berth.kind.toLowerCase()}${berth.selected ? " is-selected" : ""}${berth.away ? " is-away" : ""}`);
        tile.type = "button";
        tile.setAttribute("role", "tab");
        tile.setAttribute("aria-selected", berth.selected ? "true" : "false");
        tile.title = berth.title;
        tile.disabled = busy;
        if (berth.kind === "SHIP" && berth.modelId !== null) {
          tile.appendChild(picture(`tile:${berth.key}`, berth.modelId, "fl-tile-picture"));
          if (berth.role !== null) tile.appendChild(icon(`role-${berth.role}`, "fl-tile-role"));
          tile.appendChild(stars(berth.rank, berth.maxRank));
          if (berth.hull !== null) {
            const bar = element("span", "fl-tile-hull");
            const fill = element("span", `fl-tile-hull-fill${berth.hull < 0.35 ? " is-low" : ""}`);
            fill.style.width = `${String(Math.round(berth.hull * 100))}%`;
            bar.appendChild(fill);
            tile.appendChild(bar);
          }
          if (berth.away) tile.appendChild(icon("sail", "fl-tile-away"));
          if (berth.lent) tile.appendChild(element("span", "fl-tile-lent", translate("fleet.lent")));
        } else {
          tile.appendChild(icon(berth.kind === "FREE" ? "plus" : "lock", "fl-tile-mark"));
        }
        tile.addEventListener("click", () => {
          select(berth.selection);
        });
        return tile;
      })
    );
    const content = model.detail.kind === "SHIP" ? renderShip(model.detail) : model.detail.kind === "SHIPYARD" ? renderShipyard(model.detail) : renderDock(model.detail);
    detail.className = `fl-detail is-${model.detail.kind.toLowerCase()}`;
    detail.replaceChildren(...content);
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
  dockBadge.addEventListener("click", () => {
    select({ kind: "DOCK" });
  });
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
