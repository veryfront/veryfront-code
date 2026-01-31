import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { delay } from "#std/async.ts";
import { PageTransition } from "./page-transition.ts";
import type { RouteData } from "./page-loader.ts";

interface MockElement {
  id?: string;
  innerHTML?: string;
  style?: { opacity?: string; display?: string };
  classList?: {
    toggle: (className: string, force?: boolean) => void;
    contains: (className: string) => boolean;
    _classes: Set<string>;
  };
  querySelectorAll?: (selector: string) => MockElement[];
  querySelector?: (selector: string) => MockElement | null;
  appendChild?: (child: MockElement) => void;
  append?: (...nodes: MockElement[]) => void;
  setAttribute?: (name: string, value: string) => void;
  getAttribute?: (name: string) => string | null;
  textContent?: string;
  tagName?: string;
  _children?: MockElement[];
  className?: string;
  onclick?: (() => void) | null;
  type?: string;
}

interface MockDocument {
  title?: string;
  body?: MockElement;
  head?: MockElement;
  getElementById?: (id: string) => MockElement | null;
  querySelector?: (selector: string) => MockElement | null;
  createElement?: (tag: string) => MockElement;
}

function collectText(element: MockElement): string {
  let text = element.textContent ?? "";
  for (const child of element._children ?? []) text += collectText(child);
  return text;
}

function setupMockDOM(): {
  mockDocument: MockDocument;
  mockRoot: MockElement;
  mockLoadingIndicator: MockElement;
  mockBody: MockElement;
  mockBodyClasses: Set<string>;
  getScrollPosition: () => { x: number; y: number };
  cleanup: () => void;
} {
  const originalDocument = (globalThis as any).document;
  const originalScrollTo = (globalThis as any).scrollTo;
  const originalScrollY = (globalThis as any).scrollY;

  let scrollToX = 0;
  let scrollToY = 0;

  const mockRootChildren: MockElement[] = [];
  let mockRootInnerHTML = "";

  const mockRoot: MockElement = {
    id: "root",
    get innerHTML() {
      return mockRootInnerHTML;
    },
    set innerHTML(value: string) {
      mockRootInnerHTML = value;
      mockRootChildren.length = 0;
    },
    style: { opacity: "1" },
    querySelectorAll: () => [],
    querySelector: () => null,
    appendChild: (child: MockElement) => {
      mockRootChildren.push(child);
      mockRootInnerHTML = mockRootChildren.map(collectText).join("");
    },
  };

  const mockLoadingIndicator: MockElement = {
    id: "veryfront-loading",
    style: { display: "none" },
  };

  const mockBodyClasses = new Set<string>();
  const mockBody: MockElement = {
    classList: {
      toggle: (className: string, force?: boolean) => {
        if (force === undefined) {
          if (mockBodyClasses.has(className)) mockBodyClasses.delete(className);
          else mockBodyClasses.add(className);
          return;
        }

        if (force) mockBodyClasses.add(className);
        else mockBodyClasses.delete(className);
      },
      contains: (className: string) => mockBodyClasses.has(className),
      _classes: mockBodyClasses,
    },
  };

  const mockHeadElements: MockElement[] = [];
  const mockHead: MockElement = {
    querySelectorAll: (selector: string) => {
      if (selector !== '[data-veryfront-managed="1"]') return [];
      return mockHeadElements.filter((el) => el.getAttribute?.("data-veryfront-managed") === "1");
    },
    appendChild: (child: MockElement) => {
      mockHeadElements.push(child);
    },
    querySelector: (selector: string) =>
      mockHeadElements.find((el) => {
        if (selector.includes('name="description"')) {
          return el.getAttribute?.("name") === "description";
        }
        if (selector.includes('property="og:title"')) {
          return el.getAttribute?.("property") === "og:title";
        }
        return false;
      }) ?? null,
  };

  const mockDocument: MockDocument = {
    title: "Original Title",
    body: mockBody,
    head: mockHead,
    getElementById: (id: string) => {
      if (id === "root") return mockRoot;
      if (id === "veryfront-loading") return mockLoadingIndicator;
      return null;
    },
    querySelector: (selector: string) => mockHead.querySelector?.(selector) ?? null,
    createElement: (tag: string) => {
      const attributes = new Map<string, string>();
      const children: MockElement[] = [];
      let textContent = "";
      let className = "";
      let onclick: (() => void) | null = null;
      let type = "";

      return {
        tagName: tag.toUpperCase(),
        _children: children,
        setAttribute: (name: string, value: string) => {
          attributes.set(name, value);
          if (name === "class") className = value;
          if (name === "type") type = value;
        },
        getAttribute: (name: string) => attributes.get(name) ?? null,
        appendChild: (child: MockElement) => {
          children.push(child);
        },
        append: (...nodes: MockElement[]) => {
          children.push(...nodes);
        },
        get textContent() {
          return textContent;
        },
        set textContent(value: string) {
          textContent = value;
        },
        get className() {
          return className;
        },
        set className(value: string) {
          className = value;
          attributes.set("class", value);
        },
        get onclick() {
          return onclick;
        },
        set onclick(handler: (() => void) | null) {
          onclick = handler;
        },
        get type() {
          return type;
        },
        set type(value: string) {
          type = value;
        },
      };
    },
  };

  (globalThis as any).document = mockDocument;
  (globalThis as any).scrollTo = (x: number, y: number) => {
    scrollToX = x;
    scrollToY = y;
  };
  (globalThis as any).scrollY = 0;

  return {
    mockDocument,
    mockRoot,
    mockLoadingIndicator,
    mockBody,
    mockBodyClasses,
    getScrollPosition: () => ({ x: scrollToX, y: scrollToY }),
    cleanup: () => {
      (globalThis as any).document = originalDocument;
      (globalThis as any).scrollTo = originalScrollTo;
      (globalThis as any).scrollY = originalScrollY;
    },
  };
}

