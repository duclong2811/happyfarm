import {
  broadsidePower,
  createSeaBattle,
  previewBroadside,
  SEA_BATTLE_ACTIONS,
  SEA_BATTLE_AIM_LIMIT,
  SEA_BATTLE_MAX_INPUTS,
  SEA_BATTLE_OAR_REST_TICKS,
  SEA_BATTLE_RELOAD_TICKS,
  SEA_BATTLE_TICK_HZ,
  SEA_BATTLE_TURN_UNITS,
  seaBattleResult,
  stepSeaBattle,
  type SeaBattleAction,
  type SeaBattleSide,
  type SeaBattleResult,
  type SeaBattleSetup,
  type SeaBattleShip,
  type SeaBattleState
} from "@happy-farm/domain";
import type { MessageKey } from "./i18n";
import type { Object3D } from "three";
import { createBattleScene, type BattleScene } from "./render/battle-scene";
import { shipModelId } from "./render/ship-models";

/**
 * A pirate ambush, fought on the player's device (docs/design/NAVAL.md, W5c; ADR 0031).
 *
 * The device steps the shared simulation at its fixed rate and records only the player's orders, as
 * [tick, action] pairs. When the fight ends, or the player hands it to the crew, the orders go to the
 * server in one request; the server replays the same fight and its outcome is the one that stands.
 */

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** One order as the simulation takes it: the action, and a broadside's aim off the beam. */
export interface BattleOrder {
  readonly action: SeaBattleAction;
  readonly aim?: number;
}

/**
 * The player's orders, gathered between ticks and kept as the wire carries them: [tick, action], or
 * [tick, action, aim] for a broadside. Only orders that change something are kept - a rudder already
 * hard over, a charge on guns still loading, oars the crew cannot pull yet - so a fight's record
 * stays small. A broadside's power is not recorded: the simulation measures it from the charge.
 */
export class BattleOrders {
  private pending: BattleOrder[] = [];
  readonly recorded: ([number, number] | [number, number, number])[] = [];

  give(action: SeaBattleAction, ship: SeaBattleShip | undefined, aim?: number): void {
    if (ship === undefined || !ship.alive) return;
    if (this.recorded.length + this.pending.length >= SEA_BATTLE_MAX_INPUTS) return;
    const unarmed = ship.spec.cannons <= 0;
    const unchanged =
      (action === "RUDDER_LEFT" && ship.rudder === -1) ||
      (action === "RUDDER_CENTER" && ship.rudder === 0) ||
      (action === "RUDDER_RIGHT" && ship.rudder === 1) ||
      (action === "SAIL_DOWN" && ship.sail === 0) ||
      (action === "SAIL_HALF" && ship.sail === 1) ||
      (action === "SAIL_FULL" && ship.sail === 2) ||
      (action === "CHARGE_PORT" && (unarmed || ship.reloadPort > 0 || ship.chargePort >= 0)) ||
      (action === "CHARGE_STARBOARD" && (unarmed || ship.reloadStarboard > 0 || ship.chargeStarboard >= 0)) ||
      (action === "FIRE_PORT" && (unarmed || ship.reloadPort > 0)) ||
      (action === "FIRE_STARBOARD" && (unarmed || ship.reloadStarboard > 0)) ||
      (action === "OARS" && (ship.oars > 0 || ship.oarRest > 0));
    if (unchanged || this.pending.some((order) => order.action === action)) return;
    const firing = action === "FIRE_PORT" || action === "FIRE_STARBOARD";
    const laid = firing && aim !== undefined ? Math.max(-SEA_BATTLE_AIM_LIMIT, Math.min(SEA_BATTLE_AIM_LIMIT, Math.round(aim))) : undefined;
    this.pending.push(laid === undefined || laid === 0 ? { action } : { action, aim: laid });
  }

  /** The orders for the tick about to be stepped, recorded with it. */
  take(tick: number): BattleOrder[] {
    const orders = this.pending;
    this.pending = [];
    for (const order of orders) {
      const index = SEA_BATTLE_ACTIONS.indexOf(order.action);
      this.recorded.push(order.aim === undefined ? [tick, index] : [tick, index, order.aim]);
    }
    return orders;
  }
}

