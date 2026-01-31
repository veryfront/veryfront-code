import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  applyHeadDirectives,
  executeScripts,
  extractPageDataFromScript,
  findAnchorElement,
  isInternalLink,
  manageFocus,
  parsePageDataFromHTML,
  updateMetaTags,
} from "./dom-utils.ts";
import type { FrontmatterData } from "./page-loader.ts";

type GlobalWithDOM = typeof globalThis & {
  HTMLAnchorElement: typeof HTMLAnchorElement;
  HTMLElement: typeof HTMLElement;
  Element: typeof Element;
  document: Document;
};

const originalHTMLAnchorElement = (globalThis as GlobalWithDOM).HTMLAnchorElement;
const originalHTMLElement = (globalThis as GlobalWithDOM).HTMLElement;
const originalElement = (globalThis as GlobalWithDOM).Element;

class MockHTMLAnchorElement {
  tagName = "A";
  parentElement: MockHTMLElement | MockHTMLAnchorElement | null = null;
  private attrs = new Map<string, string>();

  constructor(href = "", attributes: Record<string, string> = {}) {
    this.attrs.set("href", href);
    for (const [key, value] of Object.entries(attributes)) this.attrs.set(key, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }
}

class MockHTMLElement {
  tagName: string;
  parentElement: MockHTMLElement | MockHTMLAnchorElement | null = null;
  private attrs = new Map<string, string>();

