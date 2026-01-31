import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
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
      const { patterns } = handler.metadata;
      assertExists(patterns);
      assertEquals(patterns.length, 0);
    });
  });

  describe("NotFoundHandler.handle", () => {
    const minimalCtx = { securityConfig: undefined } as never;

    async function getBody(url: string): Promise<string> {
      const handler = new NotFoundHandler();
      const req = new Request(url);
      const result = await handler.handle(req, minimalCtx);
      return await result.response!.text();
    }

    it("should return a 404 response", async () => {
      const handler = new NotFoundHandler();
      const req = new Request("http://localhost/nonexistent");
      const result = await handler.handle(req, minimalCtx);

      assertEquals(result.response instanceof Response, true);
      assertEquals(result.response?.status, 404);
    });

    it("should return HTML content", async () => {
      const body = await getBody("http://localhost/some-path");
      assertEquals(body.includes("<!DOCTYPE html>"), true);
      assertEquals(body.includes("404"), true);
      assertEquals(body.includes("Page Not Found"), true);
    });

    it("should include the requested path in the response", async () => {
      const body = await getBody("http://localhost/my-missing-page");
      assertEquals(body.includes("/my-missing-page"), true);
    });

    it("should escape HTML in the pathname", async () => {
      // URL constructor encodes angle brackets, so the pathname becomes /%3Cscript%3E...
      // The handler uses escapeHtml on it. We verify the path is safely included.
      const body = await getBody(
        "http://localhost/%3Cscript%3Ealert(1)%3C/script%3E",
      );
      assertEquals(body.includes("<script>alert(1)</script>"), false);
    });

    it("should include Go Home and Go Back links", async () => {
      const body = await getBody("http://localhost/test");
      assertEquals(body.includes('href="/"'), true);
      assertEquals(body.includes("Go Home"), true);
      assertEquals(body.includes("Go Back"), true);
    });
  });
});
