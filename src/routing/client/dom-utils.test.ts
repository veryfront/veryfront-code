import "#veryfront/schemas/_test-setup.ts";
import { JSDOM } from "npm:jsdom@28.0.0";
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
  snapshotClientRouteHead,
  updateMetaTags,
} from "./dom-utils.ts";
import {
  descriptorFromHeadProps,
  serializeManagedHeadPayload,
} from "#veryfront/html/managed-head-protocol.ts";
import {
  createMockAnchor,
  createMockElement,
  type GlobalWithDOM,
  MockElement,
  MockHTMLElement,
  setupDOMMocks,
  setupHTMLAnchorElementMock,
  setupHTMLElementMock,
} from "./dom-utils.test-helpers.ts";
import type { FrontmatterData } from "./page-loader.ts";

describe("DOM Utils", () => {
  describe("snapshotClientRouteHead", () => {
    it("uses the trusted hydration payload and ignores forged root markers", () => {
      const structured = serializeManagedHeadPayload([
        descriptorFromHeadProps("title", { children: "Structured title" })!,
        descriptorFromHeadProps("meta", {
          name: "description",
          content: "Structured",
        })!,
        descriptorFromHeadProps("meta", {
          property: "og:image",
          content: "https://cdn.example/a.png",
        })!,
        descriptorFromHeadProps("meta", {
          property: "og:image",
          content: "https://cdn.example/b.png",
        })!,
        descriptorFromHeadProps("style", {
          nonce: "response-a",
          children: ".structured{}",
        })!,
      ]);
      const committed = serializeManagedHeadPayload([
        descriptorFromHeadProps("title", { children: "Committed" })!,
      ]);
      const dom = new JSDOM(`<!doctype html><html><head>
        <meta data-vf-shell-head="true" name="ignored" content="fallback">
      </head><body>
        <script id="veryfront-hydration-data" type="application/json">${
        JSON.stringify({ managedHeadPayload: structured })
      }</script>
        <div data-vf-react-head-owner="1" data-vf-ssr-head="${committed}"></div>
        <div id="root"><div data-veryfront-head="1" data-vf-react-head-owner="1"
          data-vf-ssr-head="${committed}"></div></div>
      </body></html>`);
      try {
        assertEquals(snapshotClientRouteHead(dom.window.document), [
          { tagName: "title", attributes: [], content: "Structured title" },
          {
            tagName: "meta",
            attributes: [["content", "Structured"], ["name", "description"]],
          },
          {
            tagName: "meta",
            attributes: [["content", "https://cdn.example/a.png"], ["property", "og:image"]],
          },
          {
            tagName: "meta",
            attributes: [["content", "https://cdn.example/b.png"], ["property", "og:image"]],
          },
          { tagName: "style", attributes: [], content: ".structured{}" },
        ]);
      } finally {
        dom.window.close();
      }
    });

    it("fails closed instead of trusting shell DOM when hydration JSON is malformed", () => {
      const dom = new JSDOM(`<!doctype html><html><head>
        <title data-vf-shell-head="true">Fallback title</title>
      </head><body>
        <script id="veryfront-hydration-data" type="application/json">{"managedHead</script>
        <div id="root"></div></body></html>`);
      try {
        assertEquals(snapshotClientRouteHead(dom.window.document), []);
      } finally {
        dom.window.close();
      }
    });

    it("rejects a duplicate hydration id forged inside the application root", () => {
      const genuine = serializeManagedHeadPayload([
        descriptorFromHeadProps("title", { children: "Genuine" })!,
      ]);
      const forged = serializeManagedHeadPayload([
        descriptorFromHeadProps("meta", {
          "http-equiv": "refresh",
          content: "0;url=https://attacker.example",
        })!,
      ]);
      const dom = new JSDOM(`<!doctype html><html><head></head><body>
        <script id="veryfront-hydration-data" type="application/json">${
        JSON.stringify({ managedHeadPayload: genuine })
      }</script>
        <div id="root"><script id="veryfront-hydration-data" type="application/json">${
        JSON.stringify({ managedHeadPayload: forged })
      }</script></div>
      </body></html>`);
      try {
        assertEquals(snapshotClientRouteHead(dom.window.document), []);
      } finally {
        dom.window.close();
      }
    });
  });

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
      remove?: () => void;
    };

    function setupMockDocument(): { headElements: MockMetaElement[]; cleanup: () => void } {
      const domMocks = setupDOMMocks();
      const originalDocument = (globalThis as GlobalWithDOM).document;
      const headElements: MockMetaElement[] = [];

      const mockHead = {
        appendChild: (element: MockMetaElement) => {
          headElements.push(element);
        },
        querySelectorAll: (selector: string) =>
          headElements.filter((element) => {
            if (selector === '[data-veryfront-managed="1"]') {
              return element.getAttribute("data-veryfront-managed") === "1";
            }
            if (selector.includes('name="description"')) {
              return element.getAttribute("name") === "description";
            }
            if (selector.includes('property="og:title"')) {
              return element.getAttribute("property") === "og:title";
            }
            return false;
          }),
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
          const element: MockMetaElement = {
            tagName: tag.toUpperCase(),
            setAttribute: (name: string, value: string) => {
              attributes.set(name, value);
            },
            getAttribute: (name: string) => attributes.get(name) ?? null,
            remove: () => {
              const index = headElements.indexOf(element);
              if (index !== -1) headElements.splice(index, 1);
            },
          };
          return element;
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

    it("updates an existing route-owned meta tag", () => {
      const mocks = setupMockDocument();
      try {
        const attributes = new Map<string, string>([
          ["name", "description"],
          ["content", "Old description"],
          ["data-vf-route-head", "true"],
        ]);
        const existingMeta: MockMetaElement = {
          tagName: "META",
          getAttribute: (name: string) => attributes.get(name) ?? null,
          setAttribute: (name: string, value: string) => attributes.set(name, value),
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

    it("adds route metadata without mutating an unowned singleton", () => {
      const mocks = setupMockDocument();
      try {
        const attributes = new Map<string, string>([
          ["name", "description"],
          ["content", "Third-party description"],
        ]);
        const thirdPartyMeta: MockMetaElement = {
          tagName: "META",
          getAttribute: (name: string) => attributes.get(name) ?? null,
          setAttribute: (name: string, value: string) => attributes.set(name, value),
          remove: () => {
            const index = mocks.headElements.indexOf(thirdPartyMeta);
            if (index !== -1) mocks.headElements.splice(index, 1);
          },
        };
        mocks.headElements.push(thirdPartyMeta);

        updateMetaTags({ description: "Route description" });

        assertEquals(mocks.headElements.includes(thirdPartyMeta), true);
        assertEquals(thirdPartyMeta.getAttribute("content"), "Third-party description");
        assertEquals(mocks.headElements.length, 2);
        const routeMeta = mocks.headElements.find((element) =>
          element.getAttribute("data-vf-route-head") === "true"
        );
        assertEquals(routeMeta?.getAttribute("content"), "Route description");
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

    it("reapplies the document nonce and drops the payload nonce", () => {
      const dom = new JSDOM(
        `<!doctype html><html><head><style nonce="doc-nonce"></style></head><body>
          <div id="container"><script nonce="payload-nonce">globalThis.x=1</script></div>
        </body></html>`,
      );
      try {
        const container = dom.window.document.getElementById("container") as HTMLElement;

        executeScripts(container);

        const replaced = container.querySelector("script");
        assertExists(replaced, "the script must still be present after cloning");
        assertEquals(
          replaced.getAttribute("nonce"),
          "doc-nonce",
          "the clone must carry the document's active nonce",
        );
      } finally {
        dom.window.close();
      }
    });

    it("adds no nonce when the document has none", () => {
      const dom = new JSDOM(
        `<!doctype html><html><head></head><body>
          <div id="container"><script>globalThis.x=1</script></div>
        </body></html>`,
      );
      try {
        const container = dom.window.document.getElementById("container") as HTMLElement;

        executeScripts(container);

        const replaced = container.querySelector("script");
        assertExists(replaced, "the script must still be present after cloning");
        assertEquals(
          replaced.hasAttribute("nonce"),
          false,
          "no active nonce means no nonce attribute",
        );
      } finally {
        dom.window.close();
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

    it("does not activate scripts inside head directives as body scripts", () => {
      const originalDocument = (globalThis as GlobalWithDOM).document;
      let createdScripts = 0;
      try {
        (globalThis as GlobalWithDOM).document = {
          createElement: () => {
            createdScripts++;
            return {};
          },
        } as unknown as Document;

        const container = {
          querySelectorAll: () => [oldScript],
        } as unknown as HTMLElement;
        const wrapper = {
          tagName: "VF-HEAD",
          getAttribute: () => null,
          parentElement: container,
        };
        const oldScript = {
          parentElement: wrapper,
          attributes: [],
          parentNode: { replaceChild: () => {} },
          textContent: "window.__runs++",
        };

        executeScripts(container);
        assertEquals(createdScripts, 0);
      } finally {
        (globalThis as GlobalWithDOM).document = originalDocument;
      }
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
      let documentTitle = "Original Title";

      const mockHead = {
        appendChild: (element: MockHeadElement) => {
          headElements.push(element);
          if (element.tagName === "TITLE") {
            documentTitle = element.textContent ?? "";
          }
        },
        querySelectorAll: (selector: string) => {
          if (selector === "title") {
            return headElements.filter((element) => element.tagName === "TITLE");
          }
          if (selector === '[data-veryfront-managed="1"]') {
            return headElements.filter((element) =>
              element.getAttribute?.("data-veryfront-managed") === "1"
            );
          }
          return [];
        },
      };

      (globalThis as GlobalWithDOM).document = {
        get title() {
          return documentTitle;
        },
        set title(value: string) {
          documentTitle = value;
        },
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
        getTitle: () => documentTitle,
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

    it("drops route directives that attempt to redefine document encoding", () => {
      const mocks = setupMockDocument();
      try {
        const charset = new MockElement("META");
        charset.setAttribute("CHARSET", "ISO-8859-1");
        const httpEquiv = new MockElement("META");
        httpEquiv.setAttribute("HTTP-EQUIV", "Content-Type");
        httpEquiv.setAttribute("content", "text/html; charset=windows-1252");
        const vfHead = {
          childNodes: [charset, httpEquiv],
          parentElement: { removeChild: () => {} },
        };
        const container = {
          querySelectorAll: () => [vfHead],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        assertEquals(mocks.headElements.length, 0);
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

    it("retires React Head ownership before legacy directives take authority", () => {
      const mocks = setupMockDocument();
      try {
        const reactManaged = {
          tagName: "META",
          getAttribute: (name: string) => {
            if (name === "data-veryfront-managed") return "1";
            if (name === "data-vf-react-head") return "true";
            return null;
          },
          parentElement: {
            removeChild: (child: MockHeadElement) => {
              const index = mocks.headElements.indexOf(child);
              if (index !== -1) mocks.headElements.splice(index, 1);
            },
          },
        };
        mocks.headElements.push(reactManaged);

        const nextMeta = new MockElement("META");
        nextMeta.setAttribute("name", "description");
        const wrapper = {
          childNodes: [nextMeta],
          parentElement: { removeChild: () => {} },
        };
        const container = {
          querySelectorAll: () => [wrapper],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        assertEquals(mocks.headElements.includes(reactManaged), false);
        assertEquals(mocks.headElements.length, 1);
      } finally {
        mocks.cleanup();
      }
    });

    it("skips wrappers that React Head still owns", () => {
      const mocks = setupMockDocument();
      try {
        const reactOwnedMeta = new MockElement("META");
        reactOwnedMeta.setAttribute("name", "react-owned");
        const legacyMeta = new MockElement("META");
        legacyMeta.setAttribute("name", "legacy");

        let reactWrapperRemoved = false;
        const reactWrapper = {
          childNodes: [reactOwnedMeta],
          getAttribute: (name: string) => name === "data-vf-react-head-owner" ? "1" : null,
          parentElement: {
            removeChild: () => {
              reactWrapperRemoved = true;
            },
          },
        };
        const legacyWrapper = {
          childNodes: [legacyMeta],
          getAttribute: () => null,
          parentElement: { removeChild: () => {} },
        };

        const container = {
          querySelectorAll: () => [reactWrapper, legacyWrapper],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        assertEquals(mocks.headElements.length, 1, "React-owned head wrappers are skipped");
        assertEquals(
          mocks.headElements[0]?.getAttribute?.("name"),
          "legacy",
          "only the legacy directive wrapper reaches the head",
        );
        assertEquals(
          reactWrapperRemoved,
          false,
          "a React-owned wrapper must stay in the container",
        );
      } finally {
        mocks.cleanup();
      }
    });

    it("leaves React head ownership intact when every wrapper is React owned", () => {
      const mocks = setupMockDocument();
      try {
        const reactManaged = {
          tagName: "META",
          getAttribute: (name: string) => {
            if (name === "data-veryfront-managed") return "1";
            if (name === "data-vf-react-head") return "true";
            return null;
          },
          parentElement: {
            removeChild: (child: MockHeadElement) => {
              const index = mocks.headElements.indexOf(child);
              if (index !== -1) mocks.headElements.splice(index, 1);
            },
          },
        };
        mocks.headElements.push(reactManaged);

        const reactOwnedMeta = new MockElement("META");
        reactOwnedMeta.setAttribute("name", "react-owned");
        const reactWrapper = {
          childNodes: [reactOwnedMeta],
          getAttribute: (name: string) => name === "data-vf-react-head-owner" ? "1" : null,
          parentElement: { removeChild: () => {} },
        };

        const container = {
          querySelectorAll: () => [reactWrapper],
        } as unknown as HTMLElement;

        applyHeadDirectives(container);

        assertEquals(
          mocks.headElements.includes(reactManaged),
          true,
          "retireClientHeadOwnership must not run when there is nothing to apply",
        );
        assertEquals(
          mocks.headElements.length,
          1,
          "a React-owned wrapper must not clone anything into the head",
        );
      } finally {
        mocks.cleanup();
      }
    });

    it("reapplies the document nonce to cloned head directives", () => {
      const dom = new JSDOM(
        `<!doctype html><html><head><style nonce="doc-nonce"></style></head><body>
          <main id="root">
            <div data-veryfront-head="1"><style nonce="payload-nonce">.a{}</style></div>
          </main>
        </body></html>`,
      );
      try {
        const targetDocument = dom.window.document;
        const container = targetDocument.getElementById("root") as HTMLElement;

        applyHeadDirectives(container);

        const clone = targetDocument.head.querySelector('style[data-vf-route-head="true"]');
        assertExists(clone, "the head directive must be cloned into the document head");
        assertEquals(
          clone.getAttribute("nonce"),
          "doc-nonce",
          "the head clone must carry the document's active nonce",
        );
      } finally {
        dom.window.close();
      }
    });

    it("applies directives only to the container owner document", () => {
      const primary = new JSDOM(
        `<!doctype html><html><head>
          <title>Primary</title>
          <meta data-veryfront-managed="1" name="primary" content="keep">
        </head><body></body></html>`,
      ).window.document;
      const secondary = new JSDOM(
        `<!doctype html><html><head>
          <title>Secondary</title>
          <meta data-veryfront-managed="1" name="stale" content="remove">
        </head><body>
          <main id="root">
            <vf-head>
              <title></title>
              <meta name="description" content="Secondary description">
            </vf-head>
          </main>
        </body></html>`,
      ).window.document;
      const container = secondary.getElementById("root") as HTMLElement;

      applyHeadDirectives(container);

      assertEquals(primary.title, "Primary");
      assertExists(primary.head.querySelector('meta[name="primary"]'));
      assertEquals(secondary.title, "");
      assertEquals(secondary.head.querySelector('meta[name="stale"]'), null);
      assertEquals(
        secondary.head.querySelector('meta[name="description"]')?.getAttribute(
          "content",
        ),
        "Secondary description",
      );
      assertEquals(container.querySelector("vf-head"), null);
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
          const hydrationMatch = html.match(
            /<script id="veryfront-hydration-data"[^>]*>(.*?)<\/script>/s,
          );

          const mockRoot = rootMatch ? { innerHTML: rootMatch[1] } : null;
          const mockScript = scriptMatch ? { textContent: scriptMatch[1] } : null;
          const mockHydrationScript = hydrationMatch
            ? {
              id: "veryfront-hydration-data",
              tagName: "SCRIPT",
              textContent: hydrationMatch[1],
              getAttribute: (name: string) => name === "type" ? "application/json" : null,
            }
            : null;

          return {
            getElementById: (id: string) =>
              id === "root"
                ? mockRoot
                : id === "veryfront-hydration-data"
                ? mockHydrationScript
                : null,
            querySelector: (selector: string) =>
              selector === "script[data-veryfront-page]" ? mockScript : null,
            querySelectorAll: (selector: string) =>
              selector === '[id="veryfront-hydration-data"]' && mockHydrationScript
                ? [mockHydrationScript]
                : [],
            body: { firstElementChild: mockHydrationScript },
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

    function installJSDOMParser(): () => void {
      const globalWithDOMParser = globalThis as GlobalWithDOMParser;
      const originalDOMParser = globalWithDOMParser.DOMParser;
      const owner = new JSDOM("");
      globalWithDOMParser.DOMParser = owner.window.DOMParser as unknown as typeof DOMParser;
      return () => {
        globalWithDOMParser.DOMParser = originalDOMParser;
        owner.window.close();
      };
    }

    it("forces a document navigation when the app root contains an inline script", () => {
      const restoreDOMParser = installJSDOMParser();
      try {
        const result = parsePageDataFromHTML(
          `<!doctype html><html><head></head><body>
            <div id="root"><main>Hi</main><script>window.x=1</script></div>
          </body></html>`,
        );

        assertEquals(
          result.pageData.requiresFullDocumentNavigation,
          true,
          "an inline script in the app root must force a document navigation",
        );
      } finally {
        restoreDOMParser();
      }
    });

    it("keeps a script-free app root on the soft transition path", () => {
      const restoreDOMParser = installJSDOMParser();
      try {
        const result = parsePageDataFromHTML(
          `<!doctype html><html><head></head><body>
            <div id="root"><main>Hi</main></div>
          </body></html>`,
        );

        assertEquals(
          result.pageData.requiresFullDocumentNavigation,
          undefined,
          "script-free roots stay on the soft transition path",
        );
      } finally {
        restoreDOMParser();
      }
    });

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

    it("should extract the dependency snapshot from hydration data", () => {
      const mocks = setupMockDOMParser();
      try {
        const html = `
        <div id="root"><div>Content</div></div>
        <script id="veryfront-hydration-data" type="application/json">${
          JSON.stringify({ dependencyPinningCacheKey: "on:snapshot-a" })
        }</script>
      `;

        const result = parsePageDataFromHTML(html);

        assertEquals(result.dependencyPinningCacheKey, "on:snapshot-a");
      } finally {
        mocks.cleanup();
      }
    });

    it("should return undefined content when root element not found", () => {
      const mocks = setupMockDOMParser();
      try {
        const html = '<div class="container">No root element</div>';
        const result = parsePageDataFromHTML(html);

        // A 200 without an app root (proxy interstitial, custom error page) has
        // no route content to commit. Reporting it as an empty string would be
        // indistinguishable from an intentionally empty route and would blank
        // the live app on the next soft transition.
        assertEquals(result.content, undefined, "Should report absent content");
        // Skipping the transition is not enough: the router would still commit
        // the navigation and leave the old page under the new URL. The
        // destination belongs to the browser's document loader.
        assertEquals(result.pageData.requiresFullDocumentNavigation, true);
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
            querySelectorAll: () => [],
            body: { firstElementChild: null },
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
