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

  // Set globals
  (globalThis as Record<string, unknown>).window = windowStub;
  (globalThis as Record<string, unknown>).document = windowStub.document;
  (globalThis as Record<string, unknown>).navigator = windowStub.navigator;
  (globalThis as Record<string, unknown>).location = windowStub.location;
  (globalThis as Record<string, unknown>).history = windowStub.history;
  (globalThis as Record<string, unknown>).localStorage = windowStub.localStorage;
  (globalThis as Record<string, unknown>).sessionStorage = windowStub.sessionStorage;
  (globalThis as Record<string, unknown>).matchMedia = windowStub.matchMedia;
  (globalThis as Record<string, unknown>).getComputedStyle = windowStub.getComputedStyle;
  (globalThis as Record<string, unknown>).requestAnimationFrame = windowStub.requestAnimationFrame;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = windowStub.cancelAnimationFrame;

  // Self-reference
  (globalThis as Record<string, unknown>).self = windowStub;

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
