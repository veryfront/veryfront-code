import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { discoverAppRoutes } from "./route-discovery.ts";
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

describe("route-discovery.ts - App Router Discovery", () => {
  describe("discoverAppRoutes() - Basic Discovery", () => {
    it("should discover route.ts files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
      assertEquals(routes[0]!.page, "/project/app/api/route.ts");
    });

    it("should discover route.js files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "route.js", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should discover route.tsx files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "route.tsx", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should discover route.jsx files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "route.jsx", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should ignore non-route files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "page.tsx", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "layout.tsx", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "loading.tsx", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "error.tsx", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "not-found.tsx", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "helpers.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 0, "Should not discover non-route files");
    });

    it("should handle empty directory", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 0);
    });

    it("should handle root-level route.ts with empty prefix", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app";
      const prefix = "";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/");
    });
  });

  describe("discoverAppRoutes() - Nested Routes", () => {
    it("should discover routes in nested directories", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users");
      assertEquals(routes[0]!.page, "/project/app/api/users/route.ts");
    });

    it("should discover routes in deeply nested directories", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "v1", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/v1") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/v1/users") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v1/users");
    });

    it("should discover multiple routes at different levels", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 2);

      const patterns = routes.map((r) => r.pattern).sort();
      assertEquals(patterns, ["/api", "/api/users"]);
    });

    it("should recurse through directories without route files", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "v1", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/v1") {
          yield { name: "admin", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/v1/admin") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v1/admin");
    });
  });

  describe("discoverAppRoutes() - Dynamic Routes", () => {
    it("should discover dynamic parameter routes [id]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "[id]", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/[id]") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[id]");
    });

    it("should discover catch-all routes [...slug]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "[...slug]", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/[...slug]") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[...slug]");
    });

    it("should discover optional catch-all routes [[...slug]]", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "[[...slug]]", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/[[...slug]]") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/[[...slug]]");
    });

    it("should discover nested dynamic routes", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users") {
          yield { name: "[userId]", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users/[userId]") {
          yield { name: "posts", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users/[userId]/posts") {
          yield { name: "[postId]", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users/[userId]/posts/[postId]") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/users/[userId]/posts/[postId]");
    });
  });

  describe("discoverAppRoutes() - Edge Cases", () => {
    it("should handle directories with special characters", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "user-profile", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/user-profile") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/user-profile");
    });

    it("should handle numeric directory names", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "v2", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/v2") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/api/v2");
    });

    it("should only match exact route file names", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "routes.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "route-handler.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "route.backup.ts", isFile: true, isDirectory: false, isSymlink: false };
        yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1, "Should only match exact route.ts name");
      assertEquals(routes[0]!.pattern, "/api");
    });

    it("should preserve full file paths correctly", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/very/long/path/to/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.page, "/very/long/path/to/project/app/api/route.ts");
    });

    it("should handle different prefix paths", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/custom";
      const prefix = "/custom";

      adapter.fs.readDir = async function* (_path: string) {
        yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const routes = router.listRoutes();
      assertEquals(routes.length, 1);
      assertEquals(routes[0]!.pattern, "/custom");
    });
  });

  describe("discoverAppRoutes() - Integration with DynamicRouter", () => {
    it("should add routes that can be matched by DynamicRouter", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const match = router.match("/api/users");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users");
      assertEquals(match.params, {});
    });

    it("should add dynamic routes that extract parameters", async () => {
      const adapter = createMockAdapter();
      const router = createRouter();
      const dir = "/project/app/api";
      const prefix = "/api";

      adapter.fs.readDir = async function* (path: string) {
        if (path === "/project/app/api") {
          yield { name: "users", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users") {
          yield { name: "[id]", isFile: false, isDirectory: true, isSymlink: false };
        } else if (path === "/project/app/api/users/[id]") {
          yield { name: "route.ts", isFile: true, isDirectory: false, isSymlink: false };
        }
      };

      await discoverAppRoutes(router, dir, prefix, adapter);

      const match = router.match("/api/users/42");
      assertExists(match);
      assertEquals(match.route.pattern, "/api/users/[id]");
      assertEquals(match.params, { id: "42" });
    });
  });
});
