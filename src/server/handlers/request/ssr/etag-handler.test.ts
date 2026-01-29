import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeSSRETag } from "./etag-handler.ts";

describe("server/handlers/request/ssr/etag-handler", () => {
  describe("computeSSRETag", () => {
    it("should use ssrHash when provided", () => {
      const etag = computeSSRETag("abc123", "<html></html>");
      assertEquals(etag, 'W/"abc123"');
    });

    it("should normalize ssrHash with W/ prefix", () => {
      const etag = computeSSRETag('W/"abc"', "<html></html>");
      assertEquals(etag, 'W/"abc"');
    });

    it("should strip extra quotes from ssrHash", () => {
      const etag = computeSSRETag('"def"', "<html></html>");
      assertEquals(etag, 'W/"def"');
    });

    it("should fall back to computing etag from HTML when no ssrHash", () => {
      const etag = computeSSRETag(undefined, "<html>hello</html>");
      assertEquals(etag.startsWith('W/"'), true);
      assertEquals(etag.endsWith('"'), true);
    });

    it("should produce deterministic output for same HTML", () => {
      const a = computeSSRETag(undefined, "<div>content</div>");
      const b = computeSSRETag(undefined, "<div>content</div>");
      assertEquals(a, b);
    });

    it("should produce different output for different HTML", () => {
      const a = computeSSRETag(undefined, "<div>a</div>");
      const b = computeSSRETag(undefined, "<div>b</div>");
      assertEquals(a !== b, true);
    });
  });
});
