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

function createLink(overrides: Record<string, unknown> = {}): any {
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

function createOptions(
  overrides: Partial<LinkObserverOptions> = {},
): LinkObserverOptions {
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
    constructor(
      callback: IntersectionObserverCallback,
      options: IntersectionObserverInit,
    ) {
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

function withMocks(test: (mocks: ReturnType<typeof setupMocks>) => void): void {
  const mocks = setupMocks();
  try {
    test(mocks);
  } finally {
    mocks.cleanup();
  }
}

async function withMocksAsync(
  test: (mocks: ReturnType<typeof setupMocks>) => Promise<void>,
): Promise<void> {
  const mocks = setupMocks();
  try {
    await test(mocks);
  } finally {
    mocks.cleanup();
  }
}

function withObserver(
  _mocks: ReturnType<typeof setupMocks>,
  options: LinkObserverOptions,
  prefetchedUrls: Set<string>,
  test: (observer: LinkObserver) => void,
): void {
  const observer = new LinkObserver(options, prefetchedUrls);
  try {
    test(observer);
  } finally {
    observer.destroy();
  }
}

async function withObserverAsync(
  _mocks: ReturnType<typeof setupMocks>,
  options: LinkObserverOptions,
  prefetchedUrls: Set<string>,
  test: (observer: LinkObserver) => Promise<void>,
): Promise<void> {
  const observer = new LinkObserver(options, prefetchedUrls);
  try {
    await test(observer);
  } finally {
    observer.destroy();
  }
}

describe("LinkObserver", () => {
  describe("Constructor and Initialization", () => {
    it("should create LinkObserver with options and prefetchedUrls", () => {
      withMocks((_mocks) => {
        const observer = new LinkObserver(createOptions(), new Set<string>());
        assertExists(observer);
        observer.destroy();
      });
    });

    it("should initialize intersection observer with correct rootMargin", () => {
      withMocks((mocks) => {
        withObserver(
          mocks,
          createOptions({ rootMargin: "200px", delay: 50 }),
          new Set<string>(),
          (observer) => {
            observer.init();
            assertEquals(mocks.getMockIntersectionObserver().options.rootMargin, "200px");
          },
        );
      });
    });

    it("should setup mutation observer on document.body", () => {
      withMocks((mocks) => {
        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();

          const mockMO = mocks.getMockMutationObserver();
          assertEquals(mockMO.observedTarget, (globalThis as any).document.body);
          assertEquals(mockMO.observerOptions?.childList, true);
          assertEquals(mockMO.observerOptions?.subtree, true);
        });
      });
    });
  });

  describe("Link Detection and Observation", () => {
    it("should observe valid internal links on init", () => {
      withMocks((mocks) => {
        const link1 = createLink({ href: "http://example.com/page1", pathname: "/page1" });
        const link2 = createLink({ href: "http://example.com/page2", pathname: "/page2" });

        mocks.setDocument({
          querySelectorAll: (selector: string) => {
            if (selector === 'a[href^="/"], a[href^="./"]') return [link1, link2];
            return [];
          },
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();
          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 2);
        });
      });
    });

    it("should not observe external links", () => {
      withMocks((mocks) => {
        const externalLink = createLink({
          href: "http://external.com/page",
          hostname: "external.com",
          pathname: "/page",
        });

        mocks.setDocument({
          querySelectorAll: () => [externalLink],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();
          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
        });
      });
    });

    it("should not observe links with download attribute", () => {
      withMocks((mocks) => {
        const downloadLink = createLink({
          href: "http://example.com/file.pdf",
          pathname: "/file.pdf",
          hasAttribute: (attr: string) => attr === "download",
        });

        mocks.setDocument({
          querySelectorAll: () => [downloadLink],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();
          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
        });
      });
    });

    it('should not observe links with target="_blank"', () => {
      withMocks((mocks) => {
        const blankLink = createLink({ target: "_blank" });

        mocks.setDocument({
          querySelectorAll: () => [blankLink],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();
          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
        });
      });
    });

    it("should not observe already prefetched URLs", () => {
      withMocks((mocks) => {
        const link = createLink({
          href: "http://example.com/prefetched",
          pathname: "/prefetched",
        });

        mocks.setDocument({
          querySelectorAll: () => [link],
          body: {},
        });

        withObserver(
          mocks,
          createOptions(),
          new Set(["http://example.com/prefetched"]),
          (observer) => {
            observer.init();
            assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
          },
        );
      });
    });

    it("should not observe current page URL", () => {
      withMocks((mocks) => {
        const currentLink = createLink({
          href: "http://example.com/current",
          pathname: "/current",
        });

        mocks.setDocument({
          querySelectorAll: () => [currentLink],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();
          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
        });
      });
    });

    it("should not observe hash-only links on same page", () => {
      withMocks((mocks) => {
        const hashLink = createLink({
          href: "http://example.com/current#section",
          pathname: "/current",
          hash: "#section",
        });

        mocks.setDocument({
          querySelectorAll: () => [hashLink],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();
          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
        });
      });
    });

    it("should not observe links with data-no-prefetch attribute", () => {
      withMocks((mocks) => {
        const noPrefetchLink = createLink({ dataset: { noPrefetch: true } });

        mocks.setDocument({
          querySelectorAll: () => [noPrefetchLink],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();
          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
        });
      });
    });
  });

  describe("Intersection Handling", () => {
    it("should call onLinkVisible when link becomes visible", async () => {
      await withMocksAsync(async (mocks) => {
        const link = createLink();

        mocks.setDocument({
          querySelectorAll: () => [link],
          body: {},
        });

        let callbackCalled = false;

        await withObserverAsync(
          mocks,
          createOptions({
            delay: 0,
            onLinkVisible: (visibleLink) => {
              callbackCalled = true;
              assertEquals(visibleLink.href, link.href);
            },
          }),
          new Set<string>(),
          async (observer) => {
            observer.init();
            mocks.getMockIntersectionObserver().triggerIntersection(link as any, true);

            await delay(10);

            assertEquals(callbackCalled, true);
          },
        );
      });
    });

    it("should respect delay option before calling onLinkVisible", async () => {
      await withMocksAsync(async (mocks) => {
        const link = createLink();

        mocks.setDocument({
          querySelectorAll: () => [link],
          body: {},
        });

        const delayMs = scaleMs(50);
        let callbackTime = 0;

        await withObserverAsync(
          mocks,
          createOptions({
            delay: delayMs,
            onLinkVisible: () => {
              callbackTime = Date.now();
            },
          }),
          new Set<string>(),
          async (observer) => {
            observer.init();

            const startTime = Date.now();
            mocks.getMockIntersectionObserver().triggerIntersection(link as any, true);

            await delay(100);

            assertEquals(callbackTime - startTime >= delayMs, true);
          },
        );
      });
    });

    it("should not call onLinkVisible when link is not intersecting", async () => {
      await withMocksAsync(async (mocks) => {
        const link = createLink();

        mocks.setDocument({
          querySelectorAll: () => [link],
          body: {},
        });

        let callbackCalled = false;

        await withObserverAsync(
          mocks,
          createOptions({
            delay: 0,
            onLinkVisible: () => {
              callbackCalled = true;
            },
          }),
          new Set<string>(),
          async (observer) => {
            observer.init();
            mocks.getMockIntersectionObserver().triggerIntersection(link as any, false);

            await delay(10);

            assertEquals(callbackCalled, false);
          },
        );
      });
    });
  });

  describe("Dynamic Link Detection", () => {
    it("should observe new links added via mutation observer", () => {
      withMocks((mocks) => {
        mocks.setDocument({
          querySelectorAll: () => [],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
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

          mocks.getMockMutationObserver().triggerMutation([newLink as any]);

          assertEquals(mockIO.observedElements.has(newLink as any), true);
        });
      });
    });

    it("should observe links inside newly added containers", () => {
      withMocks((mocks) => {
        mocks.setDocument({
          querySelectorAll: () => [],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
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

          mocks.getMockMutationObserver().triggerMutation([newContainer as any]);

          assertEquals(mockIO.observedElements.has(innerLink as any), true);
        });
      });
    });

    it("should not observe invalid nodes added via mutation observer", () => {
      withMocks((mocks) => {
        mocks.setDocument({
          querySelectorAll: () => [],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();

          const textNode = { nodeType: 3 };
          mocks.getMockMutationObserver().triggerMutation([textNode as any]);

          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
        });
      });
    });
  });

  describe("Cleanup and Destroy", () => {
    it("should disconnect observers on destroy", () => {
      withMocks((mocks) => {
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
      });
    });

    it("should be safe to call destroy multiple times", () => {
      withMocks((mocks) => {
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
      });
    });
  });

  describe("Edge Cases", () => {
    it("should handle empty document", () => {
      withMocks((mocks) => {
        mocks.setDocument({
          querySelectorAll: () => [],
          body: {},
        });

        withObserver(mocks, createOptions(), new Set<string>(), (observer) => {
          observer.init();
          assertEquals(mocks.getMockIntersectionObserver().observedElements.size, 0);
        });
      });
    });

    it("should handle multiple links becoming visible simultaneously", async () => {
      await withMocksAsync(async (mocks) => {
        const link1 = createLink({ href: "http://example.com/page1", pathname: "/page1" });
        const link2 = createLink({ href: "http://example.com/page2", pathname: "/page2" });

        mocks.setDocument({
          querySelectorAll: () => [link1, link2],
          body: {},
        });

        const calledLinks: HTMLAnchorElement[] = [];

        await withObserverAsync(
          mocks,
          createOptions({
            delay: 0,
            onLinkVisible: (link) => {
              calledLinks.push(link);
            },
          }),
          new Set<string>(),
          async (observer) => {
            observer.init();

            const mockIO = mocks.getMockIntersectionObserver();
            mockIO.triggerIntersection(link1 as any, true);
            mockIO.triggerIntersection(link2 as any, true);

            await delay(10);

            assertEquals(calledLinks.length, 2);
          },
        );
      });
    });
  });
});
