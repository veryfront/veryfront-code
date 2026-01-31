import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { contentSecurityPolicy } from "./csp.ts";
import { MiddlewareContext } from "../../core/context.ts";

describe("contentSecurityPolicy", () => {
  function createContext(): MiddlewareContext {
    return new MiddlewareContext(new Request("https://example.com/"));
  }

  async function runMiddleware(
    middleware: ReturnType<typeof contentSecurityPolicy>,
    response: Response,
  ): Promise<Response | undefined> {
    return await middleware(createContext(), () => Promise.resolve(response));
  }

  function getCsp(response: Response | undefined): string {
    return response?.headers.get("Content-Security-Policy") ?? "";
  }

  it("should add CSP header to response", async () => {
    const middleware = contentSecurityPolicy({ "default-src": "'self'" });
    const response = await runMiddleware(middleware, new Response("OK"));

    assertStringIncludes(getCsp(response), "default-src 'self'");
  });

  it("should combine multiple directives", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
      "script-src": "'self' https://cdn.example.com",
      "style-src": "'self' 'unsafe-inline'",
    });

    const response = await runMiddleware(middleware, new Response("OK"));
    const csp = getCsp(response);

    assertStringIncludes(csp, "default-src 'self'");
    assertStringIncludes(csp, "script-src 'self' https://cdn.example.com");
    assertStringIncludes(csp, "style-src 'self' 'unsafe-inline'");
  });

  it("should add nonce to script-src", async () => {
    const middleware = contentSecurityPolicy(
      { "script-src": "'self'" },
      { nonce: "abc123" },
    );

    const response = await runMiddleware(middleware, new Response("OK"));

    assertStringIncludes(getCsp(response), "'nonce-abc123'");
  });

  it("should merge with existing CSP", async () => {
    const middleware = contentSecurityPolicy(
      { "default-src": "'self'" },
      { merge: "frame-ancestors 'none'" },
    );

    const response = await runMiddleware(middleware, new Response("OK"));
    const csp = getCsp(response);

    assertStringIncludes(csp, "frame-ancestors 'none'");
    assertStringIncludes(csp, "default-src 'self'");
  });

  it("should preserve original response status", async () => {
    const middleware = contentSecurityPolicy({ "default-src": "'self'" });
    const response = await runMiddleware(
      middleware,
      new Response("Created", { status: 201 }),
    );

    assertEquals(response?.status, 201);
  });

  it("should preserve original response body", async () => {
    const middleware = contentSecurityPolicy({ "default-src": "'self'" });
    const response = await runMiddleware(middleware, new Response("Original Body"));

    assertEquals(await response?.text(), "Original Body");
  });

  it("should handle undefined response from next", async () => {
    const middleware = contentSecurityPolicy({ "default-src": "'self'" });

    const response = await middleware(
      createContext(),
      () => Promise.resolve(undefined as unknown as Response),
    );

    assertEquals(response, undefined);
  });
});
