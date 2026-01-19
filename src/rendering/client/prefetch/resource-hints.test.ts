/**
 * Unit Tests for Resource Hints Manager
 * Tests resource hint generation and application (preload, prefetch, dns-prefetch)
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ResourceHintsManager } from "./resource-hints.ts";
import type { ResourceHint } from "./resource-hints.ts";

// Mock DOMParser
class MockDOMParser {
  parseFromString(html: string, _mimeType: DOMParserSupportedType): Document {
    // Simple HTML parser mock
    const scripts: HTMLScriptElement[] = [];
    const links: HTMLLinkElement[] = [];

    // Parse script tags
    const scriptRegex = /<script\s+src="([^"]+)"/g;
    let match;
    while ((match = scriptRegex.exec(html)) !== null) {
      scripts.push({
        src: match[1],
        tagName: "SCRIPT",
      } as HTMLScriptElement);
    }

    // Parse link tags
    const linkRegex = /<link\s+([^>]+)>/g;
    while ((match = linkRegex.exec(html)) !== null) {
      const attrs = match[1] || "";
      const relMatch = /rel="([^"]+)"/.exec(attrs);
      const hrefMatch = /href="([^"]+)"/.exec(attrs);
      const asMatch = /as="([^"]+)"/.exec(attrs);

      if (relMatch && hrefMatch) {
        links.push({
          rel: relMatch[1],
          href: hrefMatch[1],
          tagName: "LINK",
          getAttribute: (attr: string) => {
            if (attr === "as" && asMatch) return asMatch[1];
            return null;
          },
        } as unknown as HTMLLinkElement);
      }
    }

    return {
      querySelectorAll: (selector: string) => {
        if (selector === "script[src]") return scripts;
        if (selector.includes('link[rel="preload"]') || selector.includes('link[rel="prefetch"]')) {
          return links.filter((l) => l.rel === "preload" || l.rel === "prefetch");
        }
        if (selector === 'link[rel="stylesheet"]') {
          return links.filter((l) => l.rel === "stylesheet");
        }
        return [];
      },
    } as unknown as Document;
  }
}

// Setup global mocks
const setupMocks = () => {
  const originalDOMParser = (globalThis as any).DOMParser;
  const originalDocument = globalThis.document;
  (globalThis as any).DOMParser = MockDOMParser;

  const createdElements: Array<{ tagName: string; attributes: Record<string, string> }> = [];
  (globalThis as any).document = {
    head: {
      appendChild: (element: any) => {
        createdElements.push({
          tagName: element.tagName,
          attributes: { ...element },
        });
      },
    },
    createElement: (tagName: string) => {
      const element: any = {
        tagName,
        rel: "",
        href: "",
        setAttribute: function (name: string, value: string) {
          this[name] = value;
        },
      };
      return element;
    },
    querySelector: (_selector: string) => null,
  };

  return {
    cleanup: () => {
      (globalThis as any).DOMParser = originalDOMParser;
      (globalThis as any).document = originalDocument;
    },
    getCreatedElements: () => createdElements,
    clearCreatedElements: () => {
      createdElements.length = 0;
    },
  };
};

describe("ResourceHintsManager", () => {
  describe("Constructor", () => {
    it("should create ResourceHintsManager instance", () => {
      const manager = new ResourceHintsManager();
      assertExists(manager);
    });

    it("should initialize with empty applied hints set", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();

      const hints: ResourceHint[] = [
        { type: "prefetch", href: "http://example.com/page" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 1);

      mocks.cleanup();
    });
  });

  describe("Apply Resource Hints", () => {
    it("should apply prefetch hint", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "prefetch", href: "http://example.com/page" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 1);
      assertEquals(elements[0]?.attributes.rel, "prefetch");
      assertEquals(elements[0]?.attributes.href, "http://example.com/page");

      mocks.cleanup();
    });

    it("should apply preload hint with as attribute", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "preload", href: "http://example.com/script.js", as: "script" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 1);
      assertEquals(elements[0]?.attributes.rel, "preload");
      assertEquals(elements[0]?.attributes.href, "http://example.com/script.js");
      assertEquals(elements[0]?.attributes.as, "script");

      mocks.cleanup();
    });

    it("should apply dns-prefetch hint", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "dns-prefetch", href: "http://cdn.example.com" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 1);
      assertEquals(elements[0]?.attributes.rel, "dns-prefetch");
      assertEquals(elements[0]?.attributes.href, "http://cdn.example.com");

      mocks.cleanup();
    });

    it("should apply preconnect hint with crossorigin", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "preconnect", href: "http://api.example.com", crossOrigin: "anonymous" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 1);
      assertEquals(elements[0]?.attributes.rel, "preconnect");
      assertEquals(elements[0]?.attributes.href, "http://api.example.com");
      assertEquals(elements[0]?.attributes.crossorigin, "anonymous");

      mocks.cleanup();
    });

    it("should apply hint with media attribute", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "preload", href: "http://example.com/style.css", as: "style", media: "print" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 1);
      assertEquals(elements[0]?.attributes.media, "print");

      mocks.cleanup();
    });

    it("should apply multiple hints", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "dns-prefetch", href: "http://cdn.example.com" },
        { type: "preconnect", href: "http://api.example.com" },
        { type: "prefetch", href: "http://example.com/page" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 3);

      mocks.cleanup();
    });

    it("should not apply duplicate hints", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "prefetch", href: "http://example.com/page" },
        { type: "prefetch", href: "http://example.com/page" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 1);

      mocks.cleanup();
    });

    it("should not apply hint if already exists in DOM", () => {
      const mocks = setupMocks(); // Mock existing hint
      (globalThis as any).document.querySelector = (selector: string) => {
        if (selector === 'link[rel="prefetch"][href="http://example.com/page"]') {
          return { rel: "prefetch", href: "http://example.com/page" };
        }
        return null;
      };

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "prefetch", href: "http://example.com/page" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 0);

      mocks.cleanup();
    });

    it("should track applied hints across multiple calls", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();

      manager.applyResourceHints([
        { type: "prefetch", href: "http://example.com/page1" },
      ]);

      manager.applyResourceHints([
        { type: "prefetch", href: "http://example.com/page1" },
        { type: "prefetch", href: "http://example.com/page2" },
      ]);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 2);

      mocks.cleanup();
    });
  });

  describe("Extract Resource Hints", () => {
    it("should extract script tags as prefetch hints", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const html = '<script src="http://example.com/app.js"></script>';
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 1);
      assertEquals(hints[0]?.type, "prefetch");
      assertEquals(hints[0]?.href, "http://example.com/app.js");
      assertEquals(hints[0]?.as, "script");

      mocks.cleanup();
    });

    it("should extract stylesheet links as prefetch hints", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const html = '<link rel="stylesheet" href="http://example.com/style.css">';
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 1);
      assertEquals(hints[0]?.type, "prefetch");
      assertEquals(hints[0]?.href, "http://example.com/style.css");
      assertEquals(hints[0]?.as, "style");

      mocks.cleanup();
    });

    it("should extract existing preload links", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const html = '<link rel="preload" href="http://example.com/font.woff2" as="font">';
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 1);
      assertEquals(hints[0]?.type, "preload");
      assertEquals(hints[0]?.href, "http://example.com/font.woff2");
      assertEquals(hints[0]?.as, "font");

      mocks.cleanup();
    });

    it("should extract existing prefetch links", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const html = '<link rel="prefetch" href="http://example.com/next-page" as="document">';
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 1);
      assertEquals(hints[0]?.type, "prefetch");
      assertEquals(hints[0]?.href, "http://example.com/next-page");

      mocks.cleanup();
    });

    it("should skip already prefetched URLs", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const html = '<script src="http://example.com/app.js"></script>';
      const prefetchedUrls = new Set(["http://example.com/app.js"]);

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 0);

      mocks.cleanup();
    });

    it("should extract multiple resource types", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const html = `
        <script src="http://example.com/app.js"></script>
        <link rel="stylesheet" href="http://example.com/style.css">
        <link rel="preload" href="http://example.com/font.woff2" as="font">
      `;
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 3);

      mocks.cleanup();
    });

    it("should handle parsing errors gracefully", () => {
      const mocks = setupMocks(); // Mock parser to throw error
      (globalThis as any).DOMParser = class {
        parseFromString() {
          throw new Error("Parse error");
        }
      };

      const manager = new ResourceHintsManager();
      const html = "<invalid-html";
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 0);

      mocks.cleanup();
    });

    it("should handle empty HTML", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const html = "";
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 0);

      mocks.cleanup();
    });

    it("should skip resources without href/src", () => {
      const mocks = setupMocks();
      (globalThis as any).DOMParser = class {
        parseFromString() {
          return {
            querySelectorAll: (selector: string) => {
              if (selector === "script[src]") {
                return [{ src: "" }]; // Empty src
              }
              return [];
            },
          };
        }
      };

      const manager = new ResourceHintsManager();
      const html = '<script src=""></script>';
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length, 0);

      mocks.cleanup();
    });
  });

  describe("Generate Resource Hints (Static)", () => {
    it("should generate dns-prefetch hints for CDNs", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", []);

      assertEquals(
        hints.includes('<link rel="dns-prefetch" href="https://cdn.jsdelivr.net">'),
        true,
      );
      assertEquals(hints.includes('<link rel="dns-prefetch" href="https://esm.sh">'), true);
    });

    it("should generate preconnect hint for CDN", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", []);

      assertEquals(
        hints.includes('<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>'),
        true,
      );
    });

    it("should generate modulepreload for JS files", () => {
      const assets = ["app.js", "vendor.js"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      assertEquals(hints.includes('<link rel="modulepreload" href="app.js">'), true);
      assertEquals(hints.includes('<link rel="modulepreload" href="vendor.js">'), true);
    });

    it("should generate preload for CSS files", () => {
      const assets = ["style.css", "theme.css"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      assertEquals(hints.includes('<link rel="preload" as="style" href="style.css">'), true);
      assertEquals(hints.includes('<link rel="preload" as="style" href="theme.css">'), true);
    });

    it("should generate preload for font files with crossorigin", () => {
      const assets = ["font.woff2", "icons.woff"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      assertEquals(
        hints.includes('<link rel="preload" as="font" href="font.woff2" crossorigin>'),
        true,
      );
      assertEquals(
        hints.includes('<link rel="preload" as="font" href="icons.woff" crossorigin>'),
        true,
      );
    });

    it("should handle TTF font files", () => {
      const assets = ["font.ttf"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      assertEquals(
        hints.includes('<link rel="preload" as="font" href="font.ttf" crossorigin>'),
        true,
      );
    });

    it("should handle OTF font files", () => {
      const assets = ["font.otf"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      assertEquals(
        hints.includes('<link rel="preload" as="font" href="font.otf" crossorigin>'),
        true,
      );
    });

    it("should handle mixed asset types", () => {
      const assets = ["app.js", "style.css", "font.woff2"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      assertEquals(hints.includes('<link rel="modulepreload" href="app.js">'), true);
      assertEquals(hints.includes('<link rel="preload" as="style" href="style.css">'), true);
      assertEquals(
        hints.includes('<link rel="preload" as="font" href="font.woff2" crossorigin>'),
        true,
      );
    });

    it("should return newline-separated hints", () => {
      const assets = ["app.js", "style.css"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      const lines = hints.split("\n");
      assertEquals(lines.length > 1, true);
    });

    it("should handle empty assets array", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", []);

      // Should still have CDN hints
      assertEquals(hints.includes("cdn.jsdelivr.net"), true);
    });

    it("should ignore non-recognized file types", () => {
      const assets = ["image.png", "data.json", "app.js"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      assertEquals(hints.includes("image.png"), false);
      assertEquals(hints.includes("data.json"), false);
      assertEquals(hints.includes("app.js"), true);
    });

    it("should handle assets with paths", () => {
      const assets = ["/assets/js/app.js", "./styles/main.css"];
      const hints = ResourceHintsManager.generateResourceHints("/route", assets);

      assertEquals(hints.includes('<link rel="modulepreload" href="/assets/js/app.js">'), true);
      assertEquals(
        hints.includes('<link rel="preload" as="style" href="./styles/main.css">'),
        true,
      );
    });
  });

  describe("Edge Cases", () => {
    it("should handle hints without optional attributes", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "prefetch", href: "http://example.com/page" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 1);
      assertEquals(elements[0]?.attributes.rel, "prefetch");

      mocks.cleanup();
    });

    it("should handle complex HTML with nested elements", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const html = `
        <html>
          <head>
            <script src="http://example.com/app.js"></script>
          </head>
          <body>
            <div>
              <script src="http://example.com/widget.js"></script>
            </div>
          </body>
        </html>
      `;
      const prefetchedUrls = new Set<string>();

      const hints = manager.extractResourceHints(html, prefetchedUrls);

      assertEquals(hints.length >= 1, true);

      mocks.cleanup();
    });

    it("should handle URLs with query parameters", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "prefetch", href: "http://example.com/page?v=1.0" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements[0]?.attributes.href, "http://example.com/page?v=1.0");

      mocks.cleanup();
    });

    it("should handle URLs with hash fragments", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "prefetch", href: "http://example.com/page#section" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements[0]?.attributes.href, "http://example.com/page#section");

      mocks.cleanup();
    });

    it("should handle relative URLs", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "prefetch", href: "/assets/app.js" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements[0]?.attributes.href, "/assets/app.js");

      mocks.cleanup();
    });

    it("should differentiate hints by type and href", () => {
      const mocks = setupMocks();

      const manager = new ResourceHintsManager();
      const hints: ResourceHint[] = [
        { type: "prefetch", href: "http://example.com/page" },
        { type: "preload", href: "http://example.com/page", as: "document" },
      ];

      manager.applyResourceHints(hints);

      const elements = mocks.getCreatedElements();
      assertEquals(elements.length, 2);

      mocks.cleanup();
    });
  });
});
