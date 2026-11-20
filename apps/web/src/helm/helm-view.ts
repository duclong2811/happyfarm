import type { MessageKey } from "../i18n";
import { isTypingTarget } from "../player/input";
import {
  giveHelmOrder,
  helmOarRestShare,
  setHelmRudder,
  stepHelm,
  type HelmOrder,
  type HelmRudder,
  type HelmShip,
  type HelmState,
  type HelmWaters
} from "./helm";

/**
 * The helm's controls (docs/design/NAVAL.md, "Taking the helm"): the same rudder, sails and oars as a
 * sea battle, laid out the same way, over the island instead of an arena - and the loop that sails
 * the ship between frames. It asks nothing of the server; the host draws each pose it is handed.
 */

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

export interface HelmViewOptions {
  readonly host: HTMLElement;
  readonly translate: Translate;
  readonly ship: HelmShip;
  readonly waters: HelmWaters;
  readonly start: HelmState;
  /** Draws the ship and the camera at this pose. Called once per frame while the ship moves. */
  readonly onPose: (state: HelmState) => void;
  /** The edge of home waters reached and the player asked for the chart. */
  readonly onOpenChart: () => void;
  /** The player stepped off: the host takes the ship back to the pier. */
  readonly onLeave: () => void;
  /** The neighbour the ship lies close to, with its name, or null; asked as the ship moves. */
  readonly portAt?: (state: HelmState) => { readonly slotId: string; readonly name: string } | null;
  /** The player asked to sail for that neighbour: a real voyage, which the host requests. */
  readonly onSailTo?: (slotId: string) => void;
}

export interface HelmView {
  /** Stops sailing while something else has the screen (the chart), and starts again after. */
  setPaused(paused: boolean): void;
  close(): void;
}

const SAIL_KEYS: readonly MessageKey[] = ["battle.sailDown", "battle.sailHalf", "battle.sailFull"];

