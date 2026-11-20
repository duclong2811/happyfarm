import type { FleetResponse, HuntsResponse, ShipRole } from "@happy-farm/contracts";
import {
  FISHING_GROUNDS,
  MATERIAL_MERGE_COUNT,
  MAX_MONSTER_LEVEL,
  MONSTER_KIND_DEFINITIONS,
  MONSTER_LEVELS,
  monsterMaterialId,
  parseMonsterMaterial,
  SHIP_CLASSES,
  SHIP_REPAIR_GOLD_PER_HULL,
  SHIP_REPAIR_WOOD_PER_HULL
} from "@happy-farm/game-data";
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

export type ShipActionKind =
  | "FIGHT"
  | "SAIL"
  | "HELM"
  | "VISIT"
  | "COME_HOME"
  | "REPAIR"
  | "UPGRADE"
  | "BUILD"
  | "DOCK"
  | "FISH"
  | "TRIP"
  | "COLLECT"
  | "RECALL"
  /** Opens the sea-monster page (the panel's own, not a request). */
  | "HUNTS"
  /** Fights a roster monster, or resumes the fight already planned. */
  | "HUNT"
  /** Merges ten of a monster material into one of the next level. */
  | "MERGE";

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
  | "visit"
  | "fish"
  | "clock"
  | "monster"
  | "xp";

export interface CostChip {
  /** A resource drawn as an icon, or an item (a monster material) drawn as its own picture. */
  readonly icon: "gold" | "wood" | "ore" | "item";
  readonly amount: number;
  /** The island has less than this. */
  readonly short: boolean;
  /** The item, for an item's chip. */
  readonly itemDefinitionId?: string;
  readonly name?: string;
  /** How many the island has, for an item's chip; null when unknown. */
  readonly have?: number | null;
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
  /** The fishing ground a trip would work (trip). */
  readonly groundId?: string;
  /** The roster slot of the monster to fight (hunt). */
  readonly slot?: number;
  /** The material to merge (merge). */
  readonly itemDefinitionId?: string;
}

/** What the panel is about: one of the player's ships, the free berth, or the dock itself. */
export type FleetSelection =
  | { readonly kind: "SHIP"; readonly shipId: string }
  | { readonly kind: "BERTH" }
  | { readonly kind: "DOCK" }
  /** The fishing grounds, for one fishing boat at its dock. */
  | { readonly kind: "GROUNDS"; readonly shipId: string }
  /** The sea monsters in home waters, and the ship that would fight them (null: the panel picks). */
  | { readonly kind: "HUNTS"; readonly shipId: string | null };

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
  /** Out fishing (false), or back with a catch (true); null when not on a trip. */
  readonly fishing: boolean | null;
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
  /** A fishing trip under way: how far through it is, 0 to 1; null otherwise. */
  readonly tripShare: number | null;
  /** A returned trip's catch, fish by fish; empty otherwise. */
  readonly catch: readonly CatchChip[];
  readonly actions: readonly ShipActionModel[];
  readonly upgrade: { readonly name: string; readonly rank: number; readonly action: ShipActionModel } | null;
}

export interface CatchChip {
  readonly itemDefinitionId: string;
  /** The fish's own model, for its picture. */
  readonly modelId: string;
  readonly quantity: number;
  readonly name: string;
}

export interface GroundCardModel {
  readonly groundId: string;
  readonly name: string;
  readonly minutes: number;
  /** The fish it gives, as pictures, most likely first. */
  readonly fish: readonly CatchChip[];
  /** About how many fish this boat brings back. */
  readonly expected: number;
  readonly action: ShipActionModel;
}

