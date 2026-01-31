import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeSSRETag } from "./etag-handler.ts";

describe("server/handlers/request/ssr/etag-handler", () => {
  describe("computeSSRETag", () => {
    it("should use ssrHash when provided", () => {
      assertEquals(computeSSRETag("abc123", "<html></html>"), 'W/"abc123"');
    });

    it("should normalize ssrHash with W/ prefix", () => {
      assertEquals(computeSSRETag('W/"abc"', "<html></html>"), 'W/"abc"');
    });

    it("should strip extra quotes from ssrHash", () => {
      assertEquals(computeSSRETag('"def"', "<html></html>"), 'W/"def"');
    });

    it("should fall back to computing etag from HTML when no ssrHash", () => {
      const etag = computeSSRETag(undefined, "<html>hello</html>");
      assertEquals(etag.startsWith('W/"'), true);
      assertEquals(etag.endsWith('"'), true);
    });

    it("should produce deterministic output for same HTML", () => {
      const html = "<div>content</div>";
      assertEquals(computeSSRETag(undefined, html), computeSSRETag(undefined, html));
    });

    it("should produce different output for different HTML", () => {
      assertEquals(
        computeSSRETag(undefined, "<div>a</div>") !== computeSSRETag(undefined, "<div>b</div>"),
        true,
      );
    });
  });
});
