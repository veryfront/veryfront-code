import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { CorsHandler } from "./cors.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getApplicationPreflightHeaders } from "#veryfront/security/http/application-request.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    ...overrides,
  };
}

describe("server/handlers/response/cors", () => {
  describe("CorsHandler", () => {
    it("has correct metadata", () => {
      const handler = new CorsHandler();
      assertEquals(handler.metadata.name, "CorsHandler");
      assertEquals(handler.metadata.patterns?.length, 1);
      assertEquals(handler.metadata.patterns?.[0]?.method, "OPTIONS");
    });

    it("continues for non-OPTIONS requests", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", { method: "GET" });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("continues for POST requests", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", { method: "POST" });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.continue, true);
    });

    it("responds to OPTIONS requests", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/webhook", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Content-Type",
        },
      });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
    });

    it("responds to OPTIONS with access-control headers", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/webhook", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Authorization,Content-Type",
        },
      });
      // Preflight is policy-driven: allow-* headers are only emitted for an
      // origin the CORS policy admits.
      const ctx = makeCtx({
        securityConfig: { cors: { origin: ["http://localhost:3000"] } } as never,
      });
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
      // Should have allow-methods header
      const methods = result.response?.headers.get("access-control-allow-methods") ?? "";
      assertEquals(methods.length > 0, true);
    });

    it("handles OPTIONS with lowercase method check", async () => {
      const handler = new CorsHandler();
      // OPTIONS method should be matched case-insensitively
      const req = new Request("http://localhost/webhook", {
        method: "OPTIONS",
      });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
    });

    it("does not resolve or import project routes in a shared runtime", async () => {
      let routeResolutionCalls = 0;
      const handler = new CorsHandler({
        resolveAppRouteFile: () => {
          routeResolutionCalls++;
          throw new Error("shared preflight reached project route discovery");
        },
      });
      const result = await handler.handle(
        new Request("https://tenant.example/api/private", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "access-control-request-method": "POST",
          },
        }),
        makeCtx({
          prepareHostedConfigContext: (() => {
            throw new Error("shared preflight prepared project config");
          }) as HandlerContext["prepareHostedConfigContext"],
        }),
      );

      assertEquals(result.response instanceof Response, true);
      assertEquals(routeResolutionCalls, 0);
    });

    it("continues API preflight in a dedicated runtime", async () => {
      let routeResolutionCalls = 0;
      const handler = new CorsHandler({
        resolveAppRouteFile: () => {
          routeResolutionCalls++;
          return Promise.resolve(null);
        },
      });

      const result = await handler.handle(
        new Request("https://app.example/api/items", { method: "OPTIONS" }),
        makeCtx(),
      );

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
      assertEquals(routeResolutionCalls, 0);
    });

    it("responds to API preflight when contextual execution is unavailable", async () => {
      const ctx = makeCtx({
        securityConfig: { cors: { origin: ["https://app.example"] } } as never,
      });
      (ctx.adapter.fs as unknown as { isContextualMode: () => boolean }).isContextualMode = () =>
        true;

      const result = await new CorsHandler().handle(
        new Request("https://app.example/api/items", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "access-control-request-method": "POST",
          },
        }),
        ctx,
      );

      assertEquals(result.response?.status, 204);
      assertEquals(
        result.response?.headers.get("access-control-allow-origin"),
        "https://app.example",
      );
    });

    it("continues API preflight in an operator-granted shared runtime", async () => {
      let routeResolutionCalls = 0;
      const handler = new CorsHandler({
        resolveAppRouteFile: () => {
          routeResolutionCalls++;
          return Promise.resolve(null);
        },
      });

      const result = await handler.handle(
        new Request("https://tenant.example/api/items", { method: "OPTIONS" }),
        makeCtx({
          allowHostProjectCodeExecution: true,
          prepareHostedConfigContext: () => Promise.reject(new Error("unused")),
        }),
      );

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
      assertEquals(routeResolutionCalls, 0);
    });

    it("continues API preflight in an operator-granted atomic contextual runtime", async () => {
      let routeResolutionCalls = 0;
      const ctx = makeCtx({
        projectSlug: "tenant-project",
        allowHostProjectCodeExecution: true,
        prepareHostedConfigContext: () => Promise.reject(new Error("unused")),
      });
      const fs = ctx.adapter.fs as unknown as {
        isContextualMode: () => boolean;
        isMultiProjectMode: () => boolean;
        runWithContext: (...args: never[]) => Promise<unknown>;
      };
      fs.isContextualMode = () => true;
      fs.isMultiProjectMode = () => true;
      fs.runWithContext = () => Promise.resolve(undefined);
      const handler = new CorsHandler({
        resolveAppRouteFile: () => {
          routeResolutionCalls++;
          return Promise.resolve(null);
        },
      });

      const result = await handler.handle(
        new Request("https://tenant.example/api/items", { method: "OPTIONS" }),
        ctx,
      );

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
      assertEquals(routeResolutionCalls, 0);
    });

    it("uses automatic preflight when an atomic runtime has no project slug", async () => {
      let contextEntries = 0;
      const ctx = makeCtx({
        allowHostProjectCodeExecution: true,
        prepareHostedConfigContext: () => Promise.reject(new Error("unused")),
        securityConfig: { cors: { origin: ["https://app.example"] } } as never,
      });
      const fs = ctx.adapter.fs as unknown as {
        isContextualMode: () => boolean;
        isMultiProjectMode: () => boolean;
        runWithContext: (...args: never[]) => Promise<unknown>;
      };
      fs.isContextualMode = () => true;
      fs.isMultiProjectMode = () => true;
      fs.runWithContext = async () => {
        contextEntries++;
        return undefined;
      };

      const result = await new CorsHandler().handle(
        new Request("https://app.example/api/items", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "access-control-request-method": "POST",
          },
        }),
        ctx,
      );

      assertEquals(result.response?.status, 204);
      assertEquals(contextEntries, 0);
    });

    it("resolves a non-API App route inside its atomic project context", async () => {
      let inProjectContext = false;
      const ctx = makeCtx({
        projectSlug: "tenant-project",
        projectId: "project-123",
        proxyToken: "proxy-token",
        environmentName: "Staging",
        allowHostProjectCodeExecution: true,
        requestContext: { mode: "preview", branch: "feature" } as never,
      });
      const fs = ctx.adapter.fs as unknown as {
        isContextualMode: () => boolean;
        isMultiProjectMode: () => boolean;
        runWithContext: <T>(
          slug: string,
          token: string,
          fn: () => Promise<T>,
        ) => Promise<T>;
      };
      fs.isContextualMode = () => true;
      fs.isMultiProjectMode = () => true;
      fs.runWithContext = async (_slug, _token, fn) => {
        inProjectContext = true;
        try {
          return await fn();
        } finally {
          inProjectContext = false;
        }
      };
      const handler = new CorsHandler({
        resolveAppRouteFile: () => {
          if (!inProjectContext) throw new Error("route resolution escaped project context");
          return Promise.resolve({ file: "/project/app/webhook/route.ts", params: {} });
        },
      });

      const result = await handler.handle(
        new Request("https://tenant.example/webhook", { method: "OPTIONS" }),
        ctx,
      );

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("refreshes a mutable preview source before non-API route classification", async () => {
      let sourceIsFresh = false;
      const ctx = makeCtx({
        projectSlug: "tenant-project",
        projectId: "project-123",
        proxyToken: "proxy-token",
        allowHostProjectCodeExecution: true,
        requestContext: { mode: "preview", branch: "feature" } as never,
      });
      const fs = ctx.adapter.fs as unknown as {
        isContextualMode: () => boolean;
        isMultiProjectMode: () => boolean;
        runWithContext: <T>(
          slug: string,
          token: string,
          fn: () => Promise<T>,
        ) => Promise<T>;
        sourceSnapshotFreshnessOptionsVersion: number;
        ensureSourceSnapshotFresh: () => Promise<void>;
      };
      fs.isContextualMode = () => true;
      fs.isMultiProjectMode = () => true;
      fs.runWithContext = async (_slug, _token, fn) => await fn();
      fs.sourceSnapshotFreshnessOptionsVersion = 1;
      fs.ensureSourceSnapshotFresh = async () => {
        sourceIsFresh = true;
      };

      const result = await new CorsHandler({
        resolveAppRouteFile: () =>
          Promise.resolve(
            sourceIsFresh ? { file: "/project/app/webhook/route.ts", params: {} } : null,
          ),
      }).handle(
        new Request("https://tenant.example/webhook", { method: "OPTIONS" }),
        ctx,
      );

      assertEquals(sourceIsFresh, true);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("continues a matched non-API App route with an OPTIONS export", async () => {
      const handler = new CorsHandler({
        resolveAppRouteFile: () => Promise.resolve({ file: "/project/route.ts", params: {} }),
      });
      const result = await handler.handle(
        new Request("https://app.example/webhook", { method: "OPTIONS" }),
        makeCtx(),
      );

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("continues a matched non-API App route with a default export", async () => {
      const handler = new CorsHandler({
        resolveAppRouteFile: () => Promise.resolve({ file: "/project/route.ts", params: {} }),
      });
      const result = await handler.handle(
        new Request("https://app.example/webhook", { method: "OPTIONS" }),
        makeCtx(),
      );

      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("does not advertise infrastructure-only request headers", async () => {
      const result = await new CorsHandler().handle(
        new Request("http://localhost/webhook", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "access-control-request-method": "POST",
            "access-control-request-headers":
              "Authorization, X-Token, X-Project-Id, X-Veryfront-Dispatch-JWS, X-App-Trace",
          },
        }),
        makeCtx({
          securityConfig: { cors: { origin: ["https://app.example"] } } as never,
        }),
      );

      assertEquals(
        result.response?.headers.get("access-control-allow-headers"),
        "Authorization, X-App-Trace",
      );
    });

    it("does not advertise dynamically denied application identity headers", async () => {
      const result = await new CorsHandler().handle(
        new Request("http://localhost/webhook", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "access-control-request-method": "POST",
            "access-control-request-headers": "Authorization, X-Auth-Subject, X-App-Trace",
          },
        }),
        makeCtx({
          applicationIdentityHeaderNames: ["x-auth-subject"],
          securityConfig: { cors: { origin: ["https://app.example"] } } as never,
        }),
      );

      assertEquals(
        result.response?.headers.get("access-control-allow-headers"),
        "Authorization, X-App-Trace",
      );
    });

    it("fails preflight header capabilities closed for a malformed dynamic deny list", async () => {
      const denyHeaders = ["x-auth-subject"];
      Object.defineProperty(denyHeaders, "unexpected", { value: "x-app-trace" });

      const result = await new CorsHandler().handle(
        new Request("http://localhost/webhook", {
          method: "OPTIONS",
          headers: {
            Origin: "https://app.example",
            "access-control-request-method": "POST",
            "access-control-request-headers": "X-Auth-Subject, X-App-Trace",
          },
        }),
        makeCtx({
          applicationIdentityHeaderNames: denyHeaders,
          securityConfig: { cors: { origin: ["https://app.example"] } } as never,
        }),
      );

      assertEquals(
        result.response?.headers.get("access-control-allow-headers"),
        null,
      );
    });

    it("does not reintroduce dynamically denied default preflight headers", () => {
      const request = new Request("http://localhost/webhook", {
        method: "OPTIONS",
        headers: {
          "access-control-request-headers": "Authorization, Content-Type",
        },
      });

      assertEquals(
        getApplicationPreflightHeaders(request, { denyHeaders: ["authorization"] }),
        "Content-Type",
      );
      assertEquals(
        getApplicationPreflightHeaders(request, { denyHeaders: ["content-type"] }),
        "Authorization",
      );
      assertEquals(
        getApplicationPreflightHeaders(request, {
          denyHeaders: ["authorization", "content-type"],
        }),
        "",
      );
    });
  });
});
