import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import { join, toFileUrl } from "#veryfront/compat/path";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  __clearInFlightHttpFetches,
  __injectCachesForTests,
  cacheHttpImportsToLocal,
  captureHttpImportsToLocal,
} from "#veryfront/transforms/esm/http-cache.ts";
import { __setDistributedCacheAccessorForTests } from "#veryfront/transforms/esm/http-cache-wrapper.ts";
import { linkRenderModules } from "#veryfront/transforms/esm/link-render-modules.ts";
import { RenderArtifacts } from "#veryfront/transforms/esm/render-artifacts.ts";
import { __getMaxInFlightHttpFetchWaiterCountForTests } from "#veryfront/transforms/esm/in-flight-manager.ts";
import type { CacheBackend } from "#veryfront/cache/types.ts";
import { markBundleAccumulatorIncomplete } from "#veryfront/transforms/esm/bundle-accumulator.ts";
import { ModuleSourceCapture } from "#veryfront/transforms/esm/module-source-capture.ts";

const limits = { maxEntries: 8, maxBytes: 16_384 };
const code = 'export const load = () => import("https://example.invalid/entry.mjs");';

async function waitForSharedCall(cacheDir: string): Promise<void> {
  const fs = createFileSystem();
  for (let turn = 0; turn < 200; turn++) {
    if (__getMaxInFlightHttpFetchWaiterCountForTests() === 2) return;
    await fs.stat(cacheDir);
  }
  throw new Error("Both callers must join the shared fetch before it completes");
}

async function withCache(run: (cacheDir: string) => Promise<void>): Promise<void> {
  const fs = createFileSystem();
  const cacheDir = await fs.makeTempDir();
  __injectCachesForTests({ cachedPaths: new Map(), lastDistributedRefresh: new Map() });
  __setDistributedCacheAccessorForTests(() => Promise.resolve(null));
  try {
    await run(cacheDir);
  } finally {
    __clearInFlightHttpFetches();
    __injectCachesForTests(null);
    __setDistributedCacheAccessorForTests(null);
    if (await fs.exists(cacheDir)) await fs.remove(cacheDir, { recursive: true });
  }
}

