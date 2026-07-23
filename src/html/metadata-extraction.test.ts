import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { extractHTMLMetadata } from "./metadata-extraction.ts";

describe("html/metadata-extraction", () => {
  describe("extractHTMLMetadata", () => {
    it("should extract title and description", () => {
      const meta = extractHTMLMetadata({ title: "My Page", description: "A page" });
      assertEquals(meta.title, "My Page");
      assertEquals(meta.description, "A page");
    });

    it("should use default title when not provided", () => {
      const meta = extractHTMLMetadata({});
      assertEquals(meta.title, "Veryfront App");
    });

    it("should merge layout and page frontmatter", () => {
      const meta = extractHTMLMetadata(
        { title: "Page Title" },
        { title: "Layout Title", description: "Layout Desc" },
      );
      assertEquals(meta.title, "Page Title");
      assertEquals(meta.description, "Layout Desc");
    });

    it("should extract og metadata into meta array", () => {
      const meta = extractHTMLMetadata({
        og: { title: "OG Title", image: "https://example.com/img.png" },
      });

      assertExists(meta.meta);
      assertEquals(meta.meta.length, 2);
      assertEquals(meta.meta[0]?.property, "og:title");
      assertEquals(meta.meta[0]?.content, "OG Title");
    });

    it("should extract twitter metadata into meta array", () => {
      const meta = extractHTMLMetadata({
        twitter: { card: "summary", site: "@veryfront" },
      });

      assertExists(meta.meta);
      assertEquals(meta.meta.length, 2);
      assertEquals(meta.meta[0]?.name, "twitter:card");
    });

    it("should handle nested metadata object", () => {
      const meta = extractHTMLMetadata({
        metadata: { title: "Nested Title" },
      });
      assertEquals(meta.title, "Nested Title");
    });

    it("should pass through non-reserved keys", () => {
      const meta = extractHTMLMetadata({ customKey: "customValue" });
      assertEquals((meta as Record<string, unknown>).customKey, "customValue");
    });

    it("should handle arrays for meta, links, scripts, styles", () => {
      const meta = extractHTMLMetadata({
        meta: [{ name: "robots", content: "noindex" }],
        links: [{ rel: "canonical", href: "https://example.com" }],
        scripts: [{ src: "/app.js" }],
        styles: [{ href: "/style.css" }],
      });

      assertExists(meta.meta);
      assertExists(meta.links);
      assertExists(meta.scripts);
      assertExists(meta.styles);
      assertEquals(meta.meta.length, 1);
      assertEquals(meta.links.length, 1);
      assertEquals(meta.scripts.length, 1);
      assertEquals(meta.styles.length, 1);
    });

    it("does not mutate frontmatter arrays while adding social metadata", () => {
      const existing = [{ name: "robots", content: "index" }];

      const meta = extractHTMLMetadata({
        meta: existing,
        og: { title: "Social title" },
      });

      assertEquals(existing, [{ name: "robots", content: "index" }]);
      assertEquals(meta.meta?.length, 2);
    });

    it("ignores malformed social metadata instead of throwing", () => {
      const meta = extractHTMLMetadata({
        og: null,
        twitter: ["invalid"],
      } as never);

      assertEquals(meta.meta, []);
    });

    it("skips invalid social keys without dropping later valid entries", () => {
      const meta = extractHTMLMetadata({
        og: {
          "invalid key": "ignored",
          title: "Valid title",
        },
      });

      assertEquals(meta.meta, [
        { property: "og:title", content: "Valid title" },
      ]);
    });

    it("does not allow nested metadata to change object prototypes", () => {
      const nested = JSON.parse('{"__proto__":{"polluted":true},"title":"Safe"}');

      const meta = extractHTMLMetadata({ metadata: nested } as never);

      assertEquals(meta.title, "Safe");
      assertEquals(Object.getPrototypeOf(meta), Object.prototype);
      assertEquals((meta as Record<string, unknown>).polluted, undefined);
    });

    it("converts inaccessible frontmatter into a typed validation failure", () => {
      const frontmatter = new Proxy({}, {
        ownKeys() {
          throw new Error("private implementation detail");
        },
      });

      assertThrows(
        () => extractHTMLMetadata(frontmatter),
        Error,
        "frontmatter cannot be inspected",
      );
    });

    it("converts inaccessible structured metadata entries into validation failures", () => {
      const entry = { name: "description" } as Record<string, string>;
      let accessorCalls = 0;
      Object.defineProperty(entry, "content", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "private implementation detail";
        },
      });

      assertThrows(
        () => extractHTMLMetadata({ meta: [entry] } as never),
        Error,
        "metadata entry cannot be inspected",
      );
      assertEquals(accessorCalls, 0);
    });

    it("does not execute frontmatter accessors", () => {
      let accessorCalls = 0;
      const frontmatter: Record<string, unknown> = {};
      Object.defineProperty(frontmatter, "title", {
        enumerable: true,
        get() {
          accessorCalls++;
          return "Private title";
        },
      });

      assertThrows(
        () => extractHTMLMetadata(frontmatter),
        Error,
        "frontmatter cannot be inspected",
      );
      assertEquals(accessorCalls, 0);
    });

    it("uses string defaults for malformed title and description values", () => {
      const meta = extractHTMLMetadata({
        title: { unsafe: true },
        description: 42,
      } as never);

      assertEquals(meta.title, "Veryfront App");
      assertEquals(meta.description, "");
    });

    it("filters malformed structured metadata entries", () => {
      const meta = extractHTMLMetadata({
        meta: [null, { name: "robots", content: "index" }, { name: "missing-content" }],
        links: [null, { rel: "canonical", href: "/page" }, { rel: "stylesheet" }],
        scripts: [null, { src: "/app.js" }, { invalid: "value" }],
        styles: [null, { content: "body{}" }, { invalid: "value" }],
      } as never);

      assertEquals(meta.meta, [{ name: "robots", content: "index" }]);
      assertEquals(meta.links, [{ rel: "canonical", href: "/page" }]);
      assertEquals(meta.scripts, [{ src: "/app.js" }]);
      assertEquals(meta.styles, [{ content: "body{}" }]);
    });

    it("rejects oversized top-level metadata strings", () => {
      assertThrows(
        () => extractHTMLMetadata({ description: "x".repeat(16 * 1024 + 1) }),
        Error,
        "description",
      );
    });

    it("rejects structured metadata beyond the aggregate byte budget", () => {
      assertThrows(
        () =>
          extractHTMLMetadata({
            scripts: Array.from(
              { length: 5 },
              () => ({ content: "x".repeat(1024 * 1024) }),
            ),
          }),
        Error,
        "budget",
      );
    });

    it("rejects excessive structured metadata entries", () => {
      assertThrows(
        () =>
          extractHTMLMetadata({
            meta: Array.from(
              { length: 101 },
              (_, index) => ({ name: `entry-${index}`, content: "value" }),
            ),
          }),
        Error,
        "entry limit",
      );
    });
  });
});
