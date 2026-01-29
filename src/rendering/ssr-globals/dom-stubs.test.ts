import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createDocumentStub,
  createElementClass,
  createElementStub,
  createWindowStub,
} from "./dom-stubs.ts";

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
