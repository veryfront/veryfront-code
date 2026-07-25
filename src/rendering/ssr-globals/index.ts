/**
 * SSR Browser Globals
 *
 * Provides minimal browser API stubs for SSR to prevent crashes when
 * third-party libraries check for browser features during server rendering.
 *
 * @module rendering/ssr-globals
 */

export {
  clearSSRServerPort,
  disableSSRClientOnlyFetching,
  enableSSRClientOnlyFetching,
  isSSRGlobalsActive,
  setSSRServerPort,
} from "./context.ts";

export { disableSSRFetchInterception, enableSSRFetchInterception } from "./fetch-interceptor.ts";

export {
  createDocumentStub,
  createElementClass,
  createElementStub,
  createObserverClass,
  createWindowStub,
} from "./dom-stubs.ts";

import { isSSRGlobalsActive, markSSRGlobalsInitialized } from "./context.ts";
import { createElementClass, createWindowStub } from "./dom-stubs.ts";

function setGlobal(name: string, value: unknown): void {
  try {
    (globalThis as Record<string, unknown>)[name] = value;
  } catch (_) {
    /* expected: direct assignment may fail on frozen/non-configurable properties */
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  }
}

function setGlobalIfMissing(name: string, value: unknown): void {
  if ((globalThis as Record<string, unknown>)[name] !== undefined) return;
  setGlobal(name, value);
}

export function setupSSRGlobals(): void {
  if (isSSRGlobalsActive()) return;
  if (globalThis.window !== undefined && globalThis.document !== undefined) return;

  const windowStub = createWindowStub();

  // DOM constructor stubs. Libraries reach these both as bare globals and as
  // properties of `window` / `ownerDocument.defaultView` (e.g. Headless UI's
  // focus manager reads `window.HTMLElement.prototype`). Create them once and
  // expose them in every place a library might look, and wire document.defaultView
  // back to the window stub so `element.ownerDocument.defaultView` resolves.
  const domConstructors: Record<string, unknown> = {
    Element: createElementClass("Element"),
    HTMLElement: createElementClass("HTMLElement"),
    SVGElement: createElementClass("SVGElement"),
    Node: createElementClass("Node"),
    Text: createElementClass("Text"),
    Comment: createElementClass("Comment"),
    DocumentFragment: createElementClass("DocumentFragment"),
  };
  for (const [name, ctor] of Object.entries(domConstructors)) {
    (windowStub as Record<string, unknown>)[name] = ctor;
  }
  (windowStub.document as Record<string, unknown>).defaultView = windowStub;

  setGlobal("window", windowStub);
  setGlobal("document", windowStub.document);
  setGlobal("navigator", windowStub.navigator);
  setGlobal("location", windowStub.location);
  setGlobal("history", windowStub.history);
  setGlobal("localStorage", windowStub.localStorage);
  setGlobal("sessionStorage", windowStub.sessionStorage);
  setGlobal("matchMedia", windowStub.matchMedia);
  setGlobal("getComputedStyle", windowStub.getComputedStyle);
  setGlobal("requestAnimationFrame", windowStub.requestAnimationFrame);
  setGlobal("cancelAnimationFrame", windowStub.cancelAnimationFrame);

  setGlobal("self", windowStub);
  setGlobal("__VERYFRONT_SSR__", true);

  for (const [name, ctor] of Object.entries(domConstructors)) {
    setGlobalIfMissing(name, ctor);
  }

  setGlobalIfMissing("ResizeObserver", windowStub.ResizeObserver);
  setGlobalIfMissing("IntersectionObserver", windowStub.IntersectionObserver);
  setGlobalIfMissing("MutationObserver", windowStub.MutationObserver);

  markSSRGlobalsInitialized();
}
