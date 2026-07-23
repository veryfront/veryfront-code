import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { securityHeaders } from "./security-headers.ts";

function makeCtx(): { request: Request } {
  return { request: new Request("http://localhost/") };
}

function nextOk(): Promise<Response> {
  return Promise.resolve(new Response("ok", { status: 200 }));
}

describe("middleware/builtin/security/security-headers", () => {
  describe("securityHeaders", () => {
    it("should add default security headers", async () => {
      const mw = securityHeaders();
      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.headers.get("X-Content-Type-Options"), "nosniff");
      assertEquals(res?.headers.get("X-Frame-Options"), "DENY");
      assertEquals(
        res?.headers.get("Referrer-Policy"),
        "strict-origin-when-cross-origin",
      );
    });

    it("should add Permissions-Policy header", async () => {
      const mw = securityHeaders();
      const res = await mw(makeCtx(), nextOk);

      assertEquals(
        res?.headers.get("Permissions-Policy"),
        "geolocation=(), microphone=(), camera=()",
      );
    });

    it("should allow custom X-Frame-Options", async () => {
      const mw = securityHeaders({ frameOptions: "SAMEORIGIN" });
      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.headers.get("X-Frame-Options"), "SAMEORIGIN");
    });

    it("should allow disabling nosniff", async () => {
      const mw = securityHeaders({ noSniff: false });
      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.headers.get("X-Content-Type-Options"), null);
    });

    it("should add CSP header from string", async () => {
      const mw = securityHeaders({ contentSecurityPolicy: "default-src 'self'" });
      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.headers.get("Content-Security-Policy"), "default-src 'self'");
    });

    it("should build CSP header from directives object", async () => {
      const mw = securityHeaders({
        contentSecurityPolicy: {
          "default-src": "'self'",
          "script-src": "'self' https://cdn.example.com",
        },
      });
      const res = await mw(makeCtx(), nextOk);

      const csp = res?.headers.get("Content-Security-Policy") ?? "";
      assertEquals(csp.includes("default-src 'self'"), true);
      assertEquals(
        csp.includes("script-src 'self' https://cdn.example.com"),
        true,
      );
    });

    it("should add HSTS header", async () => {
      const mw = securityHeaders({ hsts: { maxAge: 31536000 } });
      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.headers.get("Strict-Transport-Security"), "max-age=31536000");
    });

    it("should add HSTS with includeSubDomains and preload", async () => {
      const mw = securityHeaders({
        hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      });
      const res = await mw(makeCtx(), nextOk);

      assertEquals(
        res?.headers.get("Strict-Transport-Security"),
        "max-age=31536000; includeSubDomains; preload",
      );
    });

    it("honors the explicit legacy XSS protection option", async () => {
      const mw = securityHeaders({ xssProtection: true });
      const res = await mw(makeCtx(), nextOk);

      assertEquals(res?.headers.get("X-XSS-Protection"), "1; mode=block");
    });

    it("rejects invalid header configuration during construction", () => {
      assertThrows(
        () => securityHeaders({ hsts: { maxAge: -1 } }),
        TypeError,
        "maxAge",
      );
      assertThrows(
        () => securityHeaders({ referrerPolicy: "unsafe\r\nX-Injected: yes" }),
        TypeError,
        "Referrer-Policy",
      );
      assertThrows(
        () => securityHeaders(null as never),
        TypeError,
        "options",
      );
      assertThrows(
        () => securityHeaders({ noSniff: "false" as never }),
        TypeError,
        "noSniff",
      );
      assertThrows(
        () => securityHeaders({ xssProtection: "true" as never }),
        TypeError,
        "xssProtection",
      );
      assertThrows(
        () =>
          securityHeaders({
            hsts: { maxAge: 1, includeSubDomains: "yes" as never },
          }),
        TypeError,
        "includeSubDomains",
      );
    });

    it("preserves the original response status text", async () => {
      const mw = securityHeaders();
      const res = await mw(
        makeCtx(),
        () => Promise.resolve(new Response("Created", { status: 201, statusText: "Stored" })),
      );

      assertEquals(res?.statusText, "Stored");
    });

    it("should handle undefined response from next", async () => {
      const mw = securityHeaders();
      const res = await mw(makeCtx(), () => Promise.resolve(undefined));

      assertEquals(res, undefined);
    });
  });
});
