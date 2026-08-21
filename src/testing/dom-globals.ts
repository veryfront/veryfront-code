/**
 * Install JSDOM globals for a component test, and take them back down again.
 *
 * Every UI test that renders React needs the same handful of browser globals
 * installed on `globalThis`, and needs them restored afterwards. Twelve test
 * files each grew their own copy of that code, which is how the same defect
 * appeared in all of them: `requestAnimationFrame` is stubbed with a real timer,
 * and nothing drained the frames still queued at teardown. A pending timer is
 * what the op sanitizer reports as a leak, and because it reports at suite
 * level, the failure names a suite with no step and lands on whatever branch is
 * being pushed.
 *
 * This module owns the mechanics -- snapshot, install, drain, restore -- so
 * there is one place to fix. It deliberately does not decide *which* globals a
 * test installs: callers opt into the ones they need, so migrating a file
 * changes no behaviour.
 *
 * @module testing/dom-globals
 */

/** Minimal ResizeObserver that satisfies components which construct one. */
export class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

/** The subset of `MediaQueryList` components actually touch. */
export interface MediaQueryListStub {
  matches: boolean;
  media: string;
  addEventListener: () => void;
  removeEventListener: () => void;
  addListener: () => void;
  removeListener: () => void;
  onchange: null;
  dispatchEvent: () => boolean;
}

/** A `matchMedia` that always reports no match, with the full event surface. */
export function createMatchMediaStub(): () => MediaQueryListStub {
  return () => ({
    matches: false,
    media: "",
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  });
}

/** Options for {@linkcode installComponentDom}. */
export interface ComponentDomOptions {
  /** Install a `matchMedia` stub. Omit it for tests whose component branches on its absence. */
  matchMedia?: boolean;
  /** Extra constructors to copy off the JSDOM window, such as `KeyboardEvent`. */
  windowGlobals?: readonly string[];
}

/** The globals every component test installs. */
const BASE_GLOBALS = [
  "document",
  "window",
  "navigator",
  "HTMLElement",
  "Node",
  "Element",
  "MouseEvent",
  "getComputedStyle",
  "ResizeObserver",
] as const;

/**
 * Install browser globals from `dom`, and return a teardown.
 *
 * The teardown drains animation frames before restoring globals: React can
 * schedule a frame right up to unmount, and a frame still queued when the test
 * ends is a leaked timer.
 */
export function installComponentDom(
  dom: { window: unknown },
  options: ComponentDomOptions = {},
): () => void {
  const w = dom.window as Record<string, unknown>;
  const readGlobal = (key: string): unknown => Reflect.get(globalThis, key);
  const writeGlobal = (key: string, value: unknown): void => {
    Reflect.set(globalThis, key, value);
  };

  const keys = [
    ...BASE_GLOBALS,
    ...(options.matchMedia ? ["matchMedia"] : []),
    ...(options.windowGlobals ?? []),
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];

  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = readGlobal(key);

  writeGlobal("document", w.document);
  writeGlobal("window", w);
  writeGlobal("navigator", w.navigator);
  writeGlobal("HTMLElement", w.HTMLElement);
  writeGlobal("Node", w.Node);
  writeGlobal("Element", w.Element);
  writeGlobal("MouseEvent", w.MouseEvent);
  writeGlobal(
    "getComputedStyle",
    (w.getComputedStyle as (e: Element) => CSSStyleDeclaration).bind(w),
  );
  writeGlobal("ResizeObserver", ResizeObserverStub);
  if (options.matchMedia) writeGlobal("matchMedia", createMatchMediaStub());
  for (const name of options.windowGlobals ?? []) writeGlobal(name, w[name]);

  const pendingFrames = new Set<number>();
  writeGlobal("requestAnimationFrame", (callback: (time: number) => void): number => {
    const id = setTimeout(() => {
      pendingFrames.delete(id);
      callback(0);
    }, 0);
    pendingFrames.add(id);
    return id;
  });
  writeGlobal("cancelAnimationFrame", (id: number): void => {
    pendingFrames.delete(id);
    clearTimeout(id);
  });

  return () => {
    for (const frame of pendingFrames) clearTimeout(frame);
    pendingFrames.clear();
    for (const key of keys) writeGlobal(key, previous[key]);
    (dom.window as { close: () => void }).close();
  };
}
