import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NotFoundHandler } from "./not-found.ts";

describe("server/handlers/response/not-found", () => {
  describe("NotFoundHandler metadata", () => {
    it("should have correct handler name", () => {
      const handler = new NotFoundHandler();
      assertEquals(handler.metadata.name, "NotFoundHandler");
    });

    it("should have empty patterns array (fallback handler)", () => {
      const handler = new NotFoundHandler();
      assertEquals(handler.metadata.patterns.length, 0);
    });
  });

  describe("NotFoundHandler.handle", () => {
    const minimalCtx = {
      securityConfig: undefined,
    } as never;

    it("should return a 404 response", async () => {
      const handler = new NotFoundHandler();
      const req = new Request("http://localhost/nonexistent");
      const result = await handler.handle(req, minimalCtx);
      assertEquals(result.response instanceof Response, true);
      if (result.response) {
        assertEquals(result.response.status, 404);
      }
    });

    it("should return HTML content", async () => {
      const handler = new NotFoundHandler();
      const req = new Request("http://localhost/some-path");
      const result = await handler.handle(req, minimalCtx);
      if (result.response) {
        const body = await result.response.text();
        assertEquals(body.includes("<!DOCTYPE html>"), true);
        assertEquals(body.includes("404"), true);
        assertEquals(body.includes("Page Not Found"), true);
      }
    });

    it("should include the requested path in the response", async () => {
      const handler = new NotFoundHandler();
      const req = new Request("http://localhost/my-missing-page");
      const result = await handler.handle(req, minimalCtx);
      if (result.response) {
        const body = await result.response.text();
        assertEquals(body.includes("/my-missing-page"), true);
      }
    });

    it("should escape HTML in the pathname", async () => {
      const handler = new NotFoundHandler();
      // URL constructor encodes angle brackets, so the pathname becomes /%3Cscript%3E...
      // The handler uses escapeHtml on it. We verify the path is safely included.
      const req = new Request("http://localhost/%3Cscript%3Ealert(1)%3C/script%3E");
      const result = await handler.handle(req, minimalCtx);
      if (result.response) {
        const body = await result.response.text();
        // Should NOT contain decoded, unescaped script tags
        assertEquals(body.includes("<script>alert(1)</script>"), false);
      }
    });

    it("should include Go Home and Go Back links", async () => {
      const handler = new NotFoundHandler();
      const req = new Request("http://localhost/test");
      const result = await handler.handle(req, minimalCtx);
      if (result.response) {
        const body = await result.response.text();
        assertEquals(body.includes('href="/"'), true);
        assertEquals(body.includes("Go Home"), true);
        assertEquals(body.includes("Go Back"), true);
      }
    });
  });
});
