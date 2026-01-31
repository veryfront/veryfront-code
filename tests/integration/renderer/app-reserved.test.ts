/**
 * Comprehensive Tests for App Reserved Components (app-reserved.ts)
 * Handles loading reserved App Router components (loading, error, not-found)
 * Total: 6 tests
 */

import { assertEquals, assertExists } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import {
  collectAncestorDirs,
  createErrorBoundary,
  RESERVED_COMPONENTS,
} from "@veryfront/rendering/app-reserved.ts";

describe("App Reserved Components", () => {
  describe("collectAncestorDirs", () => {
    it("should collect ancestor directories from nested path", () => {
      const dirs = collectAncestorDirs("/project/pages/blog", "/project");
      assertEquals(dirs.length, 3);
      assertEquals(dirs[0], "/project/pages/blog");
      assertEquals(dirs[1], "/project/pages");
      assertEquals(dirs[2], "/project");
    });

    it("should handle root directory correctly", () => {
      const dirs = collectAncestorDirs("/project", "/project");
      assertEquals(dirs.length, 1);
      assertEquals(dirs[0], "/project");
    });

    it("should handle same directory as root", () => {
      const dirs = collectAncestorDirs("/app", "/app");
      assertEquals(dirs.length, 1);
      assertEquals(dirs[0], "/app");
    });

    it("should collect all ancestors from deeply nested path", () => {
      const dirs = collectAncestorDirs(
        "/project/pages/blog/[id]/comments",
        "/project",
      );
      assertEquals(dirs.length, 5);
      assertEquals(dirs[0], "/project/pages/blog/[id]/comments");
      assertEquals(dirs[1], "/project/pages/blog/[id]");
      assertEquals(dirs[2], "/project/pages/blog");
      assertEquals(dirs[3], "/project/pages");
      assertEquals(dirs[4], "/project");
    });
  });

  describe("createErrorBoundary", () => {
    it("should create proper React error boundary class component", () => {
      const TestComponent = () => "test";
      const ErrorBoundary = createErrorBoundary(TestComponent);

      assertExists(ErrorBoundary);
      assertEquals(typeof ErrorBoundary, "function");
      assertEquals(ErrorBoundary.name, "ErrorBoundary");

      const ErrorBoundaryClass = ErrorBoundary as typeof ErrorBoundary & {
        getDerivedStateFromError: (
          error: Error,
        ) => { hasError: boolean; error?: Error };
      };

      assertExists(ErrorBoundaryClass.getDerivedStateFromError);
      assertEquals(typeof ErrorBoundaryClass.getDerivedStateFromError, "function");

      const error = new Error("Test error");
      const errorState = ErrorBoundaryClass.getDerivedStateFromError(error);
      assertEquals(errorState.hasError, true);
      assertEquals(errorState.error, error);
    });
  });

  describe("RESERVED_COMPONENTS", () => {
    it("should contain all required reserved component mappings", () => {
      assertEquals(RESERVED_COMPONENTS.loading, "loading.tsx");
      assertEquals(RESERVED_COMPONENTS.error, "error.tsx");
      assertEquals(RESERVED_COMPONENTS.notFound, "not-found.tsx");
      assertEquals(Object.keys(RESERVED_COMPONENTS).length, 3);
    });
  });
});
