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

/** A `matchMedia` that always reports no match, with the full event surface. */
export function createMatchMediaStub(): () => MediaQueryList {
  return () =>
    ({
      matches: false,
      media: "",
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      onchange: null,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
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
  const g = globalThis as unknown as Record<string, unknown>;

  const keys = [
    ...BASE_GLOBALS,
    ...(options.matchMedia ? ["matchMedia"] : []),
    ...(options.windowGlobals ?? []),
    "requestAnimationFrame",
    "cancelAnimationFrame",
  ];

  const previous: Record<string, unknown> = {};
  for (const key of keys) previous[key] = g[key];

  g.document = w.document;
  g.window = w;
  g.navigator = w.navigator;
  g.HTMLElement = w.HTMLElement;
  g.Node = w.Node;
  g.Element = w.Element;
  g.MouseEvent = w.MouseEvent;
  g.getComputedStyle = (w.getComputedStyle as (e: Element) => CSSStyleDeclaration).bind(w);
  g.ResizeObserver = ResizeObserverStub;
  if (options.matchMedia) g.matchMedia = createMatchMediaStub();
  for (const name of options.windowGlobals ?? []) g[name] = w[name];

  const pendingFrames = new Set<ReturnType<typeof setTimeout>>();
  g.requestAnimationFrame = (callback: (time: number) => void) => {
    const id = setTimeout(() => {
      pendingFrames.delete(id);
      callback(0);
    }, 0);
    pendingFrames.add(id);
    return id as unknown as number;
  };
  g.cancelAnimationFrame = (id: number) => {
    pendingFrames.delete(id as unknown as ReturnType<typeof setTimeout>);
    clearTimeout(id);
  };

  return () => {
    for (const frame of pendingFrames) clearTimeout(frame);
    pendingFrames.clear();
    for (const key of keys) g[key] = previous[key];
    (dom.window as { close: () => void }).close();
  };
}
