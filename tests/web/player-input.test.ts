import { describe, expect, it, vi } from "vitest";
import { createMovementInput, NEUTRAL_INPUT } from "../../apps/web/src/player/input";

type KeyHandler = (event: KeyboardEvent) => void;
type DocumentHandler = () => void;

/**
 * A window small enough to assert against.
 *
 * The input module owns its listeners, so the test counts them, fires the same events the browser
 * would, and watches the fake handlers leave again on `detach`.
 */
function createFakeWindow() {
  const keyListeners = new Map<string, Set<KeyHandler>>();
  const documentListeners = new Map<string, Set<DocumentHandler>>();
  const documentTarget = {
    visibilityState: "visible",
    addEventListener(type: string, handler: DocumentHandler): void {
      const handlers = documentListeners.get(type) ?? new Set<DocumentHandler>();
      handlers.add(handler);
      documentListeners.set(type, handlers);
    },
    removeEventListener(type: string, handler: DocumentHandler): void {
      documentListeners.get(type)?.delete(handler);
    }
  };
  const target = {
    addEventListener(type: string, handler: KeyHandler): void {
      const handlers = keyListeners.get(type) ?? new Set<KeyHandler>();
      handlers.add(handler);
      keyListeners.set(type, handlers);
    },
    removeEventListener(type: string, handler: KeyHandler): void {
      keyListeners.get(type)?.delete(handler);
    },
    document: documentTarget
  };

  function fireKey(type: "keydown" | "keyup", key: string, eventTarget: EventTarget | null) {
    const event = { key, target: eventTarget, preventDefault: vi.fn() };
    for (const handler of keyListeners.get(type) ?? []) handler(event as unknown as KeyboardEvent);
    return event;
  }

  return {
    window: target as unknown as Window,
    listenerCount(type: string): number {
      return keyListeners.get(type)?.size ?? 0;
    },
    documentListenerCount(type: string): number {
      return documentListeners.get(type)?.size ?? 0;
    },
    press(key: string, eventTarget: EventTarget | null = null) {
      return fireKey("keydown", key, eventTarget);
    },
    release(key: string, eventTarget: EventTarget | null = null) {
      return fireKey("keyup", key, eventTarget);
    },
    blur(): void {
      for (const handler of keyListeners.get("blur") ?? []) handler({} as unknown as KeyboardEvent);
    },
    setVisibility(state: "visible" | "hidden"): void {
      documentTarget.visibilityState = state;
      for (const handler of documentListeners.get("visibilitychange") ?? []) handler();
    },
    textField: { tagName: "INPUT", isContentEditable: false } as unknown as EventTarget,
    contentEditableField: { tagName: "DIV", isContentEditable: true } as unknown as EventTarget
  };
}