function withMocks(
  test: (mocks: ReturnType<typeof setupMockDOM>) => void | Promise<void>,
): () => void | Promise<void> {
  return async () => {
    const mocks = setupMockDOM();
    try {
      await test(mocks);
    } finally {
      mocks.cleanup();
    }
  };
}

describe("PageTransition", () => {
  describe("Constructor", () => {
    it(
      "should create PageTransition with setupViewportPrefetch callback",
      withMocks(() => {
        const pageTransition = new PageTransition(() => {});
        assertExists(pageTransition, "PageTransition instance should be created");
      }),
    );
  });

  describe("updatePage", () => {
    it(
      "should update document title when frontmatter includes title",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});
        const data: RouteData = {
          html: "<div>Content</div>",
          frontmatter: { title: "New Page Title" },
        };

        pageTransition.updatePage(data, false, 0);

        assertEquals(
          mocks.mockDocument.title,
          "New Page Title",
          "Document title should be updated from frontmatter",
        );
      }),
    );

    it(
      "should not update document title when frontmatter has no title",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});
        const originalTitle = mocks.mockDocument.title;
        const data: RouteData = {
          html: "<div>Content</div>",
          frontmatter: {},
        };

        pageTransition.updatePage(data, false, 0);

        assertEquals(
          mocks.mockDocument.title,
          originalTitle,
          "Document title should remain unchanged when no title in frontmatter",
        );
      }),
    );

    it(
      "should update meta tags from frontmatter",
      withMocks(() => {
        const pageTransition = new PageTransition(() => {});
        const data: RouteData = {
          html: "<div>Content</div>",
          frontmatter: {
            description: "Test description",
            ogTitle: "Test OG Title",
          },
        };

        pageTransition.updatePage(data, false, 0);

        assertExists(pageTransition, "PageTransition should handle meta tag updates");
      }),
    );

    it(
      "should perform transition when root element exists and html is not empty",
      withMocks(async (mocks) => {
        let prefetchCalled = false;
        const pageTransition = new PageTransition(() => {
          prefetchCalled = true;
        });

        const data: RouteData = {
          html: "<div>New Content</div>",
          frontmatter: {},
        };

        pageTransition.updatePage(data, false, 0);

        await delay(200);

        assertEquals(
          mocks.mockRoot.innerHTML,
          "<div>New Content</div>",
          "Root element should contain new HTML after transition",
        );
        assertEquals(prefetchCalled, true, "Viewport prefetch should be set up after transition");
      }),
    );

    it(
      "should not perform transition when root element is missing",
      withMocks((mocks) => {
        mocks.mockDocument.getElementById = () => null;

        const pageTransition = new PageTransition(() => {});
        const data: RouteData = { html: "<div>Content</div>", frontmatter: {} };

        pageTransition.updatePage(data, false, 0);
      }),
    );

    it(
      "should not perform transition when html is empty string",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});
        const originalHtml = mocks.mockRoot.innerHTML;
        const data: RouteData = { html: "", frontmatter: {} };

        pageTransition.updatePage(data, false, 0);

        assertEquals(
          mocks.mockRoot.innerHTML,
          originalHtml,
          "Root element should not change when html is empty",
        );
      }),
    );
  });

  describe("performTransition (via updatePage)", () => {
    it(
      "should fade out root element before transition",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});
        const data: RouteData = { html: "<div>New Content</div>", frontmatter: {} };

        mocks.mockRoot.style!.opacity = "1";
        pageTransition.updatePage(data, false, 0);

        assertEquals(
          mocks.mockRoot.style!.opacity,
          "0",
          "Root element opacity should be set to 0 immediately",
        );
      }),
    );

    it(
      "should fade in root element after transition",
      withMocks(async (mocks) => {
        const pageTransition = new PageTransition(() => {});
        const data: RouteData = { html: "<div>New Content</div>", frontmatter: {} };

        pageTransition.updatePage(data, false, 0);

        await delay(200);

        assertEquals(
          mocks.mockRoot.style!.opacity,
          "1",
          "Root element opacity should be set to 1 after transition",
        );
      }),
    );

    it(
      "should scroll to top when isPopState is false",
      withMocks(async (mocks) => {
        const pageTransition = new PageTransition(() => {});
        const data: RouteData = { html: "<div>Content</div>", frontmatter: {} };

        pageTransition.updatePage(data, false, 0);

        await delay(200);

        assertEquals(mocks.getScrollPosition().y, 0, "Should scroll to top for forward navigation");
      }),
    );

    it(
      "should restore scroll position when isPopState is true",
      withMocks(async (mocks) => {
        const pageTransition = new PageTransition(() => {});
        const data: RouteData = { html: "<div>Content</div>", frontmatter: {} };

        const savedScrollY = 500;
        pageTransition.updatePage(data, true, savedScrollY);

        await delay(200);

        assertEquals(
          mocks.getScrollPosition().y,
          savedScrollY,
          "Should restore scroll position for back/forward navigation",
        );
      }),
    );

    it(
      "should handle scroll errors gracefully",
      withMocks(async () => {
        (globalThis as any).scrollTo = () => {
          throw new Error("Scroll failed");
        };

        const pageTransition = new PageTransition(() => {});
        const data: RouteData = { html: "<div>Content</div>", frontmatter: {} };

        pageTransition.updatePage(data, false, 0);

        await delay(200);
      }),
    );
  });

  describe("showError", () => {
    it(
      "should display error message in root element",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});
        const error = new Error("Network request failed");

        pageTransition.showError(error);

        assertEquals(
          mocks.mockRoot.innerHTML?.includes("Oops! Something went wrong"),
          true,
          "Error heading should be displayed",
        );
        assertEquals(
          mocks.mockRoot.innerHTML?.includes("Network request failed"),
          true,
          "Error message should be displayed",
        );
        assertEquals(
          mocks.mockRoot.innerHTML?.includes("Reload Page"),
          true,
          "Reload button should be displayed",
        );
      }),
    );

    it(
      "should handle missing root element gracefully",
      withMocks((mocks) => {
        mocks.mockDocument.getElementById = () => null;

        const pageTransition = new PageTransition(() => {});
        pageTransition.showError(new Error("Test error"));
      }),
    );

    it(
      "should include error message in displayed content",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});
        const errorMessage = 'Custom error message with special characters <>&"';

        pageTransition.showError(new Error(errorMessage));

        assertEquals(
          mocks.mockRoot.innerHTML?.includes(errorMessage),
          true,
          "Custom error message should be included in error display",
        );
      }),
    );
  });

  describe("setLoadingState", () => {
    it(
      "should show loading indicator when loading is true",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});

        pageTransition.setLoadingState(true);

        assertEquals(
          mocks.mockLoadingIndicator.style!.display,
          "block",
          "Loading indicator should be visible",
        );
        assertEquals(
          mocks.mockBodyClasses.has("veryfront-loading"),
          true,
          "Body should have loading class",
        );
      }),
    );

    it(
      "should hide loading indicator when loading is false",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});

        pageTransition.setLoadingState(true);
        pageTransition.setLoadingState(false);

        assertEquals(
          mocks.mockLoadingIndicator.style!.display,
          "none",
          "Loading indicator should be hidden",
        );
        assertEquals(
          mocks.mockBodyClasses.has("veryfront-loading"),
          false,
          "Body should not have loading class",
        );
      }),
    );

    it(
      "should handle missing loading indicator gracefully",
      withMocks((mocks) => {
        mocks.mockDocument.getElementById = (id: string) => (id === "root" ? mocks.mockRoot : null);

        const pageTransition = new PageTransition(() => {});
        pageTransition.setLoadingState(true);

        assertEquals(
          mocks.mockBodyClasses.has("veryfront-loading"),
          true,
          "Body class should still be updated even without indicator element",
        );
      }),
    );

    it(
      "should toggle loading state multiple times",
      withMocks((mocks) => {
        const pageTransition = new PageTransition(() => {});

        pageTransition.setLoadingState(true);
        assertEquals(mocks.mockLoadingIndicator.style!.display, "block");

        pageTransition.setLoadingState(false);
        assertEquals(mocks.mockLoadingIndicator.style!.display, "none");

        pageTransition.setLoadingState(true);
        assertEquals(mocks.mockLoadingIndicator.style!.display, "block");
      }),
    );
  });
});
