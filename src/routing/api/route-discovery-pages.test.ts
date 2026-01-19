import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { discoverPagesRoutes } from "./route-discovery.ts";
import { DynamicRouter } from "./api-route-matcher.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";

const routers: DynamicRouter[] = [];

function createRouter(): DynamicRouter {
  const router = new DynamicRouter();
  routers.push(router);
  return router;
}

afterEach(() => {
  while (routers.length > 0) {
    const router = routers.pop();
    router?.destroy();
  }
});

describe("route-discovery.ts - Pages Router Discovery", () => {
  describe("discoverPagesRoutes() - Basic File Discovery", () => {
    it("should discover a simple API route file", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "users.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users");
      assertEquals(routes[0]!.page, "/project/pages/api/users.ts");
    });

    it("should discover multiple API route files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "users.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "posts.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "comments.js", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 3);

      const patterns = routes.map((r) => r.pattern).sort();
      assertEquals(patterns, ["/api/comments", "/api/posts", "/api/users"]);
    });

    it("should discover index.ts as root route", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "index.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
      assertEquals(routes[0]!.page, "/project/pages/api/index.ts");
    });

    it("should handle index.js files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "index.js", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should handle all supported file extensions (.ts, .js, .tsx, .jsx)", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "typescript.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "javascript.js", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "tsx-file.tsx", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "jsx-file.jsx", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 4);

      const patterns = routes.map((r) => r.pattern).sort();
      assertEquals(patterns, [
        "/api/javascript",
        "/api/jsx-file",
        "/api/tsx-file",
        "/api/typescript",
      ]);
    });

    it("should ignore non-JS/TS files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "users.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "README.md", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "config.json", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "styles.css", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: ".env", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users");
    });

    it("should handle empty directory", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 0);
    });
  });

  describe("discoverPagesRoutes() - Nested Directories", () => {
    it("should discover routes in nested directories", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      let callCount = 0;
      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/pages/api") {
          callCount++;
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/users") {
          callCount++;
          yield { name: "profile.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      assertEquals(callCount, 2, "Should have recursed into subdirectory");
      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users/profile");
      assertEquals(routes[0]!.page, "/project/pages/api/users/profile.ts");
    });

    it("should handle deeply nested directories", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/pages/api") {
          yield { name: "v1", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/v1") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/v1/users") {
          yield { name: "admin", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/v1/users/admin") {
          yield { name: "index.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v1/users/admin");
    });

    it("should handle nested index files correctly", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/pages/api") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/users") {
          yield { name: "index.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users");
      assertEquals(routes[0]!.page, "/project/pages/api/users/index.ts");
    });

    it("should handle mixed files and directories", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/pages/api") {
          yield { name: "hello.ts", isFile: true, isDirectory: false, isSymlink: false };
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/users") {
          yield { name: "[id].ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 2);

      const patterns = routes.map((r) => r.pattern).sort();
      assertEquals(patterns, ["/api/hello", "/api/users/[id]"]);
    });
  });

  describe("discoverPagesRoutes() - Dynamic Routes", () => {
    it("should discover dynamic parameter routes [id]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "[id].ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[id]");
    });

    it("should discover nested dynamic routes", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/pages/api") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/users") {
          yield { name: "[id].ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users/[id]");
    });

    it("should discover catch-all routes [...slug]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "[...slug].ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[...slug]");
    });

    it("should discover optional catch-all routes [[...slug]]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "[[...slug]].ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[[...slug]]");
    });

    it("should discover multiple dynamic segments", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/pages/api") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/users") {
          yield { name: "[userId]", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/users/[userId]") {
          yield { name: "posts", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/users/[userId]/posts") {
          yield { name: "[postId].ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users/[userId]/posts/[postId]");
    });
  });

  describe("discoverPagesRoutes() - Edge Cases", () => {
    it("should handle routes with special characters in name", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "user-profile.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "get_data.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 2);

      const patterns = routes.map((r) => r.pattern).sort();
      assertEquals(patterns, ["/api/get_data", "/api/user-profile"]);
    });

    it("should handle numeric file names", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "123.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "v2.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 2);

      const patterns = routes.map((r) => r.pattern).sort();
      assertEquals(patterns, ["/api/123", "/api/v2"]);
    });

    it("should handle different prefix paths", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/custom";
      const prefix = "/custom";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "handler.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/custom/handler");
    });

    it("should handle empty prefix", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages";
      const prefix = "";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "index.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "");
    });

    it("should preserve full file paths correctly", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/very/long/path/to/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "test.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.page, "/very/long/path/to/project/pages/api/test.ts");
    });
  });

  describe("discoverPagesRoutes() - Integration with DynamicRouter", () => {
    it("should add routes that can be matched by DynamicRouter", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "users.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users");
      assertEquals(match.params, {});
    });

    it("should add dynamic routes that extract parameters", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/pages/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/pages/api") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/pages/api/users") {
          yield { name: "[id].ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverPagesRoutes(router, dir, prefix, adapter);

      const match = router.match("/api/users/123");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users/[id]");
      assertEquals(match.params, { id: "123" });
    });
  });
});
