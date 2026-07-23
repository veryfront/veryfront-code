import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { setConfigForTest } from "./bridge-config.ts";
import { dispose, init } from "./bridge-init.ts";
import { runExclusiveScreenshotCapture } from "./bridge-message-handler.ts";
import { _flushPendingForTest, _pendingCountForTest, isFromStudio } from "./bridge-messaging.ts";
import { OVERLAY_STYLE_ELEMENT_ID } from "./bridge-style-helpers.ts";
import { state } from "./bridge-state.ts";

describe("studio/bridge/bridge-init", () => {
  it("does not initialize without a distinct parent browsing context", () => {
    const originalWindow = globalThis.window;
    let listenerCount = 0;
    const fakeWindow = {
      parent: null as unknown,
      location: {
        search: "?studio_embed=true&inspect_mode=true",
        href: "https://project.preview.veryfront.com/page",
      },
      addEventListener() {
        listenerCount++;
      },
      removeEventListener() {},
    } as unknown as Window;
    Object.defineProperty(fakeWindow, "parent", { value: fakeWindow });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    try {
      init();

      assertEquals(listenerCount, 0);
      assertEquals(state.inspectMode, false);
    } finally {
      dispose();
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: originalWindow,
      });
    }
  });

  it("owns resources and emits one notification per document activation", async () => {
    const originalWindow = globalThis.window;
    const originalDocument = globalThis.document;
    const originalNode = globalThis.Node;
    const originalMutationObserver = globalThis.MutationObserver;
    const windowListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const documentListeners = new Map<string, Set<EventListenerOrEventListenerObject>>();
    const elementsById = new Map<string, { id?: string; remove(): void }>();
    const parentMessages: Array<Record<string, unknown>> = [];
    let appendedOverlays = 0;
    let removedOverlays = 0;
    let removedStyles = 0;

    const addListener = (
      listeners: Map<string, Set<EventListenerOrEventListenerObject>>,
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => {
      const values = listeners.get(type) ?? new Set();
      values.add(listener);
      listeners.set(type, values);
    };
    const removeListener = (
      listeners: Map<string, Set<EventListenerOrEventListenerObject>>,
      type: string,
      listener: EventListenerOrEventListenerObject,
    ) => listeners.get(type)?.delete(listener);
    const dispatchWindowEvent = (type: string, event: Event) => {
      for (const listener of windowListeners.get(type) ?? []) {
        if (typeof listener === "function") listener(event);
        else listener.handleEvent(event);
      }
    };
    const lifecycleMessages = () =>
      parentMessages.filter((message) =>
        message.action === "appLoaded" || message.action === "appUpdated" ||
        message.action === "onPageTransitionEnd" || message.action === "appUnloaded"
      );

    const createElement = (tagName: string) => {
      const attributes = new Map<string, string>();
      const element = {
        id: "",
        nodeType: 1,
        tagName: tagName.toUpperCase(),
        className: "",
        children: [] as unknown[],
        childNodes: [] as unknown[],
        style: { display: "" },
        sheet: tagName === "style" ? {} : undefined,
        textContent: "",
        classList: { add() {}, remove() {} },
        setAttribute(name: string, value: string) {
          attributes.set(name, value);
        },
        getAttribute(name: string) {
          return attributes.get(name) ?? null;
        },
        hasAttribute(name: string) {
          return attributes.has(name);
        },
        appendChild(child: unknown) {
          element.children.push(child);
          element.childNodes.push(child);
          return child;
        },
        querySelector() {
          return null;
        },
        remove() {
          if (element.tagName === "STYLE") {
            removedStyles++;
            if (element.id) elementsById.delete(element.id);
          } else {
            removedOverlays++;
          }
        },
      };
      return element;
    };
    const body = createElement("body");
    const documentElement = createElement("html");
    const fakeDocument = {
      readyState: "complete",
      body,
      documentElement,
      head: {
        appendChild(element: { id?: string; remove(): void }) {
          if (element.id) elementsById.set(element.id, element);
          return element;
        },
      },
      createElement,
      getElementById(id: string) {
        return elementsById.get(id) ?? null;
      },
      querySelector() {
        return null;
      },
      querySelectorAll() {
        return [];
      },
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        addListener(documentListeners, type, listener);
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        removeListener(documentListeners, type, listener);
      },
    } as unknown as Document;
    body.appendChild = (element: unknown) => {
      appendedOverlays++;
      body.children.push(element);
      body.childNodes.push(element);
      return element;
    };

    const fakeParent = {
      postMessage(message: Record<string, unknown>) {
        parentMessages.push(message);
      },
    };
    const fakeWindow = {
      parent: fakeParent,
      location: {
        search: "",
        href: "https://project.preview.veryfront.com/page",
      },
      addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        addListener(windowListeners, type, listener);
      },
      removeEventListener(type: string, listener: EventListenerOrEventListenerObject) {
        removeListener(windowListeners, type, listener);
      },
    } as unknown as Window;
    class FakeMutationObserver {
      constructor(_callback: MutationCallback) {}
      observe() {}
      disconnect() {}
    }

    Object.defineProperty(globalThis, "window", { value: fakeWindow, configurable: true });
    Object.defineProperty(globalThis, "document", { value: fakeDocument, configurable: true });
    Object.defineProperty(globalThis, "Node", {
      value: { ELEMENT_NODE: 1, TEXT_NODE: 3 },
      configurable: true,
    });
    Object.defineProperty(globalThis, "MutationObserver", {
      value: FakeMutationObserver,
      configurable: true,
    });
    setConfigForTest({
      pageId: "page-1",
      projectId: "project-1",
      pagePath: "page.tsx",
      nonce: "request-nonce",
    });

    try {
      init();
      init();

      assertEquals(appendedOverlays, 2);
      assertEquals(windowListeners.get("message")?.size, 1);
      assertEquals(windowListeners.get("pagehide")?.size, 1);
      assertEquals(windowListeners.get("pageshow")?.size, 1);
      assertEquals(windowListeners.get("beforeunload")?.size ?? 0, 0);
      assertEquals(documentListeners.get("click")?.size, 1);
      assertEquals(_pendingCountForTest() > 0, true);
      assertEquals(
        (elementsById.get(OVERLAY_STYLE_ELEMENT_ID) as HTMLStyleElement).nonce,
        "request-nonce",
      );

      assertEquals(
        isFromStudio({
          origin: "https://studio.veryfront.com",
          source: fakeParent,
        } as unknown as MessageEvent),
        true,
      );
      _flushPendingForTest();
      assertEquals(lifecycleMessages(), [
        { action: "appLoaded", url: "https://project.preview.veryfront.com/page" },
        {
          action: "appUpdated",
          url: "https://project.preview.veryfront.com/page",
          id: "page-1",
          isInitialLoad: true,
          errors: [],
          warnings: [],
        },
        {
          action: "onPageTransitionEnd",
          url: "https://project.preview.veryfront.com/page",
          projectId: "project-1",
          id: "page-1",
          params: {},
        },
      ]);

      parentMessages.length = 0;
      dispatchWindowEvent("pageshow", { persisted: false } as PageTransitionEvent);
      _flushPendingForTest();
      assertEquals(lifecycleMessages(), [], "the initial pageshow must not duplicate appLoaded");

      for (let cycle = 0; cycle < 2; cycle++) {
        dispatchWindowEvent("pagehide", { persisted: true } as PageTransitionEvent);
        dispatchWindowEvent("pagehide", { persisted: true } as PageTransitionEvent);
        assertEquals(lifecycleMessages(), [
          { action: "appUnloaded", url: "https://project.preview.veryfront.com/page" },
        ]);

        dispatchWindowEvent("pageshow", { persisted: true } as PageTransitionEvent);
        dispatchWindowEvent("pageshow", { persisted: true } as PageTransitionEvent);
        _flushPendingForTest();
        assertEquals(lifecycleMessages(), [
          { action: "appUnloaded", url: "https://project.preview.veryfront.com/page" },
          { action: "appLoaded", url: "https://project.preview.veryfront.com/page" },
          {
            action: "appUpdated",
            url: "https://project.preview.veryfront.com/page",
            id: "page-1",
            isInitialLoad: false,
            errors: [],
            warnings: [],
          },
          {
            action: "onPageTransitionEnd",
            url: "https://project.preview.veryfront.com/page",
            projectId: "project-1",
            id: "page-1",
            params: {},
          },
        ]);
        parentMessages.length = 0;
      }

      dispatchWindowEvent("pagehide", { persisted: false } as PageTransitionEvent);
      dispatchWindowEvent("pagehide", { persisted: false } as PageTransitionEvent);
      dispatchWindowEvent("pageshow", { persisted: false } as PageTransitionEvent);
      _flushPendingForTest();
      assertEquals(lifecycleMessages(), [
        { action: "appUnloaded", url: "https://project.preview.veryfront.com/page" },
      ]);

      let releaseCapture: (() => void) | undefined;
      const capture = runExclusiveScreenshotCapture(
        () => new Promise<string>((resolve) => (releaseCapture = () => resolve("old-session"))),
      );
      await Promise.resolve();

      dispose();
      dispose();
      releaseCapture?.();

      assertEquals(windowListeners.get("message")?.size, 0);
      assertEquals(windowListeners.get("pagehide")?.size, 0);
      assertEquals(windowListeners.get("pageshow")?.size, 0);
      assertEquals(windowListeners.get("beforeunload")?.size ?? 0, 0);
      assertEquals(documentListeners.get("click")?.size, 0);
      assertEquals(removedOverlays, 2);
      assertEquals(removedStyles, 1);
      assertEquals(elementsById.has(OVERLAY_STYLE_ELEMENT_ID), false);
      assertEquals(_pendingCountForTest(), 0);
      assertEquals(await capture, {
        accepted: true,
        current: false,
        value: "old-session",
      });

      init();
      assertEquals(appendedOverlays, 4);
      assertEquals(elementsById.has(OVERLAY_STYLE_ELEMENT_ID), true);
      assertEquals(windowListeners.get("message")?.size, 1);
    } finally {
      dispose();
      Object.defineProperty(globalThis, "window", { value: originalWindow, configurable: true });
      Object.defineProperty(globalThis, "document", {
        value: originalDocument,
        configurable: true,
      });
      Object.defineProperty(globalThis, "Node", { value: originalNode, configurable: true });
      Object.defineProperty(globalThis, "MutationObserver", {
        value: originalMutationObserver,
        configurable: true,
      });
    }
  });
});
