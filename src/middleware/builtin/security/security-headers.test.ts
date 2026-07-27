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

    it("should add X-XSS-Protection only when explicitly enabled", async () => {
      const enabled = await securityHeaders({ xssProtection: true })(
        makeCtx(),
        nextOk,
      );
      const defaults = await securityHeaders()(makeCtx(), nextOk);

      assertEquals(enabled?.headers.get("X-XSS-Protection"), "1; mode=block");
      assertEquals(defaults?.headers.get("X-XSS-Protection"), null);
    });

    it("should reject invalid HSTS max-age configuration", () => {
      for (const maxAge of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
        assertThrows(
          () => securityHeaders({ hsts: { maxAge } }),
          RangeError,
          "maxAge",
        );
      }
    });

    it("should reject invalid runtime option types", () => {
      for (
        const options of [
          { noSniff: "false" },
          { xssProtection: 1 },
          { frameOptions: false },
          { referrerPolicy: 42 },
          { permissionsPolicy: [] },
          { contentSecurityPolicy: false },
          { hsts: null },
          { hsts: { maxAge: 60, includeSubDomains: "yes" } },
          { hsts: { maxAge: 60, preload: 1 } },
        ]
      ) {
        assertThrows(
          () => securityHeaders(options as never),
          TypeError,
        );
      }
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

    it("should handle undefined response from next", async () => {
      const mw = securityHeaders();
      const res = await mw(makeCtx(), () => Promise.resolve(undefined));

      assertEquals(res, undefined);
    });

    it("should preserve response status text", async () => {
      const mw = securityHeaders();
      const res = await mw(
        makeCtx(),
        () =>
          Promise.resolve(
            new Response("created", {
              status: 201,
              statusText: "Created by middleware",
            }),
          ),
      );

      assertEquals(res?.status, 201);
      assertEquals(res?.statusText, "Created by middleware");
    });
  });
});
