import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { describe, it } from "jsr:@std/testing@1/bdd";
import { contentSecurityPolicy } from "./csp.ts";
import { MiddlewareContext } from "../../core/context.ts";

describe("contentSecurityPolicy", () => {
  function createContext(): MiddlewareContext {
    return new MiddlewareContext(new Request("https://example.com/"));
  }

  it("should add CSP header to response", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
    });

    const ctx = createContext();
    const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

    const csp = response?.headers.get("Content-Security-Policy");
    assertStringIncludes(csp || "", "default-src 'self'");
  });

  it("should combine multiple directives", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
      "script-src": "'self' https://cdn.example.com",
      "style-src": "'self' 'unsafe-inline'",
    });

    const ctx = createContext();
    const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

    const csp = response?.headers.get("Content-Security-Policy");
    assertStringIncludes(csp || "", "default-src 'self'");
    assertStringIncludes(csp || "", "script-src 'self' https://cdn.example.com");
    assertStringIncludes(csp || "", "style-src 'self' 'unsafe-inline'");
  });

  it("should add nonce to script-src", async () => {
    const middleware = contentSecurityPolicy(
      { "script-src": "'self'" },
      { nonce: "abc123" },
    );

    const ctx = createContext();
    const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

    const csp = response?.headers.get("Content-Security-Policy");
    assertStringIncludes(csp || "", "'nonce-abc123'");
  });

  it("should merge with existing CSP", async () => {
    const middleware = contentSecurityPolicy(
      { "default-src": "'self'" },
      { merge: "frame-ancestors 'none'" },
    );

    const ctx = createContext();
    const response = await middleware(ctx, () => Promise.resolve(new Response("OK")));

    const csp = response?.headers.get("Content-Security-Policy");
    assertStringIncludes(csp || "", "frame-ancestors 'none'");
    assertStringIncludes(csp || "", "default-src 'self'");
  });

  it("should preserve original response status", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
    });

    const ctx = createContext();
    const response = await middleware(
      ctx,
      () => Promise.resolve(new Response("Created", { status: 201 })),
    );

    assertEquals(response?.status, 201);
  });

  it("should preserve original response body", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
    });

    const ctx = createContext();
    const response = await middleware(ctx, () => Promise.resolve(new Response("Original Body")));

    assertEquals(await response?.text(), "Original Body");
  });

  it("should handle undefined response from next", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
    });

    const ctx = createContext();
    const response = await middleware(ctx, () => Promise.resolve(undefined as unknown as Response));

    assertEquals(response, undefined);
  });
});
