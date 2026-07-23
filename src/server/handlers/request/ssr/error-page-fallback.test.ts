import "#veryfront/schemas/_test-setup.ts";
import "../../../../transforms/plugins/__tests__/code-parser-setup.ts";
import * as React from "react";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterAll, afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __injectCacheForTests, tryErrorPageFallback } from "./error-page-fallback.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withTestContext } from "../../../../../tests/_helpers/context.ts";
import { cleanupBundler } from "../../../../rendering/cleanup.ts";
import {
  __injectReactDOMServerForTests,
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

function createMockAdapter(
  overrides: {
    stat?: (
      path: string,
    ) => Promise<{ isFile: boolean; isDirectory: boolean; size: number; mtime: null }>;
    readFile?: (path: string) => Promise<string>;
    resolveFile?: ((path: string) => Promise<string | null>) | undefined;
  } = {},
): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: overrides.readFile ?? (() => Promise.resolve("")),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: overrides.stat ??
        (() => Promise.resolve({ isFile: false, isDirectory: false, size: 0, mtime: null })),
      ...(overrides.resolveFile !== undefined ? { resolveFile: overrides.resolveFile } : {}),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test-project",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    projectId: "test-proj",
    ...overrides,
  };
}

function createResolvedFileAdapter(
  adapter: RuntimeAdapter,
  resolvedPath: string,
): RuntimeAdapter {
  const fs = new Proxy(adapter.fs, {
    get(target, property, receiver) {
      if (property === "resolveFile") return () => Promise.resolve(resolvedPath);
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return new Proxy(adapter, {
    get(target, property, receiver) {
      if (property === "fs") return fs;
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as RuntimeAdapter;
}

const SUITE_NAME = "server/handlers/request/ssr/error-page-fallback";
const SUITE_OPTIONS = { sanitizeOps: false, sanitizeResources: false };

describe(SUITE_NAME, SUITE_OPTIONS, () => {
  afterAll(async () => {
    await cleanupBundler();
  });

  afterEach(() => {
    __injectCacheForTests(null);
    __resetLogRecordEmitterForTests();
    resetReactCache();
    __setServerModuleLoaderForTests(null);
  });

  describe("tryErrorPageFallback", () => {
    it("returns null when pages directory does not exist", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Deno.errors.NotFound("not found")),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null);
    });

    it("returns null when pages is not a directory", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null }),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null);
    });

    it("propagates pages directory permission failures", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Deno.errors.PermissionDenied("private-permission-canary")),
      });

      await assertRejects(
        () =>
          tryErrorPageFallback(
            new Request("http://localhost/"),
            makeCtx({ adapter }),
            new ResponseBuilder(),
            { statusCode: 404 },
          ),
        Deno.errors.PermissionDenied,
        "private-permission-canary",
      );
    });

    it("propagates custom page read permission failures", async () => {
      const adapter = createMockAdapter({
        stat: (path) =>
          Promise.resolve({
            isFile: !path.endsWith("/pages"),
            isDirectory: path.endsWith("/pages"),
            size: 0,
            mtime: null,
          }),
        readFile: () => Promise.reject(new Deno.errors.PermissionDenied("private-read-canary")),
      });

      await assertRejects(
        () =>
          tryErrorPageFallback(
            new Request("http://localhost/"),
            makeCtx({ adapter, projectId: "permission-read" }),
            new ResponseBuilder(),
            { statusCode: 404 },
          ),
        Deno.errors.PermissionDenied,
        "private-read-canary",
      );
    });

    it("returns null when no error page files exist", async () => {
      const _statResults: Record<
        string,
        { isFile: boolean; isDirectory: boolean; size: number; mtime: null }
      > = {};

      const adapter = createMockAdapter({
        stat: (path: string) => {
          // pages dir exists as directory
          if (path.endsWith("/pages")) {
            return Promise.resolve({ isFile: false, isDirectory: true, size: 0, mtime: null });
          }
          // No error page files exist
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
      });
      const ctx = makeCtx({ adapter, projectId: "missing-error-pages" });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null);
    });

    it("returns null when no error page files exist and resolveFile returns null", async () => {
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({ isFile: false, isDirectory: true, size: 0, mtime: null });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
        resolveFile: () => Promise.resolve(null),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 500,
      });
      assertEquals(result, null);
    });

    it("renders with the React version configured for the project", async () => {
      const adapter = await getAdapter();
      const statPaths: string[] = [];
      const fsWithProjectRelativeResolution = new Proxy(adapter.fs, {
        get(target, property, receiver) {
          if (property === "resolveFile") {
            return () => Promise.resolve("src/error-pages/404.tsx");
          }
          if (property === "stat") {
            return (path: string) => {
              statPaths.push(path);
              return target.stat(path);
            };
          }
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
      const adapterWithoutResolveFile = new Proxy(adapter, {
        get(target, property, receiver) {
          if (property === "fs") return fsWithProjectRelativeResolution;
          const value = Reflect.get(target, property, receiver);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }) as RuntimeAdapter;
      const loadedVersions: string[] = [];
      const server = (marker: string) => ({
        renderToString: () => `<p>${marker}</p>`,
        renderToStaticMarkup: () => `<p>${marker}</p>`,
      });

      await withTestContext("error-fallback-react-version", async (context) => {
        __setServerModuleLoaderForTests((_url, label, reactVersion) => {
          if (label === "React") {
            loadedVersions.push(reactVersion);
            return Promise.resolve({ default: React });
          }
          throw new Error(`Unexpected module load: ${label}`);
        });
        __injectReactDOMServerForTests(server("default-react"));
        __injectReactDOMServerForTests(server("project-react-18"), "18.3.1");

        const pagesDir = join(context.projectDir, "src", "error-pages");
        await mkdir(pagesDir, { recursive: true });
        await writeTextFile(
          join(pagesDir, "404.tsx"),
          "export default function ErrorPage() { return null; }",
        );
        const ctx = makeCtx({
          projectDir: context.projectDir,
          projectId: context.projectDir,
          adapter: adapterWithoutResolveFile,
          isLocalProject: true,
          config: {
            react: { version: "18.3.1" },
            directories: { pages: "src/error-pages" },
          } as HandlerContext["config"],
        });
        const result = await tryErrorPageFallback(
          new Request("http://localhost/missing"),
          ctx,
          new ResponseBuilder(),
          { statusCode: 404, pathname: "/missing" },
        );

        assertExists(result);
        assertStringIncludes(await result.text(), "project-react-18");
        assertEquals(loadedVersions, ["18.3.1"]);
        assertEquals(statPaths.includes(pagesDir), true);
        assertEquals(statPaths.includes(join(context.projectDir, "pages")), false);
      });
    });

    it("propagates renderer initialization failures", async () => {
      const adapter = await getAdapter();

      await withTestContext("error-fallback-renderer-init", async (context) => {
        const pagesDir = join(context.projectDir, "pages");
        await mkdir(pagesDir, { recursive: true });
        await writeTextFile(
          join(pagesDir, "404.tsx"),
          "export default function ErrorPage() { return null; }",
        );
        __setServerModuleLoaderForTests((_url, label) => {
          if (label === "React") return Promise.resolve({ default: React });
          return Promise.reject(
            new Deno.errors.PermissionDenied("private-renderer-init-canary"),
          );
        });

        await assertRejects(
          () =>
            tryErrorPageFallback(
              new Request("http://localhost/missing"),
              makeCtx({
                projectDir: context.projectDir,
                projectId: "renderer-init-failure",
                adapter: createResolvedFileAdapter(adapter, "pages/404.tsx"),
              }),
              new ResponseBuilder(),
              { statusCode: 404 },
            ),
          Deno.errors.PermissionDenied,
          "private-renderer-init-canary",
        );
      });
    });

    it("does not pass raw error or pathname details to a custom page", async () => {
      const adapter = await getAdapter();

      await withTestContext("error-fallback-private-props", async (context) => {
        const pagesDir = join(context.projectDir, "pages");
        await mkdir(pagesDir, { recursive: true });
        await writeTextFile(
          join(pagesDir, "404.tsx"),
          `export default function ErrorPage({ statusCode, pathname, err }) {
            return <p>{statusCode}|{pathname ?? "no-path"}|{err?.message ?? "no-error"}</p>;
          }`,
        );

        const result = await tryErrorPageFallback(
          new Request("http://localhost/private-request-route-canary"),
          makeCtx({
            projectDir: context.projectDir,
            projectId: context.projectDir,
            adapter: createResolvedFileAdapter(
              adapter,
              join(context.projectDir, "pages", "404.tsx"),
            ),
            isLocalProject: true,
          }),
          new ResponseBuilder(),
          {
            statusCode: 404,
            pathname: "/private-path-prop-canary",
            error: new Error("private-error-prop-canary"),
          },
        );

        assertExists(result);
        const html = await result.text();
        assertStringIncludes(html, "404");
        assertStringIncludes(html, "no-path");
        assertStringIncludes(html, "no-error");
        assertEquals(html.includes("data-node-file"), false);
        assertEquals(html.includes("private-request-route-canary"), false);
        assertEquals(html.includes("private-path-prop-canary"), false);
        assertEquals(html.includes("private-error-prop-canary"), false);
      });
    });

    it("uses a generic safe response when the custom page fails to render", async () => {
      const adapter = await getAdapter();
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));

      await withTestContext("error-fallback-render-failure", async (context) => {
        const pagesDir = join(context.projectDir, "pages");
        await mkdir(pagesDir, { recursive: true });
        await writeTextFile(
          join(pagesDir, "404.tsx"),
          "export default function ErrorPage() { return <p>unused</p>; }",
        );
        __injectReactDOMServerForTests({
          renderToString: () => {
            throw new Error("private-render-error-canary");
          },
          renderToStaticMarkup: () => {
            throw new Error("private-render-error-canary");
          },
        });

        const result = await tryErrorPageFallback(
          new Request("http://localhost/private-request-route-canary"),
          makeCtx({
            projectDir: context.projectDir,
            projectId: "private-project-id-canary",
            adapter: createResolvedFileAdapter(adapter, "pages/404.tsx"),
            isLocalProject: true,
          }),
          new ResponseBuilder(),
          {
            statusCode: 404,
            pathname: "/private-path-prop-canary",
            error: new Error("private-error-prop-canary"),
          },
        );

        assertExists(result);
        const html = await result.text();
        assertStringIncludes(html, "Page not found.");
        for (
          const privateValue of [
            "private-request-route-canary",
            "private-path-prop-canary",
            "private-error-prop-canary",
            "private-render-error-canary",
            "private-project-id-canary",
            context.projectDir,
          ]
        ) {
          assertEquals(html.includes(privateValue), false);
          assertEquals(JSON.stringify(entries).includes(privateValue), false);
        }

        const failure = entries.find((entry) =>
          entry.message === "Custom error page render failed"
        );
        assertEquals(failure?.context, { errorCategory: "error" });
      });
    });
  });

  describe("status codes", () => {
    it("returns null for 500 when no error page files exist", async () => {
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 500,
        error: new Error("test error"),
      });
      assertEquals(result, null);
    });

    it("returns null for 403 (only tries _error fallback)", async () => {
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 403,
      });
      assertEquals(result, null);
    });
  });

  describe("cache behavior with injected repo", () => {
    it("calls cache.get and cache.set via injected repo", async () => {
      const cacheOps: string[] = [];
      const mockRepo = {
        get: (key: string) => {
          cacheOps.push(`get:${key}`);
          return Promise.resolve(null);
        },
        set: (key: string, value: string) => {
          cacheOps.push(`set:${key}:${value}`);
          return Promise.resolve();
        },
        delete: (key: string) => {
          cacheOps.push(`delete:${key}`);
          return Promise.resolve();
        },
      };
      __injectCacheForTests(mockRepo as any);

      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      await tryErrorPageFallback(req, ctx, builder, { statusCode: 404 });

      // Should have called get and set on the cache
      assertEquals(cacheOps.some((op) => op.startsWith("get:")), true);
      assertEquals(cacheOps.some((op) => op.startsWith("set:")), true);
    });

    it("returns null when cache has NOT_FOUND sentinel", async () => {
      const mockRepo = {
        get: () => Promise.resolve("__NOT_FOUND__"),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };
      __injectCacheForTests(mockRepo as any);

      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null);
    });

    it("propagates cache failures without logging private details", async () => {
      __injectCacheForTests({
        context: {
          projectId: "test-project",
          environment: "preview",
          versionId: "test-version",
        },
        get: () => Promise.reject(new Error("private-cache-error-canary")),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      });
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
      });
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));

      await assertRejects(
        () =>
          tryErrorPageFallback(
            new Request("http://localhost/"),
            makeCtx({ adapter }),
            new ResponseBuilder(),
            { statusCode: 500 },
          ),
        Error,
        "private-cache-error-canary",
      );

      assertEquals(JSON.stringify(entries).includes("private-cache-error-canary"), false);
    });
  });

  describe("resolveFile path", () => {
    it("propagates unexpected resolveFile failures", async () => {
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
        resolveFile: () => Promise.reject(new Error("private-resolve-error-canary")),
      });
      const ctx = makeCtx({ adapter, projectId: "unexpected-resolve" });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      await assertRejects(
        () => tryErrorPageFallback(req, ctx, builder, { statusCode: 404 }),
        Error,
        "private-resolve-error-canary",
      );
    });

    it("treats a typed missing resolveFile result as absent", async () => {
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
        resolveFile: () => Promise.reject(new Deno.errors.NotFound("not found")),
      });

      const result = await tryErrorPageFallback(
        new Request("http://localhost/"),
        makeCtx({ adapter, projectId: "typed-missing-resolve" }),
        new ResponseBuilder(),
        { statusCode: 404 },
      );

      assertEquals(result, null);
    });

    it("rejects resolved error pages outside the configured pages directory", async () => {
      let readAttempted = false;
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          }
          return Promise.reject(new Deno.errors.NotFound("not found"));
        },
        readFile: () => {
          readAttempted = true;
          return Promise.resolve("private-source-canary");
        },
        resolveFile: () => Promise.resolve("../private/error-page.tsx"),
      });

      await assertRejects(
        () =>
          tryErrorPageFallback(
            new Request("http://localhost/"),
            makeCtx({ adapter, projectDir: "/project", projectId: "outside-error-page" }),
            new ResponseBuilder(),
            { statusCode: 404 },
          ),
        TypeError,
        "outside the configured pages directory",
      );
      assertEquals(readAttempted, false);
    });
  });

  describe("pathname in error options", () => {
    it("passes pathname through options", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Deno.errors.NotFound("not found")),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/missing-page");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
        pathname: "/missing-page",
      });
      assertEquals(result, null);
    });
  });

  describe("__injectCacheForTests", () => {
    it("can inject and reset cache repo", () => {
      const mockRepo = {
        get: () => Promise.resolve(null),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };
      __injectCacheForTests(mockRepo as any);
      __injectCacheForTests(null);
    });
  });
});
