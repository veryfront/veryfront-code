import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { NavigationCallbacks, NavigationHandlers } from "./navigation-handlers.ts";

interface MockElement {
  tagName?: string;
  getAttribute?: (name: string) => string | null;
  parentElement?: MockElement | null;
  _attributes?: Map<string, string>;
}

interface MockLocation {
  pathname: string;
}

const setupMocks = () => {
  const originalLocation = (globalThis as any).location;
  const originalScrollY = (globalThis as any).scrollY;
  const originalHTMLAnchorElement = (globalThis as any).HTMLAnchorElement;
  const originalHTMLElement = (globalThis as any).HTMLElement;

  const mockLocation: MockLocation = {
    pathname: "/current-page",
  };

  // Mock HTMLElement base class for instanceof checks
  class MockHTMLElement {
    tagName = "";
    private _attributes = new Map<string, string>();

    getAttribute(name: string): string | null {
      return this._attributes.get(name) || null;
    }

    setAttribute(name: string, value: string): void {
      this._attributes.set(name, value);
    }
  }

  // Mock HTMLAnchorElement extending HTMLElement
  class MockHTMLAnchorElement extends MockHTMLElement {
    constructor() {
      super();
      this.tagName = "A";
    }
  }

  (globalThis as any).location = mockLocation;
  (globalThis as any).scrollY = 0;
  (globalThis as any).HTMLElement = MockHTMLElement;
  (globalThis as any).HTMLAnchorElement = MockHTMLAnchorElement;

  return {
    mockLocation,
    setScrollY: (value: number) => {
      (globalThis as any).scrollY = value;
    },
    cleanup: () => {
      (globalThis as any).location = originalLocation;
      (globalThis as any).scrollY = originalScrollY;
      (globalThis as any).HTMLAnchorElement = originalHTMLAnchorElement;
      (globalThis as any).HTMLElement = originalHTMLElement;
    },
  };
};

const createMockAnchor = (href: string, attributes: Record<string, string> = {}): any => {
  const MockHTMLAnchorElement = (globalThis as any).HTMLAnchorElement;
  if (!MockHTMLAnchorElement) {
    throw new Error("MockHTMLAnchorElement not set up. Call setupMocks() first.");
  }
  const anchor = new MockHTMLAnchorElement();
  anchor.setAttribute("href", href);
  for (const [key, value] of Object.entries(attributes)) {
    anchor.setAttribute(key, value);
  }
  (anchor as any).parentElement = null;
  return anchor;
};

const createMockElement = (
  tagName: string,
  attributes: Record<string, string> = {},
): MockElement => {
  const MockHTMLElement = (globalThis as any).HTMLElement;
  if (!MockHTMLElement) {
    // Fallback for tests that don't call setupMocks()
    const attrs = new Map<string, string>(Object.entries(attributes));
    return {
      tagName: tagName.toUpperCase(),
      getAttribute: (name: string) => attrs.get(name) || null,
      parentElement: null,
      _attributes: attrs,
    } as MockElement;
  }
  const element = new MockHTMLElement();
  element.tagName = tagName.toUpperCase();
  for (const [key, value] of Object.entries(attributes)) {
    element.setAttribute(key, value);
  }
  (element as any).parentElement = null;
  return element as MockElement;
};

