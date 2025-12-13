import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assert } from "std/assert/mod.ts";
import { getAppRouteEntity } from "./app-route-resolver.ts";

describe("app-route-resolver", () => {
  describe("getAppRouteEntity", () => {
    it("should find page.mdx in exact match", async () => {
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            if (path.includes("page.mdx")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.includes("page.mdx")) {
              return Promise.resolve("# Hello World");
            }
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "blog/post",
        mockAdapter as any,
        "app",
      );

      assertExists(entity);
      assertEquals(entity?.entity.slug, "blog/post");
      assertEquals(entity?.entity.type, "page");
    });

    it("should find page.tsx in exact match", async () => {
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            if (path.includes("page.tsx")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.includes("page.tsx")) {
              return Promise.resolve("export default function Page() {}");
            }
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "about",
        mockAdapter as any,
        "app",
      );

      assertExists(entity);
      assertEquals(entity?.entity.type, "page");
    });

    it("should handle frontmatter extraction", async () => {
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            if (path.includes("page.mdx")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.includes("page.mdx")) {
              return Promise.resolve(
                "---\ntitle: Test Page\nlayout: custom\n---\n# Content",
              );
            }
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "test",
        mockAdapter as any,
      );

      assertExists(entity);
      assert(entity?.entity.content.includes("# Content"));
      assertEquals(entity?.entity.frontmatter?.title, "Test Page");
    });

    it("should coerce boolean layout to string", async () => {
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            if (path.includes("page.mdx")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.includes("page.mdx")) {
              return Promise.resolve(
                "---\nlayout: true\n---\n# Content",
              );
            }
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "test",
        mockAdapter as any,
      );

      assertExists(entity);
      assertEquals(entity?.entity.frontmatter?.layout, "default");
    });

    it("should handle dynamic segments", async () => {
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            if (path.includes("[id]")) {
              return Promise.resolve({ isFile: false, isDirectory: true });
            }
            if (path.includes("page.tsx")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.includes("page.tsx")) {
              return Promise.resolve("export default function Page() {}");
            }
            return Promise.reject(new Error("Not found"));
          },
          readDir: async function* (path: string) {
            if (path.includes("blog")) {
              yield { name: "[id]", isDirectory: true, isFile: false };
            }
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "blog/123",
        mockAdapter as any,
      );

      assertExists(entity);
      assertEquals(entity?.entity.slug, "blog/123");
    });

    it("should handle catch-all segments", async () => {
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            if (path.includes("[...slug]")) {
              return Promise.resolve({ isFile: false, isDirectory: true });
            }
            if (path.includes("page.tsx")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.includes("page.tsx")) {
              return Promise.resolve("export default function Page() {}");
            }
            return Promise.reject(new Error("Not found"));
          },
          readDir: async function* (path: string) {
            if (path.includes("docs")) {
              yield { name: "[...slug]", isDirectory: true, isFile: false };
            }
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "docs/a/b/c",
        mockAdapter as any,
      );

      assertExists(entity);
      assertEquals(entity?.entity.slug, "docs/a/b/c");
    });

    it("should return null when no page found", async () => {
      const mockAdapter = {
        fs: {
          stat: () => Promise.reject(new Error("Not found")),
          readFile: () => Promise.reject(new Error("Not found")),
          readDir: async function* () {
            // Empty directory
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "nonexistent",
        mockAdapter as any,
      );

      assertEquals(entity, null);
    });

    it("should handle root path", async () => {
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            if (path.includes("page.tsx")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.includes("page.tsx")) {
              return Promise.resolve("export default function Home() {}");
            }
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "",
        mockAdapter as any,
      );

      assertExists(entity);
      assertEquals(entity?.entity.slug, "");
    });

    it("should try multiple file extensions", async () => {
      const attemptedFiles: string[] = [];
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            attemptedFiles.push(path);
            if (path.endsWith("page.js")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.endsWith("page.js")) {
              return Promise.resolve("export default function Page() {}");
            }
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "test",
        mockAdapter as any,
      );

      assertExists(entity);
      // Should try .mdx, .tsx, .jsx, .ts before finding .js
      assert(attemptedFiles.some(f => f.includes(".mdx")));
      assert(attemptedFiles.some(f => f.includes(".tsx")));
      assert(attemptedFiles.some(f => f.includes(".js")));
    });

    it("should handle custom app directory name", async () => {
      const mockAdapter = {
        fs: {
          stat: (path: string) => {
            if (path.includes("custom-app") && path.includes("page.tsx")) {
              return Promise.resolve({ isFile: true, isDirectory: false });
            }
            return Promise.reject(new Error("Not found"));
          },
          readFile: (path: string) => {
            if (path.includes("custom-app") && path.includes("page.tsx")) {
              return Promise.resolve("export default function Page() {}");
            }
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      const entity = await getAppRouteEntity(
        "/project",
        "test",
        mockAdapter as any,
        "custom-app",
      );

      assertExists(entity);
      assert(entity?.entity.id.includes("custom-app"));
    });
  });
});
