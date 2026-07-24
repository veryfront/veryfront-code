import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { CorsHandler } from "./cors.ts";
import type { HandlerContext } from "../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter as createVfsAdapter } from "#veryfront/platform/adapters/mock.ts";
import { resetApiHandler } from "../request/api/pages-api-handler.ts";
import { createHandlerRegistry } from "../../runtime-handler/index.ts";

function createMockAdapter(envMap: Record<string, string> = {}): RuntimeAdapter {
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
      get: (key: string) => envMap[key],
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
    cspUserHeader: null,
    ...overrides,
  };
}

function makeCorsCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return makeCtx({
    securityConfig: { cors: true },
    ...overrides,
  });
}

afterAll(async () => {
  const { stop } = await import("veryfront/extensions/bundler");
  await stop();
});

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
      const req = new Request("http://localhost/api/test", {
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
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: {
          origin: "http://localhost:3000",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Authorization,Content-Type",
        },
      });
      const ctx = makeCorsCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
      // Should have allow-methods header
      const methods = result.response?.headers.get("access-control-allow-methods") ?? "";
      assertEquals(methods.length > 0, true);
    });

    it("advertises exact methods for a VFS-backed App Router route", async () => {
      const projectDir = "/virtual/cors-vfs-capabilities";
      const adapter = createVfsAdapter();
      adapter.fs.files.set(
        `${projectDir}/app/api/items/route.ts`,
        [
          `export function GET() { return new Response("get"); }`,
          `export function PATCH() { return new Response("patch"); }`,
        ].join("\n"),
      );
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/items", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "PATCH",
        },
      });

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {} }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "GET, HEAD, PATCH, OPTIONS",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("advertises a custom method when the matched default route can execute it", async () => {
      const projectDir = "/virtual/cors-default-custom-method";
      const adapter = createVfsAdapter();
      adapter.fs.files.set(
        `${projectDir}/app/api/webdav/route.ts`,
        `export default function handler() { return new Response("webdav"); }`,
      );
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/webdav", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "PROPFIND",
        },
      });

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {} }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS, PROPFIND",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("fails closed for an unmatched API route", async () => {
      const projectDir = "/virtual/cors-unmatched-api";
      const adapter = createVfsAdapter();
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/missing", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
        },
      });

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {} }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "OPTIONS",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("fails closed when a matched VFS route module cannot load", async () => {
      const projectDir = "/virtual/cors-unavailable-route";
      const adapter = createVfsAdapter();
      adapter.fs.files.set(
        `${projectDir}/app/api/broken/route.ts`,
        `export function POST( {`,
      );
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/broken", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
        },
      });

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {} }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "OPTIONS",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("uses conservative read-only capabilities for an unmatched page route", async () => {
      const projectDir = "/virtual/cors-unmatched-page";
      const adapter = createVfsAdapter();
      const handler = new CorsHandler();
      const req = new Request("http://localhost/about", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
        },
      });

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {} }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "GET, HEAD, OPTIONS",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("preserves declared methods for a framework-owned route", async () => {
      const projectDir = "/virtual/cors-framework-route";
      const adapter = createVfsAdapter();
      const handler = new CorsHandler();
      const req = new Request("http://localhost/channels/invoke", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
        },
      });
      const routeRegistry: NonNullable<HandlerContext["routeRegistry"]> = {
        getHandlers: () => [{
          metadata: {
            name: "ChannelInvokeHandler",
            priority: 500,
            patterns: [{ pattern: "/channels/invoke", exact: true, method: "POST" }],
          },
        }],
        getStats: () => ({
          totalHandlers: 1,
          handlersByPriority: { "500": 1 },
          handlerNames: ["ChannelInvokeHandler"],
        }),
      };

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {}, routeRegistry }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "POST, OPTIONS",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("preserves framework-owned methods under /api before the project API router", async () => {
      const projectDir = "/virtual/cors-framework-api-route";
      const adapter = createVfsAdapter();
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/control-plane/agents/list", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
        },
      });
      const routeRegistry: NonNullable<HandlerContext["routeRegistry"]> = {
        getHandlers: () => [
          {
            metadata: {
              name: "InternalAgentsListHandler",
              priority: 700,
              patterns: [{
                pattern: "/api/control-plane/agents/list",
                exact: true,
                method: "POST",
              }],
            },
          },
          {
            metadata: {
              name: "ApiHandlerWrapper",
              priority: 700,
            },
          },
          {
            metadata: {
              name: "SSRHandler",
              priority: 1000,
              patterns: [{ pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] }],
            },
          },
        ],
        getStats: () => ({
          totalHandlers: 3,
          handlersByPriority: { "700": 2, "1000": 1 },
          handlerNames: ["InternalAgentsListHandler", "ApiHandlerWrapper", "SSRHandler"],
        }),
      };

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {}, routeRegistry }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "POST, OPTIONS",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("does not advertise handlers that are unreachable after an unmatched /api route", async () => {
      const projectDir = "/virtual/cors-terminal-api-miss";
      const adapter = createVfsAdapter();
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/missing", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
        },
      });
      const routeRegistry: NonNullable<HandlerContext["routeRegistry"]> = {
        getHandlers: () => [
          {
            metadata: {
              name: "ApiHandlerWrapper",
              priority: 700,
            },
          },
          {
            metadata: {
              name: "SSRHandler",
              priority: 1000,
              patterns: [{ pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] }],
            },
          },
        ],
        getStats: () => ({
          totalHandlers: 2,
          handlersByPriority: { "700": 1, "1000": 1 },
          handlerNames: ["ApiHandlerWrapper", "SSRHandler"],
        }),
      };

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {}, routeRegistry }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "OPTIONS",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("uses exact reachability from the real registry for control-plane-looking paths", async () => {
      const projectDir = "/virtual/cors-real-registry";
      const adapter = createVfsAdapter();
      const { registry } = createHandlerRegistry(projectDir, adapter);
      const handler = new CorsHandler();
      const ctx = makeCorsCtx({
        projectDir,
        adapter,
        config: {},
        routeRegistry: registry,
      });

      try {
        const missing = await handler.handle(
          new Request(
            "http://localhost/api/control-plane/runs/run_1/not-a-runtime-route",
            {
              method: "OPTIONS",
              headers: {
                origin: "https://app.example.com",
                "access-control-request-method": "POST",
              },
            },
          ),
          ctx,
        );
        const exactRouteRequests: Array<readonly [string, string]> = [
          ["http://localhost/api/control-plane/runs/run_1", "DELETE"],
          ["http://localhost/api/control-plane/runs/run_1/resume", "POST"],
          ["http://localhost/api/control-plane/runs/run_1/execute", "POST"],
        ];
        const exactRoutes = await Promise.all(
          exactRouteRequests.map(([url, method]) =>
            handler.handle(
              new Request(url, {
                method: "OPTIONS",
                headers: {
                  origin: "https://app.example.com",
                  "access-control-request-method": method,
                },
              }),
              ctx,
            )
          ),
        );

        assertEquals(
          missing.response?.headers.get("access-control-allow-methods"),
          "OPTIONS",
        );
        assertEquals(
          exactRoutes.map((result) => result.response?.headers.get("access-control-allow-methods")),
          ["DELETE, OPTIONS", "POST, OPTIONS", "POST, OPTIONS"],
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("fails closed when framework route enablement cannot be evaluated", async () => {
      const projectDir = "/virtual/cors-throwing-enablement";
      const adapter = createVfsAdapter();
      const handler = new CorsHandler();
      const req = new Request("http://localhost/framework/action", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
        },
      });
      const routeRegistry: NonNullable<HandlerContext["routeRegistry"]> = {
        getHandlers: () => [{
          metadata: {
            name: "ThrowingHandler",
            priority: 500,
            enabled: () => {
              throw new Error("enablement unavailable");
            },
            patterns: [{ pattern: "/framework/action", exact: true, method: "POST" }],
          },
        }],
        getStats: () => ({
          totalHandlers: 1,
          handlersByPriority: { "500": 1 },
          handlerNames: ["ThrowingHandler"],
        }),
      };

      try {
        const result = await handler.handle(
          req,
          makeCorsCtx({ projectDir, adapter, config: {}, routeRegistry }),
        );

        assertEquals(
          result.response?.headers.get("access-control-allow-methods"),
          "OPTIONS",
        );
      } finally {
        await resetApiHandler(projectDir);
      }
    });

    it("does not broaden configured CORS method or header allowlists", async () => {
      const handler = new CorsHandler();
      const req = new Request("http://localhost/about", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "POST",
          "access-control-request-headers": "Content-Type, X-Internal",
        },
      });
      const ctx = makeCtx({
        securityConfig: {
          cors: {
            origin: "https://app.example.com",
            methods: ["GET"],
            allowedHeaders: ["Content-Type"],
            maxAge: 7,
          },
        },
      });

      const result = await handler.handle(req, ctx);

      assertEquals(result.response?.headers.get("access-control-allow-methods"), "GET");
      assertEquals(
        result.response?.headers.get("access-control-allow-headers"),
        "Content-Type",
      );
      assertEquals(result.response?.headers.get("access-control-max-age"), "7");
    });

    it("uses the resolved request policy without reloading project config", async () => {
      let configLookupCount = 0;
      const adapter = createMockAdapter();
      adapter.fs.readFile = () => {
        configLookupCount++;
        return Promise.reject(new Error("config must not be reloaded"));
      };
      const handler = new CorsHandler();
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: {
          origin: "https://app.example.com",
          "access-control-request-method": "GET",
        },
      });
      const ctx = makeCtx({
        adapter,
        projectDir: "/tmp/cors-handler-request-policy-test",
        config: {},
        securityConfig: {
          cors: {
            origin: "https://app.example.com",
            methods: ["GET"],
          },
        },
      });

      const result = await handler.handle(req, ctx);

      assertEquals(configLookupCount, 0);
      assertEquals(
        result.response?.headers.get("access-control-allow-origin"),
        "https://app.example.com",
      );
    });

    it("preserves local response-security context for preflights", async () => {
      const origin = "https://app.example.com";
      const handler = new CorsHandler();
      const result = await handler.handle(
        new Request("https://local.test/about", {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "GET",
          },
        }),
        makeCtx({
          adapter: createMockAdapter({ VERYFRONT_CORP: "cross-origin" }),
          isLocalProject: true,
          cspUserHeader: "default-src 'none'",
          securityConfig: { cors: { origin } },
        }),
      );

      const headers = result.response?.headers;
      assertEquals(headers?.get("content-security-policy"), "default-src 'none'");
      assertEquals(headers?.get("cross-origin-resource-policy"), "cross-origin");
      assertEquals(headers?.get("strict-transport-security"), null);
      assertEquals(headers?.get("x-frame-options"), null);
      assertEquals(headers?.get("cross-origin-opener-policy"), null);
    });

    it("preserves hosted-domain iframe policy for preflights", async () => {
      const origin = "https://app.example.com";
      const handler = new CorsHandler();
      const result = await handler.handle(
        new Request("https://project.production.veryfront.com/about", {
          method: "OPTIONS",
          headers: {
            origin,
            "access-control-request-method": "GET",
          },
        }),
        makeCtx({
          isLocalProject: false,
          parsedDomain: {
            slug: "project",
            branch: null,
            environment: "production",
            isVeryfrontDomain: true,
            isDraft: false,
            allowIframeEmbed: true,
          },
          securityConfig: { cors: { origin } },
        }),
      );

      const csp = result.response?.headers.get("content-security-policy") ?? "";
      assertEquals(
        csp.includes(
          "frame-ancestors 'self' https://veryfront.com https://veryfront.org",
        ),
        true,
      );
      assertEquals(csp.includes("frame-ancestors 'none'"), false);
    });

    it("handles OPTIONS with lowercase method check", async () => {
      const handler = new CorsHandler();
      // OPTIONS method should be matched case-insensitively
      const req = new Request("http://localhost/api/test", {
        method: "OPTIONS",
      });
      const ctx = makeCtx();
      const result = await handler.handle(req, ctx);
      assertEquals(result.response instanceof Response, true);
    });
  });
});
