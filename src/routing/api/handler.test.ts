import "#veryfront/schemas/_test-setup.ts";
import { SECURITY_VIOLATION } from "#veryfront/errors";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { HTTP_OK } from "#veryfront/utils";
import { __injectDepsForTests, APIRouteHandler } from "./handler.ts";
import { getConfig } from "#veryfront/config";
import { __resetPoolForTests } from "#veryfront/security/sandbox/worker-pool.ts";
import type { HandlerContext } from "#veryfront/types";

const handlers: APIRouteHandler[] = [];
const originalWorkerIsolationEnv = new Map(
  ["WORKER_ISOLATION_ENABLED", "WORKER_ISOLATION_API"].map((key) => [key, Deno.env.get(key)]),
);

function setAPIWorkerIsolation(enabled: boolean): void {
  const value = enabled ? "1" : "0";
  Deno.env.set("WORKER_ISOLATION_ENABLED", value);
  Deno.env.set("WORKER_ISOLATION_API", value);
  __resetPoolForTests();
}

function restoreWorkerIsolationEnv(): void {
  for (const [key, value] of originalWorkerIsolationEnv) {
    if (value === undefined) Deno.env.delete(key);
    else Deno.env.set(key, value);
  }
  __resetPoolForTests();
}

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

afterEach((): void => {
  while (handlers.length) handlers.pop()?.destroy();
  __injectDepsForTests(null);
  restoreWorkerIsolationEnv();
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

    it("should coalesce concurrent initialization", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test/project/pages/api/status.ts", "export const GET = () => null");
      let discoveryCalls = 0;
      __injectDepsForTests({
        discoverPagesRoutes: async () => {
          discoveryCalls++;
          await Promise.resolve();
        },
      });
      const handler = createHandler("/test/project", adapter);

      await Promise.all([handler.initialize(), handler.initialize()]);

      assertEquals(discoveryCalls, 1);
    });

    it("should propagate configuration failures instead of using implicit defaults", async () => {
      const adapter = createMockAdapter();
      __injectDepsForTests({
        getConfig: () => Promise.reject(new Error("configuration unavailable")),
      });
      const handler = createHandler("/test/project", adapter);

      await assertRejects(
        () => handler.initialize(),
        Error,
        "configuration unavailable",
      );
    });

    it("should load project configuration only once", async () => {
      const adapter = createMockAdapter();
      let configLoads = 0;
      __injectDepsForTests({
        getConfig: async (...args) => {
          configLoads++;
          return await getConfig(...args);
        },
      });
      const handler = createHandler("/test/project", adapter);

      await handler.initialize();

      assertEquals(configLoads, 1);
    });

    it("uses provided trusted config without loading an executable project config", async () => {
      const adapter = createMockAdapter();
      let configLoads = 0;
      __injectDepsForTests({
        getConfig: () => {
          configLoads++;
          return Promise.reject(new Error("remote config must not execute"));
        },
      });
      const handler = new APIRouteHandler(
        "/test/project",
        adapter,
        { title: "Trusted host config" } as never,
      );
      handlers.push(handler);

      await handler.initialize();

      assertEquals(configLoads, 0);
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

  describe("remote API isolation boundary", () => {
    it("rejects a matched remote route before loading its module when isolation is disabled", async () => {
      setAPIWorkerIsolation(false);
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/remote.ts",
        "export function GET() { return new Response('unsafe'); }",
      );
      let moduleLoads = 0;
      let executorCalls = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          moduleLoads++;
          return Promise.resolve({ GET: () => new Response("unsafe") });
        },
        executePagesRoute: async () => {
          executorCalls++;
          return new Response("unsafe");
        },
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/api/remote"),
        { isLocalProject: false } as HandlerContext,
      );

      assertEquals(response?.status, 503);
      assertEquals(await response?.text(), "Service Unavailable");
      assertEquals(response?.headers.get("Cache-Control"), "no-store");
      assertEquals(moduleLoads, 0);
      assertEquals(executorCalls, 0);
    });

    it("delegates a matched remote route to the executor without loading it in the host", async () => {
      setAPIWorkerIsolation(true);
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/remote.ts",
        "export function GET() { return new Response('isolated'); }",
      );
      let moduleLoads = 0;
      let executorCalls = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          moduleLoads++;
          return Promise.resolve({ GET: () => new Response("host") });
        },
        executePagesRoute: async (...args) => {
          executorCalls++;
          assertEquals(args[6]?.modulePath, "/test/project/pages/api/remote.ts");
          return new Response("isolated");
        },
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/api/remote"),
        { isLocalProject: false } as HandlerContext,
      );

      assertEquals(response?.status, 200);
      assertEquals(await response?.text(), "isolated");
      assertEquals(moduleLoads, 0);
      assertEquals(executorCalls, 1);
    });

    it("preserves in-process loading for local and unspecified project locality", async () => {
      setAPIWorkerIsolation(false);
      const adapter = createMockAdapter();
      adapter.fs.files.set(
        "/test/project/pages/api/local.ts",
        "export function GET() { return new Response('local'); }",
      );
      let moduleLoads = 0;
      let executorCalls = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          moduleLoads++;
          return Promise.resolve({ GET: () => new Response("local") });
        },
        executePagesRoute: async () => {
          executorCalls++;
          return new Response("local");
        },
      });
      const handler = await createInitializedHandler("/test/project", adapter);
      const request = new Request("http://localhost/api/local");

      const localResponse = await handler.handle(
        request,
        { isLocalProject: true } as HandlerContext,
      );
      const unspecifiedResponse = await handler.handle(request);

      assertEquals(localResponse?.status, 200);
      assertEquals(unspecifiedResponse?.status, 200);
      assertEquals(moduleLoads, 1);
      assertEquals(executorCalls, 2);
    });

    it("does not capture an unmatched non-API request from a remote project", async () => {
      setAPIWorkerIsolation(false);
      const adapter = createMockAdapter();
      let moduleLoads = 0;
      __injectDepsForTests({
        loadHandlerModule: () => {
          moduleLoads++;
          return Promise.resolve({ GET: () => new Response("unexpected") });
        },
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/about"),
        { isLocalProject: false } as HandlerContext,
      );

      assertEquals(response, null);
      assertEquals(moduleLoads, 0);
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

    it("should not capture OPTIONS requests outside API routes", async () => {
      const adapter = createMockAdapter();
      const handler = await createInitializedHandler("/test/project", adapter);

      const response = await handler.handle(
        new Request("http://localhost/about", { method: "OPTIONS" }),
      );

      assertEquals(response, null);
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

    it("should keep handler-load failures scoped to the current request", async () => {
      const adapter = createMockAdapter();
      adapter.fs.files.set("/test/project/pages/api/blocked.ts", "export const GET = () => null");
      adapter.fs.files.set("/test/project/pages/api/missing.ts", "export const GET = () => null");
      __injectDepsForTests({
        loadHandlerModule: ({ modulePath }) => {
          if (modulePath.endsWith("blocked.ts")) {
            return Promise.reject(
              SECURITY_VIOLATION.create({ message: "Remote import blocked by allow-list" }),
            );
          }
          return Promise.resolve(null);
        },
      });
      const handler = await createInitializedHandler("/test/project", adapter);

      const blocked = await handler.handle(new Request("http://localhost/api/blocked"));
      const missing = await handler.handle(new Request("http://localhost/api/missing"));

      assertEquals(blocked?.status, 502);
      assertEquals(missing?.status, 500);
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
});
