import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { NotFoundHandler } from "./not-found.ts";
import { ErrorPages } from "#veryfront/server/utils/error-html.ts";
import { addNonceToHtmlTags } from "#veryfront/html/nonce-injection.ts";

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

    it("renders the SAME 404 page as the SSR miss path (nonce-injected ErrorPages)", async () => {
      // The fallback handler and the SSR miss path must produce an identical 404,
      // so a fallthrough like /_veryfront/<missing> looks the same as a normal
      // page miss — not the old divergent card design.
      const body = await getBody("http://localhost/some-path");

      // The inline <style>/<script> must carry the CSP nonce (like the SSR
      // response builder), otherwise a strict nonce-based CSP would block the
      // styling and the page would render unstyled.
      const nonce = body.match(/<style nonce="([^"]+)"/)?.[1] ?? "";
      assertEquals(nonce.length > 0, true);
      // ...and the body is exactly the canonical ErrorPages 404 with that nonce.
      assertEquals(body, addNonceToHtmlTags(ErrorPages.notFound("/some-path"), nonce));

      assertEquals(body.includes("Page Not Found"), false);
      assertEquals(body.includes("Go Home"), false);
    });

    it("should return styled HTML naming the missing path", async () => {
      const body = await getBody("http://localhost/my-missing-page");
      assertEquals(body.includes("<!DOCTYPE html>"), true);
      assertEquals(body.includes("Not Found"), true);
      assertEquals(body.includes("could not be found"), true);
      assertEquals(body.includes("/my-missing-page"), true);
    });

    it("should escape HTML in the pathname", async () => {
      // URL keeps the angle brackets percent-encoded in the pathname, and
      // ErrorPages escapes the message — the raw script tag must never appear.
      const body = await getBody(
        "http://localhost/%3Cscript%3Ealert(1)%3C/script%3E",
      );
      assertEquals(body.includes("<script>alert(1)</script>"), false);
    });
  });
});
