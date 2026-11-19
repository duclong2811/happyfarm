import {
  createSeaBattle,
  SEA_BATTLE_ACTIONS,
  SEA_BATTLE_MAX_INPUTS,
  SEA_BATTLE_TICK_HZ,
  seaBattleResult,
  stepSeaBattle,
  type SeaBattleAction,
  type SeaBattleResult,
  type SeaBattleSetup,
  type SeaBattleShip,
  type SeaBattleState
} from "@happy-farm/domain";
import type { MessageKey } from "./i18n";
import { createBattleScene, type BattleScene } from "./render/battle-scene";

/**
 * A pirate ambush, fought on the player's device (docs/design/NAVAL.md, W5c; ADR 0031).
 *
 * The device steps the shared simulation at its fixed rate and records only the player's orders, as
 * [tick, action] pairs. When the fight ends, or the player hands it to the crew, the orders go to the
 * server in one request; the server replays the same fight and its outcome is the one that stands.
 */

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/**
 * The player's orders, gathered between ticks and kept as the wire carries them. Only orders that
 * change something are kept - a rudder already hard over, or a broadside whose guns are still
 * loading, is not an order - so a fight's record stays small.
 */
export class BattleOrders {
  private pending: SeaBattleAction[] = [];
  readonly recorded: [number, number][] = [];

  give(action: SeaBattleAction, ship: SeaBattleShip | undefined): void {
    if (ship === undefined || !ship.alive) return;
    if (this.recorded.length + this.pending.length >= SEA_BATTLE_MAX_INPUTS) return;
    const unchanged =
      (action === "RUDDER_LEFT" && ship.rudder === -1) ||
      (action === "RUDDER_CENTER" && ship.rudder === 0) ||
      (action === "RUDDER_RIGHT" && ship.rudder === 1) ||
      (action === "SAIL_DOWN" && ship.sail === 0) ||
      (action === "SAIL_HALF" && ship.sail === 1) ||
      (action === "SAIL_FULL" && ship.sail === 2) ||
      (action === "FIRE_PORT" && (ship.reloadPort > 0 || ship.spec.cannons <= 0)) ||
      (action === "FIRE_STARBOARD" && (ship.reloadStarboard > 0 || ship.spec.cannons <= 0));
    if (unchanged || this.pending.includes(action)) return;
    this.pending.push(action);
  }

  /** The orders for the tick about to be stepped, recorded with it. */
  take(tick: number): SeaBattleAction[] {
    const actions = this.pending;
    this.pending = [];
    for (const action of actions) this.recorded.push([tick, SEA_BATTLE_ACTIONS.indexOf(action)]);
    return actions;
  }
}

export interface BattleViewOptions {
  readonly host: HTMLElement;
  readonly translate: Translate;
  readonly setup: SeaBattleSetup;
  /** Pirate ids, for their names. */
  readonly pirates: readonly string[];
  /** Sends the recorded orders; resolves with the server's own result (null if it was already decided). */
  readonly submit: (inputs: readonly [number, number][]) => Promise<SeaBattleResult | null>;
  readonly describeError: (error: unknown) => string;
  readonly onClose: () => void;
}

export interface BattleView {
  close(): void;
}

const KEYS: Readonly<Record<string, SeaBattleAction | "SAIL_UP" | "SAIL_DOWN_ONE">> = {
  a: "RUDDER_LEFT",
  arrowleft: "RUDDER_LEFT",
  d: "RUDDER_RIGHT",
  arrowright: "RUDDER_RIGHT",
  w: "SAIL_UP",
  arrowup: "SAIL_UP",
  s: "SAIL_DOWN_ONE",
  arrowdown: "SAIL_DOWN_ONE",
  q: "FIRE_PORT",
  e: "FIRE_STARBOARD"
};

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
  root.setAttribute("aria-label", translate("battle.title"));
  const canvas = document.createElement("canvas");
  canvas.className = "bv-canvas";
  canvas.setAttribute("aria-hidden", "true");

  const top = document.createElement("div");
  top.className = "bv-top";
  const title = document.createElement("h2");
  title.textContent = translate("battle.title");
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
  const firePort = button(translate("battle.firePort"), "bv-fire bv-fire-port", () => {
    orders.give("FIRE_PORT", state.ships[0]);
  });
  const fireStarboard = button(translate("battle.fireStarboard"), "bv-fire bv-fire-starboard", () => {
    orders.give("FIRE_STARBOARD", state.ships[0]);
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
    fireStarboard
  );

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
  end.replaceChildren(endTitle, endText, endButton);

  const crew = document.createElement("button");
  crew.type = "button";
  crew.className = "bv-crew";
  crew.textContent = translate("battle.leaveToCrew");
  crew.addEventListener("click", () => {
    void finish();
  });

  root.replaceChildren(canvas, top, controls, crew, end);
  host.appendChild(root);
  let scene: BattleScene | null = null;
  try {
    scene = createBattleScene(canvas, state);
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
      firePort.disabled = me.reloadPort > 0 || me.spec.cannons <= 0;
      fireStarboard.disabled = me.reloadStarboard > 0 || me.spec.cannons <= 0;
      firePort.style.setProperty("--reload", String(me.reloadPort / 60));
      fireStarboard.style.setProperty("--reload", String(me.reloadStarboard / 60));
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
    const local = state.outcome === null ? null : seaBattleResult(state);
    try {
      const verdict = (await options.submit(orders.recorded)) ?? local;
      const outcome = verdict?.outcome ?? "TIMEOUT";
      endTitle.textContent = translate(`battle.outcome.${outcome}` as MessageKey);
      endText.textContent = translate("battle.hullLeft", { hull: verdict?.playerHull ?? 0, hullMax: options.setup.player.hullMax });
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
    if (mapped === undefined || ship === undefined || event.repeat) return;
    event.preventDefault();
    if (mapped === "SAIL_UP") orders.give(sailStep(ship, true), ship);
    else if (mapped === "SAIL_DOWN_ONE") orders.give(sailStep(ship, false), ship);
    else orders.give(mapped, ship);
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    const mapped = KEYS[event.key.toLowerCase()];
    if (mapped === "RUDDER_LEFT" || mapped === "RUDDER_RIGHT") orders.give("RUDDER_CENTER", state.ships[0]);
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
