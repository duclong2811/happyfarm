import {
  renderItemCard,
  type ItemCardDeps,
  type ItemCardModel,
  type ItemCardOptions
} from "../items/card";

export interface ActionButtonOptions {
  readonly label?: string;
  readonly icon?: SVGElement;
  readonly className?: string;
  readonly ariaLabel?: string;
  readonly title?: string;
  readonly disabled?: boolean;
  readonly onClick?: () => void;
}

/** Creates a consistently structured action control without owning its action or state. */
export function createActionButton(options: ActionButtonOptions = {}): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = ["ui-action-button", options.className].filter(Boolean).join(" ");
  if (options.icon !== undefined) button.appendChild(options.icon);
  if (options.label !== undefined) {
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = options.label;
    button.appendChild(label);
  }
  if (options.ariaLabel !== undefined) button.setAttribute("aria-label", options.ariaLabel);
  if (options.title !== undefined) button.title = options.title;
  button.disabled = options.disabled ?? false;
  if (options.onClick !== undefined) button.addEventListener("click", options.onClick);
  return button;
}

export interface CategoryTab<T extends string = string> {
  readonly id: T;
  readonly label: string;
  readonly count?: number;
}

/** Renders category navigation while leaving category selection in the owning screen. */
export function renderCategoryTabs<T extends string>(
  container: HTMLElement,
  tabs: readonly CategoryTab<T>[],
  activeId: T,
  onSelect: (id: T) => void
): void {
  container.classList.add("ui-category-tabs");
  container.replaceChildren();
  for (const tabData of tabs) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "item-tab ui-category-tab";
    tab.setAttribute("role", "tab");
    const active = tabData.id === activeId;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", String(active));
    tab.textContent = tabData.count === undefined
      ? tabData.label
      : `${tabData.label} (${String(tabData.count)})`;
    tab.addEventListener("click", () => {
      onSelect(tabData.id);
    });
    container.appendChild(tab);
  }
}

export type CapacityState = "normal" | "full" | "over";

/** Updates only the visual representation of an already-owned capacity bar. */
export function renderCapacityBar(
  bar: HTMLElement,
  fill: HTMLElement,
  ratio: number,
  state: CapacityState
): void {
  const boundedRatio = Math.max(0, Math.min(1, ratio));
  bar.classList.add("ui-capacity-bar");
  bar.classList.toggle("is-full", state === "full");
  bar.classList.toggle("is-over", state === "over");
  bar.setAttribute("role", "progressbar");
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", "100");
  bar.setAttribute("aria-valuenow", String(Math.round(boundedRatio * 100)));
  fill.classList.add("ui-capacity-bar-fill");
  fill.style.width = `${String(Math.round(boundedRatio * 100))}%`;
}

/** Inventory-specific naming around the shared item-card renderer. */
export function renderInventorySlot(
  model: ItemCardModel,
  deps: ItemCardDeps,
  options: ItemCardOptions = {}
): HTMLElement {
  const slot = renderItemCard(model, deps, options);
  slot.classList.add("ui-inventory-slot");
  return slot;
}

/** The active presentation system is Modern B when the document opts in with `<html class="ui-b">`. */
export const MODERN_UI_CLASS = "ui-b";

export function isModernUi(doc: Document | null = typeof document === "undefined" ? null : document): boolean {
  return doc?.documentElement.classList.contains(MODERN_UI_CLASS) ?? false;
}

/** Adds presentation roles to the existing HUD and panel DOM without changing ownership or state. */
export function decorateGameUi(root: ParentNode = document): void {
  const modern = isModernUi();
  root.querySelectorAll<HTMLElement>(".top-hud").forEach((node) => {
    node.classList.add("ui-top-hud-bar");
    if (!modern) node.classList.add("ui-warm-harvest-hud");
  });
  root.querySelectorAll<HTMLElement>(".module-rail").forEach((node) => {
    if (!modern) node.classList.add("ui-warm-harvest-hud");
  });
  root.querySelectorAll<HTMLElement>(".module-panel").forEach((node) => {
    node.classList.add("ui-panel-shell");
    node.querySelector<HTMLElement>(":scope > .module-header")?.classList.add("ui-panel-header");
    node.querySelector<HTMLElement>(":scope > .module-body")?.classList.add("ui-panel-body");
  });
  // Modern B draws every sheet itself (ui/modern-b.css); the older art-frame skins below are kept
  // only for the legacy presentation and must not be attached on top of it.
  if (modern) {
    root.querySelector<HTMLElement>("#inventory-tabs")?.classList.add("ui-category-tabs");
    root.querySelector<HTMLElement>("#inventory-grid")?.classList.add("ui-inventory-grid");
    return;
  }
  root.querySelector<HTMLElement>("#inventory-panel")?.classList.add("ui-inventory-shell");
  // Warm Harvest is a presentation-only acceptance experiment. It is limited to the real
  // Construction sheet; the build renderer keeps ownership of cards, prices and placement actions.
  root.querySelector<HTMLElement>("#build-panel")?.classList.add("ui-warm-harvest-construction");
  // The Market is the acceptance slice for the new Vibrant Cozy Farm 3D material family.  This is
  // deliberately an additive namespace: the other game sheets retain their existing material system
  // until the new direction is visually approved.
  const market = root.querySelector<HTMLElement>("#market-panel");
  market?.classList.add("ui-market-shell", "ui-market-vibrant");
  // Four fixed-size transparent corners sit above the stretchable coral/cream shell. They are
  // decorative only: no game state, focus order or pointer target changes when the frame is present.
  if (market !== null && market.querySelector(":scope > .market-vibrant-frame") === null) {
    const frame = document.createElement("div");
    frame.className = "market-vibrant-frame";
    frame.setAttribute("aria-hidden", "true");
    for (const corner of ["top-left", "top-right", "bottom-left", "bottom-right"]) {
      const ornament = document.createElement("span");
      ornament.className = `market-vibrant-panel-corner is-${corner}`;
      frame.appendChild(ornament);
    }
    market.insertBefore(frame, market.firstChild);
  }
  root.querySelector<HTMLElement>("#inventory-tabs")?.classList.add("ui-category-tabs");
  root.querySelector<HTMLElement>("#inventory-grid")?.classList.add("ui-inventory-grid");
}
