import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { scaleMs } from "#veryfront/testing/timing.ts";
import { LinkObserver } from "./link-observer.ts";
import type { LinkObserverOptions } from "./link-observer.ts";

class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit;
  observedElements = new Set<Element>();

  constructor(
    callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.callback = callback;
    this.options = options;
  }

  observe(element: Element): void {
    this.observedElements.add(element);
  }

  unobserve(element: Element): void {
    this.observedElements.delete(element);
  }

  disconnect(): void {
    this.observedElements.clear();
  }

  triggerIntersection(element: Element, isIntersecting: boolean): void {
    const entry: IntersectionObserverEntry = {
      target: element,
      isIntersecting,
      boundingClientRect: {} as DOMRectReadOnly,
      intersectionRatio: isIntersecting ? 1 : 0,
      intersectionRect: {} as DOMRectReadOnly,
      rootBounds: null,
      time: Date.now(),
    };

    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

class MockMutationObserver {
  callback: MutationCallback;
  observedTarget: Node | null = null;
  observerOptions: MutationObserverInit | null = null;

  constructor(callback: MutationCallback) {
    this.callback = callback;
  }

  observe(target: Node, options: MutationObserverInit): void {
    this.observedTarget = target;
    this.observerOptions = options;
  }

  disconnect(): void {
    this.observedTarget = null;
    this.observerOptions = null;
  }

  triggerMutation(addedNodes: Node[]): void {
    const mutation: MutationRecord = {
      type: "childList",
      target: this.observedTarget!,
      addedNodes: addedNodes as unknown as NodeList,
      removedNodes: [] as unknown as NodeList,
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null,
    };

    this.callback([mutation], this as unknown as MutationObserver);
  }
}

function createLink(overrides: Partial<any> = {}): any {
  return {
    tagName: "A",
    href: "http://example.com/page",
    hostname: "example.com",
    pathname: "/page",
    hash: "",
    target: "",
    hasAttribute: () => false,
    dataset: {},
    ...overrides,
  };
}

function createOptions(overrides: Partial<LinkObserverOptions> = {}): LinkObserverOptions {
  return {
    rootMargin: "100px",
    delay: 100,
    onLinkVisible: () => {},
    ...overrides,
  };
}

function setupMocks(): {
  cleanup: () => void;
  getMockIntersectionObserver: () => MockIntersectionObserver;
  getMockMutationObserver: () => MockMutationObserver;
  setDocument: (doc: any) => void;
} {
  const g = globalThis as any;

  const originalIntersectionObserver = g.IntersectionObserver;
  const originalMutationObserver = g.MutationObserver;
  const originalDocument = g.document;
  const originalLocation = g.location;
  const originalNode = g.Node;

  let mockIntersectionObserver: MockIntersectionObserver | null = null;
  let mockMutationObserver: MockMutationObserver | null = null;

  g.IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      mockIntersectionObserver = new MockIntersectionObserver(callback, options);
      return mockIntersectionObserver;
    }
  };

  g.MutationObserver = class {
    constructor(callback: MutationCallback) {
      mockMutationObserver = new MockMutationObserver(callback);
      return mockMutationObserver;
    }
  };

  g.Node = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_FRAGMENT_NODE: 11,
  };

  g.document = {
    querySelectorAll: (_selector: string) => [],
    body: {},
  };

  g.location = {
    hostname: "example.com",
    href: "http://example.com/current",
    pathname: "/current",
  };

  return {
    cleanup: () => {
      g.IntersectionObserver = originalIntersectionObserver;
      g.MutationObserver = originalMutationObserver;
      g.Node = originalNode;
      g.document = originalDocument;
      g.location = originalLocation;
    },
    getMockIntersectionObserver: () => mockIntersectionObserver!,
    getMockMutationObserver: () => mockMutationObserver!,
    setDocument: (doc: any) => {
      g.document = doc;
    },
  };
}