export function openHelmView(options: HelmViewOptions): HelmView {
  const { translate, ship, waters } = options;
  let state = options.start;
  let paused = false;
  let closed = false;
  let frame: number | null = null;
  let lastTime = 0;
  let signature = "";
  const held = { left: false, right: false, touchLeft: false, touchRight: false };

  const root = document.createElement("div");
  root.className = "helm-view";
  root.id = "helm-view";

  const hint = document.createElement("p");
  hint.className = "helm-hint";
  hint.textContent = translate("helm.keys");

  const notice = document.createElement("div");
  notice.className = "helm-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const noticeText = document.createElement("p");
  const chartButton = document.createElement("button");
  chartButton.type = "button";
  chartButton.className = "primary helm-chart";
  chartButton.textContent = translate("helm.openChart");
  chartButton.addEventListener("click", () => {
    options.onOpenChart();
  });
  const sailButton = document.createElement("button");
  sailButton.type = "button";
  sailButton.className = "primary helm-sail-to";
  sailButton.hidden = true;
  let port: { readonly slotId: string; readonly name: string } | null = null;
  sailButton.addEventListener("click", () => {
    if (port !== null) options.onSailTo?.(port.slotId);
  });
  notice.replaceChildren(noticeText, chartButton, sailButton);

  const controls = document.createElement("div");
  controls.className = "helm-controls";
  const button = (label: string, className: string, title: string): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.className = className;
    element.textContent = label;
    element.title = title;
    element.setAttribute("aria-label", title);
    return element;
  };
  const rudderButton = (side: "touchLeft" | "touchRight", label: string, title: string): HTMLButtonElement => {
    const element = button(label, "helm-rudder", title);
    element.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      held[side] = true;
      steer();
    });
    const release = (): void => {
      held[side] = false;
      steer();
    };
    element.addEventListener("pointerup", release);
    element.addEventListener("pointerleave", release);
    element.addEventListener("pointercancel", release);
    return element;
  };
  const order = (kind: HelmOrder): void => {
    if (paused || closed) return;
    state = giveHelmOrder(state, kind);
    render();
    wake();
  };
  const left = rudderButton("touchLeft", "◀", translate("helm.port"));
  const right = rudderButton("touchRight", "▶", translate("helm.starboard"));
  const sailDown = button("−", "helm-sail-button", translate("battle.sailDown"));
  sailDown.addEventListener("click", () => {
    order("SAIL_DOWN");
  });
  const sailUp = button("+", "helm-sail-button", translate("battle.sailFull"));
  sailUp.addEventListener("click", () => {
    order("SAIL_UP");
  });
  const sailText = document.createElement("span");
  sailText.className = "helm-sail";
  const oars = button(translate("battle.oars"), "helm-oars", translate("battle.oars"));
  oars.addEventListener("click", () => {
    order("OARS");
  });
  const leave = button(translate("helm.leave"), "helm-leave", translate("helm.leaveHint"));
  leave.addEventListener("click", () => {
    options.onLeave();
  });
  controls.replaceChildren(left, sailDown, sailText, sailUp, right, oars, leave);
  root.replaceChildren(hint, notice, controls);
  options.host.appendChild(root);

  function steer(): void {
    const port = held.left || held.touchLeft;
    const starboard = held.right || held.touchRight;
    const rudder: HelmRudder = port === starboard ? 0 : port ? -1 : 1;
    state = setHelmRudder(state, rudder);
    wake();
  }

  function render(): void {
    const resting = helmOarRestShare(state);
    port = options.portAt?.(state) ?? null;
    const next = `${String(state.sail)}|${state.blocked}|${resting.toFixed(2)}|${String(state.oars > 0)}|${port?.slotId ?? ""}`;
    if (next === signature) return;
    signature = next;
    sailText.textContent = translate(SAIL_KEYS[state.sail] ?? "battle.sailDown");
    oars.style.setProperty("--reload", resting.toFixed(2));
    oars.disabled = state.oars > 0 || state.oarRest > 0;
    oars.classList.toggle("is-rowing", state.oars > 0);
    // One notice at a time: the edge of home waters, then a neighbour close by, then shoal water.
    const atEdge = state.blocked === "EDGE";
    const nearPort = !atEdge && port !== null;
    notice.hidden = !atEdge && !nearPort && state.blocked === "NONE";
    chartButton.hidden = !atEdge;
    sailButton.hidden = !nearPort;
    if (nearPort && port !== null) sailButton.textContent = translate("helm.sailTo", { name: port.name });
    noticeText.textContent = atEdge
      ? translate("helm.edge")
      : nearPort && port !== null
        ? translate("helm.nearPort", { name: port.name })
        : state.blocked === "LAND"
          ? translate("helm.aground")
          : "";
  }

  /** Whether the ship would change from one frame to the next: way on, a sprint, a turn, or the view still swinging. */
  function moving(): boolean {
    return (
      state.speed > 1e-4 ||
      state.sail > 0 ||
      state.oars > 0 ||
      state.oarRest > 0 ||
      state.rudder !== 0 ||
      Math.abs(state.heel) > 1e-4 ||
      Math.abs(state.viewHeading - state.heading) > 1e-4
    );
  }

  function tick(time: number): void {
    frame = null;
    if (paused || closed) return;
    const seconds = lastTime === 0 ? 1 / 60 : (time - lastTime) / 1000;
    lastTime = time;
    state = stepHelm(state, ship, waters, seconds);
    options.onPose(state);
    render();
    // The loop sleeps once the ship lies still with its sails struck: an idle helm costs no frames.
    if (moving()) frame = window.requestAnimationFrame(tick);
    else lastTime = 0;
  }

  function wake(): void {
    if (frame !== null || paused || closed) return;
    frame = window.requestAnimationFrame(tick);
  }

  const onKeyDown = (event: KeyboardEvent): void => {
    if (paused || closed || isTypingTarget(event.target)) return;
    switch (event.key) {
      case "a":
      case "A":
      case "ArrowLeft":
        held.left = true;
        steer();
        break;
      case "d":
      case "D":
      case "ArrowRight":
        held.right = true;
        steer();
        break;
      case "w":
      case "W":
      case "ArrowUp":
        if (!event.repeat) order("SAIL_UP");
        break;
      case "s":
      case "S":
      case "ArrowDown":
        if (!event.repeat) order("SAIL_DOWN");
        break;
      case " ":
        if (!event.repeat) order("OARS");
        break;
      case "Escape":
        options.onLeave();
        break;
      default:
        return;
    }
    event.preventDefault();
  };
  const onKeyUp = (event: KeyboardEvent): void => {
    switch (event.key) {
      case "a":
      case "A":
      case "ArrowLeft":
        held.left = false;
        steer();
        break;
      case "d":
      case "D":
      case "ArrowRight":
        held.right = false;
        steer();
        break;
      default:
        return;
    }
  };
  const letGo = (): void => {
    held.left = false;
    held.right = false;
    held.touchLeft = false;
    held.touchRight = false;
    steer();
  };
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", letGo);

  render();
  options.onPose(state);

  return {
    setPaused(next: boolean): void {
      if (closed || paused === next) return;
      paused = next;
      root.hidden = next;
      if (next) {
        letGo();
        if (frame !== null) window.cancelAnimationFrame(frame);
        frame = null;
        lastTime = 0;
      } else {
        wake();
      }
    },
    close(): void {
      if (closed) return;
      closed = true;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", letGo);
      root.remove();
    }
  };
}
