import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { DynamicRouter } from "./api-route-matcher.ts";
import { discoverAppRoutes } from "./route-discovery.ts";

const routers: DynamicRouter[] = [];

function createRouter(): DynamicRouter {
  const router = new DynamicRouter();
  routers.push(router);
  return router;
}

type DirEntry = {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
};

function file(name: string): DirEntry {
  return { name, isFile: true, isDirectory: false, isSymlink: false };
}

function dir(name: string): DirEntry {
  return { name, isFile: false, isDirectory: true, isSymlink: false };
}

function setReadDir(
  adapter: ReturnType<typeof createMockAdapter>,
  entriesByPath: Record<string, DirEntry[]>,
): void {
  adapter.fs.readDir = async function* (path: string) {
    for (const entry of entriesByPath[path] ?? []) yield entry;
  };
}

afterEach((): void => {
  while (routers.length) routers.pop()?.destroy();
});

describe("route-discovery.ts - App Router Discovery", () => {
  describe("discoverAppRoutes() - Basic Discovery", () => {
    it("should discover route.ts files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, { "/project/app/api": [file("route.ts")] });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
      assertEquals(routes[0]!.page, "/project/app/api/route.ts");
    });

    it("should discover route.js files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, { "/project/app/api": [file("route.js")] });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should discover route.tsx files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, { "/project/app/api": [file("route.tsx")] });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should discover route.jsx files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, { "/project/app/api": [file("route.jsx")] });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should ignore non-route files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [
          file("page.tsx"),
          file("layout.tsx"),
          file("loading.tsx"),
          file("error.tsx"),
          file("not-found.tsx"),
          file("helpers.ts"),
        ],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 0, "Should not discover non-route files");
    });

    it("should handle empty directory", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, { "/project/app/api": [] });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 0);
    });

    it("should handle root-level route.ts with empty prefix", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, { "/project/app": [file("route.ts")] });

      await discoverAppRoutes(router, "/project/app", "", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/");
    });
  });

  describe("discoverAppRoutes() - Nested Routes", () => {
    it("should discover routes in nested directories", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("users")],
        "/project/app/api/users": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users");
      assertEquals(routes[0]!.page, "/project/app/api/users/route.ts");
    });

    it("should discover routes in deeply nested directories", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("v1")],
        "/project/app/api/v1": [dir("users")],
        "/project/app/api/v1/users": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v1/users");
    });

    it("should discover multiple routes at different levels", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [file("route.ts"), dir("users")],
        "/project/app/api/users": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 2);

      const patterns = routes.map((r) => r.pattern).sort();
      assertEquals(patterns, ["/api", "/api/users"]);
    });

    it("should recurse through directories without route files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("v1")],
        "/project/app/api/v1": [dir("admin")],
        "/project/app/api/v1/admin": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v1/admin");
    });
  });

  describe("discoverAppRoutes() - Dynamic Routes", () => {
    it("should discover dynamic parameter routes [id]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("[id]")],
        "/project/app/api/[id]": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[id]");
    });

    it("should discover catch-all routes [...slug]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("[...slug]")],
        "/project/app/api/[...slug]": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[...slug]");
    });

    it("should discover optional catch-all routes [[...slug]]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("[[...slug]]")],
        "/project/app/api/[[...slug]]": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[[...slug]]");
    });

    it("should discover nested dynamic routes", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("users")],
        "/project/app/api/users": [dir("[userId]")],
        "/project/app/api/users/[userId]": [dir("posts")],
        "/project/app/api/users/[userId]/posts": [dir("[postId]")],
        "/project/app/api/users/[userId]/posts/[postId]": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users/[userId]/posts/[postId]");
    });
  });

  describe("discoverAppRoutes() - Edge Cases", () => {
    it("should handle directories with special characters", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("user-profile")],
        "/project/app/api/user-profile": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/user-profile");
    });

    it("should handle numeric directory names", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("v2")],
        "/project/app/api/v2": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v2");
    });

    it("should only match exact route file names", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [
          file("routes.ts"),
          file("route-handler.ts"),
          file("route.backup.ts"),
          file("route.ts"),
        ],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1, "Should only match exact route.ts name");
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should preserve full file paths correctly", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, { "/very/long/path/to/project/app/api": [file("route.ts")] });

      await discoverAppRoutes(router, "/very/long/path/to/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.page, "/very/long/path/to/project/app/api/route.ts");
    });

    it("should handle different prefix paths", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, { "/project/app/custom": [file("route.ts")] });

      await discoverAppRoutes(router, "/project/app/custom", "/custom", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/custom");
    });
  });

  describe("discoverAppRoutes() - Integration with DynamicRouter", () => {
    it("should add routes that can be matched by DynamicRouter", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("users")],
        "/project/app/api/users": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users");
      assertEquals(match.params, {});
    });

    it("should add dynamic routes that extract parameters", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      setReadDir(adapter, {
        "/project/app/api": [dir("users")],
        "/project/app/api/users": [dir("[id]")],
        "/project/app/api/users/[id]": [file("route.ts")],
      });

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const match = router.match("/api/users/42");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users/[id]");
      assertEquals(match.params, { id: "42" });
    });
  });
});
