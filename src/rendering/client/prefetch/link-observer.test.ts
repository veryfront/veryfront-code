/**
 * Unit Tests for Link Observer
 * Tests intersection observer-based link prefetching functionality
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { LinkObserver } from "./link-observer.ts";
import type { LinkObserverOptions } from "./link-observer.ts";
import { delay } from "#std/async.ts";

// Mock IntersectionObserver
class MockIntersectionObserver {
  callback: IntersectionObserverCallback;
  options: IntersectionObserverInit;
  observedElements = new Set<Element>();

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.options = options;
  }

  observe(element: Element) {
    this.observedElements.add(element);
  }

  unobserve(element: Element) {
    this.observedElements.delete(element);
  }

  disconnect() {
    this.observedElements.clear();
  }

  triggerIntersection(element: Element, isIntersecting: boolean) {
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

// Mock MutationObserver
class MockMutationObserver {
  callback: MutationCallback;
  observedTarget: Node | null = null;
  observerOptions: MutationObserverInit | null = null;

  constructor(callback: MutationCallback) {
    this.callback = callback;
  }

  observe(target: Node, options: MutationObserverInit) {
    this.observedTarget = target;
    this.observerOptions = options;
  }

  disconnect() {
    this.observedTarget = null;
    this.observerOptions = null;
  }

  triggerMutation(addedNodes: Node[]) {
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

// Setup global mocks
const setupMocks = () => {
  const originalIntersectionObserver = (globalThis as any).IntersectionObserver;
  const originalMutationObserver = (globalThis as any).MutationObserver;
  const originalDocument = globalThis.document;
  const originalLocation = globalThis.location;
  const originalNode = (globalThis as any).Node;

  let mockIntersectionObserver: MockIntersectionObserver | null = null;
  let mockMutationObserver: MockMutationObserver | null = null;
  (globalThis as any).IntersectionObserver = class {
    constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit) {
      mockIntersectionObserver = new MockIntersectionObserver(callback, options);
      return mockIntersectionObserver;
    }
  };
  (globalThis as any).MutationObserver = class {
    constructor(callback: MutationCallback) {
      mockMutationObserver = new MockMutationObserver(callback);
      return mockMutationObserver;
    }
  };

  // Mock Node constants
  (globalThis as any).Node = {
    ELEMENT_NODE: 1,
    TEXT_NODE: 3,
    COMMENT_NODE: 8,
    DOCUMENT_NODE: 9,
    DOCUMENT_FRAGMENT_NODE: 11,
  };

  // Mock document
  const mockDocument = {
    querySelectorAll: (_selector: string) => [],
    body: {},
  };
  (globalThis as any).document = mockDocument; // Mock location
  (globalThis as any).location = {
    hostname: "example.com",
    href: "http://example.com/current",
    pathname: "/current",
  };

  return {
    cleanup: () => {
      (globalThis as any).IntersectionObserver = originalIntersectionObserver;
      (globalThis as any).MutationObserver = originalMutationObserver;
      (globalThis as any).Node = originalNode;
      (globalThis as any).document = originalDocument;
      (globalThis as any).location = originalLocation;
    },
    getMockIntersectionObserver: () => mockIntersectionObserver!,
    getMockMutationObserver: () => mockMutationObserver!,
    setDocument: (doc: any) => {
      (globalThis as any).document = doc;
    },
  };
};

describe("LinkObserver", () => {
  describe("Constructor and Initialization", () => {
    it("should create LinkObserver with options and prefetchedUrls", () => {
      const mocks = setupMocks();

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      assertExists(observer);

      mocks.cleanup();
    });

    it("should initialize intersection observer with correct rootMargin", () => {
      const mocks = setupMocks();

      const options: LinkObserverOptions = {
        rootMargin: "200px",
        delay: 50,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.options.rootMargin, "200px");

      observer.destroy();
      mocks.cleanup();
    });

    it("should setup mutation observer on document.body", () => {
      const mocks = setupMocks();

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
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

      const link1 = {
        tagName: "A",
        href: "http://example.com/page1",
        hostname: "example.com",
        pathname: "/page1",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      const link2 = {
        tagName: "A",
        href: "http://example.com/page2",
        hostname: "example.com",
        pathname: "/page2",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: (selector: string) => {
          if (selector === 'a[href^="/"], a[href^="./"]') {
            return [link1, link2];
          }
          return [];
        },
        body: {},
      });

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 2);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe external links", () => {
      const mocks = setupMocks();

      const externalLink = {
        tagName: "A",
        href: "http://external.com/page",
        hostname: "external.com",
        pathname: "/page",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [externalLink],
        body: {},
      });

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe links with download attribute", () => {
      const mocks = setupMocks();

      const downloadLink = {
        tagName: "A",
        href: "http://example.com/file.pdf",
        hostname: "example.com",
        pathname: "/file.pdf",
        hash: "",
        target: "",
        hasAttribute: (attr: string) => attr === "download",
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [downloadLink],
        body: {},
      });

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it('should not observe links with target="_blank"', () => {
      const mocks = setupMocks();

      const blankLink = {
        tagName: "A",
        href: "http://example.com/page",
        hostname: "example.com",
        pathname: "/page",
        hash: "",
        target: "_blank",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [blankLink],
        body: {},
      });

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe already prefetched URLs", () => {
      const mocks = setupMocks();

      const link = {
        tagName: "A",
        href: "http://example.com/prefetched",
        hostname: "example.com",
        pathname: "/prefetched",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [link],
        body: {},
      });

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set(["http://example.com/prefetched"]);

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe current page URL", () => {
      const mocks = setupMocks();

      const currentLink = {
        tagName: "A",
        href: "http://example.com/current",
        hostname: "example.com",
        pathname: "/current",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [currentLink],
        body: {},
      });

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe hash-only links on same page", () => {
      const mocks = setupMocks();

      const hashLink = {
        tagName: "A",
        href: "http://example.com/current#section",
        hostname: "example.com",
        pathname: "/current",
        hash: "#section",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [hashLink],
        body: {},
      });

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not observe links with data-no-prefetch attribute", () => {
      const mocks = setupMocks();

      const noPrefetchLink = {
        tagName: "A",
        href: "http://example.com/page",
        hostname: "example.com",
        pathname: "/page",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: { noPrefetch: true },
      };

      mocks.setDocument({
        querySelectorAll: () => [noPrefetchLink],
        body: {},
      });

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
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

      const link = {
        tagName: "A",
        href: "http://example.com/page",
        hostname: "example.com",
        pathname: "/page",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [link],
        body: {},
      });

      let callbackCalled = false;
      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 0,
        onLinkVisible: (visibleLink) => {
          callbackCalled = true;
          assertEquals(visibleLink.href, link.href);
        },
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      mockIO.triggerIntersection(link as any, true);

      // Wait for callback to be called
      await delay(10);

      assertEquals(callbackCalled, true);

      observer.destroy();
      mocks.cleanup();
    });

    it("should respect delay option before calling onLinkVisible", async () => {
      const mocks = setupMocks();

      const link = {
        tagName: "A",
        href: "http://example.com/page",
        hostname: "example.com",
        pathname: "/page",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [link],
        body: {},
      });

      let callbackTime = 0;
      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 50,
        onLinkVisible: () => {
          callbackTime = Date.now();
        },
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      const startTime = Date.now();
      mockIO.triggerIntersection(link as any, true);

      // Wait for delay
      await delay(100);

      const elapsed = callbackTime - startTime;
      assertEquals(elapsed >= 50, true);

      observer.destroy();
      mocks.cleanup();
    });

    it("should not call onLinkVisible when link is not intersecting", async () => {
      const mocks = setupMocks();

      const link = {
        tagName: "A",
        href: "http://example.com/page",
        hostname: "example.com",
        pathname: "/page",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [link],
        body: {},
      });

      let callbackCalled = false;
      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 0,
        onLinkVisible: () => {
          callbackCalled = true;
        },
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
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

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();

      const newLink = {
        nodeType: 1, // Node.ELEMENT_NODE
        tagName: "A",
        href: "http://example.com/new-page",
        hostname: "example.com",
        pathname: "/new-page",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
        querySelectorAll: () => [],
      };

      const mockMO = mocks.getMockMutationObserver();
      mockMO.triggerMutation([newLink as any]);

      // Should have observed the new link
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

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();

      const innerLink = {
        tagName: "A",
        href: "http://example.com/inner",
        hostname: "example.com",
        pathname: "/inner",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      const newContainer = {
        nodeType: 1,
        tagName: "DIV",
        querySelectorAll: (selector: string) => {
          if (selector === 'a[href^="/"], a[href^="./"]') {
            return [innerLink];
          }
          return [];
        },
      };

      const mockMO = mocks.getMockMutationObserver();
      mockMO.triggerMutation([newContainer as any]);

      // Should have observed the inner link
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

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();

      const textNode = {
        nodeType: 3, // Node.TEXT_NODE
      };

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

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
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

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
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

      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 100,
        onLinkVisible: () => {},
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
      observer.init();

      const mockIO = mocks.getMockIntersectionObserver();
      assertEquals(mockIO.observedElements.size, 0);

      observer.destroy();
      mocks.cleanup();
    });

    it("should handle multiple links becoming visible simultaneously", async () => {
      const mocks = setupMocks();

      const link1 = {
        tagName: "A",
        href: "http://example.com/page1",
        hostname: "example.com",
        pathname: "/page1",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      const link2 = {
        tagName: "A",
        href: "http://example.com/page2",
        hostname: "example.com",
        pathname: "/page2",
        hash: "",
        target: "",
        hasAttribute: () => false,
        dataset: {},
      };

      mocks.setDocument({
        querySelectorAll: () => [link1, link2],
        body: {},
      });

      const calledLinks: HTMLAnchorElement[] = [];
      const options: LinkObserverOptions = {
        rootMargin: "100px",
        delay: 0,
        onLinkVisible: (link) => {
          calledLinks.push(link);
        },
      };
      const prefetchedUrls = new Set<string>();

      const observer = new LinkObserver(options, prefetchedUrls);
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
