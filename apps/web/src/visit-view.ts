import type { VisitWorldPlaceResponse } from "@happy-farm/contracts";
import type { MessageKey } from "./i18n";
import { createIcon } from "./icons";
import { createFarmScene, type FarmSceneHandle, type FarmSceneInput, type RenderQualityName } from "./render";
import { archipelagoName } from "./sea-chart-view";

/**
 * A visit to another place on the chart (W4: look only, owner decision 2026-11-20).
 *
 * The visited island is drawn in a renderer of its own, over the game: the estate camera only, no
 * character, and nothing that can be picked, planted or built. The home farm's state is never
 * touched, so nothing done here can reach the home island or the visited one. "Home" closes the
 * view and disposes its renderer.
 */

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** The built things on the visited island, already resolved to models by the caller. */
export type VisitSceneConstructions = Parameters<FarmSceneHandle["setConstructions"]>[0];

export interface VisitViewOptions {
  readonly host: HTMLElement;
  readonly translate: Translate;
  readonly quality: RenderQualityName;
  readonly visit: VisitWorldPlaceResponse;
  readonly input: FarmSceneInput;
  readonly constructions: VisitSceneConstructions;
  readonly onClose: () => void;
  /** A renderer that cannot start (no WebGL): the caller reports it; the view closes itself. */
  readonly onUnavailable: (error: unknown) => void;
}

export interface VisitView {
  close(): void;
}

/** The visit's heading: the island's name (or "a wild island"), and where it lies. */
export function visitHeading(visit: VisitWorldPlaceResponse, translate: Translate): { readonly title: string; readonly subtitle: string } {
  const place = visit.place;
  const region = place.region;
  const archipelago = translate("chart.archipelago", { name: archipelagoName(region, place.archipelagoIndex) });
  return {
    title: place.name ?? translate(place.claimed ? "visit.settled" : "visit.wild"),
    subtitle: translate("visit.where", { archipelago, region: translate(`chart.region.${region}` as MessageKey) })
  };
}

export function openVisitView(options: VisitViewOptions): VisitView {
  const { host, translate, visit } = options;
  let closed = false;
  let scene: FarmSceneHandle | null = null;

  const root = document.createElement("div");
  root.id = "visit-view";
  root.className = "visit-view";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-modal", "true");
  root.setAttribute("aria-labelledby", "visit-view-title");

  const canvas = document.createElement("canvas");
  canvas.className = "vv-canvas";
  canvas.setAttribute("aria-hidden", "true");

  const bar = document.createElement("header");
  bar.className = "vv-bar";
  const text = document.createElement("div");
  text.className = "vv-text";
  const heading = visitHeading(visit, translate);
  const title = document.createElement("h2");
  title.id = "visit-view-title";
  title.textContent = heading.title;
  const subtitle = document.createElement("p");
  subtitle.textContent = heading.subtitle;
  const note = document.createElement("p");
  note.className = "vv-note";
  note.textContent = translate("visit.lookOnly");
  text.replaceChildren(title, subtitle, note);
  const home = document.createElement("button");
  home.type = "button";
  home.className = "primary vv-home";
  home.appendChild(createIcon("farm", 18));
  home.appendChild(document.createTextNode(translate("visit.home")));
  bar.replaceChildren(text, home);
  root.replaceChildren(canvas, bar);

  const onKey = (event: KeyboardEvent): void => {
    if (event.key === "Escape") close();
  };

  function close(): void {
    if (closed) return;
    closed = true;
    window.removeEventListener("keydown", onKey);
    scene?.dispose();
    scene = null;
    root.remove();
    options.onClose();
  }

  home.addEventListener("click", () => {
    close();
  });

  host.appendChild(root);
  window.addEventListener("keydown", onKey);
  try {
    // No callbacks: a click on the visited island selects nothing and asks nothing of the server.
    scene = createFarmScene(canvas, { quality: options.quality });
    scene.setPlayer(null);
    scene.setState(options.input);
    scene.setConstructions(options.constructions);
  } catch (error: unknown) {
    close();
    options.onUnavailable(error);
  }
  home.focus();
  return { close };
}
