import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ViewportPrefetch } from "./viewport-prefetch.ts";

interface MockIntersectionObserverEntry {
  isIntersecting: boolean;
  target: HTMLElement;
}

type IntersectionObserverCallback = (
  entries: MockIntersectionObserverEntry[],
  observer: any,
) => void;

const setupMockIntersectionObserver = () => {
  const originalIntersectionObserver = (globalThis as any).IntersectionObserver;
  const originalHTMLAnchorElement = (globalThis as any).HTMLAnchorElement;

  // Mock HTMLAnchorElement class for instanceof checks
  class MockHTMLAnchorElement {
    tagName = "A";
    private _attributes = new Map<string, string>();

    getAttribute(name: string): string | null {
      return this._attributes.get(name) || null;
    }

    setAttribute(name: string, value: string): void {
      this._attributes.set(name, value);
    }
  }

  (globalThis as any).HTMLAnchorElement = MockHTMLAnchorElement;

  let observerCallback: IntersectionObserverCallback | null = null;
  let observerOptions: any = null;
  const observedElements = new Set<HTMLElement>();
  const unobservedElements = new Set<HTMLElement>();
  let disconnectCalled = false;

  class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback, options?: any) {
      observerCallback = callback;
      observerOptions = options;
    }

    observe(element: HTMLElement) {
      observedElements.add(element);
      unobservedElements.delete(element);
    }

    unobserve(element: HTMLElement) {
      observedElements.delete(element);
      unobservedElements.add(element);
    }

    disconnect() {
      disconnectCalled = true;
      observedElements.clear();
    }
  }

  (globalThis as any).IntersectionObserver = MockIntersectionObserver;

  return {
    getObserverCallback: () => observerCallback,
    getObserverOptions: () => observerOptions,
    getObservedElements: () => observedElements,
    getUnobservedElements: () => unobservedElements,
    isDisconnectCalled: () => disconnectCalled,
    triggerIntersection: (element: HTMLElement, isIntersecting: boolean) => {
      if (observerCallback) {
        observerCallback([{ isIntersecting, target: element }], null);
      }
    },
    reset: () => {
      observerCallback = null;
      observerOptions = null;
      observedElements.clear();
      unobservedElements.clear();
      disconnectCalled = false;
    },
    cleanup: () => {
      (globalThis as any).IntersectionObserver = originalIntersectionObserver;
      (globalThis as any).HTMLAnchorElement = originalHTMLAnchorElement;
    },
  };
};

const createMockAnchor = (
  href: string,
  attributes: Record<string, string> = {},
): HTMLAnchorElement => {
  const MockHTMLAnchorElement = (globalThis as any).HTMLAnchorElement;
  const anchor = new MockHTMLAnchorElement();
  anchor.setAttribute("href", href);
  for (const [key, value] of Object.entries(attributes)) {
    anchor.setAttribute(key, value);
  }
  return anchor as unknown as HTMLAnchorElement;
};

const createMockDocument = (anchors: HTMLAnchorElement[]): Document => {
  return {
    querySelectorAll: (selector: string) => {
      if (selector === 'a[href]:not([target="_blank"])') {
        return anchors as any;
      }
      return [] as any;
    },
  } as unknown as Document;
};

const createMockElement = (anchors: HTMLAnchorElement[]): HTMLElement => {
  return {
    querySelectorAll: (selector: string) => {
      if (selector === 'a[href]:not([target="_blank"])') {
        return anchors as any;
      }
      return [] as any;
    },
  } as unknown as HTMLElement;
};

