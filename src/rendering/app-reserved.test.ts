import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { collectAncestorDirs, createErrorBoundary, RESERVED_COMPONENTS } from "./app-reserved.ts";
import * as React from "react";

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

    it("should handle identical segment and root", () => {
      const dirs = collectAncestorDirs("/root", "/root");
      assertEquals(dirs.length, 1);
      assertEquals(dirs[0], "/root");
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