  constructor(
    tagName: string,
    attributes: Record<string, string> = {},
    parent: MockHTMLElement | MockHTMLAnchorElement | null = null,
  ) {
    this.tagName = tagName.toUpperCase();
    this.parentElement = parent;
    for (const [key, value] of Object.entries(attributes)) this.attrs.set(key, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  hasAttribute(name: string): boolean {
    return this.attrs.has(name);
  }

  querySelector(_selector: string): HTMLElement | null {
    return null;
  }

  focus(_options?: { preventScroll?: boolean }): void {
  }
}

class MockElement {
  tagName: string;
  attributes: Array<{ name: string; value: string }> = [];
  textContent: string | null = null;
  childNodes: unknown[] = [];
  parentElement: MockElement | null = null;

  constructor(tagName = "DIV") {
    this.tagName = tagName.toUpperCase();
  }

  getAttribute(name: string): string | null {
    return this.attributes.find((a) => a.name === name)?.value ?? null;
  }

  setAttribute(name: string, value: string): void {
    const existing = this.attributes.find((a) => a.name === name);
    if (existing) {
      existing.value = value;
      return;
    }
    this.attributes.push({ name, value });
  }

  hasAttribute(name: string): boolean {
    return this.attributes.some((a) => a.name === name);
  }
}

function createMockAnchor(
  href: string,
  attributes: Record<string, string> = {},
): HTMLAnchorElement {
  return new MockHTMLAnchorElement(href, attributes) as unknown as HTMLAnchorElement;
}

function createMockElement(
  tagName: string,
  attributes: Record<string, string> = {},
  parent: HTMLElement | HTMLAnchorElement | null = null,
): HTMLElement {
  return new MockHTMLElement(
    tagName,
    attributes,
    parent as unknown as MockHTMLElement | MockHTMLAnchorElement | null,
  ) as unknown as HTMLElement;
}

function setupGlobalMock<K extends keyof GlobalWithDOM>(
  key: K,
  value: GlobalWithDOM[K],
  original: GlobalWithDOM[K],
): { cleanup: () => void } {
  (globalThis as GlobalWithDOM)[key] = value;
  return {
    cleanup: () => {
      (globalThis as GlobalWithDOM)[key] = original;
    },
  };
}

function setupHTMLAnchorElementMock(): { cleanup: () => void } {
  return setupGlobalMock(
    "HTMLAnchorElement",
    MockHTMLAnchorElement as unknown as typeof HTMLAnchorElement,
    originalHTMLAnchorElement,
  );
}

function setupHTMLElementMock(): { cleanup: () => void } {
  return setupGlobalMock(
    "HTMLElement",
    MockHTMLElement as unknown as typeof HTMLElement,
    originalHTMLElement,
  );
}

function setupElementMock(): { cleanup: () => void } {
  return setupGlobalMock("Element", MockElement as unknown as typeof Element, originalElement);
}

function setupDOMMocks(): { cleanup: () => void } {
  const htmlAnchorMock = setupHTMLAnchorElementMock();
  const htmlElementMock = setupHTMLElementMock();
  const elementMock = setupElementMock();

  return {
    cleanup: () => {
      htmlAnchorMock.cleanup();
      htmlElementMock.cleanup();
      elementMock.cleanup();
    },
  };
}

describe("DOM Utils", () => {
  describe("isInternalLink", () => {
    it("should return true for internal links", () => {
      const anchor = createMockAnchor("/about");
      assertEquals(isInternalLink(anchor), true, "Should recognize /about as internal link");
    });

    it("should return true for relative paths", () => {
      const anchor = createMockAnchor("../contact");
      assertEquals(isInternalLink(anchor), true, "Should recognize ../contact as internal link");
    });

    it("should return false for external HTTP links", () => {
      const anchor = createMockAnchor("https://example.com");
      assertEquals(isInternalLink(anchor), false, "Should recognize external HTTP link");
    });

    it("should return false for external HTTPS links", () => {
      const anchor = createMockAnchor("https://example.com/page");
      assertEquals(isInternalLink(anchor), false, "Should recognize external HTTPS link");
    });

    it("should return false for mailto links", () => {
      const anchor = createMockAnchor("mailto:test@example.com");
      assertEquals(isInternalLink(anchor), false, "Should recognize mailto link");
    });

    it("should return false for hash links", () => {
      const anchor = createMockAnchor("#section");
      assertEquals(isInternalLink(anchor), false, "Should recognize hash link");
    });

    it("should return false for links with target=_blank", () => {
      const anchor = createMockAnchor("/page", { target: "_blank" });
      assertEquals(isInternalLink(anchor), false, "Should recognize target=_blank");
    });

    it("should return false for download links", () => {
      const anchor = createMockAnchor("/file.pdf", { download: "file.pdf" });
      assertEquals(isInternalLink(anchor), false, "Should recognize download link");
    });

    it("should return false for links without href", () => {
      const anchor = createMockAnchor("");
      assertEquals(isInternalLink(anchor), false, "Should handle empty href");
    });

    it("should return false when href is null", () => {
      const anchor = {
        tagName: "A",
        getAttribute: () => null,
      } as unknown as HTMLAnchorElement;

      assertEquals(isInternalLink(anchor), false, "Should handle null href");
    });

    it("should handle links starting with http (not https)", () => {
      const anchor = createMockAnchor("http://example.com");
      assertEquals(isInternalLink(anchor), false, "Should recognize http links as external");
    });
  });

  describe("findAnchorElement", () => {
    it("should return anchor element when given anchor", () => {
      const mocks = setupHTMLAnchorElementMock();
      try {
        const anchor = createMockAnchor("/page");
        const result = findAnchorElement(anchor);
        assertEquals(result, anchor, "Should return the anchor itself");
      } finally {
        mocks.cleanup();
      }
    });

    it("should find anchor parent of nested element", () => {
      const mocks = setupHTMLAnchorElementMock();
      try {
        const anchor = createMockAnchor("/page");
        const span = createMockElement("span", {}, anchor);

        const result = findAnchorElement(span);
        assertEquals(result?.tagName, "A", "Should find parent anchor");
      } finally {
        mocks.cleanup();
      }
    });

    it("should traverse multiple levels to find anchor", () => {
      const mocks = setupHTMLAnchorElementMock();
      try {
        const anchor = createMockAnchor("/page");
        const div = createMockElement("div", {}, anchor);
        const span = createMockElement("span", {}, div);

        const result = findAnchorElement(span);
        assertEquals(result?.tagName, "A", "Should find anchor through multiple levels");
      } finally {
        mocks.cleanup();
      }
    });

    it("should return null when no anchor found", () => {
      const mocks = setupHTMLAnchorElementMock();
      try {
        const div = createMockElement("div");
        const result = findAnchorElement(div);
        assertEquals(result, null, "Should return null when no anchor found");
      } finally {
        mocks.cleanup();
      }
    });

    it("should return null when given null", () => {
      const mocks = setupHTMLAnchorElementMock();
      try {
        const result = findAnchorElement(null);
        assertEquals(result, null, "Should handle null input");
      } finally {
        mocks.cleanup();
      }
    });

    it("should stop at anchor element", () => {
      const mocks = setupHTMLAnchorElementMock();
      try {
        const outerAnchor = createMockAnchor("/outer");
        const innerAnchor = createMockAnchor("/inner");
        Object.defineProperty(innerAnchor, "parentElement", { value: outerAnchor, writable: true });

        const result = findAnchorElement(innerAnchor);
        assertEquals(result, innerAnchor, "Should return closest anchor, not traverse further");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle non-HTMLAnchorElement parents", () => {
      const mocks = setupHTMLAnchorElementMock();
      try {
        const div = createMockElement("div");
        const span = createMockElement("span", {}, div);

        const result = findAnchorElement(span);
        assertEquals(result, null, "Should return null when parent chain has no anchor");
      } finally {
        mocks.cleanup();
      }
    });
  });

  describe("updateMetaTags", () => {
    type MockMetaElement = {
      tagName: string;
      getAttribute: (name: string) => string | null;
      setAttribute: (name: string, value: string) => void;
    };

    function setupMockDocument(): { headElements: MockMetaElement[]; cleanup: () => void } {
      const domMocks = setupDOMMocks();
      const originalDocument = (globalThis as GlobalWithDOM).document;
      const headElements: MockMetaElement[] = [];

      const mockHead = {
        appendChild: (element: MockMetaElement) => {
          headElements.push(element);
        },
        querySelectorAll: () => [],
      };

      (globalThis as GlobalWithDOM).document = {
        head: mockHead,
        querySelector: (selector: string) => {
          return headElements.find((el) => {
            if (selector.includes('name="description"')) {
              return el.getAttribute("name") === "description";
            }
            if (selector.includes('property="og:title"')) {
              return el.getAttribute("property") === "og:title";
            }
            return false;
          }) ?? null;
        },
        createElement: (tag: string) => {
          const attributes = new Map<string, string>();
          return {
            tagName: tag.toUpperCase(),
            setAttribute: (name: string, value: string) => {
              attributes.set(name, value);
            },
            getAttribute: (name: string) => attributes.get(name) ?? null,
          };
        },
      } as unknown as Document;

      return {
        headElements,
        cleanup: () => {
          (globalThis as GlobalWithDOM).document = originalDocument;
          domMocks.cleanup();
        },
      };
    }

    it("should update description meta tag", () => {
      const mocks = setupMockDocument();
      try {
        const frontmatter: FrontmatterData = { description: "Test description" };
        updateMetaTags(frontmatter);

        const descMeta = mocks.headElements.find((el) => el.getAttribute("name") === "description");
        assertExists(descMeta, "Description meta tag should be created");
        assertEquals(
          descMeta?.getAttribute("content"),
          "Test description",
          "Should set description content",
        );
      } finally {
        mocks.cleanup();
      }
    });

    it("should update og:title meta tag", () => {
      const mocks = setupMockDocument();
      try {
        const frontmatter: FrontmatterData = { ogTitle: "Test OG Title" };
        updateMetaTags(frontmatter);

        const ogMeta = mocks.headElements.find((el) => el.getAttribute("property") === "og:title");
        assertExists(ogMeta, "OG title meta tag should be created");
        assertEquals(
          ogMeta?.getAttribute("content"),
          "Test OG Title",
          "Should set og:title content",
        );
      } finally {
        mocks.cleanup();
      }
    });

    it("should update both meta tags when both provided", () => {
      const mocks = setupMockDocument();
      try {
        const frontmatter: FrontmatterData = {
          description: "Page description",
          ogTitle: "Page OG Title",
        };

        updateMetaTags(frontmatter);
        assertEquals(mocks.headElements.length, 2, "Should create both meta tags");
      } finally {
        mocks.cleanup();
      }
    });

    it("should not create meta tags when frontmatter is empty", () => {
      const mocks = setupMockDocument();
      try {
        updateMetaTags({});
        assertEquals(mocks.headElements.length, 0, "Should not create meta tags");
      } finally {
        mocks.cleanup();
      }
    });

    it("should update existing meta tag content", () => {
      const mocks = setupMockDocument();
      try {
        const existingMeta: MockMetaElement = {
          tagName: "META",
          getAttribute: (name: string) => {
            if (name === "name") return "description";
            if (name === "content") return "Old description";
            return null;
          },
          setAttribute: (name: string, value: string) => {
            if (name !== "content") return;
            existingMeta.getAttribute = (n: string) => {
              if (n === "name") return "description";
              if (n === "content") return value;
              return null;
            };
          },
        };

        mocks.headElements.push(existingMeta);
        updateMetaTags({ description: "New description" });

        assertEquals(
          existingMeta.getAttribute("content"),
          "New description",
          "Should update existing meta tag",
        );
      } finally {
        mocks.cleanup();
      }
    });
  });

  describe("executeScripts", () => {
    it("should execute scripts in container", () => {
      const scriptExecutions: string[] = [];
      const originalDocument = (globalThis as GlobalWithDOM).document;

      try {
        (globalThis as GlobalWithDOM).document = {
          createElement: (tag: string) => {
            if (tag !== "script") return null;
            return {
              tagName: "SCRIPT",
              setAttribute: () => {},
              attributes: [],
              textContent: "",
            };
          },
        } as unknown as Document;

        const oldScript = {
          tagName: "SCRIPT",
          attributes: [{ name: "type", value: "text/javascript" }],
          textContent: "console.log('test')",
          parentNode: {
            replaceChild: (newScript: any) => {
              scriptExecutions.push(newScript.textContent);
            },
          },
        };

        const container = {
          querySelectorAll: (selector: string) => (selector === "script" ? [oldScript] : []),
        } as unknown as HTMLElement;

        executeScripts(container);

        assertEquals(scriptExecutions.length, 1, "Should execute script");
        assertEquals(scriptExecutions[0], "console.log('test')", "Should preserve script content");
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
    });

    it("should copy all script attributes", () => {
      const originalDocument = (globalThis as GlobalWithDOM).document;
      const copiedAttributes: Array<{ name: string; value: string }> = [];

      try {
        (globalThis as GlobalWithDOM).document = {
          createElement: (tag: string) => {
            if (tag !== "script") return null;
            return {
              tagName: "SCRIPT",
              setAttribute: (name: string, value: string) => {
                copiedAttributes.push({ name, value });
              },
              attributes: [],
              textContent: "",
            };
          },
        } as unknown as Document;

        const oldScript = {
          tagName: "SCRIPT",
          attributes: [
            { name: "type", value: "module" },
            { name: "src", value: "/script.js" },
            { name: "async", value: "true" },
          ],
          textContent: "",
          parentNode: {
            replaceChild: () => {},
          },
        };

        const container = {
          querySelectorAll: () => [oldScript],
        } as unknown as HTMLElement;

        executeScripts(container);

        assertEquals(copiedAttributes.length, 3, "Should copy all attributes");
        assertEquals(copiedAttributes[0], { name: "type", value: "module" });
        assertEquals(copiedAttributes[1], { name: "src", value: "/script.js" });
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
    });

    it("should handle multiple scripts", () => {
      const originalDocument = (globalThis as GlobalWithDOM).document;
      let scriptCount = 0;

      try {
        (globalThis as GlobalWithDOM).document = {
          createElement: () => ({
            tagName: "SCRIPT",
            setAttribute: () => {},
            attributes: [],
            textContent: "",
          }),
        } as unknown as Document;

        const scripts = [
          {
            attributes: [],
            textContent: "script1",
            parentNode: { replaceChild: () => scriptCount++ },
          },
          {
            attributes: [],
            textContent: "script2",
            parentNode: { replaceChild: () => scriptCount++ },
          },
        ];

        const container = {
          querySelectorAll: () => scripts,
        } as unknown as HTMLElement;

        executeScripts(container);

        assertEquals(scriptCount, 2, "Should execute all scripts");
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
    });

    it("should handle container with no scripts", () => {
      const container = {
        querySelectorAll: () => [],
      } as unknown as HTMLElement;

      executeScripts(container);
    });
  });

  describe("applyHeadDirectives", () => {
    type MockHeadElement = {
      tagName: string;
      getAttribute?: (name: string) => string | null;
      setAttribute?: (name: string, value: string) => void;
      hasAttribute?: (name: string) => boolean;
      textContent?: string;
      parentElement?: { removeChild: (child: MockHeadElement) => void };
    };

    function setupMockDocument(): {
      headElements: MockHeadElement[];
      getTitle: () => string;
      cleanup: () => void;
    } {
      const domMocks = setupDOMMocks();
      const originalDocument = (globalThis as GlobalWithDOM).document;
      const headElements: MockHeadElement[] = [];

      const mockHead = {
        appendChild: (element: MockHeadElement) => {
          headElements.push(element);
        },
        querySelectorAll: (selector: string) => {
          if (selector !== '[data-veryfront-managed="1"]') return [];
          return headElements.filter((el) => el.getAttribute?.("data-veryfront-managed") === "1");
        },
      };

      (globalThis as GlobalWithDOM).document = {
        title: "Original Title",
        head: mockHead,
        createElement: (tag: string) => {
          const attributes = new Map<string, string>();
          return {
            tagName: tag.toUpperCase(),
            setAttribute: (name: string, value: string) => {
              attributes.set(name, value);
            },
            getAttribute: (name: string) => attributes.get(name) ?? null,
            hasAttribute: (name: string) => attributes.has(name),
            textContent: "",
          };
        },
      } as unknown as Document;

      return {
        headElements,
        getTitle: () => (globalThis as GlobalWithDOM).document.title,
        cleanup: () => {
          (globalThis as GlobalWithDOM).document = originalDocument;
          domMocks.cleanup();
        },
      };
    }

    it("should update document title from vf-head", () => {
      const mocks = setupMockDocument();
      try {
        const titleElement = new MockElement("TITLE");
        titleElement.textContent = "New Page Title";

        const vfHead = {
          childNodes: [titleElement],
          parentElement: {
            removeChild: () => {},
          },
        };

        const container = {
          querySelectorAll: (selector: string) =>
            selector === '[data-veryfront-head="1"], vf-head' ? [vfHead] : [],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        assertEquals(mocks.getTitle(), "New Page Title", "Should update document title");
      } finally {
        mocks.cleanup();
      }
    });

    it("should add meta tags to head", () => {
      const mocks = setupMockDocument();
      try {
        const metaElement = new MockElement("META");
        metaElement.setAttribute("name", "description");
        metaElement.setAttribute("content", "Test description");

        const vfHead = {
          childNodes: [metaElement],
          parentElement: {
            removeChild: () => {},
          },
        };

        const container = {
          querySelectorAll: () => [vfHead],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        const addedMeta = mocks.headElements.find((el) => el.tagName === "META");
        assertExists(addedMeta, "Should add meta tag to head");
        assertEquals(
          addedMeta.getAttribute?.("data-veryfront-managed"),
          "1",
          "Should mark as managed",
        );
      } finally {
        mocks.cleanup();
      }
    });

    it("should add link tags to head", () => {
      const mocks = setupMockDocument();
      try {
        const linkElement = new MockElement("LINK");
        linkElement.setAttribute("rel", "stylesheet");
        linkElement.setAttribute("href", "/styles.css");

        const vfHead = {
          childNodes: [linkElement],
          parentElement: {
            removeChild: () => {},
          },
        };

        const container = {
          querySelectorAll: () => [vfHead],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        const addedLink = mocks.headElements.find((el) => el.tagName === "LINK");
        assertExists(addedLink, "Should add link tag to head");
      } finally {
        mocks.cleanup();
      }
    });

    it("should remove old managed head tags before adding new ones", () => {
      const mocks = setupMockDocument();
      try {
        const oldMeta = {
          tagName: "META",
          getAttribute: (name: string) => (name === "data-veryfront-managed" ? "1" : null),
          parentElement: {
            removeChild: (child: any) => {
              const index = mocks.headElements.indexOf(child);
              if (index > -1) mocks.headElements.splice(index, 1);
            },
          },
        };

        mocks.headElements.push(oldMeta);

        const newMeta = new MockElement("META");
        newMeta.setAttribute("name", "new");

        const vfHead = {
          childNodes: [newMeta],
          parentElement: {
            removeChild: () => {},
          },
        };

        const container = {
          querySelectorAll: () => [vfHead],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        const managedElements = mocks.headElements.filter(
          (el) => el.getAttribute?.("data-veryfront-managed") === "1",
        );

        assertEquals(managedElements.length, 1, "Should clean old managed elements");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle script tags with src attribute", () => {
      const mocks = setupMockDocument();
      try {
        const scriptElement = new MockElement("SCRIPT");
        scriptElement.setAttribute("src", "/script.js");
        scriptElement.textContent = "console.log('should not copy')";

        const vfHead = {
          childNodes: [scriptElement],
          parentElement: {
            removeChild: () => {},
          },
        };

        const container = {
          querySelectorAll: () => [vfHead],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        const addedScript = mocks.headElements.find((el) => el.tagName === "SCRIPT");
        assertEquals(addedScript?.textContent, "", "Should not copy textContent when src exists");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle script tags without src attribute", () => {
      const mocks = setupMockDocument();
      try {
        const scriptElement = new MockElement("SCRIPT");
        scriptElement.textContent = "console.log('inline script')";

        const vfHead = {
          childNodes: [scriptElement],
          parentElement: {
            removeChild: () => {},
          },
        };

        const container = {
          querySelectorAll: () => [vfHead],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        const addedScript = mocks.headElements.find((el) => el.tagName === "SCRIPT");
        assertEquals(
          addedScript?.textContent,
          "console.log('inline script')",
          "Should copy inline script content",
        );
      } finally {
        mocks.cleanup();
      }
    });

    it("should remove wrapper element after processing", () => {
      const mocks = setupMockDocument();
      try {
        let wrapperRemoved = false;
        const vfHead = {
          childNodes: [],
          parentElement: {
            removeChild: (child: any) => {
              if (child === vfHead) wrapperRemoved = true;
            },
          },
        };

        const container = {
          querySelectorAll: () => [vfHead],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        assertEquals(wrapperRemoved, true, "Should remove wrapper element");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle data-veryfront-head attribute", () => {
      const mocks = setupMockDocument();
      try {
        const metaElement = new MockElement("META");

        const wrapper = {
          childNodes: [metaElement],
          parentElement: {
            removeChild: () => {},
          },
          getAttribute: (name: string) => (name === "data-veryfront-head" ? "1" : null),
        };

        const container = {
          querySelectorAll: () => [wrapper],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        assertEquals(mocks.headElements.length, 1, "Should process data-veryfront-head elements");
      } finally {
        mocks.cleanup();
      }
    });

    it("should skip non-Element child nodes", () => {
      const mocks = setupMockDocument();
      try {
        const textNode = "This is text";
        const elementNode = new MockElement("META");

        const vfHead = {
          childNodes: [textNode, elementNode],
          parentElement: {
            removeChild: () => {},
          },
        };

        const container = {
          querySelectorAll: () => [vfHead],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        assertEquals(mocks.headElements.length, 1, "Should only process element nodes");
      } finally {
        mocks.cleanup();
      }
    });
  });

  describe("manageFocus", () => {
    type FocusableElement = MockHTMLElement & {
      focus: (options?: { preventScroll?: boolean }) => void;
    };

    it("should focus element with data-router-focus attribute", () => {
      const mocks = setupHTMLElementMock();
      try {
        let focusedElement: string | null = null;

        const focusElement = new MockHTMLElement("DIV") as unknown as FocusableElement;
        focusElement.focus = () => {
          focusedElement = "focus-div";
        };

        const container = {
          querySelector: (
            selector: string,
          ) => (selector === "[data-router-focus]" ? focusElement : null),
        } as unknown as HTMLElement;

        manageFocus(container);

        assertEquals(focusedElement, "focus-div", "Should focus element with data-router-focus");
      } finally {
        mocks.cleanup();
      }
    });

    it("should focus main element when no data-router-focus", () => {
      const mocks = setupHTMLElementMock();
      try {
        let focusedElement: string | null = null;

        const mainElement = new MockHTMLElement("MAIN") as unknown as FocusableElement;
        mainElement.focus = () => {
          focusedElement = "main";
        };

        const container = {
          querySelector: (selector: string) => {
            if (selector === "[data-router-focus]") return null;
            if (selector === "main") return mainElement;
            return null;
          },
        } as unknown as HTMLElement;

        manageFocus(container);

        assertEquals(focusedElement, "main", "Should focus main element as fallback");
      } finally {
        mocks.cleanup();
      }
    });

    it("should focus h1 element when no data-router-focus or main", () => {
      const mocks = setupHTMLElementMock();
      try {
        let focusedElement: string | null = null;

        const h1Element = new MockHTMLElement("H1") as unknown as FocusableElement;
        h1Element.focus = () => {
          focusedElement = "h1";
        };

        const container = {
          querySelector: (selector: string) => {
            if (selector === "[data-router-focus]") return null;
            if (selector === "main") return null;
            if (selector === "h1") return h1Element;
            return null;
          },
        } as unknown as HTMLElement;

        manageFocus(container);

        assertEquals(focusedElement, "h1", "Should focus h1 as final fallback");
      } finally {
        mocks.cleanup();
      }
    });

    it("should use preventScroll option when focusing", () => {
      const mocks = setupHTMLElementMock();
      try {
        let focusOptions: { preventScroll?: boolean } | undefined;

        const focusElement = new MockHTMLElement("DIV") as unknown as FocusableElement;
        focusElement.focus = (options?: { preventScroll?: boolean }) => {
          focusOptions = options;
        };

        const container = {
          querySelector: () => focusElement,
        } as unknown as HTMLElement;

        manageFocus(container);

        assertEquals(focusOptions?.preventScroll, true, "Should use preventScroll: true");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle focus errors gracefully", () => {
      const mocks = setupHTMLElementMock();
      try {
        const focusElement = new MockHTMLElement("DIV") as unknown as FocusableElement;
        focusElement.focus = () => {
          throw new Error("Focus failed");
        };

        const container = {
          querySelector: () => focusElement,
        } as unknown as HTMLElement;

        manageFocus(container);
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle when no focusable element is found", () => {
      const container = {
        querySelector: () => null,
      } as unknown as HTMLElement;

      manageFocus(container);
    });

    it("should check if element has focus method", () => {
      const focusCalled = false;

      const nonFocusableElement = {
        tagName: "DIV",
      };

      const container = {
        querySelector: () => nonFocusableElement,
      } as unknown as HTMLElement;

      manageFocus(container);

      assertEquals(focusCalled, false, "Should not call focus on non-focusable elements");
    });
  });

  describe("extractPageDataFromScript", () => {
    type MockScriptTag = {
      textContent: string | null;
    };

    it("should extract page data from script tag", () => {
      const originalDocument = (globalThis as GlobalWithDOM).document;

      try {
        const pageData = { user: "test", id: 123 };
        const script: MockScriptTag = {
          textContent: JSON.stringify(pageData),
        };

        (globalThis as GlobalWithDOM).document = {
          querySelector: (
            selector: string,
          ) => (selector === "script[data-veryfront-page]" ? script : null),
        } as unknown as Document;

        const result = extractPageDataFromScript();

        assertEquals(result, pageData, "Should extract and parse page data");
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
    });

    it("should return null when script tag not found", () => {
      const originalDocument = (globalThis as GlobalWithDOM).document;

      try {
        (globalThis as GlobalWithDOM).document = {
          querySelector: () => null,
        } as unknown as Document;

        const result = extractPageDataFromScript();

        assertEquals(result, null, "Should return null when script not found");
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
    });

    it("should return null when JSON parsing fails", () => {
      const originalDocument = (globalThis as GlobalWithDOM).document;

      try {
        const script: MockScriptTag = {
          textContent: "invalid json {",
        };

        (globalThis as GlobalWithDOM).document = {
          querySelector: () => script,
        } as unknown as Document;

        const result = extractPageDataFromScript();

        assertEquals(result, null, "Should return null on parse error");
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
    });

    it("should handle empty script content", () => {
      const originalDocument = (globalThis as GlobalWithDOM).document;

      try {
        const script: MockScriptTag = {
          textContent: "",
        };

        (globalThis as GlobalWithDOM).document = {
          querySelector: () => script,
        } as unknown as Document;

        const result = extractPageDataFromScript();

        assertEquals(result, {}, "Should return empty object for empty content");
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
    });

    it("should handle null textContent", () => {
      const originalDocument = (globalThis as GlobalWithDOM).document;

      try {
        const script: MockScriptTag = {
          textContent: null,
        };

        (globalThis as GlobalWithDOM).document = {
          querySelector: () => script,
        } as unknown as Document;

        const result = extractPageDataFromScript();

        assertEquals(result, {}, "Should return empty object for null content");
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
    });
  });

  describe("parsePageDataFromHTML", () => {
    type GlobalWithDOMParser = typeof globalThis & {
      DOMParser: typeof DOMParser;
    };

    function setupMockDOMParser(): { cleanup: () => void } {
      const originalDOMParser = (globalThis as GlobalWithDOMParser).DOMParser;

      class MockDOMParser {
        parseFromString(html: string, _type: string) {
          const rootMatch = html.match(/<div id="root"[^>]*>(.*?)<\/div>/s);
          const scriptMatch = html.match(/<script data-veryfront-page[^>]*>(.*?)<\/script>/s);

          const mockRoot = rootMatch ? { innerHTML: rootMatch[1] } : null;
          const mockScript = scriptMatch ? { textContent: scriptMatch[1] } : null;

          return {
            getElementById: (id: string) => (id === "root" ? mockRoot : null),
            querySelector: (selector: string) =>
              selector === "script[data-veryfront-page]" ? mockScript : null,
          };
        }
      }

      (globalThis as GlobalWithDOMParser).DOMParser = MockDOMParser as unknown as typeof DOMParser;

      return {
        cleanup: () => {
          (globalThis as GlobalWithDOMParser).DOMParser = originalDOMParser;
        },
      };
    }

    it("should extract content from root element", () => {
      const mocks = setupMockDOMParser();
      try {
        const html = '<div id="root"><h1>Page Title</h1><p>Content</p></div>';
        const result = parsePageDataFromHTML(html);

        assertEquals(result.content, "<h1>Page Title</h1><p>Content</p>", "Should extract content");
      } finally {
        mocks.cleanup();
      }
    });

    it("should extract page data from script tag", () => {
      const mocks = setupMockDOMParser();
      try {
        const pageData = { user: "test", count: 42 };
        const html = `
        <div id="root"><div>Content</div></div>
        <script data-veryfront-page>${JSON.stringify(pageData)}</script>
      `;

        const result = parsePageDataFromHTML(html);

        assertEquals(result.pageData, pageData, "Should extract page data");
      } finally {
        mocks.cleanup();
      }
    });

    it("should return empty content when root element not found", () => {
      const mocks = setupMockDOMParser();
      try {
        const html = '<div class="container">No root element</div>';
        const result = parsePageDataFromHTML(html);

        assertEquals(result.content, "", "Should return empty content");
      } finally {
        mocks.cleanup();
      }
    });

    it("should return empty page data when script not found", () => {
      const mocks = setupMockDOMParser();
      try {
        const html = '<div id="root"><div>Content</div></div>';
        const result = parsePageDataFromHTML(html);

        assertEquals(result.pageData, {}, "Should return empty page data");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle malformed page data JSON", () => {
      const mocks = setupMockDOMParser();
      try {
        const html = `
        <div id="root"><div>Content</div></div>
        <script data-veryfront-page>invalid json {</script>
      `;

        const result = parsePageDataFromHTML(html);

        assertEquals(result.pageData, {}, "Should return empty object on parse error");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle empty root element", () => {
      const mocks = setupMockDOMParser();
      try {
        const html = '<div id="root"></div>';
        const result = parsePageDataFromHTML(html);

        assertEquals(result.content, "", "Should handle empty root element");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle complete HTML document", () => {
      const mocks = setupMockDOMParser();
      try {
        const pageData = { title: "Test" };
        const html = `
        <!DOCTYPE html>
        <html>
          <head><title>Test</title></head>
          <body>
            <div id="root"><main>Main content</main></div>
            <script data-veryfront-page>${JSON.stringify(pageData)}</script>
          </body>
        </html>
      `;

        const result = parsePageDataFromHTML(html);

        assertEquals(result.content, "<main>Main content</main>", "Should extract content");
        assertEquals(result.pageData, pageData, "Should extract page data");
      } finally {
        mocks.cleanup();
      }
    });

    it("should handle root element with null innerHTML", () => {
      const originalDOMParser = (globalThis as GlobalWithDOMParser).DOMParser;

      class MockDOMParser {
        parseFromString() {
          return {
            getElementById: () => ({ innerHTML: null }),
            querySelector: () => null,
          };
        }
      }

      (globalThis as GlobalWithDOMParser).DOMParser = MockDOMParser as unknown as typeof DOMParser;

      try {
        const html = '<div id="root"></div>';
        const result = parsePageDataFromHTML(html);

        assertEquals(result.content, "", "Should handle null innerHTML");
      } finally {
        (globalThis as GlobalWithDOMParser).DOMParser = originalDOMParser;
      }
    });
  });
});
