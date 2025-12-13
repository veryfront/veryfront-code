import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { securityHeaders } from "./security-headers.ts";
import { MiddlewareContext } from "../../core/context.ts";

describe("securityHeaders", () => {
  it("should add default security headers", async () => {
    const middleware = securityHeaders();
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(response.headers.get("X-Frame-Options"), "DENY");
    assertEquals(response.headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    assertEquals(response.headers.get("Permissions-Policy"), "geolocation=(), microphone=(), camera=()");
  });

  it("should allow disabling noSniff", async () => {
    const middleware = securityHeaders({ noSniff: false });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.has("X-Content-Type-Options"), false);
  });

  it("should set custom frame options", async () => {
    const middleware = securityHeaders({ frameOptions: "SAMEORIGIN" });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("X-Frame-Options"), "SAMEORIGIN");
  });

  it("should set custom referrer policy", async () => {
    const middleware = securityHeaders({ referrerPolicy: "no-referrer" });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("Referrer-Policy"), "no-referrer");
  });

  it("should set custom permissions policy", async () => {
    const middleware = securityHeaders({
      permissionsPolicy: "geolocation=(self), camera=()",
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("Permissions-Policy"), "geolocation=(self), camera=()");
  });

  it("should add CSP header from string", async () => {
    const middleware = securityHeaders({
      contentSecurityPolicy: "default-src 'self'; script-src 'self' 'unsafe-inline'",
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(
      response.headers.get("Content-Security-Policy"),
      "default-src 'self'; script-src 'self' 'unsafe-inline'",
    );
  });

  it("should add CSP header from directives object", async () => {
    const middleware = securityHeaders({
      contentSecurityPolicy: {
        "default-src": "'self'",
        "script-src": "'self' 'unsafe-inline'",
      },
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

  it("should add HSTS header", async () => {
    const middleware = securityHeaders({
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(
      response.headers.get("Strict-Transport-Security"),
      "max-age=31536000; includeSubDomains; preload",
    );
  });

  it("should add HSTS header without optional flags", async () => {
    const middleware = securityHeaders({
      hsts: {
        maxAge: 31536000,
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("Strict-Transport-Security"), "max-age=31536000");
  });

  it("should add HSTS with includeSubDomains only", async () => {
    const middleware = securityHeaders({
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(
      response.headers.get("Strict-Transport-Security"),
      "max-age=31536000; includeSubDomains",
    );
  });

  it("should add HSTS with preload only", async () => {
    const middleware = securityHeaders({
      hsts: {
        maxAge: 31536000,
        preload: true,
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("Strict-Transport-Security"), "max-age=31536000; preload");
  });

  it("should preserve existing response headers", async () => {
    const middleware = securityHeaders();
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
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
  });

  it("should return undefined if next returns undefined", async () => {
    const middleware = securityHeaders();
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(undefined);

    const response = await middleware(ctx, next);

    assertEquals(response, undefined);
  });

  it("should combine all options", async () => {
    const middleware = securityHeaders({
      noSniff: true,
      frameOptions: "SAMEORIGIN",
      referrerPolicy: "origin",
      permissionsPolicy: "geolocation=(self)",
      contentSecurityPolicy: "default-src 'self'",
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("X-Content-Type-Options"), "nosniff");
    assertEquals(response.headers.get("X-Frame-Options"), "SAMEORIGIN");
    assertEquals(response.headers.get("Referrer-Policy"), "origin");
    assertEquals(response.headers.get("Permissions-Policy"), "geolocation=(self)");
    assertEquals(response.headers.get("Content-Security-Policy"), "default-src 'self'");
    assertEquals(
      response.headers.get("Strict-Transport-Security"),
      "max-age=31536000; includeSubDomains; preload",
    );
  });

  it("should allow custom frame options string", async () => {
    const middleware = securityHeaders({ frameOptions: "ALLOW-FROM https://example.com" });
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const next = () => Promise.resolve(new Response("OK", { status: 200 }));

    const response = await middleware(ctx, next);

    assertExists(response);
    assertEquals(response.headers.get("X-Frame-Options"), "ALLOW-FROM https://example.com");
  });
});
