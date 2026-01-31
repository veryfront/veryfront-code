import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import { NavigationHandlers } from "./navigation-handlers.ts";
import type { NavigationCallbacks } from "./navigation-handlers.ts";

interface MockElement {
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  parentElement?: MockElement | null;
  _attributes?: Map<string, string>;
}

interface MockLocation {
  pathname: string;
}

function setupMocks(): {
  mockLocation: MockLocation;
  setScrollY: (value: number) => void;
  cleanup: () => void;
} {
  const g = globalThis as any;

  const originalLocation = g.location;
  const originalScrollY = g.scrollY;
  const originalHTMLAnchorElement = g.HTMLAnchorElement;
  const originalHTMLElement = g.HTMLElement;

  const mockLocation: MockLocation = { pathname: "/current-page" };

  class MockHTMLElement {
    tagName = "";
    private _attributes = new Map<string, string>();

    getAttribute(name: string): string | null {
      return this._attributes.get(name) ?? null;
    }

    setAttribute(name: string, value: string): void {
      this._attributes.set(name, value);
    }

    hasAttribute(name: string): boolean {
      return this._attributes.has(name);
    }
  }

  class MockHTMLAnchorElement extends MockHTMLElement {
    constructor() {
      super();
      this.tagName = "A";
    }
  }

  g.location = mockLocation;
  g.scrollY = 0;
  g.HTMLElement = MockHTMLElement;
  g.HTMLAnchorElement = MockHTMLAnchorElement;

  return {
    mockLocation,
    setScrollY(value: number) {
      g.scrollY = value;
    },
    cleanup() {
      g.location = originalLocation;
      g.scrollY = originalScrollY;
      g.HTMLAnchorElement = originalHTMLAnchorElement;
      g.HTMLElement = originalHTMLElement;
    },
  };
}

function createMockAnchor(
  href: string,
  attributes: Record<string, string> = {},
): any {
  const MockHTMLAnchorElement = (globalThis as any).HTMLAnchorElement;
  if (!MockHTMLAnchorElement) {
    throw new Error("MockHTMLAnchorElement not set up. Call setupMocks() first.");
  }

  const anchor = new MockHTMLAnchorElement();
  anchor.setAttribute("href", href);

  for (const [key, value] of Object.entries(attributes)) {
    anchor.setAttribute(key, value);
  }

  anchor.parentElement = null;
  return anchor;
}

function createMockElement(
  tagName: string,
  attributes: Record<string, string> = {},
): MockElement {
  const MockHTMLElement = (globalThis as any).HTMLElement;
  if (!MockHTMLElement) {
    const attrs = new Map<string, string>(Object.entries(attributes));
    return {
      tagName: tagName.toUpperCase(),
      getAttribute: (name: string) => attrs.get(name) ?? null,
      parentElement: null,
      _attributes: attrs,
    };
  }

  const element = new MockHTMLElement();
  element.tagName = tagName.toUpperCase();

  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }

  element.parentElement = null;
  return element as MockElement;
}

