/**
 * Unit Tests for Resource Hints Manager
 * Tests resource hint generation and application (preload, prefetch, dns-prefetch)
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ResourceHintsManager } from "./resource-hints.ts";
import type { ResourceHint as _ResourceHint } from "./resource-hints.ts";

class MockDOMParser {
  parseFromString(html: string, _mimeType: DOMParserSupportedType): Document {
    const scripts: HTMLScriptElement[] = [];
    const links: HTMLLinkElement[] = [];

    const scriptRegex = /<script\s+src="([^"]+)"/g;
    let match: RegExpExecArray | null;
    while ((match = scriptRegex.exec(html)) !== null) {
      scripts.push({ src: match[1], tagName: "SCRIPT" } as HTMLScriptElement);
    }

    const linkRegex = /<link\s+([^>]+)>/g;
    while ((match = linkRegex.exec(html)) !== null) {
      const attrs = match[1] ?? "";
      const rel = /rel="([^"]+)"/.exec(attrs)?.[1];
      const href = /href="([^"]+)"/.exec(attrs)?.[1];
      const as = /as="([^"]+)"/.exec(attrs)?.[1];

      if (!rel || !href) continue;

      links.push({
        rel,
        href,
        tagName: "LINK",
        getAttribute: (attr: string) => (attr === "as" ? as ?? null : null),
      } as unknown as HTMLLinkElement);
    }

    return {
      querySelectorAll: (selector: string) => {
        if (selector === "script[src]") return scripts;

        if (
          selector.includes('link[rel="preload"]') ||
          selector.includes('link[rel="prefetch"]')
        ) {
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

type CreatedElement = { tagName: string; attributes: Record<string, string> };

function setupMocks(): {
  cleanup: () => void;
  getCreatedElements: () => CreatedElement[];
  clearCreatedElements: () => void;
} {
  const originalDOMParser = (globalThis as any).DOMParser;
  const originalDocument = globalThis.document;

  (globalThis as any).DOMParser = MockDOMParser;

  const createdElements: CreatedElement[] = [];
  (globalThis as any).document = {
    head: {
      appendChild: (element: any) => {
        createdElements.push({
          tagName: element.tagName,
          attributes: { ...element },
        });
      },
    },
    createElement: (tagName: string) => ({
      tagName,
      rel: "",
      href: "",
      setAttribute(name: string, value: string) {
        this[name] = value;
      },
    }),
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
}

describe("ResourceHintsManager", () => {
  describe("Constructor", () => {
    it("should create ResourceHintsManager instance", () => {
      const manager = new ResourceHintsManager();
      assertExists(manager);
    });

    it("should initialize with empty applied hints set", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([{ type: "prefetch", href: "http://example.com/page" }]);

      assertEquals(mocks.getCreatedElements().length, 1);
      mocks.cleanup();
    });
  });

  describe("Apply Resource Hints", () => {
    it("should apply prefetch hint", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([{ type: "prefetch", href: "http://example.com/page" }]);

      const [el] = mocks.getCreatedElements();
      assertEquals(mocks.getCreatedElements().length, 1);
      assertEquals(el?.attributes.rel, "prefetch");
      assertEquals(el?.attributes.href, "http://example.com/page");

      mocks.cleanup();
    });

    it("should apply preload hint with as attribute", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([
        { type: "preload", href: "http://example.com/script.js", as: "script" },
      ]);

      const [el] = mocks.getCreatedElements();
      assertEquals(mocks.getCreatedElements().length, 1);
      assertEquals(el?.attributes.rel, "preload");
      assertEquals(el?.attributes.href, "http://example.com/script.js");
      assertEquals(el?.attributes.as, "script");

      mocks.cleanup();
    });

    it("should apply dns-prefetch hint", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([{ type: "dns-prefetch", href: "http://cdn.example.com" }]);

      const [el] = mocks.getCreatedElements();
      assertEquals(mocks.getCreatedElements().length, 1);
      assertEquals(el?.attributes.rel, "dns-prefetch");
      assertEquals(el?.attributes.href, "http://cdn.example.com");

      mocks.cleanup();
    });

    it("should apply preconnect hint with crossorigin", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([
        { type: "preconnect", href: "http://api.example.com", crossOrigin: "anonymous" },
      ]);

      const [el] = mocks.getCreatedElements();
      assertEquals(mocks.getCreatedElements().length, 1);
      assertEquals(el?.attributes.rel, "preconnect");
      assertEquals(el?.attributes.href, "http://api.example.com");
      assertEquals(el?.attributes.crossorigin, "anonymous");

      mocks.cleanup();
    });

    it("should apply hint with media attribute", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([
        { type: "preload", href: "http://example.com/style.css", as: "style", media: "print" },
      ]);

      const [el] = mocks.getCreatedElements();
      assertEquals(mocks.getCreatedElements().length, 1);
      assertEquals(el?.attributes.media, "print");

      mocks.cleanup();
    });

    it("should apply multiple hints", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([
        { type: "dns-prefetch", href: "http://cdn.example.com" },
        { type: "preconnect", href: "http://api.example.com" },
        { type: "prefetch", href: "http://example.com/page" },
      ]);

      assertEquals(mocks.getCreatedElements().length, 3);
      mocks.cleanup();
    });

    it("should not apply duplicate hints", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([
        { type: "prefetch", href: "http://example.com/page" },
        { type: "prefetch", href: "http://example.com/page" },
      ]);

      assertEquals(mocks.getCreatedElements().length, 1);
      mocks.cleanup();
    });

    it("should not apply hint if already exists in DOM", () => {
      const mocks = setupMocks();
      (globalThis as any).document.querySelector = (selector: string) => {
        if (selector === 'link[rel="prefetch"][href="http://example.com/page"]') {
          return { rel: "prefetch", href: "http://example.com/page" };
        }
        return null;
      };

      const manager = new ResourceHintsManager();
      manager.applyResourceHints([{ type: "prefetch", href: "http://example.com/page" }]);

      assertEquals(mocks.getCreatedElements().length, 0);
      mocks.cleanup();
    });

    it("should track applied hints across multiple calls", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([{ type: "prefetch", href: "http://example.com/page1" }]);
      manager.applyResourceHints([
        { type: "prefetch", href: "http://example.com/page1" },
        { type: "prefetch", href: "http://example.com/page2" },
      ]);

      assertEquals(mocks.getCreatedElements().length, 2);
      mocks.cleanup();
    });
  });

  describe("Extract Resource Hints", () => {
    it("should extract script tags as prefetch hints", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      const hints = manager.extractResourceHints(
        '<script src="http://example.com/app.js"></script>',
        new Set<string>(),
      );

      assertEquals(hints.length, 1);
      assertEquals(hints[0]?.type, "prefetch");
      assertEquals(hints[0]?.href, "http://example.com/app.js");
      assertEquals(hints[0]?.as, "script");

      mocks.cleanup();
    });

    it("should extract stylesheet links as prefetch hints", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      const hints = manager.extractResourceHints(
        '<link rel="stylesheet" href="http://example.com/style.css">',
        new Set<string>(),
      );

      assertEquals(hints.length, 1);
      assertEquals(hints[0]?.type, "prefetch");
      assertEquals(hints[0]?.href, "http://example.com/style.css");
      assertEquals(hints[0]?.as, "style");

      mocks.cleanup();
    });

    it("should extract existing preload links", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      const hints = manager.extractResourceHints(
        '<link rel="preload" href="http://example.com/font.woff2" as="font">',
        new Set<string>(),
      );

      assertEquals(hints.length, 1);
      assertEquals(hints[0]?.type, "preload");
      assertEquals(hints[0]?.href, "http://example.com/font.woff2");
      assertEquals(hints[0]?.as, "font");

      mocks.cleanup();
    });

    it("should extract existing prefetch links", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      const hints = manager.extractResourceHints(
        '<link rel="prefetch" href="http://example.com/next-page" as="document">',
        new Set<string>(),
      );

      assertEquals(hints.length, 1);
      assertEquals(hints[0]?.type, "prefetch");
      assertEquals(hints[0]?.href, "http://example.com/next-page");

      mocks.cleanup();
    });

    it("should skip already prefetched URLs", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      const hints = manager.extractResourceHints(
        '<script src="http://example.com/app.js"></script>',
        new Set(["http://example.com/app.js"]),
      );

      assertEquals(hints.length, 0);
      mocks.cleanup();
    });

    it("should extract multiple resource types", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      const hints = manager.extractResourceHints(
        `
        <script src="http://example.com/app.js"></script>
        <link rel="stylesheet" href="http://example.com/style.css">
        <link rel="preload" href="http://example.com/font.woff2" as="font">
      `,
        new Set<string>(),
      );

      assertEquals(hints.length, 3);
      mocks.cleanup();
    });

    it("should handle parsing errors gracefully", () => {
      const mocks = setupMocks();
      (globalThis as any).DOMParser = class {
        parseFromString(): never {
          throw new Error("Parse error");
        }
      };

      const manager = new ResourceHintsManager();
      const hints = manager.extractResourceHints("<invalid-html", new Set<string>());

      assertEquals(hints.length, 0);
      mocks.cleanup();
    });

    it("should handle empty HTML", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      const hints = manager.extractResourceHints("", new Set<string>());

      assertEquals(hints.length, 0);
      mocks.cleanup();
    });

    it("should skip resources without href/src", () => {
      const mocks = setupMocks();
      (globalThis as any).DOMParser = class {
        parseFromString(): { querySelectorAll: (selector: string) => any[] } {
          return {
            querySelectorAll: (selector: string) => {
              if (selector === "script[src]") return [{ src: "" }];
              return [];
            },
          };
        }
      };

      const manager = new ResourceHintsManager();
      const hints = manager.extractResourceHints('<script src=""></script>', new Set<string>());

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
      const hints = ResourceHintsManager.generateResourceHints("/route", ["app.js", "vendor.js"]);

      assertEquals(hints.includes('<link rel="modulepreload" href="app.js">'), true);
      assertEquals(hints.includes('<link rel="modulepreload" href="vendor.js">'), true);
    });

    it("should generate preload for CSS files", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", [
        "style.css",
        "theme.css",
      ]);

      assertEquals(hints.includes('<link rel="preload" as="style" href="style.css">'), true);
      assertEquals(hints.includes('<link rel="preload" as="style" href="theme.css">'), true);
    });

    it("should generate preload for font files with crossorigin", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", [
        "font.woff2",
        "icons.woff",
      ]);

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
      const hints = ResourceHintsManager.generateResourceHints("/route", ["font.ttf"]);

      assertEquals(
        hints.includes('<link rel="preload" as="font" href="font.ttf" crossorigin>'),
        true,
      );
    });

    it("should handle OTF font files", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", ["font.otf"]);

      assertEquals(
        hints.includes('<link rel="preload" as="font" href="font.otf" crossorigin>'),
        true,
      );
    });

    it("should handle mixed asset types", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", [
        "app.js",
        "style.css",
        "font.woff2",
      ]);

      assertEquals(hints.includes('<link rel="modulepreload" href="app.js">'), true);
      assertEquals(hints.includes('<link rel="preload" as="style" href="style.css">'), true);
      assertEquals(
        hints.includes('<link rel="preload" as="font" href="font.woff2" crossorigin>'),
        true,
      );
    });

    it("should return newline-separated hints", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", ["app.js", "style.css"]);
      assertEquals(hints.split("\n").length > 1, true);
    });

    it("should handle empty assets array", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", []);
      assertEquals(hints.includes("cdn.jsdelivr.net"), true);
    });

    it("should ignore non-recognized file types", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", [
        "image.png",
        "data.json",
        "app.js",
      ]);

      assertEquals(hints.includes("image.png"), false);
      assertEquals(hints.includes("data.json"), false);
      assertEquals(hints.includes("app.js"), true);
    });

    it("should handle assets with paths", () => {
      const hints = ResourceHintsManager.generateResourceHints("/route", [
        "/assets/js/app.js",
        "./styles/main.css",
      ]);

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

      manager.applyResourceHints([{ type: "prefetch", href: "http://example.com/page" }]);

      const [el] = mocks.getCreatedElements();
      assertEquals(mocks.getCreatedElements().length, 1);
      assertEquals(el?.attributes.rel, "prefetch");

      mocks.cleanup();
    });

    it("should handle complex HTML with nested elements", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      const hints = manager.extractResourceHints(
        `
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
      `,
        new Set<string>(),
      );

      assertEquals(hints.length >= 1, true);
      mocks.cleanup();
    });

    it("should handle URLs with query parameters", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([{ type: "prefetch", href: "http://example.com/page?v=1.0" }]);

      const [el] = mocks.getCreatedElements();
      assertEquals(el?.attributes.href, "http://example.com/page?v=1.0");

      mocks.cleanup();
    });

    it("should handle URLs with hash fragments", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([{ type: "prefetch", href: "http://example.com/page#section" }]);

      const [el] = mocks.getCreatedElements();
      assertEquals(el?.attributes.href, "http://example.com/page#section");

      mocks.cleanup();
    });

    it("should handle relative URLs", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([{ type: "prefetch", href: "/assets/app.js" }]);

      const [el] = mocks.getCreatedElements();
      assertEquals(el?.attributes.href, "/assets/app.js");

      mocks.cleanup();
    });

    it("should differentiate hints by type and href", () => {
      const mocks = setupMocks();
      const manager = new ResourceHintsManager();

      manager.applyResourceHints([
        { type: "prefetch", href: "http://example.com/page" },
        { type: "preload", href: "http://example.com/page", as: "document" },
      ]);

      assertEquals(mocks.getCreatedElements().length, 2);
      mocks.cleanup();
    });
  });
});