describe("movement input", () => {
  it("starts neutral and tracks held keys", () => {
    const fake = createFakeWindow();
    const input = createMovementInput({ target: fake.window });
    input.attach();
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
    expect(input.isActive()).toBe(false);

    expect(fake.press("w").preventDefault).toHaveBeenCalled();
    expect(input.vector()).toEqual({ x: 0, z: 1 });
    expect(input.isActive()).toBe(true);

    fake.release("w");
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
    expect(input.isActive()).toBe(false);
  });

  it("reads every movement key, in either case", () => {
    const fake = createFakeWindow();
    const input = createMovementInput({ target: fake.window });
    input.attach();
    const cases: readonly (readonly [string, { x: number; z: number }])[] = [
      ["w", { x: 0, z: 1 }],
      ["W", { x: 0, z: 1 }],
      ["ArrowUp", { x: 0, z: 1 }],
      ["s", { x: 0, z: -1 }],
      ["ArrowDown", { x: 0, z: -1 }],
      ["a", { x: -1, z: 0 }],
      ["ArrowLeft", { x: -1, z: 0 }],
      ["d", { x: 1, z: 0 }],
      ["ArrowRight", { x: 1, z: 0 }]
    ];
    for (const [key, expected] of cases) {
      fake.press(key);
      expect(input.vector(), key).toEqual(expected);
      fake.release(key);
      expect(input.vector(), key).toEqual(NEUTRAL_INPUT);
    }
  });

  it("adds held keys together, cancels opposites, and never exceeds one unit per axis", () => {
    const fake = createFakeWindow();
    const input = createMovementInput({ target: fake.window });
    input.attach();
    fake.press("w");
    fake.press("a");
    expect(input.vector()).toEqual({ x: -1, z: 1 });
    fake.press("s");
    expect(input.vector()).toEqual({ x: -1, z: 0 });
    fake.press("d");
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
    expect(input.isActive()).toBe(true);
  });

  it("treats a repeated keydown as one held key", () => {
    const fake = createFakeWindow();
    const changes: boolean[] = [];
    const input = createMovementInput({
      target: fake.window,
      onActivityChange: (active) => changes.push(active)
    });
    input.attach();
    fake.press("w");
    fake.press("w");
    expect(input.vector()).toEqual({ x: 0, z: 1 });
    expect(changes).toEqual([true]);
    fake.release("w");
    expect(changes).toEqual([true, false]);
  });

  it("claims only the keys it uses", () => {
    const fake = createFakeWindow();
    const input = createMovementInput({ target: fake.window });
    input.attach();
    expect(fake.press("ArrowDown").preventDefault).toHaveBeenCalled();
    expect(fake.press("q").preventDefault).not.toHaveBeenCalled();
    // The key it did not claim changed nothing, and the arrow is still the held key.
    expect(input.vector()).toEqual({ x: 0, z: -1 });
  });

  it("lets a field own the keyboard while it has focus", () => {
    const fake = createFakeWindow();
    const input = createMovementInput({ target: fake.window });
    input.attach();
    const typed = fake.press("w", fake.textField);
    expect(typed.preventDefault).not.toHaveBeenCalled();
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
    const typedInEditor = fake.press("d", fake.contentEditableField);
    expect(typedInEditor.preventDefault).not.toHaveBeenCalled();
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
  });

  it("ignores the extra targets a caller names", () => {
    const fake = createFakeWindow();
    const ownTarget = { tagName: "CANVAS" } as unknown as EventTarget;
    const input = createMovementInput({ target: fake.window, ignoreTargets: [ownTarget] });
    input.attach();
    expect(fake.press("w", ownTarget).preventDefault).not.toHaveBeenCalled();
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
    expect(fake.press("w").preventDefault).toHaveBeenCalled();
    expect(input.vector()).toEqual({ x: 0, z: 1 });
  });

  it("forgets a held key when focus or the tab is lost", () => {
    const fake = createFakeWindow();
    const input = createMovementInput({ target: fake.window });
    input.attach();

    fake.press("w");
    fake.blur();
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
    expect(input.isActive()).toBe(false);

    fake.press("w");
    fake.setVisibility("hidden");
    expect(input.vector()).toEqual(NEUTRAL_INPUT);

    // Going back to the tab does not restore the key: it has to be pressed again.
    fake.setVisibility("visible");
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
  });

  it("releases every listener on detach", () => {
    const fake = createFakeWindow();
    const input = createMovementInput({ target: fake.window });
    input.attach();
    expect(fake.listenerCount("keydown")).toBe(1);
    expect(fake.listenerCount("keyup")).toBe(1);
    expect(fake.listenerCount("blur")).toBe(1);
    expect(fake.documentListenerCount("visibilitychange")).toBe(1);

    fake.press("w");
    input.detach();
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
    expect(input.isActive()).toBe(false);
    expect(fake.listenerCount("keydown")).toBe(0);
    expect(fake.listenerCount("keyup")).toBe(0);
    expect(fake.listenerCount("blur")).toBe(0);
    expect(fake.documentListenerCount("visibilitychange")).toBe(0);

    // Nothing is left listening, so a key after detach changes nothing.
    fake.press("w");
    expect(input.vector()).toEqual(NEUTRAL_INPUT);
  });
});
