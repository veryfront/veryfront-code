/**
 * SSR Browser Globals
 *
 * Provides minimal browser API stubs for SSR to prevent crashes when
 * third-party libraries check for browser features during server rendering.
 *
 * @module rendering/ssr-globals
 */

// Re-export context functions
export {
  disableSSRClientOnlyFetching,
  enableSSRClientOnlyFetching,
  isSSRGlobalsActive,
  setSSRProjectDomain,
  setSSRServerPort,
} from "./context.ts";

// Re-export fetch interceptor functions
export { disableSSRFetchInterception, enableSSRFetchInterception } from "./fetch-interceptor.ts";

// Re-export DOM stubs for testing/extension
export {
  createDocumentStub,
  createElementClass,
  createElementStub,
  createWindowStub,
} from "./dom-stubs.ts";

// Import for internal use
import { isSSRGlobalsActive, markSSRGlobalsInitialized } from "./context.ts";
import { createElementClass, createWindowStub } from "./dom-stubs.ts";

/**
 * Safely set a global property, using Object.defineProperty as fallback
 * for read-only properties (e.g., navigator in Node.js 21+)
 */
function setGlobal(name: string, value: unknown): void {
  try {
    (globalThis as Record<string, unknown>)[name] = value;
  } catch {
    // Property might be read-only (e.g., navigator in Node.js 21+)
    // Use Object.defineProperty to override
    Object.defineProperty(globalThis, name, {
      value,
      writable: true,
      configurable: true,
    });
  }
}

/**
 * Set up browser globals for SSR
 * Safe to call multiple times - only initializes once
 */
export function setupSSRGlobals(): void {
  if (isSSRGlobalsActive()) return;

  // Only set up if we're in a server environment (no existing window)
  if (typeof globalThis.window !== "undefined" && typeof globalThis.document !== "undefined") {
    // Already have browser globals, don't override
    return;
  }

  const windowStub = createWindowStub();

  // Set globals (using setGlobal for properties that might be read-only in Node.js 21+)
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

  // Self-reference
  setGlobal("self", windowStub);

  // DOM Element classes - needed by framer-motion and other animation libraries
  // These check `instanceof SVGElement` etc to determine element types
  if (typeof globalThis.Element === "undefined") {
    (globalThis as Record<string, unknown>).Element = createElementClass("Element");
  }
  if (typeof globalThis.HTMLElement === "undefined") {
    (globalThis as Record<string, unknown>).HTMLElement = createElementClass("HTMLElement");
  }
  if (typeof globalThis.SVGElement === "undefined") {
    (globalThis as Record<string, unknown>).SVGElement = createElementClass("SVGElement");
  }
  if (typeof globalThis.Node === "undefined") {
    (globalThis as Record<string, unknown>).Node = createElementClass("Node");
  }
  if (typeof globalThis.Text === "undefined") {
    (globalThis as Record<string, unknown>).Text = createElementClass("Text");
  }
  if (typeof globalThis.Comment === "undefined") {
    (globalThis as Record<string, unknown>).Comment = createElementClass("Comment");
  }
  if (typeof globalThis.DocumentFragment === "undefined") {
    (globalThis as Record<string, unknown>).DocumentFragment = createElementClass(
      "DocumentFragment",
    );
  }

  markSSRGlobalsInitialized();
}
