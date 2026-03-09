import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PageHandler } from "./page-handler.ts";

describe("server/services/rsc/orchestrators/page-handler", () => {
  describe("handle", () => {
    it("should return HTML response with correct content type", () => {
      const handler = new PageHandler();
      const response = handler.handle("/test", new URLSearchParams());
      assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
    });

    it("should return 200 status", () => {
      const handler = new PageHandler();
      const response = handler.handle("/test", new URLSearchParams());
      assertEquals(response.status, 200);
    });

    it("should include render URL for the given pathname", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/about", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("/_veryfront/rsc/render/about"), true);
    });

    it("should include query string in render URL", async () => {
      const handler = new PageHandler();
      const params = new URLSearchParams({ name: "World", id: "42" });
      const response = handler.handle("/page", params);
      const html = await response.text();
      assertEquals(html.includes("name=World"), true);
      assertEquals(html.includes("id=42"), true);
    });

    it("should not include query separator when no search params", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/page", new URLSearchParams());
      const html = await response.text();
      // The render URL should not have a ? when no params
      assertEquals(html.includes("/_veryfront/rsc/render/page?"), false);
    });

    it("should include rsc-root div", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes('id="rsc-root"'), true);
    });

    it("should include dev mode flag", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("__VERYFRONT_DEV__"), true);
    });

    it("should include hydrate.js import", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("/_veryfront/rsc/hydrate.js"), true);
    });

    it("should include security validation function", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.includes("validateTrustedHtml"), true);
    });

    it("should be a valid HTML document", async () => {
      const handler = new PageHandler();
      const response = handler.handle("/", new URLSearchParams());
      const html = await response.text();
      assertEquals(html.startsWith("<!DOCTYPE html>"), true);
      assertEquals(html.includes("<html"), true);
      assertEquals(html.includes("</html>"), true);
    });
  });
});
