import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDocumentStub,
  createElementClass,
  createElementStub,
  createObserverClass,
  createWindowStub,
} from "./dom-stubs.ts";
import { resetSSRGlobalsState } from "./context.ts";
import { setupSSRGlobals } from "./index.ts";

describe("rendering/ssr-globals/dom-stubs", () => {
  describe("createElementStub", () => {
    it("should return an object with all DOM properties", () => {
      const el = createElementStub();
      assertEquals(typeof el.setAttribute, "function");
      assertEquals(el.getAttribute(), null);
      assertEquals(el.hasAttribute(), false);
      assertEquals(el.querySelector(), null);
      assertEquals(el.querySelectorAll().length, 0);
    });

    // Regression: libraries read `el.dataset.<key>`, attach listeners and measure
    // rects during SSR (Floating UI, Radix, theme scripts); a missing member throws
    // "Cannot read properties of undefined" or "is not a function" mid-render.
    it("should expose dataset, event listeners and rect helpers", () => {
      const el = createElementStub();
      assertEquals(typeof el.dataset, "object", "libraries read el.dataset.<key> during SSR");
      assertEquals(
        el.getClientRects().length,
        0,
        "Floating UI calls el.getClientRects() during render",
      );
      assertEquals(typeof el.addEventListener, "function", "libraries subscribe during render");
      assertEquals(typeof el.removeEventListener, "function", "libraries unsubscribe on teardown");
      el.addEventListener();
      el.removeEventListener();
      assertEquals(typeof el.setAttributeNS, "function", "SVG helpers write namespaced attributes");
      assertEquals(el.getAttributeNS(), null, "SVG helpers read namespaced attributes");
    });

    it("should have zero dimensions", () => {
      const el = createElementStub();
      assertEquals(el.offsetWidth, 0);
      assertEquals(el.offsetHeight, 0);
      assertEquals(el.clientWidth, 0);
      assertEquals(el.clientHeight, 0);
    });

    it("should have empty text content", () => {
      const el = createElementStub();
      assertEquals(el.innerHTML, "");
      assertEquals(el.textContent, "");
      assertEquals(el.innerText, "");
    });

    it("should return zeroed bounding rect", () => {
      const el = createElementStub();
      const rect = el.getBoundingClientRect();
      assertEquals(rect.top, 0);
      assertEquals(rect.width, 0);
      assertEquals(rect.height, 0);
    });

    it("should have classList with noop methods", () => {
      const el = createElementStub();
      el.classList.add();
      assertEquals(el.classList.contains(), false);
    });

    // Regression: `style` is a bag AND carries CSSOM methods. Libraries set CSS
    // custom properties during render (Floating UI, Radix Presence, vaul); a
    // bare {} would throw "el.style.setProperty is not a function" on SSR.
    it("should expose style.setProperty/getPropertyValue/removeProperty", () => {
      const el = createElementStub();
      assertEquals(typeof el.style.setProperty, "function");
      assertEquals(typeof el.style.getPropertyValue, "function");
      assertEquals(typeof el.style.removeProperty, "function");
      el.style.setProperty("--x", "1"); // must not throw
      (el.style as Record<string, unknown>).color = "red"; // still a bag
    });

    // Regression: methods focus/scroll-lock/click-outside libs call during render.
    it("should expose closest/matches/contains/focus/remove/scrollIntoView", () => {
      const el = createElementStub();
      assertEquals(el.closest(), null);
      assertEquals(el.matches(), false);
      assertEquals(el.contains(), false);
      for (const m of ["focus", "blur", "click", "scrollIntoView", "remove"] as const) {
        assertEquals(typeof el[m], "function");
      }
    });

    it("should clone to a new element stub", () => {
      const el = createElementStub();
      const clone = el.cloneNode();
      assertEquals(typeof clone.setAttribute, "function");
    });

    it("should have null parent and sibling references", () => {
      const el = createElementStub();
      assertEquals(el.parentNode, null);
      assertEquals(el.parentElement, null);
      assertEquals(el.nextSibling, null);
      assertEquals(el.firstChild, null);
      assertEquals(el.lastChild, null);
    });
  });

  describe("createDocumentStub", () => {
    it("should have SSR stub marker", () => {
      const doc = createDocumentStub();
      assertEquals(doc.__veryfrontSSRStub, true);
    });

    it("should create element stubs", () => {
      const doc = createDocumentStub();
      const el = doc.createElement();
      assertEquals(typeof el.setAttribute, "function");
    });

    it("should return null for query methods", () => {
      const doc = createDocumentStub();
      assertEquals(doc.querySelector(), null);
      assertEquals(doc.getElementById(), null);
    });

    // Regression: libraries (sonner, next-themes, focus/scroll-lock helpers)
    // read attributes off documentElement/body during render. These must carry
    // the full element-stub surface, not just { style, classList }, or SSR
    // throws "document.documentElement.getAttribute is not a function".
    it("documentElement and body expose the full element-stub attribute API", () => {
      const doc = createDocumentStub();
      for (const el of [doc.documentElement, doc.body]) {
        assertEquals(typeof el.getAttribute, "function");
        assertEquals(typeof el.setAttribute, "function");
        assertEquals(typeof el.hasAttribute, "function");
        assertEquals(typeof el.removeAttribute, "function");
        assertEquals(el.getAttribute(), null);
        assertEquals(el.hasAttribute(), false);
        assertEquals(typeof el.classList.toggle, "function");
      }
    });

    // Regression: CSS-in-JS libraries insert <style> tags through document.head
    // during SSR, so the head stub must keep the element insertion API.
    it("head exposes the full element-stub insertion API", () => {
      const doc = createDocumentStub();
      const style = doc.createElement();
      const anchor = doc.createElement();
      assertEquals(typeof doc.head.insertBefore, "function");
      assertEquals(typeof doc.head.appendChild, "function");
      assertEquals(Reflect.apply(doc.head.insertBefore, doc.head, [style, anchor]), undefined);
      assertEquals(Reflect.apply(doc.head.appendChild, doc.head, [style]), undefined);
    });

    it("should have complete readyState", () => {
      const doc = createDocumentStub();
      assertEquals(doc.readyState, "complete");
    });

    it("should have empty string for content properties", () => {
      const doc = createDocumentStub();
      assertEquals(doc.cookie, "");
      assertEquals(doc.domain, "");
      assertEquals(doc.title, "");
    });

    it("should have location with root pathname", () => {
      const doc = createDocumentStub();
      assertEquals(doc.location.pathname, "/");
    });

    it("should have fullscreen properties as null/undefined", () => {
      const doc = createDocumentStub();
      assertEquals(doc.fullscreenElement, null);
      assertEquals(doc.exitFullscreen, undefined);
    });

    // Regression: CSS-in-JS (emotion, styled-components) query/insert <style> in
    // <head> during SSR; the head stub must carry querySelector, not just append.
    it("head exposes querySelector/querySelectorAll/contains", () => {
      const doc = createDocumentStub();
      assertEquals(typeof doc.head.querySelector, "function");
      assertEquals(doc.head.querySelector(), null);
      assertEquals(doc.head.querySelectorAll().length, 0);
      assertEquals(doc.head.contains(), false);
    });

    it("exposes activeElement/createDocumentFragment/createComment/visibilityState", () => {
      const doc = createDocumentStub();
      assertEquals(doc.activeElement, null);
      assertEquals(doc.visibilityState, "visible");
      assertEquals(typeof doc.createDocumentFragment().setAttribute, "function");
      assertEquals(doc.createComment().textContent, "");
    });
  });

  describe("createObserverClass", () => {
    // Regression: libs constructing an observer at render/module scope (not in an
    // effect) threw "ResizeObserver is not defined" during SSR.
    it("constructs and exposes observe/unobserve/disconnect/takeRecords", () => {
      const RO = createObserverClass("ResizeObserver");
      assertEquals(RO.name, "ResizeObserver");
      const ro = new RO();
      ro.observe();
      ro.unobserve();
      ro.disconnect();
      assertEquals(ro.takeRecords().length, 0);
    });
  });

  describe("createWindowStub", () => {
    it("should have SSR stub marker", () => {
      const win = createWindowStub();
      assertEquals(win.__veryfrontSSRStub, true);
    });

    it("should have document sub-stub", () => {
      const win = createWindowStub();
      assertEquals(win.document.__veryfrontSSRStub, true);
    });

    it("should have SSR navigator", () => {
      const win = createWindowStub();
      assertEquals(win.navigator.userAgent, "SSR");
      assertEquals(win.navigator.platform, "SSR");
      assertEquals(win.navigator.onLine, true);
      assertEquals(win.navigator.cookieEnabled, false);
    });

    it("should have default dimensions", () => {
      const win = createWindowStub();
      assertEquals(win.innerWidth, 1024);
      assertEquals(win.innerHeight, 768);
      assertEquals(win.devicePixelRatio, 1);
    });

    it("should have noop storage stubs", () => {
      const win = createWindowStub();
      assertEquals(win.localStorage.getItem(), null);
      assertEquals(win.localStorage.length, 0);
      assertEquals(win.sessionStorage.getItem(), null);
    });

    it("should have matchMedia returning non-matching query", () => {
      const win = createWindowStub();
      const mq = win.matchMedia("(min-width: 768px)");
      assertEquals(mq.matches, false);
      assertEquals(mq.media, "(min-width: 768px)");
    });

    it("should have zero scroll offsets", () => {
      const win = createWindowStub();
      assertEquals(win.scrollX, 0);
      assertEquals(win.scrollY, 0);
      assertEquals(win.pageXOffset, 0);
      assertEquals(win.pageYOffset, 0);
    });

    it("should have history with zero length", () => {
      const win = createWindowStub();
      assertEquals(win.history.length, 0);
      assertEquals(win.history.state, null);
    });

    it("should have https protocol in location", () => {
      const win = createWindowStub();
      assertEquals(win.location.protocol, "https:");
      assertEquals(win.location.pathname, "/");
    });

    it("should provide global constructors", () => {
      const win = createWindowStub();
      assertEquals(win.URL, globalThis.URL);
      assertEquals(win.TextEncoder, globalThis.TextEncoder);
      assertEquals(win.TextDecoder, globalThis.TextDecoder);
    });

    it("should provide observer constructors", () => {
      const win = createWindowStub();
      assertEquals(typeof win.ResizeObserver, "function");
      assertEquals(typeof win.IntersectionObserver, "function");
      assertEquals(typeof win.MutationObserver, "function");
    });
  });

  describe("setupSSRGlobals", () => {
    type ObserverStubConstructor = new (callback?: unknown) => {
      observe: () => void;
      unobserve: () => void;
      disconnect: () => void;
      takeRecords: () => [];
    };

    const globalNames = [
      "window",
      "document",
      "navigator",
      "location",
      "history",
      "localStorage",
      "sessionStorage",
      "matchMedia",
      "getComputedStyle",
      "requestAnimationFrame",
      "cancelAnimationFrame",
      "self",
      "__VERYFRONT_SSR__",
      "Element",
      "HTMLElement",
      "SVGElement",
      "Node",
      "Text",
      "Comment",
      "DocumentFragment",
      "ResizeObserver",
      "IntersectionObserver",
      "MutationObserver",
    ] as const;

    it("should mirror observer constructors onto window", () => {
      const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
      for (const name of globalNames) {
        originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Reflect.deleteProperty(globalThis, name);
      }

      try {
        resetSSRGlobalsState();
        setupSSRGlobals();

        const globalRecord = globalThis as Record<string, unknown>;
        // Reached through the document, because SSR installs no `window`
        // global -- see the "leaves `window` undefined" case below.
        const windowStub = (globalRecord.document as { defaultView: unknown }).defaultView as {
          ResizeObserver: ObserverStubConstructor;
          IntersectionObserver: ObserverStubConstructor;
          MutationObserver: ObserverStubConstructor;
        };

        for (
          const name of ["ResizeObserver", "IntersectionObserver", "MutationObserver"] as const
        ) {
          assertEquals(windowStub[name], globalRecord[name]);
          const observer = new windowStub[name]();
          observer.observe();
          observer.disconnect();
          assertEquals(observer.takeRecords().length, 0);
        }
      } finally {
        resetSSRGlobalsState();
        for (const name of globalNames) {
          const descriptor = originalDescriptors.get(name);
          if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
          } else {
            Reflect.deleteProperty(globalThis, name);
          }
        }
      }
    });

    it("leaves `window` undefined so libraries can still detect the server", () => {
      const originalDescriptors = new Map<PropertyKey, PropertyDescriptor | undefined>();
      for (const name of globalNames) {
        originalDescriptors.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
        Reflect.deleteProperty(globalThis, name);
      }

      try {
        resetSSRGlobalsState();
        setupSSRGlobals();

        const globalRecord = globalThis as Record<string, unknown>;

        // The contract third-party code relies on. A stubbed `window` made
        // `typeof window === "undefined"` answer "browser" during SSR, which
        // is how next-themes came to emit `nonce=""` on a nonce-based CSP.
        assertEquals(typeof globalRecord.window, "undefined");

        // Everything the stub exists to provide is still reachable.
        assertExists(globalRecord.document);
        assertEquals(typeof globalRecord.matchMedia, "function");
        assertEquals(typeof globalRecord.HTMLElement, "function");

        // Including for libraries that reach the window through an element,
        // which is the access path the stub was written for.
        const defaultView = (globalRecord.document as { defaultView: Record<string, unknown> })
          .defaultView;
        assertExists(defaultView);
        assertEquals(defaultView.HTMLElement, globalRecord.HTMLElement);
      } finally {
        resetSSRGlobalsState();
        for (const name of globalNames) {
          const descriptor = originalDescriptors.get(name);
          if (descriptor) {
            Object.defineProperty(globalThis, name, descriptor);
          } else {
            Reflect.deleteProperty(globalThis, name);
          }
        }
      }
    });
  });

  describe("createElementClass", () => {
    it("should create a class with the given name", () => {
      const Cls = createElementClass("HTMLDivElement");
      assertEquals(Cls.name, "HTMLDivElement");
    });

    it("should be instantiable", () => {
      const Cls = createElementClass("HTMLSpanElement");
      const instance = new Cls();
      assertEquals(instance instanceof Cls, true);
    });
  });
});