export interface BattleViewOptions {
  readonly host: HTMLElement;
  readonly translate: Translate;
  readonly setup: SeaBattleSetup;
  /** Pirate ids, for their names and models. */
  readonly pirates: readonly string[];
  /** The player's ship class id, for its model. */
  readonly playerShip: string;
  /** The heading over the fight, when it is not pirates (a sea monster). */
  readonly title?: string;
  /** Loads a ship model (the shared model library); without it the fight draws block ships. */
  readonly loadModel?: (modelId: string) => Promise<Object3D | null>;
  /**
   * Sends the recorded orders; resolves with the server's own result (null if it was already decided)
   * and, for a won fight, a line saying what the server paid for it.
   */
  readonly submit: (inputs: readonly ([number, number] | [number, number, number])[]) => Promise<{ readonly battle: SeaBattleResult | null; readonly spoils: string | null }>;
  readonly describeError: (error: unknown) => string;
  readonly onClose: () => void;
}

export interface BattleView {
  close(): void;
}

type KeyOrder = "RUDDER_LEFT" | "RUDDER_RIGHT" | "SAIL_UP" | "SAIL_DOWN_ONE" | "PORT" | "STARBOARD" | "OARS" | "AIM_AFT" | "AIM_FORE";

const KEYS: Readonly<Record<string, KeyOrder>> = {
  a: "RUDDER_LEFT",
  arrowleft: "RUDDER_LEFT",
  d: "RUDDER_RIGHT",
  arrowright: "RUDDER_RIGHT",
  w: "SAIL_UP",
  arrowup: "SAIL_UP",
  s: "SAIL_DOWN_ONE",
  arrowdown: "SAIL_DOWN_ONE",
  q: "PORT",
  e: "STARBOARD",
  " ": "OARS",
  shift: "OARS",
  z: "AIM_AFT",
  c: "AIM_FORE"
};

/** Heading units a key press, or a pixel of a finger's slide, swings the aim. */
const AIM_KEY_STEP = 40;
const AIM_PER_PIXEL = 2.5;

/** The wind's strength as a word: the simulation's push runs from about 1.75 to 7. */
function windWord(strength: number): "battle.windLight" | "battle.windModerate" | "battle.windStrong" {
  return strength < 3.5 ? "battle.windLight" : strength < 5.5 ? "battle.windModerate" : "battle.windStrong";
}

function sailStep(ship: SeaBattleShip, up: boolean): SeaBattleAction {
  const next = Math.max(0, Math.min(2, ship.sail + (up ? 1 : -1)));
  return next === 0 ? "SAIL_DOWN" : next === 1 ? "SAIL_HALF" : "SAIL_FULL";
}