describe("LinkObserver", () => {
  describe("Constructor and Initialization", () => {
    it("should create LinkObserver with options and prefetchedUrls", () => {
      const mocks = setupMocks();

      const observer = new LinkObserver(createOptions(), new Set<string>());
      assertExists(observer);

      mocks.cleanup();
    });

    it("should initialize intersection observer with correct rootMargin", () => {
      const mocks = setupMocks();

      const observer = new LinkObserver(
        createOptions({ rootMargin: "200px", delay: 50 }),
        new Set<string>(),
      );
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.options.rootMargin, "200px");

      observer.destroy();
      mocks.cleanup();
    });

    it("should setup mutation observer on document.body", () => {
      const mocks = setupMocks();

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockMO = mocks.getMockMutationObserver();
      assertEquals(mockMO.observedTarget, (globalThis as any).document.body);
      assertEquals(mockMO.observerOptions?.childList, true);
      assertEquals(mockMO.observerOptions?.subtree, true);

      observer.destroy();
      mocks.cleanup();
    });
  });

  describe("Link Detection and Observation", () => {
    it("should observe valid internal links on init", () => {
      const mocks = setupMocks();

      const link1 = createLink({ href: "http://example.com/page1", pathname: "/page1" });
      const link2 = createLink({ href: "http://example.com/page2", pathname: "/page2" });

      mocks.setDocument({
        querySelectorAll: (selector: string) => {
          if (selector === 'a[href^="/"], a[href^="./"]') return [link1, link2];
          return [];
        },
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 2);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe external links", () => {
      const mocks = setupMocks();

      const externalLink = createLink({
        href: "http://external.com/page",
        hostname: "external.com",
        pathname: "/page",
      });

      mocks.setDocument({
        querySelectorAll: () => [externalLink],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe links with download attribute", () => {
      const mocks = setupMocks();

      const downloadLink = createLink({
        href: "http://example.com/file.pdf",
        pathname: "/file.pdf",
        hasAttribute: (attr: string) => attr === "download",
      });

      mocks.setDocument({
        querySelectorAll: () => [downloadLink],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it('should not observe links with target="_blank"', () => {
      const mocks = setupMocks();

      const blankLink = createLink({ target: "_blank" });

      mocks.setDocument({
        querySelectorAll: () => [blankLink],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe already prefetched URLs", () => {
      const mocks = setupMocks();

      const link = createLink({
        href: "http://example.com/prefetched",
        pathname: "/prefetched",
      });

      mocks.setDocument({
        querySelectorAll: () => [link],
        body: {},
      });

      const observer = new LinkObserver(
        createOptions(),
        new Set(["http://example.com/prefetched"]),
      );
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe current page URL", () => {
      const mocks = setupMocks();

      const currentLink = createLink({
        href: "http://example.com/current",
        pathname: "/current",
      });

      mocks.setDocument({
        querySelectorAll: () => [currentLink],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe hash-only links on same page", () => {
      const mocks = setupMocks();

      const hashLink = createLink({
        href: "http://example.com/current#section",
        pathname: "/current",
        hash: "#section",
      });

      mocks.setDocument({
        querySelectorAll: () => [hashLink],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe links with data-no-prefetch attribute", () => {
      const mocks = setupMocks();

      const noPrefetchLink = createLink({ dataset: { noPrefetch: true } });

      mocks.setDocument({
        querySelectorAll: () => [noPrefetchLink],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });
  });

  describe("Intersection Handling", () => {
    it("should call onLinkVisible when link becomes visible", async () => {
      const mocks = setupMocks();

      const link = createLink();

      mocks.setDocument({
        querySelectorAll: () => [link],
        body: {},
      });

      let callbackCalled = false;
      const observer = new LinkObserver(
        createOptions({
          delay: 0,
          onLinkVisible: (visibleLink) => {
            callbackCalled = true;
            assertEquals(visibleLink.href, link.href);
          },
        }),
        new Set<string>(),
      );
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      mockIO.triggerIntersection(link as any, true);

      await delay(10);

      assertEquals(callbackCalled, true);

      observer.destroy();
      mocks.cleanup();
    });

    it("should respect delay option before calling onLinkVisible", async () => {
      const mocks = setupMocks();

      const link = createLink();

      mocks.setDocument({
        querySelectorAll: () => [link],
        body: {},
      });

      const delayMs = scaleMs(50);
      let callbackTime = 0;
      const observer = new LinkObserver(
        createOptions({
          delay: delayMs,
          onLinkVisible: () => {
            callbackTime = Date.now();
          },
        }),
        new Set<string>(),
      );
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      const startTime = Date.now();
      mockIO.triggerIntersection(link as any, true);

      await delay(100);

      assertEquals(callbackTime - startTime >= delayMs, true);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not call onLinkVisible when link is not intersecting", async () => {
      const mocks = setupMocks();

      const link = createLink();

      mocks.setDocument({
        querySelectorAll: () => [link],
        body: {},
      });

      let callbackCalled = false;
      const observer = new LinkObserver(
        createOptions({
          delay: 0,
          onLinkVisible: () => {
            callbackCalled = true;
          },
        }),
        new Set<string>(),
      );
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      mockIO.triggerIntersection(link as any, false);

      await delay(10);

      assertEquals(callbackCalled, false);

      observer.destroy();
      mocks.cleanup();
    });
  });

  describe("Dynamic Link Detection", () => {
    it("should observe new links added via mutation observer", () => {
      const mocks = setupMocks();

      mocks.setDocument({
        querySelectorAll: () => [],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();

      const newLink = {
        nodeType: 1,
        ...createLink({
          href: "http://example.com/new-page",
          pathname: "/new-page",
        }),
        querySelectorAll: () => [],
      };

      const mockMO = mocks.getMockMutationObserver();
      mockMO.triggerMutation([newLink as any]);

      assertEquals(mockIO.observedElements.has(newLink as any), true);

      observer.destroy();
      mocks.cleanup();
    });

    it("should observe links inside newly added containers", () => {
      const mocks = setupMocks();

      mocks.setDocument({
        querySelectorAll: () => [],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();

      const innerLink = createLink({
        href: "http://example.com/inner",
        pathname: "/inner",
      });

      const newContainer = {
        nodeType: 1,
        tagName: "DIV",
        querySelectorAll: (selector: string) => {
          if (selector === 'a[href^="/"], a[href^="./"]') return [innerLink];
          return [];
        },
      };

      const mockMO = mocks.getMockMutationObserver();
      mockMO.triggerMutation([newContainer as any]);

      assertEquals(mockIO.observedElements.has(innerLink as any), true);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe invalid nodes added via mutation observer", () => {
      const mocks = setupMocks();

      mocks.setDocument({
        querySelectorAll: () => [],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();

      const textNode = { nodeType: 3 };

      const mockMO = mocks.getMockMutationObserver();
      mockMO.triggerMutation([textNode as any]);

      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });
  });

  describe("Cleanup and Destroy", () => {
    it("should disconnect observers on destroy", () => {
      const mocks = setupMocks();

      mocks.setDocument({
        querySelectorAll: () => [],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      const mockMO = mocks.getMockMutationObserver();

      assertEquals(mockIO.observedElements.size >= 0, true);
      assertEquals(mockMO.observedTarget !== null, true);

      observer.destroy();

      assertEquals(mockIO.observedElements.size, 0);
      assertEquals(mockMO.observedTarget, null);

      mocks.cleanup();
    });

    it("should be safe to call destroy multiple times", () => {
      const mocks = setupMocks();

      mocks.setDocument({
        querySelectorAll: () => [],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      observer.destroy();
      observer.destroy();
      observer.destroy();

      const mockIO = mocks.getMockIntersectionObserver();
      const mockMO = mocks.getMockMutationObserver();

      assertEquals(mockIO.observedElements.size, 0);
      assertEquals(mockMO.observedTarget, null);

      mocks.cleanup();
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty document", () => {
      const mocks = setupMocks();

      mocks.setDocument({
        querySelectorAll: () => [],
        body: {},
      });

      const observer = new LinkObserver(createOptions(), new Set<string>());
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should handle multiple links becoming visible simultaneously", async () => {
      const mocks = setupMocks();

      const link1 = createLink({ href: "http://example.com/page1", pathname: "/page1" });
      const link2 = createLink({ href: "http://example.com/page2", pathname: "/page2" });

      mocks.setDocument({
        querySelectorAll: () => [link1, link2],
        body: {},
      });

      const calledLinks: HTMLAnchorElement[] = [];
      const observer = new LinkObserver(
        createOptions({
          delay: 0,
          onLinkVisible: (link) => {
            calledLinks.push(link);
          },
        }),
        new Set<string>(),
      );
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      mockIO.triggerIntersection(link1 as any, true);
      mockIO.triggerIntersection(link2 as any, true);

      await delay(10);

      assertEquals(calledLinks.length, 2);

      observer.destroy();
      mocks.cleanup();
    });
  });
});
