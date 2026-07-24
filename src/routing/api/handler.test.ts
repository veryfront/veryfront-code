import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { computeHash, HTTP_OK } from "#veryfront/utils";
import type { HandlerContext } from "#veryfront/types";
import { __resetPoolForTests, getWorkerPool } from "#veryfront/security/sandbox/worker-pool.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import {
  __injectDepsForTests,
  type APIRoute,
  APIRouteHandler,
  sanitizeLoadErrorForResponse,
} from "./handler.ts";

const handlers: APIRouteHandler[] = [];

function createHandler(
  projectDir: string,
  adapter?: ReturnType<typeof createMockAdapter>,
): APIRouteHandler {
  const handler = new APIRouteHandler(projectDir, adapter);
  handlers.push(handler);
  return handler;
}

async function createInitializedHandler(
  projectDir: string,
  adapter: ReturnType<typeof createMockAdapter>,
): Promise<APIRouteHandler> {
  const handler = createHandler(projectDir, adapter);
  await handler.initialize();
  return handler;
}

async function withApiWorkerIsolation<T>(run: () => Promise<T>): Promise<T> {
  const previousMaster = Deno.env.get("WORKER_ISOLATION_ENABLED");
  const previousApi = Deno.env.get("WORKER_ISOLATION_API");
  Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
  Deno.env.set("WORKER_ISOLATION_API", "1");
  __resetPoolForTests();

  try {
    return await runWithExactSourceIntegrationPolicy(
      normalizeSourceIntegrationPolicy(undefined),
      run,
    );
  } finally {
    __resetPoolForTests();
    if (previousMaster === undefined) Deno.env.delete("WORKER_ISOLATION_ENABLED");
    else Deno.env.set("WORKER_ISOLATION_ENABLED", previousMaster);
    if (previousApi === undefined) Deno.env.delete("WORKER_ISOLATION_API");
    else Deno.env.set("WORKER_ISOLATION_API", previousApi);
  }
}

afterEach((): void => {
  while (handlers.length) handlers.pop()?.destroy();
  __resetPoolForTests();
  __injectDepsForTests(null);
});

afterAll(async () => {
  const { stop } = await import("veryfront/extensions/bundler");
  await stop();
});

