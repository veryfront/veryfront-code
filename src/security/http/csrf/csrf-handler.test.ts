import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { CsrfHandler } from "./csrf-handler.ts";
import { generateCsrfToken } from "../../csrf/helpers.ts";
import type { HandlerContext } from "#veryfront/types";
import { CSP_REPORT_PATH } from "#veryfront/security/http/csp-report-endpoint.ts";

function createCtx(csrf?: boolean | Record<string, unknown>): HandlerContext {
  return {
    projectDir: "/tmp/test",
    adapter: { env: { get: () => undefined } } as unknown as HandlerContext["adapter"],
    securityConfig: csrf !== undefined ? { csrf } : null,
  };
}

describe("security/http/csrf/csrf-handler", () => {
  const handler = new CsrfHandler();

  describe("Server Actions documentation", () => {
    it("binds dependency snapshots with the transport header, not application query state", async () => {
      const source = await Deno.readTextFile(new URL("./csrf-handler.ts", import.meta.url));
      const exampleStart = source.indexOf("* Example (client-side fetch wrapper):");
      const exampleEnd = source.indexOf("* @module security/http/csrf/csrf-handler");
      const example = source.slice(exampleStart, exampleEnd);

      assertEquals(exampleStart >= 0 && exampleEnd > exampleStart, true);
      assertEquals(
        example.includes('headers["x-veryfront-dependency-pins"] = pinKey;'),
        true,
      );
      assertEquals(example.includes('searchParams.set("pins"'), false);
    });
  });

  describe("platform CSP report endpoint", () => {
    it("passes a browser report through even with CSRF enabled", async () => {
      // A violation report is not a user action: the browser sends no token, so
      // a project enabling CSRF would advertise a reporting endpoint that
      // silently collects nothing.
      const result = await handler.handle(
        new Request(`https://acme.veryfront.com${CSP_REPORT_PATH}`, {
          method: "POST",
          body: '{"csp-report":{}}',
        }),
        createCtx(true),
      );

      assertEquals(result.response, undefined);
    });

    it("still rejects a token-less POST to any other path", async () => {
      const result = await handler.handle(
        new Request("https://acme.veryfront.com/_vf/csp-report-other", {
          method: "POST",
          body: "{}",
        }),
        createCtx(true),
      );

      assertEquals(result.response?.status, 403);
    });
  });

  describe("signed control-plane surfaces", () => {
    const SIGNED = { "x-veryfront-control-plane-jws": "header.payload.signature" };

    it("passes every registered surface through for every enabled csrf shape", async () => {
      // The control plane holds no `__Host-vf_csrf` cookie and authorizes from
      // a signed envelope the receiving handler verifies. Gating it here left a
      // project that configured CSRF unable to build its own release assets.
      const surfaces = [
        { method: "POST", path: "/api/control-plane/agents/list" },
        { method: "POST", path: "/api/control-plane/runs/run_1/execute" },
        { method: "POST", path: "/api/control-plane/runs/run_1/stream" },
        { method: "POST", path: "/api/control-plane/runs/run_1/resume" },
        { method: "DELETE", path: "/api/control-plane/runs/run_1" },
      ];

      for (const csrf of [true, { excludePaths: ["/api/ag-ui"] }]) {
        for (const surface of surfaces) {
          const result = await handler.handle(
            new Request(`https://acme.example.test${surface.path}`, {
              method: surface.method,
              headers: SIGNED,
              body: "{}",
            }),
            createCtx(csrf),
          );

          assertEquals(
            result.response,
            undefined,
            `${surface.method} ${surface.path} was gated`,
          );
        }
      }
    });

    it("still rejects a token-less POST to a path that merely starts alike", async () => {
      const result = await handler.handle(
        new Request("https://acme.example.test/api/control-plane-mirror/runs", {
          method: "POST",
          body: "{}",
        }),
        createCtx(true),
      );

      assertEquals(result.response?.status, 403);
    });

    it("still enforces CSRF on a project route inside the control-plane namespace", async () => {
      // The reserved namespace is not exclusively routed. In a custom runtime
      // served with `createHandler`, an App or Pages API route under
      // `/api/control-plane/*` that no control-plane handler claims falls
      // through to `ApiHandlerWrapper` and runs project code authenticated by
      // cookies. Exempting the prefix would let any project disable CSRF on its
      // own state-changing routes by choosing a path.
      const projectRoutes = [
        { method: "POST", path: "/api/control-plane/checkout" },
        { method: "POST", path: "/api/control-plane/runs" },
        { method: "POST", path: "/api/control-plane/runs/run_1" },
        { method: "POST", path: "/api/control-plane/runs/run_1/execute/extra" },
        { method: "POST", path: "/api/control-plane/agents/list/all" },
        { method: "PUT", path: "/api/control-plane/runs/run_1/execute" },
        { method: "DELETE", path: "/api/control-plane/runs/run_1/execute" },
      ];

      for (const route of projectRoutes) {
        const result = await handler.handle(
          new Request(`https://acme.example.test${route.path}`, {
            method: route.method,
            body: "{}",
          }),
          createCtx(true),
        );

        assertEquals(
          result.response?.status,
          403,
          `${route.method} ${route.path} skipped the CSRF gate`,
        );
      }
    });

    it("does not let a signature header alone exempt a project route", async () => {
      // A same-origin caller can set any header it likes. The signature only
      // earns an exemption on a path a verifying handler owns, so an
      // unrecognized path stays gated even when the header is present.
      const result = await handler.handle(
        new Request("https://acme.example.test/api/control-plane/checkout", {
          method: "POST",
          headers: SIGNED,
          body: "{}",
        }),
        createCtx(true),
      );

      assertEquals(result.response?.status, 403);
    });

    it("still enforces CSRF on a registered surface with no signature header", async () => {
      // A cross-site form POST cannot attach the signature header. Without it
      // the request is browser shaped and must present a CSRF token.
      const result = await handler.handle(
        new Request("https://acme.example.test/api/control-plane/runs/run_1/execute", {
          method: "POST",
          body: "{}",
        }),
        createCtx(true),
      );

      assertEquals(result.response?.status, 403);
    });
  });

  describe("when CSRF is not configured", () => {
    it("should pass through all requests when securityConfig is null", async () => {
      const ctx = createCtx();
      ctx.securityConfig = null;
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should pass through when csrf is false", async () => {
      const ctx = createCtx(false);
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should pass through when csrf is undefined", async () => {
      const ctx = createCtx();
      ctx.securityConfig = {};
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("when CSRF is enabled", () => {
    it("should pass GET requests", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/page");
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should pass HEAD requests", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/page", { method: "HEAD" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should pass OPTIONS requests", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/api", { method: "OPTIONS" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should protect /_veryfront/log", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/_veryfront/log", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should NOT exempt /_veryfront/log/subpath", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/_veryfront/log/evil", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should protect unsafe methods even on internal asset paths", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/_veryfront/modules/client.js", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should NOT exempt /_veryfront/rsc/action (Server Actions need CSRF)", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/_veryfront/rsc/action", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should reject POST without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should apply the resolved CORS and security policy to rejections", async () => {
      const ctx = createCtx(true);
      ctx.securityConfig = {
        csrf: true,
        cors: {
          origin: "https://client.example",
          credentials: true,
        },
      };
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: { origin: "https://client.example" },
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.status, 403);
      assertEquals(
        result.response?.headers.get("Access-Control-Allow-Origin"),
        "https://client.example",
      );
      assertEquals(result.response?.headers.get("Access-Control-Allow-Credentials"), "true");
      assertEquals(result.response?.headers.get("X-Content-Type-Options"), "nosniff");
      assertEquals(result.response?.headers.get("Cache-Control"), "no-store");
    });

    it("should reject PUT without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/resource", { method: "PUT" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("should reject PATCH without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/resource", { method: "PATCH" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("should reject DELETE without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/resource", { method: "DELETE" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("should reject custom methods without CSRF token", async () => {
      const ctx = createCtx(true);
      const req = new Request("http://localhost/cache", { method: "PURGE" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should pass POST with valid CSRF token", async () => {
      const ctx = createCtx(true);
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `__Host-vf_csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should reject POST with mismatched CSRF token", async () => {
      const ctx = createCtx(true);
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `__Host-vf_csrf=${token}`,
          "x-csrf-token": "wrong-token",
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });
  });

  describe("custom configuration", () => {
    it("should use custom cookieName and headerName", async () => {
      const ctx = createCtx({ cookieName: "my_csrf", headerName: "x-my-csrf" });
      const { token } = generateCsrfToken({ cookieName: "my_csrf", secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `my_csrf=${token}`,
          "x-my-csrf": token,
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should reject when using default names with custom config", async () => {
      const ctx = createCtx({ cookieName: "my_csrf", headerName: "x-my-csrf" });
      const { token } = generateCsrfToken({ secure: false });
      const req = new Request("http://localhost/submit", {
        method: "POST",
        headers: {
          cookie: `__Host-vf_csrf=${token}`,
          "x-csrf-token": token,
        },
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });

    it("should skip excludePaths", async () => {
      const ctx = createCtx({ excludePaths: ["/api/webhooks", "/api/public"] });
      const req = new Request("http://localhost/api/webhooks", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should skip excludePaths with subpaths", async () => {
      const ctx = createCtx({ excludePaths: ["/api/webhooks"] });
      const req = new Request("http://localhost/api/webhooks/stripe", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("should not skip paths not in excludePaths", async () => {
      const ctx = createCtx({ excludePaths: ["/api/webhooks"] });
      const req = new Request("http://localhost/api/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response?.status, 403);
    });
  });

  describe("metadata", () => {
    it("should have correct name and priority", () => {
      assertEquals(handler.metadata.name, "CsrfHandler");
      assertEquals(handler.metadata.priority, 5);
    });

    it("should have empty patterns (matches all)", () => {
      assertEquals(handler.metadata.patterns?.length, 0);
    });
  });
});
