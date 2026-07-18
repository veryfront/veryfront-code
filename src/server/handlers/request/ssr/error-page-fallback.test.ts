import "#veryfront/schemas/_test-setup.ts";
import "../../../../transforms/plugins/__tests__/code-parser-setup.ts";
import * as React from "react";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { __injectCacheForTests, tryErrorPageFallback } from "./error-page-fallback.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withTestContext } from "../../../../../tests/_helpers/context.ts";
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

afterEach(() => {
  __injectCacheForTests(null);
  __resetLogRecordEmitterForTests();
  resetReactCache();
  __setServerModuleLoaderForTests(null);
});

describe("server/handlers/request/ssr/error-page-fallback", () => {
  describe("tryErrorPageFallback", () => {
    it("returns null when pages directory does not exist", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Error("not found")),
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
          return Promise.reject(new Error("not found"));
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

    it("returns null when no error page files exist and resolveFile returns null", async () => {
      const adapter = createMockAdapter({
        stat: (path: string) => {
          if (path.endsWith("/pages")) {
            return Promise.resolve({ isFile: false, isDirectory: true, size: 0, mtime: null });
          }
          return Promise.reject(new Error("not found"));
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
          return Promise.reject(new Error("not found"));
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
          return Promise.reject(new Error("not found"));
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
          return Promise.reject(new Error("not found"));
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
          return Promise.reject(new Error("not found"));
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

    it("sanitizes custom error page load failures", async () => {
      __injectCacheForTests({
        get: () => Promise.reject(new Error("cache exposed <TOKEN> at <LOCAL_PATH>")),
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      } as CacheRepository<string>);
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
          return Promise.reject(new Error("not found"));
        },
      });
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));

      const result = await tryErrorPageFallback(
        new Request("http://localhost/"),
        makeCtx({ adapter }),
        new ResponseBuilder(),
        { statusCode: 500 },
      );

      assertEquals(result, null);
      const failure = entries.find((entry) =>
        entry.message === "Failed to load custom error page; falling back to default"
      );
      assertEquals(failure?.context, { errorName: "Error" });
      assertEquals(JSON.stringify(entries).includes("<TOKEN>"), false);
      assertEquals(JSON.stringify(entries).includes("<LOCAL_PATH>"), false);
    });
  });

  describe("resolveFile path", () => {
    it("returns null when resolveFile throws", async () => {
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
          return Promise.reject(new Error("not found"));
        },
        resolveFile: () => Promise.reject(new Error("resolve failed")),
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null);
    });
  });

  describe("pathname in error options", () => {
    it("passes pathname through options", async () => {
      const adapter = createMockAdapter({
        stat: () => Promise.reject(new Error("not found")),
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
