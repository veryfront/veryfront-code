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

function file(name: string) {
  return { name, isFile: true, isDirectory: false, isSymlink: false };
}

function dir(name: string) {
  return { name, isFile: false, isDirectory: true, isSymlink: false };
}

afterEach(() => {
  while (routers.length) routers.pop()?.destroy();
});

describe("route-discovery.ts - App Router Discovery", () => {
  describe("discoverAppRoutes() - Basic Discovery", () => {
    it("should discover route.ts files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
      assertEquals(routes[0]!.page, "/project/app/api/route.ts");
    });

    it("should discover route.js files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("route.js");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should discover route.tsx files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("route.tsx");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should discover route.jsx files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("route.jsx");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should ignore non-route files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("page.tsx");
        yield file("layout.tsx");
        yield file("loading.tsx");
        yield file("error.tsx");
        yield file("not-found.tsx");
        yield file("helpers.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 0, "Should not discover non-route files");
    });

    it("should handle empty directory", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {};

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 0);
    });

    it("should handle root-level route.ts with empty prefix", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("route.ts");
      };

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

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("users");
        if (path === "/project/app/api/users") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users");
      assertEquals(routes[0]!.page, "/project/app/api/users/route.ts");
    });

    it("should discover routes in deeply nested directories", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("v1");
        if (path === "/project/app/api/v1") yield dir("users");
        if (path === "/project/app/api/v1/users") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v1/users");
    });

    it("should discover multiple routes at different levels", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield file("route.ts");
          yield dir("users");
        }
        if (path === "/project/app/api/users") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 2);

      const patterns = routes.map((r) => r.pattern).sort();
      assertEquals(patterns, ["/api", "/api/users"]);
    });

    it("should recurse through directories without route files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("v1");
        if (path === "/project/app/api/v1") yield dir("admin");
        if (path === "/project/app/api/v1/admin") yield file("route.ts");
      };

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

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("[id]");
        if (path === "/project/app/api/[id]") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[id]");
    });

    it("should discover catch-all routes [...slug]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("[...slug]");
        if (path === "/project/app/api/[...slug]") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[...slug]");
    });

    it("should discover optional catch-all routes [[...slug]]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("[[...slug]]");
        if (path === "/project/app/api/[[...slug]]") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[[...slug]]");
    });

    it("should discover nested dynamic routes", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("users");
        if (path === "/project/app/api/users") yield dir("[userId]");
        if (path === "/project/app/api/users/[userId]") yield dir("posts");
        if (path === "/project/app/api/users/[userId]/posts") yield dir("[postId]");
        if (path === "/project/app/api/users/[userId]/posts/[postId]") yield file("route.ts");
      };

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

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("user-profile");
        if (path === "/project/app/api/user-profile") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/user-profile");
    });

    it("should handle numeric directory names", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("v2");
        if (path === "/project/app/api/v2") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v2");
    });

    it("should only match exact route file names", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("routes.ts");
        yield file("route-handler.ts");
        yield file("route.backup.ts");
        yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1, "Should only match exact route.ts name");
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should preserve full file paths correctly", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("route.ts");
      };

      await discoverAppRoutes(router, "/very/long/path/to/project/app/api", "/api", adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.page, "/very/long/path/to/project/app/api/route.ts");
    });

    it("should handle different prefix paths", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (_path: string) {
        yield file("route.ts");
      };

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

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("users");
        if (path === "/project/app/api/users") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users");
      assertEquals(match.params, {});
    });

    it("should add dynamic routes that extract parameters", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") yield dir("users");
        if (path === "/project/app/api/users") yield dir("[id]");
        if (path === "/project/app/api/users/[id]") yield file("route.ts");
      };

      await discoverAppRoutes(router, "/project/app/api", "/api", adapter);

      const match = router.match("/api/users/42");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users/[id]");
      assertEquals(match.params, { id: "42" });
    });
  });
});
