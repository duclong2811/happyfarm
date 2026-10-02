/**
 * HappyFarm's interface icons, authored in the project as inline SVG.
 *
 * One stroke width, one 24-unit grid, one join and cap style, so the set reads as a family at 18-22
 * px. No icon package: the whole system is the path data below, which keeps the bundle flat and the
 * licence question closed. Icons are decorative - every control that carries one also has a
 * localized accessible name - so the markup hides them from assistive technology.
 */

export type IconName =
  | "farm"
  | "inventory"
  | "market"
  | "coin"
  | "star"
  | "language"
  | "refresh"
  | "close"
  | "plus"
  | "minus"
  | "walk"
  | "plant"
  | "harvest"
  | "remove"
  | "land"
  | "build"
  | "lock"
  | "road"
  | "fence"
  | "lamp"
  | "water"
  | "monument"
  /** Recentre the estate camera on the player. A crosshair with a centre dot. */
  | "target"
  /** The compact HUD's overflow control. */
  | "more"
  /** The bottom surface's expand/collapse affordance. */
  | "chevron";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/** Path data per icon, drawn inside a 24 x 24 box. */
const PATHS: Readonly<Record<IconName, readonly string[]>> = {
  farm: ["M12 21V9", "M12 9c0-3 2-5 5-5 0 3-2 5-5 5", "M12 12c0-2.5-1.7-4-4.5-4 0 2.5 1.7 4 4.5 4", "M6 21h12"],
  inventory: ["M4 8h16v12H4z", "M9 8V6a3 3 0 0 1 6 0v2", "M4 13h16"],
  market: ["M5 10h14l-1.2 10H6.2z", "M9 10V7a3 3 0 0 1 6 0v3", "M9 14h6"],
  coin: ["M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M12 8v8", "M9.5 10.5h5", "M9.5 13.5h5"],
  star: ["M12 4l2.4 5 5.6.7-4 3.9 1 5.4-5-2.7-5 2.7 1-5.4-4-3.9 5.6-.7z"],
  language: ["M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z", "M3.5 12h17", "M12 3c2.5 2.5 2.5 15 0 18", "M12 3c-2.5 2.5-2.5 15 0 18"],
  refresh: ["M5 12a7 7 0 0 1 12-4.9", "M17 3.5V8h-4.5", "M19 12a7 7 0 0 1-12 4.9", "M7 20.5V16h4.5"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  plus: ["M12 6v12", "M6 12h12"],
  minus: ["M6 12h12"],
  walk: ["M13 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z", "M13 8l-2 5 3 3v5", "M11 13l-3 1-1.5 4", "M11 10.5 8 9"],
  plant: ["M12 21v-7", "M12 14c0-3 2-5 5.5-5 0 3-2.2 5-5.5 5", "M12 17c0-2.4-1.6-4-4.5-4 0 2.4 1.7 4 4.5 4"],
  harvest: ["M7 20V9", "M17 20V9", "M7 13h10", "M9 9c0-3 1.4-5 3-5s3 2 3 5"],
  remove: ["M6 12h12", "M12 6v12"],
  land: ["M3 17l4-6 4 3 4-7 6 10z", "M3 20h18"],
  /** Build: a hammer over a level. The module's own glyph, not a picture of a farm. */
  build: ["M4 20h10", "M6 16l7-7", "M13 5l3-2 3 3-2 3z", "M11 8l3 3"],
  lock: ["M6 11h12v9H6z", "M8.5 11V8a3.5 3.5 0 0 1 7 0v3"],
  /** Road: a strip receding to a vanishing point, which is what the shop is selling. */
  road: ["M8 20L10.5 4", "M16 20L13.5 4", "M12 6v2", "M12 11v2", "M12 16v2"],
  /** Fence: posts and two rails. */
  fence: ["M6 20V7", "M12 20V6", "M18 20V7", "M4 11h16", "M4 15h16"],
  /** Lamp: a post with a hooded light. */
  lamp: ["M12 21v-8", "M8 13h8l-1.2-4h-5.6z", "M12 9V6", "M9 6h6"],
  /** Waterfront: two waves over a jetty line. */
  water: ["M3 15c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2 2.2-2 4.4-2", "M3 19c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2 2.2-2 4.4-2", "M12 4v9", "M9 7h6"],
  /** Monument: a plinth and an obelisk. */
  monument: ["M9 20h6", "M8 17h8l-1 3H9z", "M12 4l2.5 13h-5z"]
  ,
  /**
   * Target: a ring with four ticks and a centre mark. The universal "put the view back on me"
   * control, and deliberately not a camera glyph - it names the *player*, which is where the estate
   * camera goes when a player asks to be followed again.
   */
  target: [
    "M12 3v3", "M12 18v3", "M3 12h3", "M18 12h3",
    "M12 7.4a4.6 4.6 0 1 0 0 9.2 4.6 4.6 0 0 0 0-9.2z",
    "M12 11.4a.6.6 0 1 0 0 1.2.6.6 0 0 0 0-1.2z"
  ],
  /** More: three round dots, the standard overflow affordance. */
  more: [
    "M5.4 12a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0",
    "M10.9 12a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0",
    "M16.4 12a1.1 1.1 0 1 0 2.2 0 1.1 1.1 0 1 0-2.2 0"
  ],
  /** Chevron: one stroke, rotated by CSS for expand and collapse. */
  chevron: ["M6 14.5l6-6 6 6"]
};

/** Builds one icon as an SVG element the caller can drop into a button. */
export function createIcon(name: IconName, size = 20): SVGElement {
  const svg = document.createElementNS(SVG_NAMESPACE, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.7");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const data of PATHS[name]) {
    const path = document.createElementNS(SVG_NAMESPACE, "path");
    path.setAttribute("d", data);
    svg.appendChild(path);
  }
  return svg;
}

/**
 * Fills every `[data-icon]` slot in the document.
 *
 * The markup stays declarative - `<span data-icon="market"></span>` - and this replaces its content
 * with the drawn icon, so a control never depends on a glyph character that a platform might render
 * differently. Slots marked `data-icon-label` keep a text label beside the icon.
 */
export function renderIcons(root: ParentNode = document): void {
  for (const slot of root.querySelectorAll<HTMLElement>("[data-icon]")) {
    const name = slot.dataset.icon as IconName | undefined;
    if (name === undefined || !(name in PATHS)) continue;
    const size = Number(slot.dataset.iconSize ?? 20);
    slot.replaceChildren(createIcon(name, Number.isFinite(size) ? size : 20));
  }
}
