import "#veryfront/schemas/_test-setup.ts";
import "../../../../transforms/plugins/__tests__/code-parser-setup.ts";
import * as React from "react";
import { mkdir, writeTextFile } from "#veryfront/compat/fs.ts";
import { join } from "#veryfront/compat/path";
import { getAdapter } from "#veryfront/platform/adapters/detect.ts";
import { assertEquals, assertExists, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  __injectCacheForTests,
  __setComponentSourceLoaderForTests,
  tryErrorPageFallback,
} from "./error-page-fallback.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { withTestContext } from "../../../../../tests/_helpers/context.ts";
import {
  __injectProjectReactForTests,
  __injectReactDOMServerForTests,
  __setServerModuleLoaderForTests,
  resetReactCache,
} from "#veryfront/react/compat/ssr-adapter/server-loader.ts";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";
import { clearReactVersionCache } from "#veryfront/transforms/esm/package-registry.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { DEPENDENCY_PINNING_ENV_FLAG } from "#veryfront/release-assets/constants.ts";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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
    projectId: "test-proj",
    ...overrides,
  };
}

afterEach(() => {
  __injectCacheForTests(null);
  __resetLogRecordEmitterForTests();
  resetReactCache();
  __setServerModuleLoaderForTests(null);
  __setComponentSourceLoaderForTests(null);
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

    it("fails closed before fallback loading when package.json is malformed", async () => {
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const projectDir = await Deno.makeTempDir({
        prefix: "vf-error-fallback-malformed-",
      });
      let statCalls = 0;

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        await Deno.writeTextFile(join(projectDir, "package.json"), "{ malformed");
        const adapter = createMockAdapter({
          stat: () => {
            statCalls++;
            return Promise.resolve({
              isFile: false,
              isDirectory: true,
              size: 0,
              mtime: null,
            });
          },
        });

        const result = await tryErrorPageFallback(
          new Request("http://localhost/missing"),
          makeCtx({ projectDir, adapter, isLocalProject: true }),
          new ResponseBuilder(),
          { statusCode: 500 },
        );

        assertEquals(result, null);
        assertEquals(statCalls, 0);
      } finally {
        if (originalFlag === undefined) {
          deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
        } else {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        }
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }
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

    it("loads a hosted preview error page with the preview environment", async () => {
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
        readFile: () =>
          Promise.resolve(
            "export default function ErrorPage() { return null; }",
          ),
        resolveFile: (path: string) =>
          Promise.resolve(path.endsWith("/404") ? "pages/404.tsx" : null),
      });
      let observed: { dev: boolean; mode?: string } | undefined;
      __setComponentSourceLoaderForTests(
        (_source, _filePath, _projectDir, _adapter, options) => {
          observed = { dev: options.dev, mode: options.mode };
          return Promise.reject(new Error("stop after observing loader options"));
        },
      );

      const result = await tryErrorPageFallback(
        new Request("http://localhost/missing"),
        makeCtx({
          adapter,
          projectId: "error-fallback-hosted-preview",
          isLocalProject: false,
          resolvedEnvironment: "preview",
        }),
        new ResponseBuilder(),
        { statusCode: 404, pathname: "/missing" },
      );

      assertEquals(result, null);
      assertEquals(observed, { dev: false, mode: "preview" });
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

    it("keeps component loading and React rendering on snapshot A after package state B", async () => {
      const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
      const projectDir = await Deno.makeTempDir({
        prefix: "vf-error-fallback-snapshot-",
      });
      const snapshotCaptured = deferred();
      const continueFallback = deferred();

      try {
        setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
        clearReactVersionCache();
        await Deno.writeTextFile(
          join(projectDir, "package.json"),
          JSON.stringify({
            dependencies: { react: "^18.3.1", "example-package": "1.0.0" },
          }),
        );

        const adapter = createMockAdapter({
          stat: async (path: string) => {
            if (path === join(projectDir, "pages")) {
              snapshotCaptured.resolve();
              await continueFallback.promise;
              return {
                isFile: false,
                isDirectory: true,
                size: 0,
                mtime: null,
              };
            }
            throw new Error("not found");
          },
          readFile: () =>
            Promise.resolve(
              "export default function ErrorPage() { return null; }",
            ),
          resolveFile: (path: string) =>
            Promise.resolve(
              path.endsWith("/404") ? "pages/404.tsx" : null,
            ),
        });
        let observed:
          | {
            reactVersion?: string;
            cacheKey?: string;
            dependencies?: Readonly<Record<string, string>>;
            source?: unknown;
            moduleServerOrigin?: string;
          }
          | undefined;
        __setComponentSourceLoaderForTests(
          (_source, _filePath, _projectDir, _adapter, options) => {
            observed = {
              reactVersion: options?.reactVersion,
              cacheKey: options?.dependencyPinningCacheKey,
              dependencies: options?.dependencyPinningDependencies,
              source: options?.dependencyPinningSource,
              moduleServerOrigin: options?.moduleServerOrigin,
            };
            return Promise.resolve(() => null);
          },
        );
        __setServerModuleLoaderForTests((_url, label) => {
          if (label === "React") return Promise.resolve({ default: React });
          throw new Error(`Unexpected module load: ${label}`);
        });
        __injectReactDOMServerForTests({
          renderToString: () => "<p>react-18</p>",
          renderToStaticMarkup: () => "<p>react-18</p>",
        }, "18.3.1");

        const responsePromise = tryErrorPageFallback(
          new Request("http://localhost/missing"),
          makeCtx({
            projectDir,
            projectId: projectDir,
            adapter,
            isLocalProject: true,
          }),
          new ResponseBuilder(),
          { statusCode: 404, pathname: "/missing" },
        );

        await snapshotCaptured.promise;
        await Deno.writeTextFile(
          join(projectDir, "package.json"),
          JSON.stringify({
            dependencies: { react: "^19.0.0", "example-package": "2.0.0" },
          }),
        );
        continueFallback.resolve();

        const response = await responsePromise;
        assertExists(response);
        assertStringIncludes(await response.text(), "react-18");
        assertEquals(observed?.reactVersion, "18.3.1");
        assertEquals(observed?.cacheKey?.startsWith("on:"), true);
        assertEquals(observed?.dependencies, {
          react: "^18.3.1",
          "example-package": "1.0.0",
        });
        assertEquals(
          (observed?.source as { projectDir?: string } | undefined)?.projectDir,
          projectDir,
        );
        assertEquals(observed?.moduleServerOrigin, "http://localhost");
      } finally {
        continueFallback.resolve();
        __setComponentSourceLoaderForTests(null);
        if (originalFlag === undefined) {
          deleteEnv(DEPENDENCY_PINNING_ENV_FLAG);
        } else {
          setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag);
        }
        clearReactVersionCache();
        await Deno.remove(projectDir, { recursive: true });
      }
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
      // Without resolveFile the candidates are probed through stat, so the
      // recorded paths show exactly which error pages were considered.
      const probed: string[] = [];
      const adapter = createMockAdapter({
        stat: (path: string) => {
          probed.push(path);
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
      // A fresh identity so the module-level path cache from earlier tests
      // cannot suppress the probes this test observes.
      const ctx = makeCtx({
        adapter,
        projectId: "probe-403",
        projectDir: "/tmp/test-project-403",
      });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 403,
      });
      assertEquals(result, null);
      assertEquals(
        probed.some((path) => path.includes("/pages/_error.")),
        true,
        "a 403 must fall back to the generic _error page",
      );
      assertEquals(
        probed.some((path) => /\/pages\/(404|500)\./.test(path)),
        false,
        "a 403 must never probe the 404 or 500 page",
      );
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

      // The filesystem WOULD find an error page, so a null result can only
      // come from honouring the cached miss without probing.
      let probes = 0;
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
          probes++;
          return Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null });
        },
        resolveFile: (path: string) => {
          probes++;
          return Promise.resolve(path.endsWith("404") ? "pages/404.tsx" : null);
        },
      });
      const ctx = makeCtx({ adapter });
      const req = new Request("http://localhost/");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
      });
      assertEquals(result, null, "a cached NOT_FOUND must answer without an error page");
      assertEquals(probes, 0, "a cached miss must not re-probe the filesystem");
    });

    it("sanitizes custom error page load failures", async () => {
      __injectCacheForTests({
        context: {
          projectId: "test-project",
          environment: "preview",
          versionId: "test-version",
        },
        get: () => Promise.reject(new Error("cache exposed <TOKEN> at <LOCAL_PATH>")),
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
    /** An adapter whose pages directory holds a 404 page the loader can find. */
    function adapterWith404Page(): RuntimeAdapter {
      return createMockAdapter({
        stat: (path: string) =>
          Promise.resolve({
            isFile: false,
            isDirectory: path.endsWith("pages"),
            size: 0,
            mtime: null,
          }),
        readFile: () => Promise.resolve("export default function E(p) { return p.pathname; }"),
        resolveFile: (path: string) =>
          Promise.resolve(path.endsWith("404") ? "pages/404.tsx" : null),
      });
    }

    function ErrorPageProbe(props: { pathname?: string }): string | null {
      return props.pathname ?? null;
    }

    it("passes pathname through options", async () => {
      __setComponentSourceLoaderForTests(() =>
        Promise.resolve(ErrorPageProbe as unknown as React.ComponentType<unknown>)
      );
      __injectProjectReactForTests(React);
      // Renders the element's props so the response body exposes exactly what
      // the custom error page received.
      __injectReactDOMServerForTests({
        renderToString: (element: unknown) => JSON.stringify((element as { props: unknown }).props),
        renderToStaticMarkup: () => "",
      } as never);
      const ctx = makeCtx({
        adapter: adapterWith404Page(),
        projectId: "pathname-props",
        isLocalProject: true,
      });
      const req = new Request("http://localhost/missing-page");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
        pathname: "/missing-page",
      });

      assertExists(result, "the custom 404 page must render");
      assertEquals(result.status, 404);
      assertStringIncludes(
        await result.text(),
        '"pathname":"/missing-page"',
        "the custom error page must receive the request pathname",
      );
    });

    it("names the pathname in the fallback body when the custom page fails to render", async () => {
      __setComponentSourceLoaderForTests(() =>
        Promise.resolve(ErrorPageProbe as unknown as React.ComponentType<unknown>)
      );
      __injectProjectReactForTests(React);
      __injectReactDOMServerForTests({
        renderToString: () => {
          throw new Error("custom error page exploded");
        },
        renderToStaticMarkup: () => "",
      } as never);
      const ctx = makeCtx({
        adapter: adapterWith404Page(),
        projectId: "pathname-fallback",
        isLocalProject: true,
      });
      const req = new Request("http://localhost/missing-page");
      const builder = new ResponseBuilder();

      const result = await tryErrorPageFallback(req, ctx, builder, {
        statusCode: 404,
        pathname: "/missing-page",
      });

      assertExists(result, "a broken custom page must still produce a fallback response");
      assertEquals(result.status, 404);
      assertStringIncludes(
        await result.text(),
        "/missing-page",
        "the fallback body must name the page that could not be found",
      );
    });
  });

  describe("negative caching", () => {
    /** Records every write so the tests can see what was cached. */
    function recordingRepo() {
      const store = new Map<string, string>();
      const writes: Array<{ key: string; value: string }> = [];

      return {
        writes,
        repo: {
          get: (key: string) => Promise.resolve(store.get(key) ?? null),
          set: (key: string, value: string) => {
            store.set(key, value);
            writes.push({ key, value });
            return Promise.resolve();
          },
          delete: (key: string) => {
            store.delete(key);
            return Promise.resolve();
          },
        },
      };
    }

    function pagesDirOnly() {
      return createMockAdapter({
        stat: (path: string) =>
          Promise.resolve({
            isFile: false,
            isDirectory: path.endsWith("pages"),
            size: 0,
            mtime: null,
          }),
        resolveFile: () => Promise.resolve(null),
      });
    }

    async function runFallback(ctx: HandlerContext): Promise<Response | null> {
      return await tryErrorPageFallback(
        new Request("http://localhost/boom"),
        ctx,
        new ResponseBuilder(),
        { statusCode: 500, pathname: "/boom" },
      );
    }

    it("caches a miss for a deployed project", async () => {
      const { repo, writes } = recordingRepo();
      __injectCacheForTests(repo as never);

      const result = await runFallback(
        makeCtx({ adapter: pagesDirOnly(), isLocalProject: false }),
      );

      assertEquals(result, null);
      assertEquals(writes.length > 0, true, "a deployed project should cache the miss");
      assertEquals(writes.every((write) => write.value === "__NOT_FOUND__"), true);
    });

    // Regression: dev reaches this fallback now, and nothing invalidates the
    // cache on a file change. A cached miss meant that creating pages/500.tsx
    // mid-session kept showing the dev overlay until the server restarted.
    it("does not cache a miss in dev", async () => {
      const { repo, writes } = recordingRepo();
      __injectCacheForTests(repo as never);

      const result = await runFallback(
        makeCtx({ adapter: pagesDirOnly(), isLocalProject: true }),
      );

      assertEquals(result, null);
      assertEquals(writes.length, 0, "dev must re-probe the filesystem each time");
    });

    it("finds an error page created after a miss in dev", async () => {
      const { repo } = recordingRepo();
      __injectCacheForTests(repo as never);

      let errorPageExists = false;
      const adapter = createMockAdapter({
        stat: (path: string) =>
          Promise.resolve({
            isFile: false,
            isDirectory: path.endsWith("pages"),
            size: 0,
            mtime: null,
          }),
        resolveFile: (path: string) =>
          Promise.resolve(errorPageExists && path.endsWith("500") ? "pages/500.tsx" : null),
      });
      const ctx = makeCtx({ adapter, isLocalProject: true });

      assertEquals(await runFallback(ctx), null);

      // The author creates pages/500.tsx without restarting the server.
      errorPageExists = true;

      let resolved = false;
      const adapterAfter = createMockAdapter({
        stat: adapter.fs.stat as never,
        readFile: () => {
          // Reaching the read proves the miss was not cached. Stop here rather
          // than compiling a component, which is not what this test is about.
          resolved = true;
          return Promise.reject(new Error("stop after resolving the error page"));
        },
        resolveFile: adapter.fs.resolveFile as never,
      });

      await runFallback(makeCtx({ adapter: adapterAfter, isLocalProject: true }));

      assertEquals(resolved, true, "the newly created error page must be picked up");
    });
  });

  describe("__injectCacheForTests", () => {
    it("can inject and reset cache repo", async () => {
      let gets = 0;
      const mockRepo = {
        get: () => {
          gets++;
          return Promise.resolve(null);
        },
        set: () => Promise.resolve(),
        delete: () => Promise.resolve(),
      };
      const adapter = createMockAdapter({
        stat: (path: string) =>
          Promise.resolve({
            isFile: false,
            isDirectory: path.endsWith("pages"),
            size: 0,
            mtime: null,
          }),
        resolveFile: () => Promise.resolve(null),
      });
      const runFallback = () =>
        tryErrorPageFallback(
          new Request("http://localhost/boom"),
          makeCtx({ adapter, projectId: "inject-reset", isLocalProject: true }),
          new ResponseBuilder(),
          { statusCode: 500, pathname: "/boom" },
        );

      __injectCacheForTests(mockRepo as any);
      await runFallback();
      assertEquals(
        gets > 0,
        true,
        "an injected cache repo must receive the fallback's cache lookups",
      );

      __injectCacheForTests(null);
      gets = 0;
      await runFallback();
      assertEquals(gets, 0, "resetting with null must detach the injected repo");
    });
  });
});