describe("ViewportPrefetch", () => {
  describe("Constructor", () => {
    it("should create ViewportPrefetch with prefetch callback", () => {
      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback);

      assertExists(viewportPrefetch, "ViewportPrefetch instance should be created");
    });

    it("should create ViewportPrefetch with empty prefetch options", () => {
      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, {});

      assertExists(viewportPrefetch, "Should create with empty options");
    });

    it("should create ViewportPrefetch with hover option", () => {
      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { hover: true });

      assertExists(viewportPrefetch, "Should create with hover option");
    });

    it("should create ViewportPrefetch with viewport option", () => {
      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      assertExists(viewportPrefetch, "Should create with viewport option");
    });

    it("should create ViewportPrefetch with both options", () => {
      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, {
        hover: true,
        viewport: true,
      });

      assertExists(viewportPrefetch, "Should create with both options");
    });
  });

  describe("setup", () => {
    it("should create IntersectionObserver when available", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback);

      const mockDoc = createMockDocument([]);
      viewportPrefetch.setup(mockDoc);

      assertEquals(mocks.getObserverCallback() !== null, true, "Observer callback should be set");

      mocks.cleanup();
    });

    it("should create observer with 200px rootMargin", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback);

      const mockDoc = createMockDocument([]);
      viewportPrefetch.setup(mockDoc);

      const options = mocks.getObserverOptions();
      assertEquals(options?.rootMargin, "200px", "Should set rootMargin to 200px");

      mocks.cleanup();
    });

    it("should not throw when IntersectionObserver is unavailable", () => {
      const originalIO = (globalThis as any).IntersectionObserver;
      delete (globalThis as any).IntersectionObserver;

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback);

      const mockDoc = createMockDocument([]);
      viewportPrefetch.setup(mockDoc); // Should not throw

      (globalThis as any).IntersectionObserver = originalIO;
    });

    it("should disconnect previous observer before creating new one", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback);

      const mockDoc = createMockDocument([]);

      viewportPrefetch.setup(mockDoc);
      assertEquals(mocks.isDisconnectCalled(), false, "Should not disconnect on first setup");

      mocks.reset();
      viewportPrefetch.setup(mockDoc);
      assertEquals(mocks.isDisconnectCalled(), true, "Should disconnect previous observer");

      mocks.cleanup();
    });

    it("should observe internal links when viewport is enabled", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor1 = createMockAnchor("/page1");
      const anchor2 = createMockAnchor("/page2");
      const mockDoc = createMockDocument([anchor1, anchor2]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.has(anchor1 as any), true, "Should observe first link");
      assertEquals(observed.has(anchor2 as any), true, "Should observe second link");

      mocks.cleanup();
    });

    it("should observe links with data-prefetch=viewport attribute", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: false });

      const anchor = createMockAnchor("/page", { "data-prefetch": "viewport" });
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(
        observed.has(anchor as any),
        true,
        "Should observe link with data-prefetch=viewport",
      );

      mocks.cleanup();
    });

    it("should not observe links when viewport is disabled and no data-prefetch attribute", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: false });

      const anchor = createMockAnchor("/page");
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 0, "Should not observe any links");

      mocks.cleanup();
    });

    it("should not observe links with data-prefetch=false", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("/page", { "data-prefetch": "false" });
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 0, "Should not observe links with data-prefetch=false");

      mocks.cleanup();
    });

    it("should not observe external links", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("https://external.com/page");
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 0, "Should not observe external links");

      mocks.cleanup();
    });

    it("should not observe hash links", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("#section");
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 0, "Should not observe hash links");

      mocks.cleanup();
    });

    it("should not observe download links", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("/file.pdf", { download: "file.pdf" });
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 0, "Should not observe download links");

      mocks.cleanup();
    });

    it("should not observe links without href", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("");
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 0, "Should not observe links without href");

      mocks.cleanup();
    });

    it("should work with HTMLElement as root", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("/page");
      const mockElement = createMockElement([anchor]);

      viewportPrefetch.setup(mockElement);

      const observed = mocks.getObservedElements();
      assertEquals(observed.has(anchor as any), true, "Should observe links in HTMLElement");

      mocks.cleanup();
    });

    it("should handle mixed internal and external links", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const internalLink1 = createMockAnchor("/page1");
      const externalLink = createMockAnchor("https://external.com");
      const internalLink2 = createMockAnchor("/page2");
      const hashLink = createMockAnchor("#section");

      const mockDoc = createMockDocument([internalLink1, externalLink, internalLink2, hashLink]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 2, "Should only observe internal links");
      assertEquals(observed.has(internalLink1 as any), true, "Should observe first internal link");
      assertEquals(observed.has(internalLink2 as any), true, "Should observe second internal link");

      mocks.cleanup();
    });

    it("should handle setup errors gracefully", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback);

      const mockDoc = {
        querySelectorAll: () => {
          throw new Error("Query failed");
        },
      } as unknown as Document;

      viewportPrefetch.setup(mockDoc);

      mocks.cleanup();
    });
  });

  describe("Intersection Handling", () => {
    it("should call prefetch callback when link enters viewport", () => {
      const mocks = setupMockIntersectionObserver();

      let prefetchedUrl = "";
      const prefetchCallback = (url: string) => {
        prefetchedUrl = url;
      };

      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("/page");
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      mocks.triggerIntersection(anchor as any, true);

      assertEquals(prefetchedUrl, "/page", "Should call prefetch callback with URL");

      mocks.cleanup();
    });

    it("should not call prefetch callback when link is not intersecting", () => {
      const mocks = setupMockIntersectionObserver();

      let prefetchCalled = false;
      const prefetchCallback = () => {
        prefetchCalled = true;
      };

      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("/page");
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      mocks.triggerIntersection(anchor as any, false);

      assertEquals(prefetchCalled, false, "Should not call prefetch when not intersecting");

      mocks.cleanup();
    });

    it("should unobserve link after intersection", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("/page");
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      assertEquals(
        mocks.getObservedElements().has(anchor as any),
        true,
        "Should be observed initially",
      );

      mocks.triggerIntersection(anchor as any, true);

      assertEquals(
        mocks.getUnobservedElements().has(anchor as any),
        true,
        "Should unobserve after intersection",
      );

      mocks.cleanup();
    });

    it("should handle multiple intersecting links", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchedUrls: string[] = [];
      const prefetchCallback = (url: string) => {
        prefetchedUrls.push(url);
      };

      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor1 = createMockAnchor("/page1");
      const anchor2 = createMockAnchor("/page2");
      const mockDoc = createMockDocument([anchor1, anchor2]);

      viewportPrefetch.setup(mockDoc);

      mocks.triggerIntersection(anchor1 as any, true);
      mocks.triggerIntersection(anchor2 as any, true);

      assertEquals(prefetchedUrls.length, 2, "Should prefetch both links");
      assertEquals(prefetchedUrls[0], "/page1", "Should prefetch first link");
      assertEquals(prefetchedUrls[1], "/page2", "Should prefetch second link");

      mocks.cleanup();
    });

    it("should not prefetch links without href on intersection", () => {
      const mocks = setupMockIntersectionObserver();

      let prefetchCalled = false;
      const prefetchCallback = () => {
        prefetchCalled = true;
      };

      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor(""); // No href
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);

      const callback = mocks.getObserverCallback();
      if (callback) {
        callback([{ isIntersecting: true, target: anchor as any }], null);
      }

      assertEquals(prefetchCalled, false, "Should not prefetch when href is empty");

      mocks.cleanup();
    });
  });

  describe("disconnect", () => {
    it("should disconnect observer", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const mockDoc = createMockDocument([]);
      viewportPrefetch.setup(mockDoc);

      viewportPrefetch.disconnect();

      assertEquals(mocks.isDisconnectCalled(), true, "Should call disconnect on observer");

      mocks.cleanup();
    });

    it("should handle disconnect when no observer exists", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback);

      viewportPrefetch.disconnect();

      assertEquals(mocks.isDisconnectCalled(), false, "Should not throw when no observer");

      mocks.cleanup();
    });

    it("should handle disconnect errors gracefully", () => {
      const mocks = setupMockIntersectionObserver();

      class ErrorIntersectionObserver {
        constructor(_callback: any, _options?: any) {}
        observe(_element: any) {}
        unobserve(_element: any) {}
        disconnect() {
          throw new Error("Disconnect failed");
        }
      }

      (globalThis as any).IntersectionObserver = ErrorIntersectionObserver;

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback);

      const mockDoc = createMockDocument([]);
      viewportPrefetch.setup(mockDoc);

      viewportPrefetch.disconnect();

      mocks.cleanup();
    });

    it("should set observer to null after disconnect", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const mockDoc = createMockDocument([]);
      viewportPrefetch.setup(mockDoc);
      viewportPrefetch.disconnect();

      viewportPrefetch.disconnect();

      mocks.cleanup();
    });

    it("should allow setup after disconnect", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor = createMockAnchor("/page");
      const mockDoc = createMockDocument([anchor]);

      viewportPrefetch.setup(mockDoc);
      viewportPrefetch.disconnect();

      mocks.reset();

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.has(anchor as any), true, "Should observe links after disconnect");

      mocks.cleanup();
    });
  });

  describe("Integration Tests", () => {
    it("should handle complete prefetch workflow", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchedUrls: string[] = [];
      const prefetchCallback = (url: string) => {
        prefetchedUrls.push(url);
      };

      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const anchor1 = createMockAnchor("/page1");
      const anchor2 = createMockAnchor("/page2");
      const anchor3 = createMockAnchor("https://external.com");

      const mockDoc = createMockDocument([anchor1, anchor2, anchor3]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 2, "Should observe 2 internal links");

      mocks.triggerIntersection(anchor1 as any, true);
      assertEquals(prefetchedUrls.length, 1, "Should prefetch first link");

      mocks.triggerIntersection(anchor2 as any, true);
      assertEquals(prefetchedUrls.length, 2, "Should prefetch second link");

      viewportPrefetch.disconnect();
      assertEquals(mocks.isDisconnectCalled(), true, "Should disconnect observer");

      mocks.cleanup();
    });

    it("should respect data-prefetch attribute priority", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: false });

      const link1 = createMockAnchor("/page1"); // No attribute, viewport disabled
      const link2 = createMockAnchor("/page2", { "data-prefetch": "viewport" }); // Explicit viewport
      const link3 = createMockAnchor("/page3", { "data-prefetch": "false" }); // Explicit false

      const mockDoc = createMockDocument([link1, link2, link3]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 1, "Should only observe link with data-prefetch=viewport");
      assertEquals(observed.has(link2 as any), true, "Should observe link with viewport attribute");

      mocks.cleanup();
    });

    it("should handle setup with no qualifying links", () => {
      const mocks = setupMockIntersectionObserver();

      const prefetchCallback = () => {};
      const viewportPrefetch = new ViewportPrefetch(prefetchCallback, { viewport: true });

      const externalLink = createMockAnchor("https://external.com");
      const hashLink = createMockAnchor("#section");
      const downloadLink = createMockAnchor("/file.pdf", { download: "file.pdf" });

      const mockDoc = createMockDocument([externalLink, hashLink, downloadLink]);

      viewportPrefetch.setup(mockDoc);

      const observed = mocks.getObservedElements();
      assertEquals(observed.size, 0, "Should not observe any non-qualifying links");

      mocks.cleanup();
    });
  });
});