describe("APIRouteHandler", () => {
  describe("initialization", () => {
    it("should initialize without errors when directories are missing", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      await handler.initialize();

      assertExists(handler);
    });

    it("should initialize with provided adapter", () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      assertExists(handler);
    });

    it("should initialize without adapter and lazy-load it", () => {
      const handler = createHandler("/test/project");

      assertExists(handler);
    });
  });

  describe("request handling - unmatched routes", () => {
    it("should return null for non-API routes", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/about");
      const response = await handler.handle(request);

      assertEquals(response, null, "Non-API routes should return null");
    });

    it("should return null for root path", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/");
      const response = await handler.handle(request);

      assertEquals(response, null, "Root path should return null when not an API route");
    });

    it("should return 404 for unmatched /api routes", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api/notfound");
      const response = await handler.handle(request);

      assertExists(response, "Should return a response for /api paths");
      assertEquals(response.status, 404, "Should return 404 for unmatched API routes");
      assertEquals(await response.text(), "Not Found");
    });

    it("should return 404 for exact /api path when no route matches", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api");
      const response = await handler.handle(request);

      assertEquals(response?.status, 404);
    });

    it("should return 404 for nested unmatched /api routes", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api/v1/users/123/posts/456");
      const response = await handler.handle(request);

      assertEquals(response?.status, 404);
    });
  });

  describe("OPTIONS/CORS handling", () => {
    it("should handle OPTIONS preflight requests with secure-by-default CORS", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: { origin: "https://example.com" },
      });
      const response = await handler.handle(request);

      assertExists(response, "Should return response for OPTIONS");
      assertEquals(response.status, 204, "OPTIONS should return 204");
      assertEquals(
        response.headers.get("Access-Control-Allow-Origin"),
        null,
        "Should not include CORS headers without config",
      );
    });

    it("should handle OPTIONS with no origin header", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api/test", { method: "OPTIONS" });
      const response = await handler.handle(request);

      assertEquals(response?.status, 204);
      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("should handle OPTIONS for /api root", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { origin: "https://example.com" },
      });
      const response = await handler.handle(request);

      assertEquals(response?.status, 204);
    });

    it("keeps framework preflight authoritative over a route OPTIONS export", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/test/route.ts",
        `export function OPTIONS() { return new Response("project options", { status: 299 }); }`,
      );
      let hostLoads = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          hostLoads++;
          return Promise.resolve({
            OPTIONS: () => new Response("project options", { status: 299 }),
          });
        },
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/api/test", { method: "OPTIONS" }),
      );

      assertEquals(response?.status, 204);
      assertEquals(await response?.text(), "");
      assertEquals(hostLoads, 0);
    });
  });

  describe("worker-isolated route execution", () => {
    it("prepares and inspects route source without loading the module on the host", async () => {
      await withApiWorkerIsolation(async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test/project/app/api/resource/route.ts",
          `export function GET() { return new Response("source placeholder"); }`,
        );
        const preparedSource = [
          `export function GET() { return new Response("prepared worker"); }`,
          `export function PATCH() { return new Response("patched"); }`,
        ].join("\n");
        let hostLoads = 0;
        let preparations = 0;
        __injectDepsForTests({
          loadHandlerModule: () => {
            hostLoads++;
            return Promise.resolve({
              GET: () => new Response("host execution"),
            });
          },
          prepareHandlerModule: async () => {
            preparations++;
            return {
              source: preparedSource,
              sha256: await computeHash(preparedSource),
            };
          },
        });
        const handler = await createInitializedHandler("/test/project", adapter);

        const response = await handler.handle(
          new Request("http://localhost/api/resource"),
          { isLocalProject: true } as HandlerContext,
        );
        const capabilities = await handler.resolveRouteMethods("/api/resource");

        assertEquals(response?.status, 200);
        assertEquals(await response?.text(), "prepared worker");
        assertEquals(capabilities, {
          status: "resolved",
          methods: ["GET", "HEAD", "PATCH", "OPTIONS"],
        });
        assertEquals(preparations, 1);
        assertEquals(hostLoads, 0);
      });
    });

    it("fails closed before preparation when project discovery requires host evaluation", async () => {
      await withApiWorkerIsolation(async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test/project/app/api/resource/route.ts",
          `export function GET() { return new Response("unreachable"); }`,
        );
        adapter.fs.files.set(
          "/test/project/tools/project-tool.ts",
          `throw new Error("project discovery must not execute on host");`,
        );
        let hostLoads = 0;
        let preparations = 0;
        __injectDepsForTests({
          loadHandlerModule: () => {
            hostLoads++;
            return Promise.resolve({});
          },
          prepareHandlerModule: () => {
            preparations++;
            return Promise.reject(new Error("preparation must not run"));
          },
        });
        const handler = await createInitializedHandler("/test/project", adapter);

        const response = await handler.handle(
          new Request("http://localhost/api/resource"),
          { isLocalProject: false } as HandlerContext,
        );
        const capabilities = await handler.resolveRouteMethods("/api/resource");

        assertEquals(response?.status, 503);
        assertEquals(await response?.text(), "API route unavailable");
        assertEquals(capabilities, { status: "unavailable" });
        assertEquals(preparations, 0);
        assertEquals(hostLoads, 0);
      });
    });

    it("makes isolation unavailable without preparation, fetch, or worker admission when config loading fails", async () => {
      await withApiWorkerIsolation(async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test/project/app/api/resource/route.ts",
          `import "https://esm.sh/unreachable"; export function GET() { return new Response("unreachable"); }`,
        );
        let configLoads = 0;
        let hostLoads = 0;
        let preparations = 0;
        let fetches = 0;
        const originalFetch = globalThis.fetch;
        globalThis.fetch = ((..._args: Parameters<typeof fetch>) => {
          fetches++;
          return Promise.reject(new Error("fetch must not run"));
        }) as typeof fetch;

        try {
          __injectDepsForTests({
            getConfig: () => {
              configLoads++;
              return Promise.reject(new Error("synthetic config failure"));
            },
            loadHandlerModule: () => {
              hostLoads++;
              return Promise.resolve({});
            },
            prepareHandlerModule: () => {
              preparations++;
              return Promise.reject(new Error("preparation must not run"));
            },
          });
          const handler = await createInitializedHandler("/test/project", adapter);

          const response = await handler.handle(
            new Request("http://localhost/api/resource"),
            { isLocalProject: false } as HandlerContext,
          );
          const capabilities = await handler.resolveRouteMethods("/api/resource");

          assertEquals(response?.status, 503);
          assertEquals(await response?.text(), "API route unavailable");
          assertEquals(capabilities, { status: "unavailable" });
          assertEquals(configLoads, 1);
          assertEquals(preparations, 0);
          assertEquals(hostLoads, 0);
          assertEquals(fetches, 0);
          assertEquals(getWorkerPool().getStats().poolSize, 0);
        } finally {
          globalThis.fetch = originalFetch;
        }
      });
    });

    it("classifies null and malformed resolved configs as isolation-unavailable before preparation", async () => {
      await withApiWorkerIsolation(async () => {
        for (
          const invalidConfig of [
            null,
            [],
            Object.create({ inherited: true }),
            { security: { remoteHosts: "https://esm.sh" } },
            { resolve: null },
            { resolve: [] },
            { resolve: { importMap: null } },
            { resolve: { importMap: [] } },
            { resolve: { importMap: { imports: null } } },
            { resolve: { importMap: { imports: [] } } },
            { resolve: { importMap: { imports: { alias: 42 } } } },
            { resolve: { importMap: { scopes: null } } },
            { resolve: { importMap: { scopes: [] } } },
            { resolve: { importMap: { scopes: { "/scope/": null } } } },
            { resolve: { importMap: { scopes: { "/scope/": [] } } } },
            { resolve: { importMap: { scopes: { "/scope/": { package: 42 } } } } },
          ]
        ) {
          const adapter = createMockAdapter();
          adapter.fs.files.set(
            "/test/project/app/api/resource/route.ts",
            `export function GET() { return new Response("unreachable"); }`,
          );
          let preparations = 0;
          __injectDepsForTests({
            getConfig: () => Promise.resolve(invalidConfig as unknown as VeryfrontConfig),
            prepareHandlerModule: () => {
              preparations++;
              return Promise.reject(new Error("preparation must not run"));
            },
          });
          const handler = await createInitializedHandler("/test/project", adapter);

          const response = await handler.handle(
            new Request("http://localhost/api/resource"),
            { isLocalProject: false } as HandlerContext,
          );

          assertEquals(response?.status, 503);
          assertEquals(preparations, 0);
          assertEquals(getWorkerPool().getStats().poolSize, 0);
        }
      });
    });

    it("does not invoke prepared-policy accessors and makes isolation unavailable", async () => {
      await withApiWorkerIsolation(async () => {
        let accessorCalls = 0;
        const accessorRecord = (key: string, value: unknown): Record<string, unknown> => {
          const record: Record<string, unknown> = {};
          Object.defineProperty(record, key, {
            enumerable: true,
            get() {
              accessorCalls++;
              return value;
            },
          });
          return record;
        };
        const accessorConfigs: unknown[] = [
          accessorRecord("resolve", {}),
          { resolve: accessorRecord("importMap", {}) },
          { resolve: { importMap: accessorRecord("imports", {}) } },
          { resolve: { importMap: accessorRecord("scopes", {}) } },
          {
            resolve: {
              importMap: {
                scopes: accessorRecord("/scope/", {}),
              },
            },
          },
          {
            resolve: {
              importMap: {
                scopes: {
                  "/scope/": accessorRecord("package", "./target.ts"),
                },
              },
            },
          },
        ];

        for (const invalidConfig of accessorConfigs) {
          const adapter = createMockAdapter();
          adapter.fs.files.set(
            "/test/project/app/api/resource/route.ts",
            `export function GET() { return new Response("unreachable"); }`,
          );
          let preparations = 0;
          __injectDepsForTests({
            getConfig: () => Promise.resolve(invalidConfig as VeryfrontConfig),
            prepareHandlerModule: () => {
              preparations++;
              return Promise.reject(new Error("preparation must not run"));
            },
          });
          const handler = await createInitializedHandler("/test/project", adapter);

          const response = await handler.handle(
            new Request("http://localhost/api/resource"),
            { isLocalProject: false } as HandlerContext,
          );
          const capabilities = await handler.resolveRouteMethods("/api/resource");

          assertEquals(response?.status, 503);
          assertEquals(capabilities, { status: "unavailable" });
          assertEquals(preparations, 0);
          assertEquals(accessorCalls, 0);
          assertEquals(getWorkerPool().getStats().poolSize, 0);
        }
      });
    });

    it("preparation receives an immutable source-policy snapshot", async () => {
      await withApiWorkerIsolation(async () => {
        const adapter = createMockAdapter();
        adapter.fs.files.set(
          "/test/project/app/api/resource/route.ts",
          `export function GET() { return new Response("unreachable"); }`,
        );
        const resolvedConfig = {
          security: { remoteHosts: [] as string[] },
          resolve: {
            importMap: {
              imports: { alias: "./before.ts" },
              scopes: { "/scope/": { package: "./before.ts" } },
            },
          },
        } as VeryfrontConfig;
        let preparedConfig: VeryfrontConfig | undefined;
        const preparedSource = `export function GET() { return new Response("snapshot"); }`;
        __injectDepsForTests({
          getConfig: () => Promise.resolve(resolvedConfig),
          prepareHandlerModule: async (options) => {
            preparedConfig = options.config;
            return {
              source: preparedSource,
              sha256: await computeHash(preparedSource),
            };
          },
        });
        const handler = await createInitializedHandler("/test/project", adapter);

        resolvedConfig.security?.remoteHosts?.push("https://esm.sh");
        if (resolvedConfig.resolve?.importMap?.imports) {
          resolvedConfig.resolve.importMap.imports.alias = "./after.ts";
        }
        if (resolvedConfig.resolve?.importMap?.scopes?.["/scope/"]) {
          resolvedConfig.resolve.importMap.scopes["/scope/"].package = "./after.ts";
        }
        const response = await handler.handle(
          new Request("http://localhost/api/resource"),
          { isLocalProject: true } as HandlerContext,
        );

        assertEquals(response?.status, 200);
        assertEquals(await response?.text(), "snapshot");
        assertEquals(preparedConfig?.security?.remoteHosts, []);
        assertEquals(preparedConfig?.resolve?.importMap?.imports?.alias, "./before.ts");
        assertEquals(
          preparedConfig?.resolve?.importMap?.scopes?.["/scope/"]?.package,
          "./before.ts",
        );
        assertEquals(Object.isFrozen(preparedConfig), true);
        assertEquals(Object.isFrozen(preparedConfig?.security), true);
        assertEquals(Object.isFrozen(preparedConfig?.security?.remoteHosts), true);
        assertEquals(Object.isFrozen(preparedConfig?.resolve), true);
        assertEquals(Object.isFrozen(preparedConfig?.resolve?.importMap), true);
        assertEquals(Object.isFrozen(preparedConfig?.resolve?.importMap?.imports), true);
        assertEquals(
          Object.isFrozen(preparedConfig?.resolve?.importMap?.scopes?.["/scope/"]),
          true,
        );
      });
    });
  });

  describe("route discovery", () => {
    it("should discover Pages Router API routes", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/project";

      adapter.fs.files.set(
        "/test/project/pages/api/users.ts",
        "export async function GET() { return Response.json({ users: [] }); }",
      );

      const handler = createHandler(projectDir, adapter);
      await handler.initialize();

      assertExists(handler);
    });

    it("should discover App Router routes", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/project";

      adapter.fs.files.set(
        "/test/project/app/api/posts/route.ts",
        "export async function GET() { return Response.json({ posts: [] }); }",
      );

      const handler = createHandler(projectDir, adapter);
      await handler.initialize();

      assertExists(handler);
    });

    it("should discover nested App Router routes", async () => {
      const adapter = createMockAdapter();
      const projectDir = "/test/project";

      adapter.fs.files.set(
        "/test/project/app/api/users/[id]/posts/route.ts",
        "export async function GET() { return Response.json({ posts: [] }); }",
      );

      const handler = createHandler(projectDir, adapter);
      await handler.initialize();

      assertExists(handler);
    });

    it("should discover multiple routes in both routers", async () => {
      const adapter = createMockAdapter();

      adapter.fs.files.set(
        "/test/project/pages/api/auth.ts",
        "export async function POST() { return Response.json({ auth: true }); }",
      );
      adapter.fs.files.set(
        "/test/project/app/api/data/route.ts",
        "export async function GET() { return Response.json({ data: [] }); }",
      );

      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      assertExists(handler);
    });
  });

  describe("cache management", () => {
    it("should provide clearCache method", () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      handler.clearCache();

      assertExists(handler);
    });

    it("should clear cache without errors after initialization", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/test/route.ts",
        "export async function GET() { return Response.json({}); }",
      );

      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      handler.clearCache();

      assertExists(handler);
    });

    it("should allow re-initialization after cache clear", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      await handler.initialize();
      handler.clearCache();
      await handler.initialize();

      assertExists(handler);
    });

    it("should defer destruction until active requests settle", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/status.ts",
        "export function GET() { return new Response('ok'); }",
      );
      __injectDepsForTests({
        loadHandlerModule: () =>
          Promise.resolve({
            GET: () => new Response("ok"),
          }),
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const responsePromise = handler.handle(new Request("http://localhost/api/status"));
      handler.destroy();

      const response = await responsePromise;
      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "ok");

      const responseAfterDestroy = await handler.handle(
        new Request("http://localhost/api/status"),
      );
      assertEquals(responseAfterDestroy?.status, 404);
    });
  });

  describe("error scenarios", () => {
    it("should handle file system errors during initialization gracefully", async () => {
      const adapter = createMockAdapter();
      adapter.fs.readDir = async function* () {
        yield* [];
        throw new Error("File system error");
      };

      const handler = createHandler("/test/project", adapter);

      try {
        await handler.initialize();
      } catch (e) {
        assertExists(e);
      }
    });

    it("should handle requests after failed initialization", async () => {
      const adapter = createMockAdapter();
      const originalReadDir = adapter.fs.readDir;
      let callCount = 0;

      adapter.fs.readDir = async function* (path: string) {
        callCount++;
        if (callCount === 1) throw new Error("First call fails");
        yield* originalReadDir.call(adapter.fs, path);
      };

      const handler = createHandler("/test/project", adapter);

      try {
        await handler.initialize();
      } catch {
        // ignore
      }

      const request = new Request("http://localhost/api/test");
      const response = await handler.handle(request);

      assertExists(response, "Should handle requests even after failed initialization");
    });
  });

  describe("route pattern matching", () => {
    it("should handle routes with dynamic segments", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/users/[id].ts",
        "export async function GET() { return Response.json({}); }",
      );

      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      assertExists(handler);
    });

    it("should handle catch-all routes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/files/[...path].ts",
        "export async function GET() { return Response.json({}); }",
      );

      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      assertExists(handler);
    });

    it("should handle optional catch-all routes", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/[[...slug]]/route.ts",
        "export async function GET() { return Response.json({}); }",
      );

      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      assertExists(handler);
    });
  });

  describe("HTTP method handling", () => {
    it("resolves exact method capabilities through the VFS-backed canonical loader", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/resource/route.ts",
        [
          `export function GET() { return new Response("get"); }`,
          `export function PATCH() { return new Response("patch"); }`,
        ].join("\n"),
      );
      const handler = await createInitializedHandler("/test/project", adapter);

      const capabilities = await handler.resolveRouteMethods("/api/resource");

      assertEquals(capabilities, {
        status: "resolved",
        methods: ["GET", "HEAD", "PATCH", "OPTIONS"],
      });
    });

    it("reports a matched route as unavailable when its module cannot load", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/broken/route.ts",
        `export function POST() { return new Response("post"); }`,
      );
      __injectDepsForTests({
        loadHandlerModule: () => Promise.reject(new Error("synthetic loader failure")),
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const capabilities = await handler.resolveRouteMethods("/api/broken");

      assertEquals(capabilities, { status: "unavailable" });
    });

    it("reports no route instead of inventing API method capabilities", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const capabilities = await handler.resolveRouteMethods("/api/missing");

      assertEquals(capabilities, { status: "not-found" });
    });

    it("recognizes a default route handler as supporting every routed HTTP method", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/default.ts",
        `export default function handler() { return new Response("ok"); }`,
      );
      const handler = await createInitializedHandler("/test/project", adapter);

      const capabilities = await handler.resolveRouteMethods("/api/default");

      assertEquals(capabilities, {
        status: "resolved",
        methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      });
    });

    it("advertises the App Router default export fallback for every routed method", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/default/route.ts",
        `export default function handler() { return new Response("ok"); }`,
      );
      const handler = await createInitializedHandler("/test/project", adapter);

      const capabilities = await handler.resolveRouteMethods("/api/default");

      assertEquals(capabilities, {
        status: "resolved",
        methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      });
    });

    it("advertises and executes a requested custom method through the same default contract", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/default/route.ts",
        `export default function handler() { return new Response("custom"); }`,
      );
      const handler = await createInitializedHandler("/test/project", adapter);

      const capabilities = await handler.resolveRouteMethods(
        "/api/default",
        "PROPFIND",
      );
      const response = await handler.handle(
        new Request("http://localhost/api/default", { method: "PROPFIND" }),
        { isLocalProject: true } as HandlerContext,
      );

      assertEquals(capabilities, {
        status: "resolved",
        methods: [
          "GET",
          "HEAD",
          "POST",
          "PUT",
          "PATCH",
          "DELETE",
          "OPTIONS",
          "PROPFIND",
        ],
      });
      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "custom");
    });

    it("should accept different HTTP methods in route names", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/resource/route.ts",
        `export async function GET() { return Response.json({ method: 'GET' }); }
         export async function POST() { return Response.json({ method: 'POST' }); }
         export async function PUT() { return Response.json({ method: 'PUT' }); }
         export async function DELETE() { return Response.json({ method: 'DELETE' }); }
         export async function PATCH() { return Response.json({ method: 'PATCH' }); }`,
      );

      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      assertExists(handler);
    });

    it("should support HEAD method", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/head/route.ts",
        "export async function HEAD() { return new Response(null, { status: 200 }); }",
      );

      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      assertExists(handler);
    });

    it("should support default handler", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/app/api/default/route.ts",
        'export async function default() { return Response.json({ method: "default" }); }',
      );

      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      assertExists(handler);
    });
  });

  describe("constructor behavior", () => {
    it("should accept project directory and adapter", () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);

      assertExists(handler);
    });

    it("should work with only project directory", () => {
      const handler = createHandler("/test/project");

      assertExists(handler);
    });

    it("should handle empty project directory", () => {
      const adapter = createMockAdapter();
      const handler = createHandler("", adapter);

      assertExists(handler);
    });
  });

  describe("HTTP_OK constant usage", () => {
    it("should verify HTTP_OK equals 200", () => {
      assertEquals(HTTP_OK, 200, "HTTP_OK constant should equal 200");
    });

    it("should import HTTP_OK from shared constants", () => {
      assertExists(HTTP_OK, "HTTP_OK should be imported and available");
      assertEquals(typeof HTTP_OK, "number", "HTTP_OK should be a number");
    });

    it("should use HTTP_OK for default status in HEAD shim logic", () => {
      const mockResponse = { status: undefined as number | undefined, headers: {} };
      const defaultStatus = mockResponse.status ?? HTTP_OK;

      assertEquals(defaultStatus, HTTP_OK, "Should default to HTTP_OK when status is undefined");
      assertEquals(defaultStatus, 200, "Default status should be 200");
    });

    it("should preserve custom status when available", () => {
      const mockResponse = { status: 201, headers: {} };
      const finalStatus = mockResponse.status ?? HTTP_OK;

      assertEquals(finalStatus, 201, "Should preserve custom status when provided");
    });

    it("should use HTTP_OK when status is null or undefined", () => {
      const cases: Array<{ status: number | null | undefined; expected: number }> = [
        { status: undefined, expected: HTTP_OK },
        { status: null, expected: HTTP_OK },
        { status: 0, expected: 0 },
        { status: 200, expected: 200 },
        { status: 404, expected: 404 },
      ];

      cases.forEach(({ status, expected }) => {
        const finalStatus = status ?? HTTP_OK;
        assertEquals(finalStatus, expected, `Status ${status} should result in ${expected}`);
      });
    });
  });

  // A load failure belongs to the attempt that produced it. Held on the
  // instance, it outlived the request and the next route to fail for its own
  // reason reported someone else's error.
  describe("load failure scoping", () => {
    async function handlerWithTwoRoutes(
      onLoad: (modulePath: string) => Promise<APIRoute | null>,
    ): Promise<{ handler: APIRouteHandler; localCtx: HandlerContext }> {
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/broken.ts",
        "export function GET() { return new Response('broken'); }",
      );
      adapter.fs.files.set(
        "/test/project/pages/api/empty.ts",
        "export const notAMethod = 1;",
      );

      __injectDepsForTests({ loadHandlerModule: ({ modulePath }) => onLoad(modulePath) });

      return {
        handler: await createInitializedHandler("/test/project", adapter),
        localCtx: {
          projectDir: "/test/project",
          adapter,
          securityConfig: null,
          cspUserHeader: null,
          isLocalProject: true,
        },
      };
    }

    it("does not report one route's load error on another route", async () => {
      const { handler, localCtx } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) throw new Error("Unexpected token in broken.ts");
        // A module with no HTTP exports: no error, just nothing to call.
        return Promise.resolve({});
      });

      const broken = await handler.handle(new Request("http://localhost/api/broken"), localCtx);
      assertEquals(broken?.status, 500);
      assertEquals(await broken?.text(), "Unexpected token in broken.ts");

      const empty = await handler.handle(new Request("http://localhost/api/empty"), localCtx);
      assertEquals(empty?.status, 500);
      assertEquals(await empty?.text(), "Handler not found");
    });

    it("does not coerce hostile rejected values while producing a bounded local 500", async () => {
      let messageReads = 0;
      let coercionCalls = 0;
      const hostile = Object.defineProperties({}, {
        message: {
          get() {
            messageReads++;
            throw new Error("message getter must not run");
          },
        },
        [Symbol.toPrimitive]: {
          value() {
            coercionCalls++;
            throw new Error("coercion hook must not run");
          },
        },
      });
      const { handler, localCtx } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) return Promise.reject(hostile);
        return Promise.resolve({});
      });

      const response = await handler.handle(
        new Request("http://localhost/api/broken"),
        localCtx,
      );
      const body = await response?.text() ?? "";

      assertEquals(response?.status, 500);
      assertEquals(body, "Unknown error");
      assertEquals(body.length <= 300, true);
      assertEquals(messageReads, 0);
      assertEquals(coercionCalls, 0);
    });

    // The load error names files, specifiers and build internals. It is a
    // development aid, and the only thing keeping it out of a deployed response
    // body is this flag.
    it("withholds the load error from a response when the project is not local", async () => {
      const { handler, localCtx } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) {
          throw new Error("Unexpected token in /srv/releases/17/pages/api/broken.ts");
        }
        return Promise.resolve({});
      });

      const hosted = await handler.handle(
        new Request("http://localhost/api/broken"),
        { ...localCtx, isLocalProject: false },
      );

      assertEquals(hosted?.status, 500);
      assertEquals(await hosted?.text(), "Handler not found");
    });

    it("fails closed when request locality cannot be read", async () => {
      const { handler, localCtx } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) {
          throw new Error("Unexpected token in /srv/releases/17/pages/api/broken.ts");
        }
        return Promise.resolve({});
      });
      const unreadableCtx = Object.defineProperty(
        { ...localCtx },
        "isLocalProject",
        {
          enumerable: true,
          get() {
            throw new Error("request locality unavailable");
          },
        },
      ) as HandlerContext;

      const hosted = await handler.handle(
        new Request("http://localhost/api/broken"),
        unreadableCtx,
      );

      assertEquals(hosted?.status, 500);
      assertEquals(await hosted?.text(), "Handler not found");
    });

    it("withholds the load error from a response when there is no context", async () => {
      const { handler } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) {
          throw new Error("Unexpected token in /srv/releases/17/pages/api/broken.ts");
        }
        return Promise.resolve({});
      });

      const anonymous = await handler.handle(new Request("http://localhost/api/broken"));

      assertEquals(anonymous?.status, 500);
      assertEquals(await anonymous?.text(), "Handler not found");
    });

    it("classifies the allow-list block against the current attempt only", async () => {
      const { handler } = await handlerWithTwoRoutes((modulePath) => {
        if (modulePath.includes("broken")) {
          throw new Error("Remote import blocked by allow-list: evil.example.com");
        }
        return Promise.resolve({});
      });

      const blocked = await handler.handle(new Request("http://localhost/api/broken"));
      assertEquals(blocked?.status, 502);

      const empty = await handler.handle(new Request("http://localhost/api/empty"));
      assertEquals(empty?.status, 500, "a later route inherited the allow-list classification");
    });
  });

  // AGENTS.md forbids local absolute paths, home directories, temp directories
  // and full stack traces in user-facing output. A dev-mode 500 body is
  // user-facing, and a raw module load error carries all four.
  describe("sanitizeLoadErrorForResponse", () => {
    const projectDir = "/PROJECT_ROOT/app";

    it("keeps the actionable first line", () => {
      const result = sanitizeLoadErrorForResponse(
        'Expected ";" but found "}"\n    at file:///PROJECT_ROOT/app/api/users.ts:12:3',
        projectDir,
      );

      assertEquals(result, 'Expected ";" but found "}"');
    });

    it("drops the stack trace", () => {
      const result = sanitizeLoadErrorForResponse(
        "Boom\n    at load (file:///PROJECT_ROOT/app/x.ts:1:1)\n    at run (x.ts:2:2)",
        projectDir,
      );

      assertEquals(result.includes("    at "), false);
    });

    it("makes a path inside the project relative", () => {
      const result = sanitizeLoadErrorForResponse(
        "Module not found: file:///PROJECT_ROOT/app/api/users.ts",
        projectDir,
      );

      assertEquals(result, "Module not found: api/users.ts");
    });

    it("redacts a temp directory the bundle was written to", () => {
      const result = sanitizeLoadErrorForResponse(
        "Could not resolve /var/folders/kx/T/vf-bundle-1234/route.js",
        projectDir,
      );

      assertEquals(result.includes("/var/folders/"), false);
      assertEquals(result.includes("<PATH>"), true);
    });

    it("redacts a home directory", () => {
      for (const path of ["/Users/someone/code/x.ts", "/home/someone/code/x.ts"]) {
        const result = sanitizeLoadErrorForResponse(`Cannot find module ${path}`, projectDir);

        assertEquals(result.includes("someone"), false, `leaked a home directory: ${result}`);
        assertEquals(result.includes("<PATH>"), true);
      }
    });

    it("redacts a file:// URL outside the project", () => {
      const result = sanitizeLoadErrorForResponse(
        "Failed to load file:///tmp/vf-9f/route.js",
        projectDir,
      );

      assertEquals(result.includes("file://"), false);
    });

    it("truncates a very long message", () => {
      const result = sanitizeLoadErrorForResponse("x".repeat(1000), projectDir);
      assertEquals(result.length <= 303, true);
      assertEquals(result.endsWith("..."), true);
    });

    it("handles an empty message and a missing project directory", () => {
      assertEquals(sanitizeLoadErrorForResponse(""), "");
      assertEquals(sanitizeLoadErrorForResponse("Handler not found"), "Handler not found");
    });
  });
});
