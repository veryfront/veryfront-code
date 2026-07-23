import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { computeSSRETag } from "./etag-handler.ts";

describe("server/handlers/request/ssr/etag-handler", () => {
  describe("computeSSRETag", () => {
    it("should use ssrHash when provided", async () => {
      assertEquals(await computeSSRETag("abc123", "<html></html>"), 'W/"abc123"');
    });

    it("should normalize ssrHash with W/ prefix", async () => {
      assertEquals(await computeSSRETag('W/"abc"', "<html></html>"), 'W/"abc"');
    });

    it("should strip extra quotes from ssrHash", async () => {
      assertEquals(await computeSSRETag('"def"', "<html></html>"), 'W/"def"');
    });

    it("should fall back to computing etag from HTML when no ssrHash", async () => {
      const etag = await computeSSRETag(undefined, "<html>hello</html>");
      assertEquals(etag.startsWith('W/"'), true);
      assertEquals(etag.endsWith('"'), true);
    });

    it("should produce deterministic output for same HTML", async () => {
      const html = "<div>content</div>";
      assertEquals(await computeSSRETag(undefined, html), await computeSSRETag(undefined, html));
    });

    it("should produce different output for different HTML", async () => {
      assertEquals(
        await computeSSRETag(undefined, "<div>a</div>") !==
          await computeSSRETag(undefined, "<div>b</div>"),
        true,
      );
    });
  });
});
