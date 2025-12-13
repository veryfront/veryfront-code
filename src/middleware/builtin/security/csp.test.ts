import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { contentSecurityPolicy } from "./csp.ts";
import { MiddlewareContext } from "../../core/context.ts";

describe("contentSecurityPolicy", () => {
  it("should add Content-Security-Policy header with basic policies", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
      "script-src": "'self' 'unsafe-inline'",
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    const cspHeader = response.headers.get("Content-Security-Policy");
    assertExists(cspHeader);
    assertEquals(cspHeader.includes("default-src 'self'"), true);
    assertEquals(cspHeader.includes("script-src 'self' 'unsafe-inline'"), true);
  });

  it("should add nonce to script-src directive", async () => {
    const middleware = contentSecurityPolicy(
      {
        "default-src": "'self'",
        "script-src": "'self'",
      },
      {
        nonce: "random-nonce-123",
      },
    );
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    const cspHeader = response.headers.get("Content-Security-Policy");
    assertExists(cspHeader);
    assertEquals(cspHeader.includes("script-src 'self' 'nonce-random-nonce-123'"), true);
  });

  it("should merge with existing CSP", async () => {
    const middleware = contentSecurityPolicy(
      {
        "default-src": "'self'",
        "script-src": "'self'",
      },
      {
        merge: "base-uri 'none'",
      },
    );
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    const cspHeader = response.headers.get("Content-Security-Policy");
    assertExists(cspHeader);
    assertEquals(cspHeader.includes("base-uri 'none'"), true);
    assertEquals(cspHeader.includes("default-src 'self'"), true);
  });

  it("should preserve existing response headers", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () =>
      Promise.resolve(
        new Response("OK", {
          status: 200,
          headers: {
            "Content-Type": "text/html",
            "X-Custom": "value",
          },
        }),
      );

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("Content-Type"), "text/html");
    assertEquals(response.headers.get("X-Custom"), "value");
    assertEquals(response.headers.has("Content-Security-Policy"), true);
  });

  it("should handle multiple directives", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
      "script-src": "'self' 'unsafe-inline'",
      "style-src": "'self' 'unsafe-inline'",
      "img-src": "'self' data:",
      "font-src": "'self' data:",
      "connect-src": "'self'",
      "frame-ancestors": "'none'",
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    const cspHeader = response.headers.get("Content-Security-Policy");
    assertExists(cspHeader);
    assertEquals(cspHeader.includes("default-src 'self'"), true);
    assertEquals(cspHeader.includes("script-src 'self' 'unsafe-inline'"), true);
    assertEquals(cspHeader.includes("style-src 'self' 'unsafe-inline'"), true);
    assertEquals(cspHeader.includes("img-src 'self' data:"), true);
    assertEquals(cspHeader.includes("font-src 'self' data:"), true);
    assertEquals(cspHeader.includes("connect-src 'self'"), true);
    assertEquals(cspHeader.includes("frame-ancestors 'none'"), true);
  });

  it("should add nonce when script-src contains case variations", async () => {
    const middleware = contentSecurityPolicy(
      {
        "Script-Src": "'self'",
      },
      {
        nonce: "test-nonce",
      },
    );
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    const cspHeader = response.headers.get("Content-Security-Policy");
    assertExists(cspHeader);
    assertEquals(cspHeader.includes("'nonce-test-nonce'"), true);
  });

  it("should return undefined if next returns undefined", async () => {
    const middleware = contentSecurityPolicy({
      "default-src": "'self'",
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(undefined);

    const response = await middleware(ctx, next);

    assertEquals(response, undefined);
  });

  it("should handle empty policies object", async () => {
    const middleware = contentSecurityPolicy({});
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    const cspHeader = response.headers.get("Content-Security-Policy");
    assertExists(cspHeader);
    assertEquals(cspHeader, "");
  });

  it("should handle nonce with merge option", async () => {
    const middleware = contentSecurityPolicy(
      {
        "script-src": "'self'",
      },
      {
        nonce: "nonce-123",
        merge: "base-uri 'self'",
      },
    );
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    const cspHeader = response.headers.get("Content-Security-Policy");
    assertExists(cspHeader);
    assertEquals(cspHeader.includes("base-uri 'self'"), true);
    assertEquals(cspHeader.includes("'nonce-nonce-123'"), true);
  });
});
