import "#veryfront/schemas/_test-setup.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { CsrfHandler } from "./csrf-handler.ts";
import { generateCsrfToken } from "../../csrf/helpers.ts";
import { deriveSecurityContext } from "../config.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import type { HandlerContext } from "#veryfront/types";
import { CSP_REPORT_PATH } from "#veryfront/security/http/csp-report-endpoint.ts";

function createCtx(csrf?: boolean | Record<string, unknown>): HandlerContext {
  return {
    projectDir: "/tmp/test",
    adapter: { env: { get: () => undefined } } as unknown as HandlerContext["adapter"],
    securityConfig: csrf !== undefined ? { csrf } : null,
  };
}

/** The deployed rejection body, pinned so it cannot drift with the local one. */
const PRODUCTION_CSRF_FORBIDDEN_BODY = "Forbidden: invalid or missing CSRF token";

/** A local-development context whose security config came through derivation. */
function localCtx(): HandlerContext {
  const ctx = createCtx();
  ctx.securityConfig = deriveSecurityContext(
    { security: {} },
    { productionDefaults: false },
  ).securityConfig;
  ctx.isLocalProject = true;
  return ctx;
}

/** A mutating request with the transport-authenticated loopback peer recorded. */
function loopbackRequest(path: string, headers: HeadersInit = {}): Request {
  const url = new URL(`http://localhost:8000${path}`);
  const finalHeaders = new Headers(headers);
  finalHeaders.set("host", url.host);
  const request = new Request(url, { method: "POST", headers: finalHeaders });
  recordRequestPeerFromTransport(request, {
    runtime: "deno",
    transport: "tcp",
    hostname: "127.0.0.1",
  });
  return request;
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

  describe("local development parity", () => {
    it("rejects a local mutating request that omits the CSRF header", async () => {
      // The reported bug: a hand-rolled browser mutation passed all through
      // local development and then answered 403 on the first deployed build.
      const ctx = localCtx();

      const result = await handler.handle(
        new Request("http://localhost/api/cases", { method: "POST" }),
        ctx,
      );

      assertEquals(
        result.continue,
        false,
        "a local mutation without the double-submit header must not reach project code",
      );
      assertEquals(
        result.response?.status,
        403,
        "local development must reject exactly what production rejects",
      );
    });

    it("accepts a local mutating request that echoes the token cookie", async () => {
      const ctx = localCtx();
      const { token } = generateCsrfToken({ secure: false });

      const result = await handler.handle(
        new Request("http://localhost/api/cases", {
          method: "POST",
          headers: {
            cookie: `__Host-vf_csrf=${token}`,
            "x-csrf-token": token,
          },
        }),
        ctx,
      );

      assertEquals(
        result.continue,
        true,
        "the double-submit contract must be satisfiable locally, not just enforceable",
      );
    });

    it("still rejects an empty local CSRF header the way production does", async () => {
      const ctx = localCtx();
      const { token } = generateCsrfToken({ secure: false });

      for (const headerValue of ["", "   "]) {
        const result = await handler.handle(
          new Request("http://localhost/api/cases", {
            method: "POST",
            headers: {
              cookie: `__Host-vf_csrf=${token}`,
              "x-csrf-token": headerValue,
            },
          }),
          ctx,
        );

        assertEquals(
          result.response?.status,
          403,
          `an empty header value ${JSON.stringify(headerValue)} must fail locally too`,
        );
      }
    });

    it("keeps security.csrf false working as the opt-out in local development", async () => {
      const ctx = createCtx();
      ctx.securityConfig = deriveSecurityContext(
        { security: { csrf: false } },
        { productionDefaults: false },
      ).securityConfig;
      ctx.isLocalProject = true;

      const result = await handler.handle(
        new Request("http://localhost/api/cases", { method: "POST" }),
        ctx,
      );

      assertEquals(
        result.continue,
        true,
        "an explicit opt-out must keep local development permissive",
      );
    });

    it("enforces rather than passing through when csrf resolves to undefined", async () => {
      // The permissive `csrfConfig === undefined` branch is gone. A context
      // that never ran through `deriveSecurityContext` must fail closed
      // instead of silently skipping the gate.
      const ctx = createCtx();
      ctx.securityConfig = {};
      const result = await handler.handle(
        new Request("http://localhost/submit", { method: "POST" }),
        ctx,
      );

      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("fails closed when no security context was derived at all", async () => {
      const ctx = createCtx();
      ctx.securityConfig = null;
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, false);
      assertEquals(result.response?.status, 403);
    });

    it("should pass through when csrf is false", async () => {
      const ctx = createCtx(false);
      const req = new Request("http://localhost/submit", { method: "POST" });
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });
  });

  describe("rejection body", () => {
    it("keeps the deployed 403 body byte-identical and free of configuration detail", async () => {
      const ctx = createCtx();
      ctx.securityConfig = deriveSecurityContext(
        { security: { csrf: { cookieName: "my_csrf", headerName: "x-my-csrf" } } },
        { productionDefaults: true },
      ).securityConfig;

      const result = await handler.handle(
        new Request("https://acme.example.test/api/cases", { method: "POST" }),
        ctx,
      );
      const body = await result.response!.text();

      assertEquals(
        body,
        PRODUCTION_CSRF_FORBIDDEN_BODY,
        "a deployed client must keep receiving the same opaque rejection",
      );
      assertEquals(
        body.includes("my_csrf"),
        false,
        "the cookie name must not leak to deployed clients",
      );
      assertEquals(
        body.includes("x-my-csrf"),
        false,
        "the header name must not leak to deployed clients",
      );
      assertEquals(body.includes("csrfMutationHeaders"), false);
      assertEquals(body.includes("security.csrf"), false);
    });

    it("names the configured cookie, header and helper in the local 403 body", async () => {
      const ctx = createCtx();
      ctx.securityConfig = deriveSecurityContext(
        { security: { csrf: { cookieName: "my_csrf", headerName: "x-my-csrf" } } },
        { productionDefaults: false },
      ).securityConfig;
      ctx.isLocalProject = true;

      const result = await handler.handle(loopbackRequest("/api/cases"), ctx);
      const body = await result.response!.text();

      assertStringIncludes(body, "my_csrf", "the local body must name the cookie in effect");
      assertStringIncludes(body, "x-my-csrf", "the local body must name the header in effect");
      assertStringIncludes(body, "csrfMutationHeaders");
      assertStringIncludes(body, "veryfront/index.client");
      assertStringIncludes(body, "security.csrf");
      assertEquals(
        body.includes("__Host-vf_csrf"),
        false,
        "a project with configured names must not be told to use the default cookie",
      );
    });

    it("names the default cookie and header when the project configures neither", async () => {
      const ctx = localCtx();

      const result = await handler.handle(loopbackRequest("/api/cases"), ctx);
      const body = await result.response!.text();

      assertStringIncludes(body, "__Host-vf_csrf");
      assertStringIncludes(body, "x-csrf-token");
    });

    it("keeps the body opaque for a local project reached from a non-loopback peer", async () => {
      // `ctx.isLocalProject` means a project directory was resolved on disk,
      // which a deployed multi-project runtime also does. Without the loopback
      // requirement that deployment would serve its configured cookie and
      // header names, and the opt-out that turns the check off, to anyone.
      const ctx = localCtx();
      ctx.securityConfig = deriveSecurityContext(
        { security: { csrf: { cookieName: "my_csrf", headerName: "x-my-csrf" } } },
        { productionDefaults: false },
      ).securityConfig;

      const result = await handler.handle(
        new Request("https://acme.example.test/api/cases", { method: "POST" }),
        ctx,
      );
      const body = await result.response!.text();

      assertEquals(
        body,
        PRODUCTION_CSRF_FORBIDDEN_BODY,
        "a project resolved on disk but reached over the network gets the deployed body",
      );
      assertEquals(
        body.includes("my_csrf"),
        false,
        "the configured cookie name must not leak to a non-loopback caller",
      );
      assertEquals(
        body.includes("x-my-csrf"),
        false,
        "the configured header name must not leak to a non-loopback caller",
      );
      assertEquals(
        body.includes("security.csrf"),
        false,
        "the opt-out that disables this check must not be advertised over the network",
      );
    });

    it("does not repeat the request path back in the local body", async () => {
      const ctx = localCtx();
      const sensitiveSegment = "private.email@example.com";

      const result = await handler.handle(
        loopbackRequest(`/api/orders/${sensitiveSegment}/charge`),
        ctx,
      );
      const body = await result.response!.text();

      assertEquals(body.includes(sensitiveSegment), false);
      assertEquals(body.includes("/api/orders"), false);
    });
  });

  describe("framework-owned local control mutations", () => {
    it("exempts the development client logger and dashboard API from a trusted loopback peer", async () => {
      const ctx = localCtx();

      for (
        const path of [
          "/_veryfront/log",
          "/_dev/api/execute-tool",
          "/_dev/api/start-workflow",
        ]
      ) {
        const result = await handler.handle(loopbackRequest(path), ctx);

        assertEquals(
          result.continue,
          true,
          `${path} is framework owned and must keep working in veryfront dev`,
        );
      }
    });

    it("does not exempt those surfaces for a cross-site browser request", async () => {
      const ctx = localCtx();

      for (const path of ["/_veryfront/log", "/_dev/api/execute-tool"]) {
        const result = await handler.handle(
          loopbackRequest(path, { "sec-fetch-site": "cross-site" }),
          ctx,
        );

        assertEquals(
          result.response?.status,
          403,
          `${path} must stay closed to a cross-site page on the developer machine`,
        );
      }
    });

    it("does not exempt those surfaces without a transport-authenticated loopback peer", async () => {
      const ctx = localCtx();

      for (const path of ["/_veryfront/log", "/_dev/api/execute-tool"]) {
        const result = await handler.handle(
          new Request(`http://localhost:8000${path}`, {
            method: "POST",
            headers: { host: "localhost:8000" },
          }),
          ctx,
        );

        assertEquals(
          result.response?.status,
          403,
          `${path} must not be exempted on a header claim alone`,
        );
      }
    });

    it("does not exempt a deployed project that is not local development", async () => {
      const ctx = createCtx(true);

      for (const path of ["/_veryfront/log", "/_dev/api/execute-tool"]) {
        const result = await handler.handle(loopbackRequest(path), ctx);

        assertEquals(
          result.response?.status,
          403,
          `${path} carries no local-development exemption off the developer machine`,
        );
      }
    });

    it("does not exempt look-alike paths beside the framework surfaces", async () => {
      const ctx = localCtx();

      for (
        const path of [
          "/_veryfront/log/subpath",
          "/_veryfront/logger",
          "/_dev/api",
          "/_dev/apifoo/run",
          "/_dev/session",
        ]
      ) {
        const result = await handler.handle(loopbackRequest(path), ctx);

        assertEquals(
          result.response?.status,
          403,
          `${path} is not a registered framework control surface`,
        );
      }
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

    it("normalizes an explicitly configured default cookie on plain-HTTP LAN origins", async () => {
      const ctx = createCtx({ cookieName: "__Host-vf_csrf" });
      const token = "lan-token";
      const req = new Request("http://192.168.1.20:3000/submit", {
        method: "POST",
        headers: {
          cookie: `vf_csrf=${token}`,
          "x-csrf-token": token,
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

    it("should treat a root exclusion as only the root path", async () => {
      const ctx = createCtx({ excludePaths: ["/"] });

      const rootResult = await handler.handle(
        new Request("http://localhost/", { method: "POST" }),
        ctx,
      );
      assertEquals(rootResult.continue, true);

      for (const path of ["/api/cases", "/nested/path"]) {
        const req = new Request(`http://localhost${path}`, { method: "POST" });
        const result = await handler.handle(req, ctx);
        assertEquals(
          result.response?.status,
          403,
          `${path} is not the root path and must stay CSRF gated`,
        );
      }
    });

    it("continues checking exclusions after a root-only mismatch", async () => {
      const ctx = createCtx({ excludePaths: ["/", "/api/webhooks"] });

      for (const path of ["/", "/api/webhooks", "/api/webhooks/stripe"]) {
        const result = await handler.handle(
          new Request(`http://localhost${path}`, { method: "POST" }),
          ctx,
        );
        assertEquals(result.continue, true, `${path} must match its exclusion`);
      }

      const protectedResult = await handler.handle(
        new Request("http://localhost/api/cases", { method: "POST" }),
        ctx,
      );
      assertEquals(protectedResult.response?.status, 403);
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
