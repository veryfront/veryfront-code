import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectAncestorDirs,
  createErrorBoundary,
  loadReservedWithPath,
  RESERVED_COMPONENTS,
} from "./app-reserved.ts";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

describe("rendering/app-reserved", () => {
  describe("RESERVED_COMPONENTS", () => {
    it("should define loading, error, and notFound components", () => {
      assertEquals(RESERVED_COMPONENTS.loading, "loading.tsx");
      assertEquals(RESERVED_COMPONENTS.error, "error.tsx");
      assertEquals(RESERVED_COMPONENTS.notFound, "not-found.tsx");
    });

    it("should have exactly 3 reserved component types", () => {
      assertEquals(Object.keys(RESERVED_COMPONENTS).length, 3);
    });
  });

  describe("collectAncestorDirs", () => {
    it("should collect dirs from segment to root", () => {
      const dirs = collectAncestorDirs("/app/blog/posts", "/app");
      assertEquals(dirs.includes("/app/blog/posts"), true);
      assertEquals(dirs.includes("/app/blog"), true);
      assertEquals(dirs.includes("/app"), true);
    });

    it("should return only segment dir when at root", () => {
      const dirs = collectAncestorDirs("/app", "/app");
      assertEquals(dirs, ["/app"]);
    });

    it("should handle deeply nested paths", () => {
      const dirs = collectAncestorDirs("/project/app/a/b/c", "/project/app");
      assertEquals(dirs.length, 4);
      assertEquals(dirs[0], "/project/app/a/b/c");
      assertEquals(dirs[dirs.length - 1], "/project/app");
    });

    it("should stop at app root boundary", () => {
      const dirs = collectAncestorDirs("/project/app/page", "/project/app");
      for (const dir of dirs) {
        assertEquals(dir.startsWith("/project/app"), true);
      }
    });

    it("should normalize trailing slashes", () => {
      const dirs = collectAncestorDirs("/app/blog/", "/app");
      assertEquals(dirs[0]?.endsWith("/"), false);
    });

    it("should return empty array for path outside root", () => {
      const dirs = collectAncestorDirs("/other/path", "/app");
      assertEquals(dirs.length, 0);
    });

    it("rejects prefix-colliding paths outside the app root", () => {
      assertEquals(
        collectAncestorDirs("/project/application/blog", "/project/app"),
        [],
      );
    });

    it("should handle identical segment and root", () => {
      const dirs = collectAncestorDirs("/root", "/root");
      assertEquals(dirs.length, 1);
      assertEquals(dirs[0], "/root");
    });
  });

  describe("loadReservedWithPath", () => {
    function adapterWithReader(
      readFile: (path: string) => Promise<string>,
    ): RuntimeAdapter {
      return {
        fs: { readFile },
      } as unknown as RuntimeAdapter;
    }

    it("propagates operational reads instead of treating the component as absent", async () => {
      const adapter = adapterWithReader(() =>
        Promise.reject(Object.assign(new Error("reserved backend unavailable"), {
          code: "EIO",
        }))
      );

      await assertRejects(
        () =>
          loadReservedWithPath(
            ["/project/app"],
            "loading",
            "/project",
            "production",
            adapter,
          ),
        Error,
        "reserved backend unavailable",
      );
    });

    it("does not fall through to an ancestor when the nearer component is invalid", async () => {
      const reads: string[] = [];
      const adapter = adapterWithReader((path) => {
        reads.push(path);
        if (path === "/project/app/blog/loading.tsx") {
          return Promise.resolve("export const value = 1");
        }
        if (path === "/project/app/loading.tsx") {
          return Promise.resolve("export default function Loading() {}");
        }
        return Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }));
      });

      await assertRejects(
        () =>
          loadReservedWithPath(
            ["/project/app/blog", "/project/app"],
            "loading",
            "/project",
            "production",
            adapter,
            undefined,
            undefined,
            undefined,
            undefined,
            {
              loadComponentFromSource: () => Promise.resolve(null),
            },
          ),
        TypeError,
        "React component",
      );
      assertEquals(reads.includes("/project/app/loading.tsx"), false);
    });

    it("uses the requested runtime mode when compiling a reserved component", async () => {
      let receivedDev: boolean | undefined;
      const adapter = adapterWithReader((path) =>
        path === "/project/app/loading.tsx"
          ? Promise.resolve("export default function Loading() {}")
          : Promise.reject(Object.assign(new Error("missing"), { code: "ENOENT" }))
      );

      const result = await loadReservedWithPath(
        ["/project/app"],
        "loading",
        "/project",
        "production",
        adapter,
        "project",
        "content",
        "19.2.4",
        undefined,
        {
          loadComponentFromSource: (_source, _path, _root, _adapter, options) => {
            receivedDev = options?.dev;
            return Promise.resolve(() => null);
          },
        },
      );

      assertEquals(result?.filePath, "/project/app/loading.tsx");
      assertEquals(receivedDev, false);
    });
  });

  describe("createErrorBoundary", () => {
    it("should create a class component", () => {
      function MockErrorComponent() {
        return React.createElement("div", null, "error fallback");
      }
      const Boundary = createErrorBoundary(MockErrorComponent);
      assertEquals(typeof Boundary, "function");
    });

    it("should render children when no error", () => {
      function MockErrorComponent() {
        return React.createElement("div", null, "error");
      }
      const Boundary = createErrorBoundary(MockErrorComponent);
      const instance = new Boundary({ children: React.createElement("span", null, "child") });
      instance.state = { hasError: false };
      const rendered = instance.render();
      assertEquals(rendered, instance.props.children);
    });

    it("should have getDerivedStateFromError static method", () => {
      function MockErrorComponent() {
        return null;
      }
      const Boundary = createErrorBoundary(MockErrorComponent);
      const state = (Boundary as any).getDerivedStateFromError(new Error("test"));
      assertEquals(state.hasError, true);
      assertEquals(state.error instanceof Error, true);
    });

    it("should accept custom React library", () => {
      function MockErrorComponent() {
        return null;
      }
      const customReact = { createElement: React.createElement };
      const Boundary = createErrorBoundary(MockErrorComponent, customReact);
      assertEquals(typeof Boundary, "function");
    });
  });
});
