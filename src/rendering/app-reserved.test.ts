import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  collectAncestorDirs,
  createErrorBoundary,
  loadReservedWithPath,
  RESERVED_COMPONENTS,
} from "./app-reserved.ts";
import * as React from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
import { isVeryfrontError } from "#veryfront/errors";

describe("rendering/app-reserved", () => {
  it("returns null when reserved component candidates are absent", async () => {
    const adapter = {
      fs: {
        readFile: () =>
          Promise.reject(
            FILE_NOT_FOUND.create({
              detail: "Reserved component not found",
              context: { operation: "read" },
            }),
          ),
      },
    } as unknown as RuntimeAdapter;

    const result = await loadReservedWithPath(
      ["/project/app"],
      "loading",
      "/project",
      { compileMode: "production", environment: "production" },
      adapter,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        loadComponentFromSource: () => {
          throw new Error("component loader must not run for a missing file");
        },
      },
    );

    assertEquals(result, null);
  });

  it("sanitizes reserved component compilation failures", async () => {
    const projectDir = "/<PROJECT_DIR>";
    const privatePath = `${projectDir}/app/loading.tsx`;
    const failure = new Error(`No component exported from ${privatePath}`);
    const adapter = {
      fs: {
        readFile: (path: string) =>
          path.endsWith("loading.tsx")
            ? Promise.resolve("export default function Loading() { return null; }")
            : Promise.reject(
              FILE_NOT_FOUND.create({
                detail: "Reserved component not found",
                context: { operation: "read" },
              }),
            ),
      },
    } as unknown as RuntimeAdapter;

    const error = await assertRejects(() =>
      loadReservedWithPath(
        [`${projectDir}/app`],
        "loading",
        projectDir,
        { compileMode: "production", environment: "production" },
        adapter,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        { loadComponentFromSource: () => Promise.reject(failure) },
      )
    );

    assertEquals(isVeryfrontError(error), true);
    if (!isVeryfrontError(error)) throw error;
    assertEquals(error.slug, "component-error");
    assertEquals(error.message, "Reserved component could not be loaded");
    assertEquals(error.message.includes(privatePath), false);
    assertStrictEquals(error.cause, failure);
  });

  it("sanitizes reserved component read failures", async () => {
    const projectDir = "/<PROJECT_DIR>";
    const privatePath = `${projectDir}/app/loading.tsx`;
    const failure = Object.assign(new Error(`EACCES: permission denied, open '${privatePath}'`), {
      code: "EACCES",
    });
    const adapter = {
      fs: {
        readFile: () => Promise.reject(failure),
      },
    } as unknown as RuntimeAdapter;

    const error = await assertRejects(() =>
      loadReservedWithPath(
        [`${projectDir}/app`],
        "loading",
        projectDir,
        { compileMode: "production", environment: "production" },
        adapter,
      )
    );

    assertEquals(isVeryfrontError(error), true);
    if (!isVeryfrontError(error)) throw error;
    assertEquals(error.slug, "component-error");
    assertEquals(error.message, "Reserved component could not be read");
    assertEquals(error.message.includes(privatePath), false);
    assertStrictEquals(error.cause, failure);
  });

  it("does not search reserved component paths after request cancellation", async () => {
    let reads = 0;
    const adapter = {
      fs: {
        readFile: () => {
          reads++;
          return Promise.reject(new Error("not found"));
        },
      },
    } as unknown as RuntimeAdapter;
    const controller = new AbortController();
    controller.abort(new DOMException("render cancelled", "AbortError"));

    try {
      await loadReservedWithPath(
        ["/project/app/blog", "/project/app"],
        "loading",
        "/project",
        { compileMode: "development", environment: "preview" },
        adapter,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller.signal,
      );
      throw new Error("Expected reserved component loading to reject after cancellation");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      assertEquals(error.name, "AbortError");
      assertEquals(
        error.message === "render cancelled" || error.message === "The operation was aborted",
        true,
      );
    }
    assertEquals(reads, 0);
  });

  it("stops the reserved component search when the loader is cancelled", async () => {
    let reads = 0;
    const adapter = {
      fs: {
        readFile: () => {
          reads++;
          return Promise.resolve("source");
        },
      },
    } as unknown as RuntimeAdapter;
    const controller = new AbortController();

    try {
      await loadReservedWithPath(
        ["/project/app/blog", "/project/app"],
        "loading",
        "/project",
        { compileMode: "development", environment: "preview" },
        adapter,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        controller.signal,
        {
          loadComponentFromSource: () => {
            controller.abort(new DOMException("render cancelled", "AbortError"));
            throw new Error("load failed");
          },
        } as never,
      );
      throw new Error("Expected reserved component loading to reject after cancellation");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      assertEquals(
        error.name,
        "AbortError",
        "a signal aborted inside the loader must propagate instead of being swallowed by the candidate catch",
      );
    }

    assertEquals(
      reads,
      1,
      "the reserved-component search must stop at the first candidate once the render is cancelled",
    );
  });

  it("normalizes a host signal that has no abort reason", async () => {
    const signal = {
      aborted: true,
      reason: undefined,
      throwIfAborted: () => {
        throw undefined;
      },
    } as unknown as AbortSignal;

    try {
      await loadReservedWithPath(
        [],
        "loading",
        "/project",
        { compileMode: "development", environment: "preview" },
        {} as RuntimeAdapter,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        signal,
      );
      throw new Error("Expected reserved component loading to reject after cancellation");
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      assertEquals(error.name, "AbortError");
      assertEquals(error.message, "The operation was aborted");
    }
  });

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

    it("should return empty array for a sibling that shares the root prefix", () => {
      const dirs = collectAncestorDirs(
        "/project/application/blog",
        "/project/app",
      );
      assertEquals(dirs, []);
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
      const Boundary = createErrorBoundary(MockErrorComponent) as
        & ReturnType<
          typeof createErrorBoundary
        >
        & {
          getDerivedStateFromError(error: Error): { hasError: boolean; error?: Error };
        };
      const state = Boundary.getDerivedStateFromError(new Error("test"));
      assertEquals(state.hasError, true);
      assertEquals(state.error instanceof Error, true);
    });

    it("should mint the fallback with the supplied React library", () => {
      function MockErrorComponent() {
        return null;
      }
      const calls: Array<[unknown, Record<string, unknown>]> = [];
      const customReact = {
        createElement: ((type: unknown, props: Record<string, unknown>) => {
          calls.push([type, props]);
          return React.createElement("div");
        }) as unknown as typeof React.createElement,
      };
      const Boundary = createErrorBoundary(MockErrorComponent, customReact);
      const error = new Error("boom");
      const instance = new Boundary({});
      instance.state = { hasError: true, error };

      instance.render();

      assertEquals(
        calls.length,
        1,
        "the boundary must mint the fallback with the supplied React instance",
      );
      assertStrictEquals(
        calls[0]?.[0],
        MockErrorComponent,
        "the fallback element must be the reserved error component",
      );
      assertStrictEquals(
        calls[0]?.[1].error,
        error,
        "the caught error must be forwarded to the fallback",
      );
      assertEquals(
        typeof calls[0]?.[1].reset,
        "function",
        "the fallback must receive a callable reset",
      );
    });
  });
});
