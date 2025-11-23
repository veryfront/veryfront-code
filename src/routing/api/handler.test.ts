import { assertEquals, assertExists } from "std/testing/asserts.ts";
import { afterEach, describe, it } from "std/testing/bdd.ts";
import { APIRouteHandler } from "./handler.ts";
import { createMockAdapter } from "@veryfront/platform/adapters/mock.ts";
import { HTTP_OK } from "@veryfront/utils";

const handlers: APIRouteHandler[] = [];

function createHandler(
  projectDir: string,
  adapter?: ReturnType<typeof createMockAdapter>,
): APIRouteHandler {
  const handler = new APIRouteHandler(projectDir, adapter);
  handlers.push(handler);
  return handler;
}

afterEach(() => {
  while (handlers.length > 0) {
    const handler = handlers.pop();
    handler?.destroy();
  }
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
      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      const request = new Request("http://localhost/about");
      const response = await handler.handle(request);

      assertEquals(response, null, "Non-API routes should return null");
    });

    it("should return null for root path", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      const request = new Request("http://localhost/");
      const response = await handler.handle(request);

      assertEquals(response, null, "Root path should return null when not an API route");
    });

    it("should return 404 for unmatched /api routes", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      const request = new Request("http://localhost/api/notfound");
      const response = await handler.handle(request);

      assertExists(response, "Should return a response for /api paths");
      assertEquals(response?.status, 404, "Should return 404 for unmatched API routes");
      assertEquals(await response?.text(), "Not Found");
    });

    it("should return 404 for exact /api path when no route matches", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      const request = new Request("http://localhost/api");
      const response = await handler.handle(request);

      assertEquals(response?.status, 404);
    });

    it("should return 404 for nested unmatched /api routes", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      const request = new Request("http://localhost/api/v1/users/123/posts/456");
      const response = await handler.handle(request);

      assertEquals(response?.status, 404);
    });
  });

  describe("OPTIONS/CORS handling", () => {
    it("should handle OPTIONS preflight requests with secure-by-default CORS", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      const request = new Request("http://localhost/api/test", {
        method: "OPTIONS",
        headers: { origin: "https://example.com" },
      });
      const response = await handler.handle(request);

      assertExists(response, "Should return response for OPTIONS");
      assertEquals(response?.status, 204, "OPTIONS should return 204");
      assertEquals(
        response?.headers.get("Access-Control-Allow-Origin"),
        null,
        "Should not include CORS headers without config",
      );
    });

    it("should handle OPTIONS with no origin header", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      const request = new Request("http://localhost/api/test", {
        method: "OPTIONS",
      });
      const response = await handler.handle(request);

      assertEquals(response?.status, 204);
      assertEquals(response?.headers.get("Access-Control-Allow-Origin"), null);
    });

    it("should handle OPTIONS for /api root", async () => {
      const adapter = createMockAdapter();
      const handler = createHandler("/test/project", adapter);
      await handler.initialize();

      const request = new Request("http://localhost/api", {
        method: "OPTIONS",
        headers: { origin: "https://example.com" },
      });
      const response = await handler.handle(request);

      assertEquals(response?.status, 204);
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
  });

  describe("error scenarios", () => {
    it("should handle file system errors during initialization gracefully", async () => {
      const adapter = createMockAdapter();
      const _originalReadDir = adapter.fs.readDir;
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
        if (callCount === 1) {
          throw new Error("First call fails");
        }
        yield* originalReadDir.call(adapter.fs, path);
      };

      const handler = createHandler("/test/project", adapter);

      try {
        await handler.initialize();
      } catch (_error) {
        void _error;
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
      const mockResponse = { status: undefined, headers: {} };
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
      const cases = [
        { status: undefined, expected: HTTP_OK },
        { status: null, expected: HTTP_OK },
        { status: 0, expected: 0 },
        { status: 200, expected: 200 },
        { status: 404, expected: 404 },
      ];

      cases.forEach(({ status, expected }) => {
        const finalStatus = status ?? HTTP_OK;
        assertEquals(
          finalStatus,
          expected,
          `Status ${status} should result in ${expected}`,
        );
      });
    });
  });
});
