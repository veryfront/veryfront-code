import { describe, it } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assert } from "std/assert/mod.ts";
import * as React from "react";
import {
  RESERVED_COMPONENTS,
  collectAncestorDirs,
  createErrorBoundary,
  tryLoadReservedInDirs,
} from "./app-reserved.ts";

describe("app-reserved", () => {
  describe("RESERVED_COMPONENTS", () => {
    it("should export reserved component names", () => {
      assertEquals(RESERVED_COMPONENTS.loading, "loading.tsx");
      assertEquals(RESERVED_COMPONENTS.error, "error.tsx");
      assertEquals(RESERVED_COMPONENTS.notFound, "not-found.tsx");
    });
  });

  describe("collectAncestorDirs", () => {
    it("should collect ancestor directories from segment to app root", () => {
      const result = collectAncestorDirs("/app/src/pages/blog", "/app/src");
      assertExists(result);
      assert(result.length > 0);
      assert(result.includes("/app/src/pages/blog"));
      assert(result.includes("/app/src/pages"));
      assert(result.includes("/app/src"));
    });

    it("should normalize paths with backslashes", () => {
      const result = collectAncestorDirs("\\app\\src\\pages", "/app/src");
      assertExists(result);
      assert(result.length > 0);
    });

    it("should handle paths with trailing slashes", () => {
      const result = collectAncestorDirs("/app/src/pages/", "/app/src/");
      assertExists(result);
      // Function normalizes paths, so trailing slashes are removed
      assert(result.length > 0);
      assert(result.some(p => p.includes("pages")));
    });

    it("should stop at app root directory", () => {
      const result = collectAncestorDirs("/app/src/pages", "/app/src");
      const hasPathsAboveRoot = result.some(p => p === "/app" || p === "/");
      assertEquals(hasPathsAboveRoot, false);
    });

    it("should return empty array if segment is not under app root", () => {
      const result = collectAncestorDirs("/other/path", "/app/src");
      assertEquals(result, []);
    });

    it("should handle when segment equals app root", () => {
      const result = collectAncestorDirs("/app/src", "/app/src");
      assertEquals(result, ["/app/src"]);
    });
  });

  describe("createErrorBoundary", () => {
    it("should create an error boundary class component", () => {
      const ErrorComponent = () => React.createElement("div", null, "Error");
      const ErrorBoundary = createErrorBoundary(ErrorComponent);

      assertExists(ErrorBoundary);
      assertEquals(typeof ErrorBoundary, "function");
      assertExists(ErrorBoundary.getDerivedStateFromError);
    });

    it("should initialize with no error state", () => {
      const ErrorComponent = () => React.createElement("div", null, "Error");
      const ErrorBoundary = createErrorBoundary(ErrorComponent);
      const instance = new ErrorBoundary({ children: null });

      assertEquals(instance.state.hasError, false);
    });

    it("should derive error state from error", () => {
      const ErrorComponent = () => React.createElement("div", null, "Error");
      const ErrorBoundary = createErrorBoundary(ErrorComponent);
      const error = new Error("Test error");
      const state = ErrorBoundary.getDerivedStateFromError(error);

      assertEquals(state.hasError, true);
      assertEquals(state.error, error);
    });

    it("should render children when no error", () => {
      const ErrorComponent = () => React.createElement("div", null, "Error");
      const ErrorBoundary = createErrorBoundary(ErrorComponent);
      const child = React.createElement("p", null, "Child");
      const instance = new ErrorBoundary({ children: child });

      const rendered = instance.render();
      assertEquals(rendered, child);
    });

    it("should render error component when error occurs", () => {
      const ErrorComponent = () => React.createElement("div", null, "Error");
      const ErrorBoundary = createErrorBoundary(ErrorComponent);
      const instance = new ErrorBoundary({ children: null });

      instance.state = { hasError: true, error: new Error("Test") };
      const rendered = instance.render();

      assertExists(rendered);
    });

    it("should allow custom React implementation", () => {
      const ErrorComponent = () => React.createElement("div", null, "Error");
      const ErrorBoundary = createErrorBoundary(ErrorComponent, React);

      assertExists(ErrorBoundary);
      assertEquals(typeof ErrorBoundary, "function");
    });
  });

  describe("tryLoadReservedInDirs", () => {
    it("should return null when no reserved component found", async () => {
      const mockAdapter = {
        fs: {
          readFile: () => Promise.reject(new Error("Not found")),
        },
      };

      const result = await tryLoadReservedInDirs(
        ["/app/src"],
        "loading",
        "/app",
        "development",
        mockAdapter as any,
      );

      assertEquals(result, null);
    });

    it("should try both tsx and jsx extensions", async () => {
      const attemptedPaths: string[] = [];
      const mockAdapter = {
        fs: {
          readFile: (path: string) => {
            attemptedPaths.push(path);
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      await tryLoadReservedInDirs(
        ["/app/src"],
        "loading",
        "/app",
        "development",
        mockAdapter as any,
      );

      assert(attemptedPaths.some(p => p.includes(".tsx")));
      assert(attemptedPaths.some(p => p.includes(".jsx")));
    });

    it("should normalize directory and file paths", async () => {
      const attemptedPaths: string[] = [];
      const mockAdapter = {
        fs: {
          readFile: (path: string) => {
            attemptedPaths.push(path);
            return Promise.reject(new Error("Not found"));
          },
        },
      };

      await tryLoadReservedInDirs(
        ["/app/src/"],
        "error",
        "/app",
        "development",
        mockAdapter as any,
      );

      // Should normalize paths without double slashes
      assert(attemptedPaths.every(p => !p.includes("//")));
    });
  });
});
