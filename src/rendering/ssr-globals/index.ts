/**
 * SSR Browser Globals
 *
 * Provides minimal browser API stubs for SSR to prevent crashes when
 * third-party libraries check for browser features during server rendering.
 *
 * @module rendering/ssr-globals
 */

export {
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
  createWindowStub,
} from "./dom-stubs.ts";

import { isSSRGlobalsActive, markSSRGlobalsInitialized } from "./context.ts";
import { createElementClass, createWindowStub } from "./dom-stubs.ts";

function setGlobal(name: string, value: unknown): void {
  try {
    (globalThis as Record<string, unknown>)[name] = value;
  } catch {
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

  setGlobalIfMissing("Element", createElementClass("Element"));
  setGlobalIfMissing("HTMLElement", createElementClass("HTMLElement"));
  setGlobalIfMissing("SVGElement", createElementClass("SVGElement"));
  setGlobalIfMissing("Node", createElementClass("Node"));
  setGlobalIfMissing("Text", createElementClass("Text"));
  setGlobalIfMissing("Comment", createElementClass("Comment"));
  setGlobalIfMissing("DocumentFragment", createElementClass("DocumentFragment"));

  markSSRGlobalsInitialized();
}
