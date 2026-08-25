import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
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
        example.includes(
          'import { csrfMutationHeaders } from "veryfront/index.client";',
        ),
        true,
      );
      assertEquals(
        example.includes('headers.set("x-veryfront-dependency-pins", pinKey);'),
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

  describe("signed channel dispatch", () => {
    const SIGNED_DISPATCH = { "x-veryfront-dispatch-jws": "header.payload.signature" };
    const SIGNED_CONTROL_PLANE = { "x-veryfront-control-plane-jws": "header.payload.signature" };

    it("passes the channel invoke route through for every enabled csrf shape", async () => {
      // The platform channel dispatcher, and the runtime-owner re-dispatch that
      // forwards to the instance owning the run, both POST this route with a
      // signed dispatch envelope and no browser cookie. Gating them here stops
      // a project's own Slack and Discord channels from answering.
      for (const csrf of [true, { excludePaths: ["/api/ag-ui"] }]) {
        const result = await handler.handle(
          new Request("https://acme.example.test/channels/invoke", {
            method: "POST",
            headers: SIGNED_DISPATCH,
            body: "{}",
          }),
          createCtx(csrf),
        );

        assertEquals(result.response, undefined, "POST /channels/invoke was gated");
      }
    });

    it("still enforces CSRF on the invoke route with no signature header", async () => {
      const result = await handler.handle(
        new Request("https://acme.example.test/channels/invoke", {
          method: "POST",
          body: "{}",
        }),
        createCtx(true),
      );

      assertEquals(result.response?.status, 403);
    });

    it("does not accept a control-plane envelope on the invoke route", async () => {
      // The two envelopes are verified by different code against different
      // claims. `ChannelInvokeHandler` reads only the dispatch header, so a
      // control-plane header here would buy an exemption no handler redeems.
      const result = await handler.handle(
        new Request("https://acme.example.test/channels/invoke", {
          method: "POST",
          headers: SIGNED_CONTROL_PLANE,
          body: "{}",
        }),
        createCtx(true),
      );

      assertEquals(result.response?.status, 403);
    });

    it("does not accept a dispatch envelope on a control-plane surface", async () => {
      // Symmetric to the above: the run execute handler verifies a
      // control-plane envelope and never reads the dispatch header.
      const result = await handler.handle(
        new Request("https://acme.example.test/api/control-plane/runs/run_1/execute", {
          method: "POST",
          headers: SIGNED_DISPATCH,
          body: "{}",
        }),
        createCtx(true),
      );

      assertEquals(result.response?.status, 403);
    });

    it("still enforces CSRF on look-alike and sibling channel routes", async () => {
      // `/channels/` is reserved but not exclusively routed. A project App or
      // Pages API route can sit beside or beneath the one dispatch route, is
      // cookie authenticated, and must keep CSRF enforced even when the caller
      // sets the signature header itself.
      const projectRoutes = [
        { method: "POST", path: "/channels/invoke/application-route" },
        { method: "POST", path: "/channels/invoker" },
        { method: "POST", path: "/channels/invoke-mirror/run" },
        { method: "POST", path: "/channels" },
        { method: "POST", path: "/api/channels/invoke" },
        { method: "PUT", path: "/channels/invoke" },
        { method: "DELETE", path: "/channels/invoke" },
      ];

      for (const route of projectRoutes) {
        const result = await handler.handle(
          new Request(`https://acme.example.test${route.path}`, {
            method: route.method,
            headers: SIGNED_DISPATCH,
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

    it("still enforces CSRF when the signature header is empty", async () => {
      const result = await handler.handle(
        new Request("https://acme.example.test/channels/invoke", {
          method: "POST",
          headers: { "x-veryfront-dispatch-jws": "" },
          body: "{}",
        }),
        createCtx(true),
      );

      assertEquals(result.response?.status, 403);
    });
  });

  describe("when CSRF is not configured", () => {
    it("warns once per path in local development when production would reject", async () => {
      const localHandler = new CsrfHandler();
      const ctx = createCtx();
      ctx.securityConfig = {};
      ctx.isLocalProject = true;
      const warnings: string[] = [];
      const originalWarn = console.warn;

      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
      try {
        await localHandler.handle(
          new Request("http://localhost/api/cases?attempt=1", { method: "POST" }),
          ctx,
        );
        await localHandler.handle(
          new Request("http://localhost/api/cases?attempt=2", { method: "POST" }),
          ctx,
        );
        await localHandler.handle(
          new Request("http://localhost/api/other", { method: "PUT" }),
          ctx,
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(warnings.length, 2);
      assertStringIncludes(warnings[0]!, "POST request [path redacted]");
      assertStringIncludes(warnings[0]!, "csrfMutationHeaders");
      assertStringIncludes(warnings[0]!, '"veryfront/index.client"');
      assertStringIncludes(warnings[1]!, "PUT request [path redacted]");
    });

    it("warns when a local mutation sends an empty CSRF header", async () => {
      const localHandler = new CsrfHandler();
      const ctx = createCtx();
      ctx.securityConfig = {};
      ctx.isLocalProject = true;
      const warnings: string[] = [];
      const originalWarn = console.warn;

      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
      try {
        await localHandler.handle(
          new Request("http://localhost/api/empty-header", {
            method: "POST",
            headers: { "x-csrf-token": "" },
          }),
          ctx,
        );
        await localHandler.handle(
          new Request("http://localhost/api/blank-header", {
            method: "POST",
            headers: { "x-csrf-token": "   " },
          }),
          ctx,
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(
        warnings.length,
        2,
        "an empty or whitespace x-csrf-token is rejected by validateCsrf in production, so it must still warn locally",
      );
      assertStringIncludes(
        warnings[0]!,
        "POST request [path redacted]",
        "the empty-header warning names the method and redacts the path",
      );
      assertStringIncludes(
        warnings[1]!,
        "POST request [path redacted]",
        "the whitespace-header warning names the method and redacts the path",
      );
    });

    it("does not include raw path segments in the missing-header warning", async () => {
      const localHandler = new CsrfHandler();
      const ctx = createCtx();
      ctx.securityConfig = {};
      ctx.isLocalProject = true;
      const warnings: string[] = [];
      const originalWarn = console.warn;
      const sensitiveSegment = "private.email@example.com";

      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
      try {
        await localHandler.handle(
          new Request(`http://localhost/api/orders/${sensitiveSegment}/charge`, {
            method: "POST",
          }),
          ctx,
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(warnings.length, 1);
      assertStringIncludes(warnings[0]!, "POST request [path redacted]");
      assertEquals(warnings[0]!.includes("/api/orders"), false);
      assertEquals(warnings[0]!.includes("charge"), false);
      assertEquals(warnings[0]!.includes(sensitiveSegment), false);
    });

    it("warns once per local project identity", async () => {
      const localHandler = new CsrfHandler();
      const alphaCtx = createCtx();
      alphaCtx.securityConfig = {};
      alphaCtx.isLocalProject = true;
      alphaCtx.projectSlug = "alpha";
      const betaCtx = createCtx();
      betaCtx.securityConfig = {};
      betaCtx.isLocalProject = true;
      betaCtx.projectSlug = "beta";
      const warnings: string[] = [];
      const originalWarn = console.warn;

      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
      try {
        await localHandler.handle(
          new Request("http://localhost/api/shared", { method: "POST" }),
          alphaCtx,
        );
        await localHandler.handle(
          new Request("http://localhost/api/shared", { method: "POST" }),
          betaCtx,
        );
        await localHandler.handle(
          new Request("http://localhost/api/shared", { method: "POST" }),
          betaCtx,
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(warnings.length, 2);
      assertStringIncludes(warnings[0]!, "POST request [path redacted]");
      assertStringIncludes(warnings[1]!, "POST request [path redacted]");
    });

    it("evicts old warning keys without suppressing new routes", async () => {
      const localHandler = new CsrfHandler();
      const ctx = createCtx();
      ctx.securityConfig = {};
      ctx.isLocalProject = true;
      ctx.projectSlug = "eviction-project";
      const warnings: string[] = [];
      const originalWarn = console.warn;

      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
      try {
        for (let index = 0; index < 101; index++) {
          await localHandler.handle(
            new Request(`http://localhost/api/r${index}`, { method: "POST" }),
            ctx,
          );
        }
        await localHandler.handle(
          new Request("http://localhost/api/final-route", { method: "POST" }),
          ctx,
        );
        await localHandler.handle(
          new Request("http://localhost/api/final-route", { method: "POST" }),
          ctx,
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(warnings.length, 102);
      assertStringIncludes(warnings[101]!, "POST request [path redacted]");
    });

    it("does not warn outside the absent-header local development case", async () => {
      const localHandler = new CsrfHandler();
      const localCtx = createCtx();
      localCtx.securityConfig = {};
      localCtx.isLocalProject = true;
      const disabledCtx = createCtx(false);
      disabledCtx.isLocalProject = true;
      const nonLocalCtx = createCtx();
      nonLocalCtx.securityConfig = {};
      const warnings: string[] = [];
      const originalWarn = console.warn;

      console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(" "));
      try {
        await localHandler.handle(
          new Request("http://localhost/explicit-off", { method: "POST" }),
          disabledCtx,
        );
        await localHandler.handle(
          new Request("http://localhost/non-local", { method: "POST" }),
          nonLocalCtx,
        );
        await localHandler.handle(new Request("http://localhost/safe"), localCtx);
        await localHandler.handle(
          new Request("http://localhost/header-present", {
            method: "POST",
            headers: { "x-csrf-token": "present" },
          }),
          localCtx,
        );
        await localHandler.handle(
          new Request("http://localhost/api/control-plane/agents/list", {
            method: "POST",
            headers: { "x-veryfront-control-plane-jws": "header.payload.signature" },
          }),
          localCtx,
        );
      } finally {
        console.warn = originalWarn;
      }

      assertEquals(warnings, []);
    });

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

    it("should not skip paths that merely start with an excludePath", async () => {
      const ctx = createCtx({ excludePaths: ["/api/webhooks"] });
      for (const path of ["/api/webhooks-admin/delete", "/api/webhooksevil"]) {
        const req = new Request(`http://localhost${path}`, { method: "POST" });
        const result = await handler.handle(req, ctx);
        assertEquals(
          result.response?.status,
          403,
          `${path} is a name collision, not a path-segment child, and must stay CSRF gated`,
        );
      }
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