export function openBattleView(options: BattleViewOptions): BattleView {
  const { host, translate } = options;
  const state: SeaBattleState = createSeaBattle(options.setup);
  const orders = new BattleOrders();
  let previous = state.ships.map((ship) => ({ x: ship.x, z: ship.z, heading: ship.heading }));
  let closed = false;
  let submitted = false;
  let frame: number | null = null;
  let lastMs = performance.now();
  let carry = 0;
  const tickMs = 1000 / SEA_BATTLE_TICK_HZ;

  const root = document.createElement("div");
  root.id = "battle-view";
  root.className = "battle-view";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-label", options.title ?? translate("battle.title"));
  const canvas = document.createElement("canvas");
  canvas.className = "bv-canvas";
  canvas.setAttribute("aria-hidden", "true");

  const top = document.createElement("div");
  top.className = "bv-top";
  const title = document.createElement("h2");
  title.textContent = options.title ?? translate("battle.title");
  const hulls = document.createElement("div");
  hulls.className = "bv-hulls";
  const bar = (label: string, mine: boolean): { row: HTMLElement; fill: HTMLElement; text: HTMLElement } => {
    const row = document.createElement("div");
    row.className = mine ? "bv-hull bv-hull-mine" : "bv-hull";
    const name = document.createElement("span");
    name.textContent = label;
    const track = document.createElement("span");
    track.className = "bv-track";
    const fill = document.createElement("span");
    fill.className = "bv-fill";
    track.appendChild(fill);
    const text = document.createElement("span");
    text.className = "bv-hull-text";
    row.appendChild(name);
    row.appendChild(track);
    row.appendChild(text);
    return { row, fill, text };
  };
  const bars = [
    bar(translate("battle.yourShip"), true),
    ...options.pirates.map((id) => bar(translate(`pirate.${id}` as MessageKey), false))
  ];
  hulls.replaceChildren(...bars.map((entry) => entry.row));
  const hint = document.createElement("p");
  hint.className = "bv-hint";
  hint.textContent = translate("battle.keys");
  top.replaceChildren(title, hulls, hint);

  const controls = document.createElement("div");
  controls.className = "bv-controls";
  const button = (label: string, className: string, act: () => void, hold = false): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    if (hold) {
      element.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        act();
      });
      const release = (): void => {
        orders.give("RUDDER_CENTER", state.ships[0]);
      };
      element.addEventListener("pointerup", release);
      element.addEventListener("pointerleave", release);
      element.addEventListener("pointercancel", release);
    } else {
      element.addEventListener("click", act);
    }
    return element;
  };
  // Aiming, the Gunny way: hold a side's fire to charge it, slide (or Z/C) to swing the aim along the
  // beam, let go to fire. The charge itself is the simulation's, measured from the tick it began.
  let aim = 0;
  let charging: SeaBattleSide | null = null;
  const charge = (side: SeaBattleSide): void => {
    const ship = state.ships[0];
    if (ship === undefined || charging !== null) return;
    if (side === "PORT" ? ship.reloadPort > 0 : ship.reloadStarboard > 0) return;
    charging = side;
    orders.give(side === "PORT" ? "CHARGE_PORT" : "CHARGE_STARBOARD", ship);
  };
  // After a broadside the camera stays over that beam a moment, so the player sees where it falls.
  let watching: { side: SeaBattleSide; until: number } | null = null;
  const release = (side: SeaBattleSide): void => {
    if (charging !== side) return;
    charging = null;
    watching = { side, until: performance.now() + 1800 };
    orders.give(side === "PORT" ? "FIRE_PORT" : "FIRE_STARBOARD", state.ships[0], aim);
  };
  const swing = (units: number): void => {
    aim = Math.max(-SEA_BATTLE_AIM_LIMIT, Math.min(SEA_BATTLE_AIM_LIMIT, aim + units));
  };
  const fireButton = (side: SeaBattleSide): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = side === "PORT" ? "bv-fire bv-fire-port" : "bv-fire bv-fire-starboard";
    const label = document.createElement("span");
    label.textContent = translate(side === "PORT" ? "battle.firePort" : "battle.fireStarboard");
    const power = document.createElement("span");
    power.className = "bv-power";
    element.replaceChildren(label, power);
    let startX = 0;
    let startAim = 0;
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      element.setPointerCapture(event.pointerId);
      startX = event.clientX;
      startAim = aim;
      charge(side);
    });
    // Sliding the held finger right swings the shot toward the bow, left toward the stern.
    element.addEventListener("pointermove", (event) => {
      if (charging !== side) return;
      aim = Math.max(-SEA_BATTLE_AIM_LIMIT, Math.min(SEA_BATTLE_AIM_LIMIT, startAim + (event.clientX - startX) * AIM_PER_PIXEL * (side === "PORT" ? 1 : -1)));
    });
    const letGo = (): void => {
      release(side);
    };
    element.addEventListener("pointerup", letGo);
    element.addEventListener("pointercancel", letGo);
    return element;
  };
  const firePort = fireButton("PORT");
  const fireStarboard = fireButton("STARBOARD");
  const oars = button(translate("battle.oars"), "bv-oars", () => {
    orders.give("OARS", state.ships[0]);
  });
  const sailText = document.createElement("span");
  sailText.className = "bv-sail";
  controls.replaceChildren(
    firePort,
    button("◀", "bv-rudder", () => {
      orders.give("RUDDER_LEFT", state.ships[0]);
    }, true),
    button("−", "bv-sail-button", () => {
      const ship = state.ships[0];
      if (ship !== undefined) orders.give(sailStep(ship, false), ship);
    }),
    sailText,
    button("+", "bv-sail-button", () => {
      const ship = state.ships[0];
      if (ship !== undefined) orders.give(sailStep(ship, true), ship);
    }),
    button("▶", "bv-rudder", () => {
      orders.give("RUDDER_RIGHT", state.ships[0]);
    }, true),
    oars,
    fireStarboard
  );

  // The wind, as the player's own ship meets it: an arrow turned to the ship's heading, and a word.
  const wind = document.createElement("div");
  wind.className = "bv-wind";
  const windArrow = document.createElement("span");
  windArrow.className = "bv-wind-arrow";
  windArrow.textContent = "➤";
  const windText = document.createElement("span");
  windText.textContent = translate(windWord(state.wind.strength));
  wind.replaceChildren(windArrow, windText);

  const end = document.createElement("div");
  end.className = "bv-end";
  end.hidden = true;
  const endTitle = document.createElement("h3");
  const endText = document.createElement("p");
  const endButton = document.createElement("button");
  endButton.type = "button";
  endButton.className = "primary";
  endButton.textContent = translate("battle.continue");
  endButton.addEventListener("click", () => {
    close();
  });
  // What a won fight paid, as the server decided it: never a number this view works out.
  const endSpoils = document.createElement("p");
  endSpoils.className = "bv-spoils";
  endSpoils.hidden = true;
  end.replaceChildren(endTitle, endText, endSpoils, endButton);

  const crew = document.createElement("button");
  crew.type = "button";
  crew.className = "bv-crew";
  crew.textContent = translate("battle.leaveToCrew");
  crew.addEventListener("click", () => {
    void finish();
  });

  root.replaceChildren(canvas, top, wind, controls, crew, end);
  host.appendChild(root);
  let scene: BattleScene | null = null;
  try {
    const models = [shipModelId(options.playerShip), ...options.pirates.map(shipModelId)];
    scene = createBattleScene(canvas, state, options.loadModel === undefined ? undefined : { ids: models, load: options.loadModel });
  } catch {
    scene = null;
  }

  function updateHud(): void {
    state.ships.forEach((ship, index) => {
      const entry = bars[index];
      if (entry === undefined) return;
      const share = Math.max(0, ship.hull) / ship.spec.hullMax;
      entry.fill.style.width = `${String(Math.round(share * 100))}%`;
      entry.text.textContent = `${String(Math.max(0, ship.hull))}/${String(ship.spec.hullMax)}`;
      entry.row.classList.toggle("is-sunk", !ship.alive);
    });
    const me = state.ships[0];
    if (me !== undefined) {
      sailText.textContent = translate(me.sail === 0 ? "battle.sailDown" : me.sail === 1 ? "battle.sailHalf" : "battle.sailFull");
      firePort.disabled = me.spec.cannons <= 0;
      fireStarboard.disabled = me.spec.cannons <= 0;
      firePort.classList.toggle("is-loading", me.reloadPort > 0);
      fireStarboard.classList.toggle("is-loading", me.reloadStarboard > 0);
      firePort.style.setProperty("--reload", String(me.reloadPort / SEA_BATTLE_RELOAD_TICKS));
      fireStarboard.style.setProperty("--reload", String(me.reloadStarboard / SEA_BATTLE_RELOAD_TICKS));
      firePort.style.setProperty("--charge", String(broadsidePower(me, "PORT", state.tick)));
      fireStarboard.style.setProperty("--charge", String(broadsidePower(me, "STARBOARD", state.tick)));
      oars.disabled = me.oars > 0 || me.oarRest > 0;
      oars.style.setProperty("--reload", String(me.oars > 0 ? 1 : me.oarRest / SEA_BATTLE_OAR_REST_TICKS));
      // The wind arrow points where the wind blows, turned so the ship's bow is up the screen.
      const relative = ((state.wind.heading - me.heading) / SEA_BATTLE_TURN_UNITS) * 360;
      windArrow.style.transform = `rotate(${String(Math.round(relative - 90))}deg)`;
    }
    // While a side is charging, the scene draws where the shot would go; it lets go of it after.
    const side = charging;
    if (watching !== null && performance.now() > watching.until) watching = null;
    if (scene !== null) {
      if (side === null && watching !== null) scene.setAim({ side: watching.side, path: [], landing: { x: 0, z: 0 } });
      else if (side === null || me === undefined) scene.setAim(null);
      else {
        const preview = previewBroadside(state, 0, side, aim, broadsidePower(me, side, state.tick));
        scene.setAim({ side, path: preview.path, landing: preview.landing });
      }
    }
  }

  function loop(now: number): void {
    if (closed) return;
    carry += Math.min(250, now - lastMs);
    lastMs = now;
    while (carry >= tickMs && state.outcome === null) {
      previous = state.ships.map((ship) => ({ x: ship.x, z: ship.z, heading: ship.heading }));
      stepSeaBattle(state, orders.take(state.tick));
      carry -= tickMs;
    }
    scene?.render(state, previous, Math.min(1, carry / tickMs));
    updateHud();
    if (state.outcome !== null && !submitted) {
      void finish();
    }
    frame = window.requestAnimationFrame(loop);
  }

  async function finish(): Promise<void> {
    if (submitted) return;
    submitted = true;
    crew.hidden = true;
    controls.classList.add("is-done");
    end.hidden = false;
    endTitle.textContent = translate("battle.sending");
    endText.textContent = "";
    endButton.disabled = true;
    // Left to the crew: the rest of the fight is played out here too, with no more orders, exactly as
    // the server will replay it - so the bars show what the server will say.
    while (state.outcome === null) stepSeaBattle(state, []);
    previous = state.ships.map((ship) => ({ x: ship.x, z: ship.z, heading: ship.heading }));
    updateHud();
    const local = seaBattleResult(state);
    try {
      const answer = await options.submit(orders.recorded);
      const verdict = answer.battle ?? local;
      endTitle.textContent = translate(`battle.outcome.${verdict.outcome}` as MessageKey);
      endText.textContent = translate("battle.hullLeft", { hull: verdict.playerHull, hullMax: options.setup.player.hullMax });
      endSpoils.textContent = answer.spoils ?? "";
      endSpoils.hidden = answer.spoils === null;
    } catch (error: unknown) {
      endTitle.textContent = translate("battle.failed");
      endText.textContent = options.describeError(error);
      submitted = false;
      crew.hidden = false;
    }
    endButton.disabled = false;
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    const mapped = KEYS[event.key.toLowerCase()];
    const ship = state.ships[0];
    if (mapped === undefined || ship === undefined) return;
    event.preventDefault();
    // Swinging the aim repeats while the key is held; every other order is one press.
    if (mapped === "AIM_AFT" || mapped === "AIM_FORE") {
      swing(mapped === "AIM_FORE" ? AIM_KEY_STEP : -AIM_KEY_STEP);
      return;
    }
    if (event.repeat) return;
    if (mapped === "SAIL_UP") orders.give(sailStep(ship, true), ship);
    else if (mapped === "SAIL_DOWN_ONE") orders.give(sailStep(ship, false), ship);
    else if (mapped === "PORT" || mapped === "STARBOARD") charge(mapped);
    else orders.give(mapped, ship);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    const mapped = KEYS[event.key.toLowerCase()];
    if (mapped === "RUDDER_LEFT" || mapped === "RUDDER_RIGHT") orders.give("RUDDER_CENTER", state.ships[0]);
    if (mapped === "PORT" || mapped === "STARBOARD") release(mapped);
  };
  const onResize = (): void => {
    scene?.resize();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("resize", onResize);

  function close(): void {
    if (closed) return;
    closed = true;
    if (frame !== null) window.cancelAnimationFrame(frame);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("resize", onResize);
    scene?.dispose();
    root.remove();
    options.onClose();
  }

  updateHud();
  frame = window.requestAnimationFrame(loop);
  return { close };
}