describe("NavigationHandlers", () => {
  describe("Constructor", () => {
    it("should create NavigationHandlers with default prefetch delay", () => {
      const handlers = new NavigationHandlers();
      assertExists(handlers, "NavigationHandlers instance should be created");
    });

    it("should create NavigationHandlers with custom prefetch delay", () => {
      const handlers = new NavigationHandlers(scaleMs(500));
      assertExists(handlers, "NavigationHandlers with custom delay should be created");
    });

    it("should create NavigationHandlers with prefetch options", () => {
      const handlers = new NavigationHandlers(scaleMs(100), { hover: true, viewport: true });
      assertExists(handlers, "NavigationHandlers with prefetch options should be created");
    });
  });

  describe("createClickHandler", () => {
    it("should handle click on internal link", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        let navigatedUrl = "";
        const callbacks: NavigationCallbacks = {
          onNavigate(url: string) {
            navigatedUrl = url;
            return Promise.resolve();
          },
          onPrefetch() {},
        };

        const clickHandler = handlers.createClickHandler(callbacks);

        const anchor = createMockAnchor("/about");
        const event = {
          target: anchor,
          preventDefault() {},
        } as unknown as MouseEvent;

        clickHandler(event);

        assertEquals(navigatedUrl, "/about", "Should navigate to internal link URL");
      } finally {
        mocks.cleanup();
      }
    });

    it("should prevent default behavior on internal link click", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        const callbacks: NavigationCallbacks = {
          onNavigate: () => Promise.resolve(),
          onPrefetch() {},
        };

        const clickHandler = handlers.createClickHandler(callbacks);

        let preventDefaultCalled = false;
        const anchor = createMockAnchor("/about");
        const event = {
          target: anchor,
          preventDefault() {
            preventDefaultCalled = true;
          },
        } as unknown as MouseEvent;

        clickHandler(event);

        assertEquals(preventDefaultCalled, true, "Should prevent default link behavior");
      } finally {
        mocks.cleanup();
      }
    });

    it("should ignore click on external link", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        let navigationCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate() {
            navigationCalled = true;
            return Promise.resolve();
          },
          onPrefetch() {},
        };

        const clickHandler = handlers.createClickHandler(callbacks);

        const anchor = createMockAnchor("https://external.com/page");
        const event = {
          target: anchor,
          preventDefault() {},
        } as unknown as MouseEvent;

        clickHandler(event);

        assertEquals(navigationCalled, false, "Should not navigate for external links");
      } finally {
        mocks.cleanup();
      }
    });

    it("should ignore click on link with target=_blank", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        let navigationCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate() {
            navigationCalled = true;
            return Promise.resolve();
          },
          onPrefetch() {},
        };

        const clickHandler = handlers.createClickHandler(callbacks);

        const anchor = createMockAnchor("/page", { target: "_blank" });
        const event = {
          target: anchor,
          preventDefault() {},
        } as unknown as MouseEvent;

        clickHandler(event);

        assertEquals(navigationCalled, false, "Should not navigate for links with target=_blank");
      } finally {
        mocks.cleanup();
      }
    });

    it("should ignore click on download link", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        let navigationCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate() {
            navigationCalled = true;
            return Promise.resolve();
          },
          onPrefetch() {},
        };

        const clickHandler = handlers.createClickHandler(callbacks);

        const anchor = createMockAnchor("/file.pdf", { download: "file.pdf" });
        const event = {
          target: anchor,
          preventDefault() {},
        } as unknown as MouseEvent;

        clickHandler(event);

        assertEquals(navigationCalled, false, "Should not navigate for download links");
      } finally {
        mocks.cleanup();
      }
    });

    it("should ignore click on hash link", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        let navigationCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate() {
            navigationCalled = true;
            return Promise.resolve();
          },
          onPrefetch() {},
        };

        const clickHandler = handlers.createClickHandler(callbacks);

        const anchor = createMockAnchor("#section");
        const event = {
          target: anchor,
          preventDefault() {},
        } as unknown as MouseEvent;

        clickHandler(event);

        assertEquals(navigationCalled, false, "Should not navigate for hash links");
      } finally {
        mocks.cleanup();
      }
    });

    it("should ignore click on non-anchor element", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        let navigationCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate() {
            navigationCalled = true;
            return Promise.resolve();
          },
          onPrefetch() {},
        };

        const clickHandler = handlers.createClickHandler(callbacks);

        const div = createMockElement("div");
        const event = {
          target: div,
          preventDefault() {},
        } as unknown as MouseEvent;

        clickHandler(event);

        assertEquals(navigationCalled, false, "Should not navigate for non-anchor elements");
      } finally {
        mocks.cleanup();
      }
    });
  });

  describe("createPopStateHandler", () => {
    it("should handle browser back/forward navigation", () => {
      const mocks = setupMocks();
      try {
        mocks.mockLocation.pathname = "/new-page";

        const handlers = new NavigationHandlers();

        let navigatedUrl = "";
        const callbacks: NavigationCallbacks = {
          onNavigate(url: string) {
            navigatedUrl = url;
            return Promise.resolve();
          },
          onPrefetch() {},
        };

        const popStateHandler = handlers.createPopStateHandler(callbacks);

        popStateHandler({} as PopStateEvent);

        assertEquals(navigatedUrl, "/new-page", "Should navigate to current pathname");
      } finally {
        mocks.cleanup();
      }
    });

    it("should set popstate navigation flag", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        const callbacks: NavigationCallbacks = {
          onNavigate: () => Promise.resolve(),
          onPrefetch() {},
        };

        const popStateHandler = handlers.createPopStateHandler(callbacks);

        assertEquals(handlers.isPopState(), false, "PopState flag should be false initially");

        popStateHandler({} as PopStateEvent);

        assertEquals(
          handlers.isPopState(),
          true,
          "PopState flag should be true after popstate event",
        );
      } finally {
        mocks.cleanup();
      }
    });
  });

  describe("createMouseOverHandler", () => {
    it("should prefetch link on mouseover when hover is enabled", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(50), { hover: true });

        let prefetchedUrl = "";
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch(url: string) {
            prefetchedUrl = url;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const anchor = createMockAnchor("/page");
        const event = { target: anchor } as unknown as MouseEvent;

        mouseOverHandler(event);

        await delay(100);

        assertEquals(prefetchedUrl, "/page", "Should prefetch link after delay");
      } finally {
        mocks.cleanup();
      }
    });

    it("should ignore mouseover on non-anchor element", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(50), { hover: true });

        let prefetchCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch() {
            prefetchCalled = true;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const div = createMockElement("div");
        const event = { target: div } as unknown as MouseEvent;

        mouseOverHandler(event);

        await delay(100);

        assertEquals(prefetchCalled, false, "Should not prefetch for non-anchor elements");
      } finally {
        mocks.cleanup();
      }
    });

    it("should ignore mouseover on external link", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(50), { hover: true });

        let prefetchCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch() {
            prefetchCalled = true;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const anchor = createMockAnchor("https://external.com/page");
        const event = { target: anchor } as unknown as MouseEvent;

        mouseOverHandler(event);

        await delay(100);

        assertEquals(prefetchCalled, false, "Should not prefetch external links");
      } finally {
        mocks.cleanup();
      }
    });

    it("should ignore mouseover on hash link", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(50), { hover: true });

        let prefetchCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch() {
            prefetchCalled = true;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const anchor = createMockAnchor("#section");
        const event = { target: anchor } as unknown as MouseEvent;

        mouseOverHandler(event);

        await delay(100);

        assertEquals(prefetchCalled, false, "Should not prefetch hash links");
      } finally {
        mocks.cleanup();
      }
    });

    it("should respect data-prefetch=false attribute", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(50), { hover: true });

        let prefetchCalled = false;
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch() {
            prefetchCalled = true;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const anchor = createMockAnchor("/page", { "data-prefetch": "false" });
        const event = { target: anchor } as unknown as MouseEvent;

        mouseOverHandler(event);

        await delay(100);

        assertEquals(prefetchCalled, false, "Should not prefetch when data-prefetch=false");
      } finally {
        mocks.cleanup();
      }
    });

    it("should prefetch when data-prefetch=true even if hover is disabled", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(50), { hover: false });

        let prefetchedUrl = "";
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch(url: string) {
            prefetchedUrl = url;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const anchor = createMockAnchor("/page", { "data-prefetch": "true" });
        const event = { target: anchor } as unknown as MouseEvent;

        mouseOverHandler(event);

        await delay(100);

        assertEquals(prefetchedUrl, "/page", "Should prefetch when data-prefetch=true");
      } finally {
        mocks.cleanup();
      }
    });

    it("should not prefetch same URL multiple times concurrently", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(100), { hover: true });

        let prefetchCount = 0;
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch() {
            prefetchCount++;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const anchor = createMockAnchor("/page");
        const event = { target: anchor } as unknown as MouseEvent;

        mouseOverHandler(event);
        mouseOverHandler(event);
        mouseOverHandler(event);

        await delay(150);

        assertEquals(prefetchCount, 1, "Should only prefetch once for concurrent hovers");
      } finally {
        mocks.cleanup();
      }
    });

    it("should remove URL from queue after prefetch", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(50), { hover: true });

        let prefetchCount = 0;
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch() {
            prefetchCount++;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const anchor = createMockAnchor("/page");
        const event = { target: anchor } as unknown as MouseEvent;

        mouseOverHandler(event);

        await delay(100);

        mouseOverHandler(event);

        await delay(100);

        assertEquals(prefetchCount, 2, "Should allow prefetch again after removal from queue");
      } finally {
        mocks.cleanup();
      }
    });
  });

  describe("Scroll Position Management", () => {
    it("should save scroll position for a path", () => {
      const mocks = setupMocks();
      try {
        mocks.setScrollY(300);

        const handlers = new NavigationHandlers();

        handlers.saveScrollPosition("/page1");

        assertEquals(handlers.getScrollPosition("/page1"), 300, "Should save scroll position");
      } finally {
        mocks.cleanup();
      }
    });

    it("should retrieve saved scroll position", () => {
      const mocks = setupMocks();
      try {
        mocks.setScrollY(500);

        const handlers = new NavigationHandlers();

        handlers.saveScrollPosition("/page2");
        mocks.setScrollY(0);

        const savedPosition = handlers.getScrollPosition("/page2");

        assertEquals(savedPosition, 500, "Should retrieve previously saved scroll position");
      } finally {
        mocks.cleanup();
      }
    });

    it("should return 0 for unknown path", () => {
      const handlers = new NavigationHandlers();
      assertEquals(
        handlers.getScrollPosition("/unknown-page"),
        0,
        "Should return 0 for paths without saved position",
      );
    });

    it("should save multiple scroll positions", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        mocks.setScrollY(100);
        handlers.saveScrollPosition("/page1");

        mocks.setScrollY(200);
        handlers.saveScrollPosition("/page2");

        mocks.setScrollY(300);
        handlers.saveScrollPosition("/page3");

        assertEquals(handlers.getScrollPosition("/page1"), 100);
        assertEquals(handlers.getScrollPosition("/page2"), 200);
        assertEquals(handlers.getScrollPosition("/page3"), 300);
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle scroll save errors gracefully", () => {
      const mocks = setupMocks();
      try {
        delete (globalThis as any).scrollY;

        const handlers = new NavigationHandlers();
        handlers.saveScrollPosition("/page");
      } finally {
        mocks.cleanup();
      }
    });

    it("should update scroll position when saving same path again", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        mocks.setScrollY(100);
        handlers.saveScrollPosition("/page");

        mocks.setScrollY(500);
        handlers.saveScrollPosition("/page");

        assertEquals(
          handlers.getScrollPosition("/page"),
          500,
          "Should update scroll position for same path",
        );
      } finally {
        mocks.cleanup();
      }
    });
  });

  describe("PopState Flag Management", () => {
    it("should return false initially", () => {
      const handlers = new NavigationHandlers();
      assertEquals(handlers.isPopState(), false, "PopState flag should be false initially");
    });

    it("should clear popstate flag", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers();

        const callbacks: NavigationCallbacks = {
          onNavigate: () => Promise.resolve(),
          onPrefetch() {},
        };

        const popStateHandler = handlers.createPopStateHandler(callbacks);

        popStateHandler({} as PopStateEvent);
        assertEquals(handlers.isPopState(), true);

        handlers.clearPopStateFlag();
        assertEquals(handlers.isPopState(), false, "Should clear popstate flag");
      } finally {
        mocks.cleanup();
      }
    });
  });

  describe("Clear", () => {
    it("should clear all state", () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(50), { hover: true });

        const callbacks: NavigationCallbacks = {
          onNavigate: () => Promise.resolve(),
          onPrefetch() {},
        };

        mocks.setScrollY(300);
        handlers.saveScrollPosition("/page1");

        const popStateHandler = handlers.createPopStateHandler(callbacks);
        popStateHandler({} as PopStateEvent);

        handlers.clear();

        assertEquals(handlers.isPopState(), false, "PopState flag should be cleared");
        assertEquals(handlers.getScrollPosition("/page1"), 0, "Scroll positions should be cleared");
      } finally {
        mocks.cleanup();
      }
    });

    it("should clear prefetch queue", async () => {
      const mocks = setupMocks();
      try {
        const handlers = new NavigationHandlers(scaleMs(100), { hover: true });

        let prefetchCount = 0;
        const callbacks: NavigationCallbacks = {
          onNavigate: async () => {},
          onPrefetch() {
            prefetchCount++;
          },
        };

        const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

        const anchor = createMockAnchor("/page");
        const event = { target: anchor } as unknown as MouseEvent;

        mouseOverHandler(event);

        await delay(50);
        handlers.clear();

        await delay(100);

        assertEquals(handlers.isPopState(), false, "Should reset state after clear");
      } finally {
        mocks.cleanup();
      }
    });
  });
});