describe("HTTP module source capture", () => {
  it("borrows one capture across rewrites and accounts for the root in the same budget", async () => {
    await withMockFetch(
      async () => new Response("export const value = 42;"),
      () =>
        withCache(async (cacheDir) => {
          const options = { cacheDir, importMap: { imports: {} } };
          const capture = new ModuleSourceCapture({ ...limits, maxEntries: 2 });
          try {
            const first = await cacheHttpImportsToLocal(code, options, capture);
            const second = await cacheHttpImportsToLocal(code, options, capture);
            assertEquals(first.code, second.code);
            const root = toFileUrl(join(cacheDir, "entry.mjs")).href;
            capture.record(root, first.code);
            assertEquals(
              capture.take().length,
              2,
              "rewrites must neither close nor duplicate the borrowed capture",
            );
          } finally {
            capture.discard();
          }
        }),
    );
  });

  it("captures lazy cyclic dependencies on fetch and cache hits without rereading at publication", async () => {
    let fetches = 0;
    await withMockFetch(async (input) => {
      fetches++;
      const path = new URL(String(input)).pathname;
      const source = path === "/entry.mjs"
        ? 'export const load = () => import("./child.mjs");'
        : 'export const value = 42; export const parent = () => import("./entry.mjs");';
      return new Response(source, { headers: { "content-type": "application/javascript" } });
    }, () =>
      withCache(async (cacheDir) => {
        const options = { cacheDir, importMap: { imports: {} } };
        const fresh = await captureHttpImportsToLocal(code, options, limits);
        const memory = await captureHttpImportsToLocal(code, options, limits);
        __injectCachesForTests({ cachedPaths: new Map(), lastDistributedRefresh: new Map() });
        const disk = await captureHttpImportsToLocal(code, options, limits);
        assertEquals(fetches, 2, "cache-hit capture must not refetch the graph");
        const sources = (result: typeof fresh) =>
          [...result.modules].sort((a, b) => a.url.localeCompare(b.url));
        assertEquals(sources(memory), sources(fresh), "memory hits retain every dependency");
        assertEquals(sources(disk), sources(fresh), "disk hits retain every dependency");
        assertEquals(fresh.modules.length, 2);
        const root = toFileUrl(join(cacheDir, "entry.mjs")).href;
        const graph = await linkRenderModules({
          modules: [{ url: root, source: fresh.code }, ...fresh.modules],
          entrypoints: [root],
        }, limits);
        const fs = createFileSystem();
        await fs.remove(cacheDir, { recursive: true });
        const artifacts = new RenderArtifacts(graph, limits);
        try {
          const prepared = await artifacts.prepare();
          assertEquals(prepared.fileCount, 3, "publication needs only the captured bytes");
          for (const file of graph.files) {
            assertEquals(await fs.readTextFile(join(prepared.directory, file.path)), file.source);
          }
        } finally {
          await artifacts.release();
        }
      }));
  });

  it("keeps capture limits local when a normal caller joins its shared fetch", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let fetches = 0;
    await withMockFetch(async () => {
      fetches++;
      started.resolve();
      await release.promise;
      return new Response("export const value = 42;");
    }, () =>
      withCache(async (cacheDir) => {
        const options = { cacheDir, importMap: { imports: {} } };
        const captured = captureHttpImportsToLocal(code, options, { ...limits, maxBytes: 1 });
        const rejected = assertRejects(() => captured, Error, "byte budget");
        await started.promise;
        const normal = cacheHttpImportsToLocal(code, options);
        try {
          await waitForSharedCall(cacheDir);
          release.resolve();
          const [result] = await Promise.all([normal, rejected]);
          assertEquals(fetches, 1, "capture failure must not poison the shared publication");
          assertEquals(result.code.includes("file://"), true);
          const retry = await captureHttpImportsToLocal(code, options, limits);
          assertEquals(
            retry.modules.length,
            1,
            "a fresh capture can use the completed cache entry",
          );
        } finally {
          release.resolve();
          await Promise.allSettled([normal, rejected]);
        }
      }));
  });

  it("closes a cancelled capture while a normal shared caller completes", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const abort = new AbortController();
    await withMockFetch(async () => {
      started.resolve();
      await release.promise;
      return new Response("export const value = 42;");
    }, () =>
      withCache(async (cacheDir) => {
        const options = { cacheDir, importMap: { imports: {} } };
        const captured = captureHttpImportsToLocal(
          code,
          { ...options, abortSignal: abort.signal },
          limits,
        );
        const rejected = assertRejects(() => captured, Error, "capture cancelled");
        await started.promise;
        const normal = cacheHttpImportsToLocal(code, options);
        try {
          await waitForSharedCall(cacheDir);
          abort.abort(new Error("capture cancelled"));
          release.resolve();
          const [result] = await Promise.all([normal, rejected]);
          assertEquals(result.code.includes("file://"), true);
          assertEquals((await captureHttpImportsToLocal(code, options, limits)).modules.length, 1);
        } finally {
          abort.abort(new Error("capture cancelled"));
          release.resolve();
          await Promise.allSettled([normal, rejected]);
        }
      }));
  });

  it("rejects incomplete accumulation without changing the normal cache result", async () => {
    await withMockFetch(async () => {
      // Model a validator reporting that its observed bundle set is incomplete.
      markBundleAccumulatorIncomplete();
      return new Response("export const value = 42;");
    }, () =>
      withCache(async (cacheDir) => {
        const options = { cacheDir, importMap: { imports: {} } };
        await assertRejects(
          () => captureHttpImportsToLocal(code, options, limits),
          Error,
          "incomplete",
        );
        const result = await cacheHttpImportsToLocal(
          'export * from "https://example.invalid/normal.mjs";',
          options,
        );
        assertEquals(result.code.includes("file://"), true);
        assertEquals(
          result.bundleManifestId,
          undefined,
          "legacy callers can omit incomplete metadata",
        );
      }));
  });

  it("uses the starting cancellation signal even if the caller later replaces its options", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    await withMockFetch(async () => {
      started.resolve();
      await release.promise;
      return new Response("export const value = 42;");
    }, () =>
      withCache(async (cacheDir) => {
        const options = {
          cacheDir,
          importMap: { imports: {} },
          abortSignal: new AbortController().signal,
        };
        const pending = captureHttpImportsToLocal(code, options, limits);
        await started.promise;
        options.abortSignal = AbortSignal.abort(new Error("unrelated cancellation"));
        release.resolve();
        assertEquals((await pending).modules.length, 1);
      }));
  });

  it("captures a recovered distributed graph after local cache loss", async () => {
    let fetches = 0;
    await withMockFetch(async (input) => {
      fetches++;
      const source = new URL(String(input)).pathname === "/entry.mjs"
        ? 'export const load = () => import("./child.mjs");'
        : "export const value = 42;";
      return new Response(source);
    }, () =>
      withCache(async (cacheDir) => {
        const stored = new Map<string, string>();
        const backend: CacheBackend = {
          type: "memory",
          get: (key) => Promise.resolve(stored.get(key) ?? null),
          set: (key, value) => {
            stored.set(key, value);
            return Promise.resolve();
          },
          del: (key) => {
            stored.delete(key);
            return Promise.resolve();
          },
        };
        __setDistributedCacheAccessorForTests(() => Promise.resolve(backend));
        const options = { cacheDir, importMap: { imports: {} } };
        const fresh = await captureHttpImportsToLocal(code, options, limits);
        const fs = createFileSystem();
        await fs.remove(cacheDir, { recursive: true });
        __injectCachesForTests({ cachedPaths: new Map(), lastDistributedRefresh: new Map() });
        const recovered = await captureHttpImportsToLocal(code, options, limits);
        const modules = (result: typeof fresh) =>
          [...result.modules].sort((a, b) => a.url.localeCompare(b.url));
        assertEquals(modules(recovered), modules(fresh));
        assertEquals(fetches, 2, "distributed recovery must capture without refetching");
      }));
  });

  it("does not read arbitrary file imports and leaves graph-closure enforcement to the linker", async () => {
    await withMockFetch(() => {
      throw new Error("Unexpected network request");
    }, () =>
      withCache(async (cacheDir) => {
        const source = 'export { value } from "file:///uncaptured/module.mjs";';
        const result = await captureHttpImportsToLocal(source, {
          cacheDir,
          importMap: { imports: {} },
        }, limits);
        assertEquals(result.modules, [], "only validated HTTP bundle reads feed capture");
        const root = toFileUrl(join(cacheDir, "entry.mjs")).href;
        await assertRejects(
          () =>
            linkRenderModules({
              modules: [{ url: root, source: result.code }],
              entrypoints: [root],
            }, limits),
          Error,
          "missing an imported source",
        );
      }));
  });
});