export interface GroundsModel {
  readonly kind: "GROUNDS";
  readonly shipId: string;
  readonly boatName: string;
  readonly modelId: string;
  readonly cards: readonly GroundCardModel[];
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

export interface HuntCardModel {
  readonly slot: number;
  readonly name: string;
  readonly level: number;
  readonly modelId: string;
  readonly defeated: boolean;
  /** This monster's fight is planned and waits to be fought. */
  readonly open: boolean;
  readonly gold: number;
  readonly xp: number;
  /** The materials a win drops, as item chips. */
  readonly drops: readonly CostChip[];
  readonly action: ShipActionModel;
}

export interface HuntFighterModel {
  readonly shipId: string;
  readonly name: string;
  readonly modelId: string;
  readonly hull: number;
  readonly selected: boolean;
  /** At its dock, afloat and free: it can set out to fight now. */
  readonly ready: boolean;
}

export interface MaterialCellModel {
  readonly itemDefinitionId: string;
  readonly name: string;
  readonly level: number;
  /** How many the island has; null when unknown. */
  readonly have: number | null;
  /** Merging ten of these into one of the next level; null on the top level. */
  readonly merge: ShipActionModel | null;
}

export interface HuntsModel {
  readonly kind: "HUNTS";
  /** The roster is still being read. */
  readonly loading: boolean;
  /** The player's armed ships; the selected one fights. */
  readonly fighters: readonly HuntFighterModel[];
  /** Why the fight buttons are held back, in a few words; null when nothing is. */
  readonly warning: string | null;
  /** When the next roster surfaces, written out; null while unknown. */
  readonly renews: string | null;
  readonly cards: readonly HuntCardModel[];
  /** Every material, kind by kind (rows) and level by level (cells). */
  readonly materials: readonly { readonly kind: string; readonly name: string; readonly cells: readonly MaterialCellModel[] }[];
}

export interface ShipPanelModel {
  readonly title: string;
  readonly berths: readonly BerthTileModel[];
  readonly dock: { readonly tier: number; readonly used: number; readonly berths: number; readonly selected: boolean; readonly canGrow: boolean };
  /** The header's monster badge: how many monsters are still to beat (null while unread). */
  readonly hunts: { readonly alive: number | null; readonly selected: boolean };
  readonly detail: ShipDetailModel | ShipyardModel | DockDetailModel | GroundsModel | HuntsModel;
}

export interface Holdings {
  readonly gold: number;
  readonly wood: number;
  readonly ore: number;
  /** How many of an item the island has (monster materials); absent when unknown. */
  readonly count?: (itemDefinitionId: string) => number;
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
  /** The monsters in home waters this window (F3); null while unread. */
  readonly hunts?: HuntsResponse | null;
  /** Whether the ship can be taken by hand round home waters: drawn at the pier, in the 3D view. */
  readonly canHelm: boolean;
  readonly placeName: (slotId: string) => string;
  /** An item's name, as the warehouse shows it. */
  readonly itemName?: (itemDefinitionId: string) => string;
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

/** An item's chip: its picture, how many it takes, and whether the island has that many. */
function itemChip(input: { readonly itemName?: (itemDefinitionId: string) => string }, holdings: Holdings | null | undefined, itemDefinitionId: string, amount: number): CostChip {
  const have = holdings?.count === undefined ? null : holdings.count(itemDefinitionId);
  return { icon: "item", itemDefinitionId, name: input.itemName?.(itemDefinitionId) ?? itemDefinitionId, amount, short: have !== null && have < amount, have };
}

/** A price as chips: gold, wood and ore as icons, then any monster materials it takes as pictures. */
function priceChips(cost: Price, holdings: Holdings | null | undefined, input: { readonly itemName?: (itemDefinitionId: string) => string } = {}): CostChip[] {
  const chips = costChips({ gold: cost.gold, wood: materialQuantity(cost.materials, "item_wood"), ore: materialQuantity(cost.materials, "item_ore") }, holdings);
  for (const entry of cost.materials) {
    if (entry.quantity > 0 && parseMonsterMaterial(entry.itemDefinitionId) !== null) chips.push(itemChip(input, holdings, entry.itemDefinitionId, entry.quantity));
  }
  return chips;
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
  if (selected?.kind === "HUNTS") return selected.shipId === null || fleet.ships.some((ship) => ship.shipId === selected.shipId) ? selected : { kind: "HUNTS", shipId: null };
  if (selected?.kind === "GROUNDS") {
    const boat = fleet.ships.find((ship) => ship.shipId === selected.shipId);
    if (boat !== undefined && boat.role === "FISHING" && boat.trip === null && !boat.away) return selected;
    if (boat !== undefined) return { kind: "SHIP", shipId: boat.shipId };
  }
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
    selected: (selection.kind === "SHIP" || selection.kind === "GROUNDS") && selection.shipId === ship.shipId,
    away: ship.away,
    fishing: ship.trip === null ? null : ship.trip.returned,
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
      fishing: null,
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
        fishing: null,
        lent: false,
        title: translate("fleet.growDock", { berths: nextDock.berths })
      });
    }
  }
  const dock = { tier: fleet.dock.tier, used: stored, berths: fleet.dock.berths, selected: selection.kind === "DOCK", canGrow: nextDock !== null };
  const title = translate("fleet.title");
  const hunts = { alive: input.hunts == null ? null : input.hunts.monsters.filter((monster) => !monster.defeated).length, selected: selection.kind === "HUNTS" };

  if (selection.kind === "DOCK") return { title, berths, dock, hunts, detail: dockDetail(input) };
  if (selection.kind === "BERTH") return { title, berths, dock, hunts, detail: shipyard(input) };
  if (selection.kind === "HUNTS") return { title, berths, dock, hunts, detail: huntsDetail(input, selection.shipId) };
  if (selection.kind === "GROUNDS") {
    const boat = fleet.ships.find((entry) => entry.shipId === selection.shipId);
    if (boat !== undefined) return { title, berths, dock, hunts, detail: groundsDetail(input, boat) };
  }
  const ship = fleet.ships.find((entry) => entry.shipId === selection.shipId) ?? fleet.ship;
  return { title, berths, dock, hunts, detail: shipDetail(input, ship) };
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
  let tripShare: number | null = null;
  let caught: CatchChip[] = [];
  const trip = ship.trip;

  if (trip !== null) {
    if (trip.returned) {
      // Back with its catch: bringing it ashore is the one thing to do.
      caught = (trip.catch ?? []).map((entry) => catchChip(input, entry.itemDefinitionId, entry.quantity));
      status = { icon: "fish", text: translate("fleet.status.tripBack", { ground: groundName(translate, trip.groundId) }), tone: "calm" };
      actions.push(action("COLLECT", "fish", "fleet.action.collect", translate("fleet.collectHint"), { primary: true }));
    } else {
      const start = Date.parse(trip.departedAt);
      const end = Date.parse(trip.returnsAt);
      tripShare = end <= start ? 1 : Math.max(0, Math.min(1, (input.serverNowMs - start) / (end - start)));
      const minutes = Math.max(1, Math.ceil((end - input.serverNowMs) / 60_000));
      status = { icon: "clock", text: translate("fleet.status.fishing", { ground: groundName(translate, trip.groundId), minutes }), tone: "busy" };
      actions.push(action("RECALL", "anchor", "fleet.action.recall", translate("fleet.recallHint")));
    }
  } else if (ship.away && voyage !== null) {
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
    // A fishing boat leads with fishing, and a warship with the hunt: neither needs a voyage, so
    // another ship out does not hold them.
    if (ship.role === "FISHING") actions.push(action("FISH", "fish", "fleet.action.fish", translate("fleet.fishHint"), { enabled: !sunk, primary: !sunk }));
    const hunts = armed(ship);
    if (hunts && ship.role === "WAR") actions.push(action("HUNTS", "monster", "fleet.action.hunt", translate("fleet.huntHint"), { enabled: !sunk, primary: !sunk }));
    actions.push(action("SAIL", "sail", "fleet.action.sail", translate("shipPanel.sailDetail"), { enabled: !otherAway && !sunk, primary: ship.role === "MERCHANT" && !otherAway && !sunk }));
    if (hunts && ship.role !== "WAR") actions.push(action("HUNTS", "monster", "fleet.action.hunt", translate("fleet.huntHint"), { enabled: !sunk }));
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
    next === null || ship.away || trip !== null
      ? null
      : {
          name: className(translate, next.classId),
          rank: next.rank,
          action: action("UPGRADE", "upgrade", "fleet.action.upgrade", translate("fleet.upgradeTo", { name: className(translate, next.classId) }), {
            enabled: !levelShort(input, next.requiredPlayerLevel),
            cost: priceChips(next.cost, input.holdings, input),
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
    stats: stats(ship, translate, ship.away || trip !== null ? null : next),
    status,
    warning,
    tripShare,
    catch: caught,
    actions,
    upgrade
  };
}

function groundName(translate: Translate, groundId: string): string {
  return translate(`fleet.ground.${groundId}` as MessageKey);
}

function catchChip(input: ShipPanelInput, itemDefinitionId: string, quantity: number): CatchChip {
  const species = itemDefinitionId.replace(/^item_fish_/, "");
  return { itemDefinitionId, modelId: `fish_${species}`, quantity, name: input.itemName?.(itemDefinitionId) ?? itemDefinitionId };
}

/** The grounds a fishing boat could work: how long, what comes up, about how much, and whether its rank reaches. */
function groundsDetail(input: ShipPanelInput, boat: FleetShip): GroundsModel {
  const { translate } = input;
  return {
    kind: "GROUNDS",
    shipId: boat.shipId,
    boatName: className(translate, boat.classId),
    modelId: modelOf(boat.classId, boat.tier),
    cards: FISHING_GROUNDS.map((ground) => {
      const total = ground.table.reduce((sum, entry) => sum + entry.weight, 0);
      const short = boat.rank < ground.minRank;
      return {
        groundId: ground.id,
        name: groundName(translate, ground.id),
        minutes: Math.round(ground.seconds / 60),
        fish: [...ground.table].sort((a, b) => b.weight - a.weight).map((entry) => catchChip(input, entry.itemDefinitionId, Math.round((entry.weight / total) * 100))),
        expected: Math.max(1, Math.min(boat.hold, Math.round(boat.hold * ground.catchShare))),
        action: {
          kind: "TRIP",
          icon: short ? "lock" : "sail",
          label: short ? translate("fleet.rankNeeded", { rank: ground.minRank }) : translate("fleet.action.setOut"),
          hint: groundName(translate, ground.id),
          enabled: !short,
          primary: !short,
          cost: [],
          lockLevel: null,
          shipId: boat.shipId,
          groundId: ground.id
        }
      };
    })
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

/** Whether a ship can fight a monster: one of the player's own, with guns (the server checks again). */
function armed(ship: FleetShip): boolean {
  return !ship.lent && ship.cannons > 0;
}

/** At its dock, afloat and not out fishing: free to set out for a fight now. */
function readyToFight(ship: FleetShip): boolean {
  return armed(ship) && !ship.away && ship.trip === null && ship.hull > 0;
}

function monsterName(translate: Translate, monsterId: string): string {
  return translate(`pirate.${monsterId}` as MessageKey);
}

/** Time to the next roster: hours and minutes, or minutes alone in the last hour. */
function renewsIn(translate: Translate, endsAt: string, nowMs: number): string {
  const minutes = Math.max(1, Math.ceil((Date.parse(endsAt) - nowMs) / 60_000));
  return minutes >= 60
    ? translate("fleet.hunt.endsHours", { hours: Math.floor(minutes / 60), minutes: minutes % 60 })
    : translate("fleet.hunt.endsMinutes", { minutes });
}

/**
 * The sea-monster page: the roster's cards (picture, level, what a win pays and drops, and the fight
 * button), the warships to fight with, and every material with its merge arrows. A fight planned and
 * not yet fought is resumed with its own ship, and holds every other card back.
 */
function huntsDetail(input: ShipPanelInput, pickedShipId: string | null): HuntsModel {
  const { fleet, translate } = input;
  const hunts = input.hunts ?? null;
  const open = hunts?.hunt ?? null;
  const candidates = fleet.ships.filter(armed);
  const picked = candidates.find((ship) => ship.shipId === pickedShipId) ?? null;
  const fighter =
    open !== null
      ? (fleet.ships.find((ship) => ship.shipId === open.shipId) ?? null)
      : (picked ?? [...candidates].sort((a, b) => Number(readyToFight(b)) - Number(readyToFight(a)) || b.rank - a.rank || b.hull - a.hull)[0] ?? null);
  const ready = fighter !== null && readyToFight(fighter);
  let warning: string | null = null;
  if (fighter === null) warning = translate("fleet.hunt.needWarship");
  else if (open === null && fighter.hull <= 0) warning = translate("fleet.warn.sunk");
  else if (open === null && !ready) warning = translate("fleet.hunt.fighterAway");

  const cards: HuntCardModel[] = (hunts?.monsters ?? []).map((monster) => {
    const isOpen = open !== null && open.slot === monster.slot;
    const held = open !== null && !isOpen;
    const enabled = isOpen || (!monster.defeated && !held && ready);
    const label = isOpen ? "fleet.hunt.resume" : monster.defeated ? "fleet.hunt.beaten" : "fleet.hunt.fight";
    return {
      slot: monster.slot,
      name: monsterName(translate, monster.monsterId),
      level: monster.level,
      modelId: monster.monsterId,
      defeated: monster.defeated,
      open: isOpen,
      gold: monster.reward.gold,
      xp: monster.reward.xp,
      drops: monster.reward.materials.map((entry) => ({ ...itemChip(input, null, entry.itemDefinitionId, entry.quantity), short: false })),
      action: {
        kind: "HUNT",
        icon: "fight",
        label: translate(label),
        hint: held ? translate("fleet.hunt.finishOpen") : monsterName(translate, monster.monsterId),
        enabled,
        primary: enabled,
        cost: [],
        lockLevel: null,
        slot: monster.slot,
        ...(fighter === null ? {} : { shipId: isOpen ? open.shipId : fighter.shipId })
      }
    };
  });

  const materials = MONSTER_KIND_DEFINITIONS.map((definition) => ({
    kind: definition.kind,
    name: monsterName(translate, definition.id),
    cells: MONSTER_LEVELS.map((level): MaterialCellModel => {
      const itemDefinitionId = monsterMaterialId(definition.kind, level.level);
      const name = input.itemName?.(itemDefinitionId) ?? itemDefinitionId;
      const have = input.holdings?.count === undefined ? null : input.holdings.count(itemDefinitionId);
      return {
        itemDefinitionId,
        name,
        level: level.level,
        have,
        merge:
          level.level >= MAX_MONSTER_LEVEL
            ? null
            : {
                kind: "MERGE",
                icon: "upgrade",
                label: translate("fleet.hunt.merge"),
                hint: translate("fleet.hunt.mergeHint", { count: MATERIAL_MERGE_COUNT, name }),
                enabled: have !== null && have >= MATERIAL_MERGE_COUNT,
                primary: false,
                cost: [],
                lockLevel: null,
                itemDefinitionId
              }
      };
    })
  }));

  return {
    kind: "HUNTS",
    loading: hunts === null,
    fighters: candidates.map((ship) => ({
      shipId: ship.shipId,
      name: className(translate, ship.classId),
      modelId: modelOf(ship.classId, ship.tier),
      hull: ship.hullMax <= 0 ? 0 : Math.max(0, Math.min(1, ship.hull / ship.hullMax)),
      selected: fighter !== null && fighter.shipId === ship.shipId,
      ready: readyToFight(ship)
    })),
    warning,
    renews: hunts === null ? null : renewsIn(translate, hunts.endsAt, input.serverNowMs),
    cards,
    materials
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
  /** Fills an item's picture (a fish), as the warehouse draws it; else the item's model is used. */
  readonly itemPicture?: (itemDefinitionId: string, image: HTMLImageElement) => void;
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
  const huntBadge = element("button", "fl-dock fl-hunts");
  huntBadge.type = "button";
  huntBadge.title = translate("fleet.hunts");
  const closeButton = element("button", "panel-close fl-close");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", translate("shipPanel.close"));
  closeButton.title = translate("shipPanel.close");
  closeButton.appendChild(createIcon("close", 18));
  head.replaceChildren(title, huntBadge, dockBadge, closeButton);
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

  /** An item's picture, drawn the warehouse's way when the host can, and kept across redraws. */
  function itemImage(key: string, entry: { readonly itemDefinitionId: string; readonly name: string; readonly modelId?: string }, className: string): HTMLImageElement {
    const draw = options.itemPicture;
    if (draw === undefined) return picture(key, entry.modelId ?? entry.itemDefinitionId, className);
    const known = pictures.get(key);
    if (known !== undefined && known.modelId === entry.itemDefinitionId) {
      known.image.className = className;
      return known.image;
    }
    const image = element("img", className);
    image.alt = entry.name;
    image.draggable = false;
    draw(entry.itemDefinitionId, image);
    pictures.set(key, { modelId: entry.itemDefinitionId, image });
    return image;
  }

  /**
   * A price or a drop as chips: resources as icons, items (monster materials) as their pictures. An
   * item chip with a known stock reads "have/need", and turns red when short.
   */
  function chipsOf(cost: readonly CostChip[], key: string, needs = false): HTMLSpanElement {
    const row = element("span", `fl-cost${needs ? " is-needs" : ""}`);
    for (const chip of cost) {
      const node = element("span", `fl-chip${chip.short ? " is-short" : ""}${chip.icon === "item" ? " is-item" : ""}`);
      if (chip.icon === "item" && chip.itemDefinitionId !== undefined) {
        node.title = chip.name ?? chip.itemDefinitionId;
        const amount = needs && chip.have != null ? `${formatAmount(chip.have)}/${formatAmount(chip.amount)}` : `×${formatAmount(chip.amount)}`;
        put(node, itemImage(`${key}:${chip.itemDefinitionId}`, { itemDefinitionId: chip.itemDefinitionId, name: chip.name ?? chip.itemDefinitionId }, "fl-chip-picture"), element("span", "fl-chip-amount", amount));
      } else {
        put(node, icon(chip.icon === "item" ? "plus" : chip.icon, "fl-chip-icon"), element("span", "fl-chip-amount", formatAmount(chip.amount)));
      }
      row.appendChild(node);
    }
    return row;
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
    // Resources ride on the button; items (monster materials) are drawn beside it, with their stock.
    const resources = action.cost.filter((chip) => chip.icon !== "item");
    if (resources.length > 0 && action.lockLevel === null) button.appendChild(chipsOf(resources, `button:${action.kind}`));
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
      const needs = model.upgrade.action.cost.filter((chip) => chip.icon === "item");
      if (needs.length > 0 && model.upgrade.action.lockLevel === null) {
        const row = element("div", "fl-needs");
        row.title = translate("fleet.upgradeMaterials");
        put(row, icon("monster", "fl-needs-icon"), chipsOf(needs, `needs:${model.key}`, true));
        upgrade.appendChild(row);
      }
      info.appendChild(upgrade);
    }
    if (model.tripShare !== null) {
      const bar = element("div", "fl-trip");
      const fill = element("span", "fl-trip-fill");
      fill.style.width = `${String(Math.round(model.tripShare * 100))}%`;
      bar.appendChild(fill);
      put(bar, icon("fish", "fl-trip-boat"));
      bar.lastElementChild?.setAttribute("style", `left: calc(${String(Math.round(model.tripShare * 100))}% - 14px)`);
      put(info, bar);
    }
    if (model.catch.length > 0) put(info, catchRow(model.catch, `catch:${model.key}`));
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

  /** Fish as pictures with their counts (or, on a ground's card, their share in per cent). */
  function catchRow(fish: readonly CatchChip[], key: string, percent = false): HTMLDivElement {
    const row = element("div", `fl-catch${percent ? " is-odds" : ""}`);
    for (const entry of fish) {
      const chip = element("span", "fl-catch-chip");
      chip.title = entry.name;
      put(chip, itemImage(`${key}:${entry.itemDefinitionId}`, entry, "fl-catch-picture"), element("span", "fl-catch-count", percent ? `${String(entry.quantity)}%` : `×${String(entry.quantity)}`));
      row.appendChild(chip);
    }
    return row;
  }

  function renderGrounds(model: GroundsModel): HTMLElement[] {
    const heading = element("div", "fl-grounds-head");
    put(heading, picture(`grounds:${model.shipId}`, model.modelId, "fl-grounds-boat"), element("h3", "fl-heading", `${translate("fleet.grounds")} · ${model.boatName}`));
    const cards = element("div", "fl-yard fl-grounds");
    model.cards.forEach((card, index) => {
      const node = element("div", `fl-yard-card fl-ground is-depth-${String(index)}${card.action.enabled ? "" : " is-locked"}`);
      const top = element("div", "fl-ground-sea");
      const time = element("span", "fl-ground-time");
      put(time, icon("clock", "fl-ground-clock"), element("span", "", `${String(card.minutes)}′`));
      put(top, element("span", "fl-yard-name", card.name), time);
      const expected = element("span", "fl-ground-expected");
      put(expected, icon("fish", "fl-ground-fish"), element("span", "", translate("fleet.expected", { count: card.expected })));
      put(node, top, catchRow(card.fish, `ground:${card.groundId}`, true), expected, actionButton(card.action));
      cards.appendChild(node);
    });
    return [heading, cards];
  }

  function renderHunts(model: HuntsModel): HTMLElement[] {
    const head = element("div", "fl-hunts-head");
    put(head, icon("monster", "fl-hunts-icon"), element("h3", "fl-heading", translate("fleet.hunts")));
    if (model.renews !== null) {
      const renews = element("span", "fl-hunts-renews");
      put(renews, icon("clock", "fl-ground-clock"), element("span", "", model.renews));
      head.appendChild(renews);
    }
    const nodes: HTMLElement[] = [head];
    // The warships, as small pictures: the lit one fights.
    if (model.fighters.length > 0) {
      const fighters = element("div", "fl-fighters");
      fighters.setAttribute("aria-label", translate("fleet.hunt.fighter"));
      for (const ship of model.fighters) {
        const chip = element("button", `fl-fighter${ship.selected ? " is-selected" : ""}${ship.ready ? "" : " is-away"}`);
        chip.type = "button";
        chip.title = ship.name;
        chip.disabled = busy;
        const bar = element("span", "fl-tile-hull");
        const fill = element("span", `fl-tile-hull-fill${ship.hull < 0.35 ? " is-low" : ""}`);
        fill.style.width = `${String(Math.round(ship.hull * 100))}%`;
        bar.appendChild(fill);
        put(chip, picture(`fighter:${ship.shipId}`, ship.modelId, "fl-fighter-picture"), bar);
        chip.addEventListener("click", () => {
          select({ kind: "HUNTS", shipId: ship.shipId });
        });
        fighters.appendChild(chip);
      }
      nodes.push(fighters);
    }
    if (model.warning !== null) {
      const warning = element("p", "fl-warning");
      put(warning, icon("lock", "fl-warning-icon"), element("span", "", model.warning));
      nodes.push(warning);
    }
    if (model.loading) {
      nodes.push(element("p", "fl-note", translate("fleet.hunt.loading")));
      return nodes;
    }
    const cards = element("div", "fl-yard fl-monsters");
    for (const card of model.cards) {
      const node = element("div", `fl-yard-card fl-monster is-level-${String(card.level)}${card.defeated ? " is-beaten" : ""}${card.open ? " is-open" : ""}`);
      const pictureBox = element("div", "fl-yard-picture fl-monster-picture");
      pictureBox.appendChild(picture(`monster:${String(card.slot)}`, card.modelId, "fl-yard-image"));
      pictureBox.appendChild(element("span", `fl-monster-level is-level-${String(card.level)}`, translate("fleet.hunt.level", { level: card.level })));
      if (card.defeated) pictureBox.appendChild(element("span", "fl-monster-stamp", translate("fleet.hunt.beaten")));
      const reward = element("div", "fl-monster-reward");
      const gold = element("span", "fl-chip");
      put(gold, icon("gold", "fl-chip-icon"), element("span", "fl-chip-amount", formatAmount(card.gold)));
      const xp = element("span", "fl-chip");
      put(xp, icon("xp", "fl-chip-icon"), element("span", "fl-chip-amount", formatAmount(card.xp)));
      put(reward, gold, xp, chipsOf(card.drops, `drop:${String(card.slot)}`));
      put(node, pictureBox, element("span", "fl-yard-name", card.name), reward, actionButton(card.action));
      cards.appendChild(node);
    }
    nodes.push(cards);

    // The materials: one row per monster, its three levels with the merge arrows between them.
    const bag = element("div", "fl-materials");
    bag.appendChild(element("h4", "fl-materials-title", translate("fleet.hunt.materials")));
    const grid = element("div", "fl-materials-grid");
    for (const row of model.materials) {
      const line = element("div", "fl-material-row");
      line.title = row.name;
      row.cells.forEach((cell) => {
        const box = element("span", `fl-material${cell.have === 0 ? " is-empty" : ""}`);
        box.title = cell.name;
        put(box, itemImage(`material:${cell.itemDefinitionId}`, cell, "fl-material-picture"), element("span", "fl-material-count", cell.have === null ? "–" : formatAmount(cell.have)));
        line.appendChild(box);
        if (cell.merge !== null) {
          const merge = cell.merge;
          const arrow = element("button", "fl-merge");
          arrow.type = "button";
          arrow.dataset.action = merge.kind;
          arrow.title = merge.hint;
          arrow.disabled = busy || !merge.enabled;
          put(arrow, element("span", "fl-merge-count", `${String(MATERIAL_MERGE_COUNT)}→1`), element("span", "fl-merge-label", merge.label));
          arrow.addEventListener("click", () => {
            void run(merge);
          });
          line.appendChild(arrow);
        }
      });
      grid.appendChild(line);
    }
    bag.appendChild(grid);
    nodes.push(bag);
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
    huntBadge.replaceChildren(icon("monster", "fl-dock-icon"), ...(model.hunts.alive === null ? [] : [element("span", "fl-dock-text", String(model.hunts.alive))]));
    huntBadge.classList.toggle("is-selected", model.hunts.selected);
    huntBadge.classList.toggle("can-grow", (model.hunts.alive ?? 0) > 0);
    huntBadge.disabled = busy;
    berthRow.replaceChildren(
      ...model.berths.map((berth) => {
        const tile = element("button", `fl-tile is-${berth.kind.toLowerCase()}${berth.selected ? " is-selected" : ""}${berth.away || berth.fishing === false ? " is-away" : ""}`);
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
          if (berth.fishing !== null) tile.appendChild(icon("fish", `fl-tile-fishing${berth.fishing ? " is-back" : ""}`));
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
    const content =
      model.detail.kind === "SHIP"
        ? renderShip(model.detail)
        : model.detail.kind === "SHIPYARD"
          ? renderShipyard(model.detail)
          : model.detail.kind === "GROUNDS"
            ? renderGrounds(model.detail)
            : model.detail.kind === "HUNTS"
              ? renderHunts(model.detail)
              : renderDock(model.detail);
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
    // Choosing a ground is the panel's own page, not a request.
    if (action.kind === "FISH" && action.shipId !== undefined) {
      select({ kind: "GROUNDS", shipId: action.shipId });
      return;
    }
    if (action.kind === "HUNTS") {
      select({ kind: "HUNTS", shipId: action.shipId ?? null });
      return;
    }
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
  huntBadge.addEventListener("click", () => {
    select({ kind: "HUNTS", shipId: null });
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