describe("NavigationHandlers", () => {
  describe("Constructor", () => {
    it("should create NavigationHandlers with default prefetch delay", () => {
      const handlers = new NavigationHandlers();
      assertExists(handlers, "NavigationHandlers instance should be created");
    });

    it("should create NavigationHandlers with custom prefetch delay", () => {
      const handlers = new NavigationHandlers(500);
      assertExists(handlers, "NavigationHandlers with custom delay should be created");
    });

    it("should create NavigationHandlers with prefetch options", () => {
      const handlers = new NavigationHandlers(100, { hover: true, viewport: true });
      assertExists(handlers, "NavigationHandlers with prefetch options should be created");
    });
  });

  describe("createClickHandler", () => {
    it("should handle click on internal link", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      let navigatedUrl = "";
      const callbacks: NavigationCallbacks = {
        onNavigate: (url: string) => {
          navigatedUrl = url;
          return Promise.resolve();
        },
        onPrefetch: () => {},
      };

      const clickHandler = handlers.createClickHandler(callbacks);

      const anchor = createMockAnchor("/about");
      const event = {
        target: anchor,
        preventDefault: () => {},
      } as unknown as MouseEvent;

      clickHandler(event);

      assertEquals(navigatedUrl, "/about", "Should navigate to internal link URL");

      mocks.cleanup();
    });

    it("should prevent default behavior on internal link click", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      const callbacks: NavigationCallbacks = {
        onNavigate: () => Promise.resolve(),
        onPrefetch: () => {},
      };

      const clickHandler = handlers.createClickHandler(callbacks);

      let preventDefaultCalled = false;
      const anchor = createMockAnchor("/about");
      const event = {
        target: anchor,
        preventDefault: () => {
          preventDefaultCalled = true;
        },
      } as unknown as MouseEvent;

      clickHandler(event);

      assertEquals(preventDefaultCalled, true, "Should prevent default link behavior");

      mocks.cleanup();
    });

    it("should ignore click on external link", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      let navigationCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: () => {
          navigationCalled = true;
          return Promise.resolve();
        },
        onPrefetch: () => {},
      };

      const clickHandler = handlers.createClickHandler(callbacks);

      const anchor = createMockAnchor("https://external.com/page");
      const event = {
        target: anchor,
        preventDefault: () => {},
      } as unknown as MouseEvent;

      clickHandler(event);

      assertEquals(navigationCalled, false, "Should not navigate for external links");

      mocks.cleanup();
    });

    it("should ignore click on link with target=_blank", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      let navigationCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: () => {
          navigationCalled = true;
          return Promise.resolve();
        },
        onPrefetch: () => {},
      };

      const clickHandler = handlers.createClickHandler(callbacks);

      const anchor = createMockAnchor("/page", { target: "_blank" });
      const event = {
        target: anchor,
        preventDefault: () => {},
      } as unknown as MouseEvent;

      clickHandler(event);

      assertEquals(navigationCalled, false, "Should not navigate for links with target=_blank");

      mocks.cleanup();
    });

    it("should ignore click on download link", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      let navigationCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: () => {
          navigationCalled = true;
          return Promise.resolve();
        },
        onPrefetch: () => {},
      };

      const clickHandler = handlers.createClickHandler(callbacks);

      const anchor = createMockAnchor("/file.pdf", { download: "file.pdf" });
      const event = {
        target: anchor,
        preventDefault: () => {},
      } as unknown as MouseEvent;

      clickHandler(event);

      assertEquals(navigationCalled, false, "Should not navigate for download links");

      mocks.cleanup();
    });

    it("should ignore click on hash link", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      let navigationCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: () => {
          navigationCalled = true;
          return Promise.resolve();
        },
        onPrefetch: () => {},
      };

      const clickHandler = handlers.createClickHandler(callbacks);

      const anchor = createMockAnchor("#section");
      const event = {
        target: anchor,
        preventDefault: () => {},
      } as unknown as MouseEvent;

      clickHandler(event);

      assertEquals(navigationCalled, false, "Should not navigate for hash links");

      mocks.cleanup();
    });

    it("should ignore click on non-anchor element", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      let navigationCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: () => {
          navigationCalled = true;
          return Promise.resolve();
        },
        onPrefetch: () => {},
      };

      const clickHandler = handlers.createClickHandler(callbacks);

      const div = createMockElement("div");
      const event = {
        target: div,
        preventDefault: () => {},
      } as unknown as MouseEvent;

      clickHandler(event);

      assertEquals(navigationCalled, false, "Should not navigate for non-anchor elements");

      mocks.cleanup();
    });
  });

  describe("createPopStateHandler", () => {
    it("should handle browser back/forward navigation", () => {
      const mocks = setupMocks();
      mocks.mockLocation.pathname = "/new-page";

      const handlers = new NavigationHandlers();

      let navigatedUrl = "";
      const callbacks: NavigationCallbacks = {
        onNavigate: (url: string) => {
          navigatedUrl = url;
          return Promise.resolve();
        },
        onPrefetch: () => {},
      };

      const popStateHandler = handlers.createPopStateHandler(callbacks);

      const event = {} as PopStateEvent;
      popStateHandler(event);

      assertEquals(navigatedUrl, "/new-page", "Should navigate to current pathname");

      mocks.cleanup();
    });

    it("should set popstate navigation flag", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      const callbacks: NavigationCallbacks = {
        onNavigate: () => Promise.resolve(),
        onPrefetch: () => {},
      };

      const popStateHandler = handlers.createPopStateHandler(callbacks);

      assertEquals(handlers.isPopState(), false, "PopState flag should be false initially");

      const event = {} as PopStateEvent;
      popStateHandler(event);

      assertEquals(
        handlers.isPopState(),
        true,
        "PopState flag should be true after popstate event",
      );

      mocks.cleanup();
    });
  });

  describe("createMouseOverHandler", () => {
    it("should prefetch link on mouseover when hover is enabled", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(50, { hover: true });

      let prefetchedUrl = "";
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: (url: string) => {
          prefetchedUrl = url;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const anchor = createMockAnchor("/page");
      const event = {
        target: anchor,
      } as unknown as MouseEvent;

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assertEquals(prefetchedUrl, "/page", "Should prefetch link after delay");
      mocks.cleanup();
    });

    it("should ignore mouseover on non-anchor element", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(50, { hover: true });

      let prefetchCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: () => {
          prefetchCalled = true;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const div = createMockElement("div");
      const event = {
        target: div,
      } as unknown as MouseEvent;

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assertEquals(prefetchCalled, false, "Should not prefetch for non-anchor elements");
      mocks.cleanup();
    });

    it("should ignore mouseover on external link", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(50, { hover: true });

      let prefetchCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: () => {
          prefetchCalled = true;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const anchor = createMockAnchor("https://external.com/page");
      const event = {
        target: anchor,
      } as unknown as MouseEvent;

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assertEquals(prefetchCalled, false, "Should not prefetch external links");
      mocks.cleanup();
    });

    it("should ignore mouseover on hash link", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(50, { hover: true });

      let prefetchCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: () => {
          prefetchCalled = true;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const anchor = createMockAnchor("#section");
      const event = {
        target: anchor,
      } as unknown as MouseEvent;

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assertEquals(prefetchCalled, false, "Should not prefetch hash links");
      mocks.cleanup();
    });

    it("should respect data-prefetch=false attribute", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(50, { hover: true });

      let prefetchCalled = false;
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: () => {
          prefetchCalled = true;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const anchor = createMockAnchor("/page", { "data-prefetch": "false" });
      const event = {
        target: anchor,
      } as unknown as MouseEvent;

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assertEquals(prefetchCalled, false, "Should not prefetch when data-prefetch=false");
      mocks.cleanup();
    });

    it("should prefetch when data-prefetch=true even if hover is disabled", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(50, { hover: false });

      let prefetchedUrl = "";
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: (url: string) => {
          prefetchedUrl = url;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const anchor = createMockAnchor("/page", { "data-prefetch": "true" });
      const event = {
        target: anchor,
      } as unknown as MouseEvent;

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assertEquals(prefetchedUrl, "/page", "Should prefetch when data-prefetch=true");
      mocks.cleanup();
    });

    it("should not prefetch same URL multiple times concurrently", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(100, { hover: true });

      let prefetchCount = 0;
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: () => {
          prefetchCount++;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const anchor = createMockAnchor("/page");
      const event = {
        target: anchor,
      } as unknown as MouseEvent;

      mouseOverHandler(event);
      mouseOverHandler(event);
      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 150));

      assertEquals(prefetchCount, 1, "Should only prefetch once for concurrent hovers");
      mocks.cleanup();
    });

    it("should remove URL from queue after prefetch", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(50, { hover: true });

      let prefetchCount = 0;
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: () => {
          prefetchCount++;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const anchor = createMockAnchor("/page");
      const event = {
        target: anchor,
      } as unknown as MouseEvent;

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 100));

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 100));

      assertEquals(prefetchCount, 2, "Should allow prefetch again after removal from queue");
      mocks.cleanup();
    });
  });

  describe("Scroll Position Management", () => {
    it("should save scroll position for a path", () => {
      const mocks = setupMocks();
      mocks.setScrollY(300);

      const handlers = new NavigationHandlers();

      handlers.saveScrollPosition("/page1");

      assertEquals(handlers.getScrollPosition("/page1"), 300, "Should save scroll position");

      mocks.cleanup();
    });

    it("should retrieve saved scroll position", () => {
      const mocks = setupMocks();
      mocks.setScrollY(500);

      const handlers = new NavigationHandlers();

      handlers.saveScrollPosition("/page2");
      mocks.setScrollY(0); // Change scroll position

      const savedPosition = handlers.getScrollPosition("/page2");

      assertEquals(savedPosition, 500, "Should retrieve previously saved scroll position");

      mocks.cleanup();
    });

    it("should return 0 for unknown path", () => {
      const handlers = new NavigationHandlers();

      const position = handlers.getScrollPosition("/unknown-page");

      assertEquals(position, 0, "Should return 0 for paths without saved position");
    });

    it("should save multiple scroll positions", () => {
      const mocks = setupMocks();

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

      mocks.cleanup();
    });

    it("should handle scroll save errors gracefully", () => {
      const mocks = setupMocks();
      delete (globalThis as any).scrollY;

      const handlers = new NavigationHandlers();

      handlers.saveScrollPosition("/page");

      mocks.cleanup();
    });

    it("should update scroll position when saving same path again", () => {
      const mocks = setupMocks();

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

      mocks.cleanup();
    });
  });

  describe("PopState Flag Management", () => {
    it("should return false initially", () => {
      const handlers = new NavigationHandlers();

      assertEquals(handlers.isPopState(), false, "PopState flag should be false initially");
    });

    it("should clear popstate flag", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers();

      const callbacks: NavigationCallbacks = {
        onNavigate: () => Promise.resolve(),
        onPrefetch: () => {},
      };

      const popStateHandler = handlers.createPopStateHandler(callbacks);

      popStateHandler({} as PopStateEvent);
      assertEquals(handlers.isPopState(), true);

      handlers.clearPopStateFlag();
      assertEquals(handlers.isPopState(), false, "Should clear popstate flag");

      mocks.cleanup();
    });
  });

  describe("Clear", () => {
    it("should clear all state", () => {
      const mocks = setupMocks();

      const handlers = new NavigationHandlers(50, { hover: true });

      const callbacks: NavigationCallbacks = {
        onNavigate: () => Promise.resolve(),
        onPrefetch: () => {},
      };

      mocks.setScrollY(300);
      handlers.saveScrollPosition("/page1");

      const popStateHandler = handlers.createPopStateHandler(callbacks);
      popStateHandler({} as PopStateEvent);

      handlers.clear();

      assertEquals(handlers.isPopState(), false, "PopState flag should be cleared");
      assertEquals(
        handlers.getScrollPosition("/page1"),
        0,
        "Scroll positions should be cleared",
      );

      mocks.cleanup();
    });

    it("should clear prefetch queue", async () => {
      const mocks = setupMocks();
      const handlers = new NavigationHandlers(100, { hover: true });

      let prefetchCount = 0;
      const callbacks: NavigationCallbacks = {
        onNavigate: async () => {},
        onPrefetch: () => {
          prefetchCount++;
        },
      };

      const mouseOverHandler = handlers.createMouseOverHandler(callbacks);

      const anchor = createMockAnchor("/page");
      const event = {
        target: anchor,
      } as unknown as MouseEvent;

      mouseOverHandler(event);

      await new Promise((resolve) => setTimeout(resolve, 50));
      handlers.clear();

      await new Promise((resolve) => setTimeout(resolve, 100));

      assertEquals(handlers.isPopState(), false, "Should reset state after clear");
      mocks.cleanup();
    });
  });
});
