import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearImportMapCache,
  getCachedImportMap,
  ImportMapPreloader,
  preloadImportMap,
} from "./preloader.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { ImportMapConfig } from "./types.ts";

function createMinimalAdapter(): RuntimeAdapter {
  return {
    fs: {
      readFile: () => {
        const error = new Error("not found") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      },
      writeFile: () => {},
      exists: () => false,
      stat: () => {
        throw new Error("not found");
      },
      readDir: async function* () {},
      mkdir: () => {},
      remove: () => {},
    },
    env: {
      get: () => undefined,
    },
  } as unknown as RuntimeAdapter;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function waitForLoadCount(
  loads: readonly unknown[],
  expected: number,
): Promise<void> {
  for (let attempt = 0; attempt < 100 && loads.length < expected; attempt++) {
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  assertEquals(loads.length, expected);
}

describe("modules/import-map/preloader", () => {
  describe("preloadImportMap", () => {
    it("should return an import map config", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      const result = await preloadImportMap("/test-preload-project", adapter);

      assertEquals(typeof result, "object");
      assertEquals("imports" in result || "scopes" in result, true);
    });

    it("should cache results for the same project dir", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      const map1 = await preloadImportMap("/test-cache-same", adapter);
      const map2 = await preloadImportMap("/test-cache-same", adapter);

      assertEquals(map1, map2);
    });

    it("should cache different projects independently", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      const result1 = await preloadImportMap("/test-ind-proj-a", adapter);
      const result2 = await preloadImportMap("/test-ind-proj-b", adapter);

      assertEquals(typeof result1, "object");
      assertEquals(typeof result2, "object");
    });

    it("isolates cache entries when one project source receives a changed config map", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();
      const firstConfig = validateVeryfrontConfig({
        resolve: {
          importMap: {
            imports: { package: "https://example.com/package-v1.ts" },
          },
        },
      });
      const secondConfig = validateVeryfrontConfig({
        resolve: {
          importMap: {
            imports: { package: "https://example.com/package-v2.ts" },
          },
        },
      });
      const firstContext = {
        contentSourceId: "release-1",
        config: firstConfig,
      };

      const first = await preloadImportMap(
        "/shared-project",
        adapter,
        "project-1",
        firstContext,
      );
      const firstAgain = await preloadImportMap(
        "/shared-project",
        adapter,
        "project-1",
        firstContext,
      );
      const changed = await preloadImportMap(
        "/shared-project",
        adapter,
        "project-1",
        {
          contentSourceId: "release-1",
          config: secondConfig,
        },
      );

      assertEquals(first, firstAgain);
      assertEquals(first.imports?.package, "https://example.com/package-v1.ts");
      assertEquals(changed.imports?.package, "https://example.com/package-v2.ts");
      assertEquals(first === changed, false);
    });

    it("binds variant identity and loading to one pre-await config snapshot", async () => {
      const adapter = createMinimalAdapter();
      const releaseLoader = createDeferred<void>();
      let loads = 0;
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 2,
        ttlMs: 1_000,
        loadImportMap: async (_path, _adapter, config) => {
          loads += 1;
          await releaseLoader.promise;
          return {
            imports: {
              package: config?.resolve?.importMap?.imports?.package ?? "",
            },
          };
        },
      });
      const config = validateVeryfrontConfig({
        resolve: {
          importMap: {
            imports: { package: "https://example.com/package-a.ts" },
          },
        },
      });
      const context = { contentSourceId: "release", config };

      const firstPromise = preloader.preload(
        "/atomic-project",
        adapter,
        "atomic-project",
        context,
      );
      const mutableImports = config.resolve?.importMap?.imports as Record<
        string,
        string
      >;
      mutableImports.package = "https://example.com/package-b.ts";
      releaseLoader.resolve();
      const first = await firstPromise;

      const originalContext = {
        contentSourceId: "release",
        config: validateVeryfrontConfig({
          resolve: {
            importMap: {
              imports: { package: "https://example.com/package-a.ts" },
            },
          },
        }),
      };
      const cachedOriginal = await preloader.preload(
        "/atomic-project",
        adapter,
        "atomic-project",
        originalContext,
      );
      const changed = await preloader.preload(
        "/atomic-project",
        adapter,
        "atomic-project",
        context,
      );

      assertEquals(first.imports?.package, "https://example.com/package-a.ts");
      assertEquals(cachedOriginal, first);
      assertEquals(changed.imports?.package, "https://example.com/package-b.ts");
      assertEquals(loads, 2);
    });

    it("isolates cache entries across content sources with the same validated config", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();
      const config = validateVeryfrontConfig({
        resolve: {
          importMap: {
            imports: { package: "https://example.com/package.ts" },
          },
        },
      });

      const release = await preloadImportMap(
        "/shared-project",
        adapter,
        "project-1",
        { contentSourceId: "release-1", config },
      );
      const branch = await preloadImportMap(
        "/shared-project",
        adapter,
        "project-1",
        { contentSourceId: "branch-main", config },
      );

      assertEquals(release === branch, false);
    });

    it("isolates project roots that share one project ID and content source", async () => {
      const adapter = createMinimalAdapter();
      let loads = 0;
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 2,
        ttlMs: 1_000,
        loadImportMap: async (projectDir) => ({
          imports: { projectDir, load: String(++loads) },
        }),
      });
      const context = { contentSourceId: "release-1" };

      const first = await preloader.preload(
        "/releases/first",
        adapter,
        "project-1",
        context,
      );
      const second = await preloader.preload(
        "/releases/second",
        adapter,
        "project-1",
        context,
      );

      assertEquals(first.imports?.projectDir, "/releases/first");
      assertEquals(second.imports?.projectDir, "/releases/second");
      assertEquals(loads, 2);
    });

    it("rejects accessor-backed request context without invoking it", async () => {
      const adapter = createMinimalAdapter();
      let getterCalls = 0;
      const context = Object.defineProperty({}, "contentSourceId", {
        enumerable: true,
        get() {
          getterCalls++;
          return "poisoned";
        },
      });

      await assertRejects(
        () =>
          preloadImportMap(
            "/accessor-context",
            adapter,
            "accessor-context",
            context,
          ),
        TypeError,
        "cannot be an accessor",
      );
      assertEquals(getterCalls, 0);
    });

    it("snapshots and deep-freezes loader output before publishing it", async () => {
      const adapter = createMinimalAdapter();
      const loadedMap = {
        imports: { package: "https://example.com/package-v1.ts" },
        scopes: {
          "https://example.com/": {
            scoped: "https://example.com/scoped-v1.ts",
          },
        },
      };
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadImportMap: async () => loadedMap,
      });

      const published = await preloader.preload(
        "/immutable-loader-output",
        adapter,
        "immutable-loader-output",
      );
      loadedMap.imports.package = "https://example.com/package-mutated.ts";
      loadedMap.scopes["https://example.com/"].scoped = "https://example.com/scoped-mutated.ts";

      assertEquals(published === loadedMap, false);
      assertEquals(Object.isFrozen(published), true);
      assertEquals(Object.isFrozen(published.imports), true);
      assertEquals(Object.isFrozen(published.scopes), true);
      assertEquals(
        Object.isFrozen(published.scopes?.["https://example.com/"]),
        true,
      );
      assertThrows(
        () => {
          published.imports!.package = "https://example.com/caller-mutation.ts";
        },
        TypeError,
      );
      assertEquals(
        published.imports?.package,
        "https://example.com/package-v1.ts",
      );
      assertEquals(
        published.scopes?.["https://example.com/"]?.scoped,
        "https://example.com/scoped-v1.ts",
      );
      assertEquals(
        await preloader.getCached("immutable-loader-output", {
          projectDir: "/immutable-loader-output",
        }),
        published,
      );
      assertEquals(
        await preloader.preload(
          "/immutable-loader-output",
          adapter,
          "immutable-loader-output",
        ),
        published,
      );
    });

    it("rejects malformed loader output before publication and permits retry", async () => {
      const adapter = createMinimalAdapter();
      let loads = 0;
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadImportMap: async () => {
          loads += 1;
          if (loads === 1) {
            return {
              imports: { package: 42 },
            } as unknown as ImportMapConfig;
          }
          return {
            imports: { package: "https://example.com/recovered.ts" },
          };
        },
      });

      await assertRejects(
        () =>
          preloader.preload(
            "/invalid-loader-output",
            adapter,
            "invalid-loader-output",
          ),
        TypeError,
        "must be a string",
      );
      const recovered = await preloader.preload(
        "/invalid-loader-output",
        adapter,
        "invalid-loader-output",
      );

      assertEquals(
        recovered.imports?.package,
        "https://example.com/recovered.ts",
      );
      assertEquals(loads, 2);
    });
  });

  describe("getCachedImportMap", () => {
    it("should return undefined when not cached", async () => {
      clearImportMapCache();

      const result = await getCachedImportMap("/test-no-cache-project");

      assertEquals(result, undefined);
    });

    it("should return cached map after preload", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      await preloadImportMap("/test-cached-get", adapter);
      const cached = await getCachedImportMap("/test-cached-get");

      assertEquals(typeof cached, "object");
      assertEquals(cached !== undefined, true);
    });
  });

  describe("bounded cache lifecycle", () => {
    function createTestPreloader(input: {
      maxProjects?: number;
      maxVariantsPerProject?: number;
      ttlMs?: number;
      now?: () => number;
    }) {
      let loads = 0;
      const preloader = new ImportMapPreloader({
        ...input,
        loadImportMap: () =>
          Promise.resolve({
            imports: { loaded: String(++loads) },
          }),
      });
      return { preloader, getLoads: () => loads };
    }

    it("evicts the least-recently-used variant within one project", async () => {
      const adapter = createMinimalAdapter();
      const { preloader } = createTestPreloader({
        maxProjects: 2,
        maxVariantsPerProject: 2,
        ttlMs: 1_000,
      });
      const projectDir = "/bounded-variants";
      const projectId = "project-1";
      const sourceA = { contentSourceId: "source-a", projectDir };
      const sourceB = { contentSourceId: "source-b", projectDir };
      const sourceC = { contentSourceId: "source-c", projectDir };

      await preloader.preload(projectDir, adapter, projectId, sourceA);
      await preloader.preload(projectDir, adapter, projectId, sourceB);
      await preloader.getCached(projectId, sourceA);
      await preloader.preload(projectDir, adapter, projectId, sourceC);

      assertEquals(await preloader.getCached(projectId, sourceA) !== undefined, true);
      assertEquals(await preloader.getCached(projectId, sourceB), undefined);
      assertEquals(await preloader.getCached(projectId, sourceC) !== undefined, true);
    });

    it("evicts the least-recently-used project bucket", async () => {
      const adapter = createMinimalAdapter();
      const { preloader } = createTestPreloader({
        maxProjects: 2,
        maxVariantsPerProject: 2,
        ttlMs: 1_000,
      });

      await preloader.preload("/project-a", adapter, "project-a");
      await preloader.preload("/project-b", adapter, "project-b");
      await preloader.getCached("project-a", { projectDir: "/project-a" });
      await preloader.preload("/project-c", adapter, "project-c");

      assertEquals(
        await preloader.getCached("project-a", { projectDir: "/project-a" }) !== undefined,
        true,
      );
      assertEquals(
        await preloader.getCached("project-b", { projectDir: "/project-b" }),
        undefined,
      );
      assertEquals(
        await preloader.getCached("project-c", { projectDir: "/project-c" }) !== undefined,
        true,
      );
    });

    it("expires settled entries against an injected clock and reloads them", async () => {
      const adapter = createMinimalAdapter();
      let now = 1_000;
      const { preloader, getLoads } = createTestPreloader({
        maxProjects: 2,
        maxVariantsPerProject: 2,
        ttlMs: 100,
        now: () => now,
      });
      const context = { contentSourceId: "source-a", projectDir: "/ttl-project" };

      const first = await preloader.preload("/ttl-project", adapter, "ttl-project", context);
      now = 1_099;
      assertEquals(await preloader.getCached("ttl-project", context), first);
      now = 1_100;
      assertEquals(await preloader.getCached("ttl-project", context), undefined);

      const reloaded = await preloader.preload(
        "/ttl-project",
        adapter,
        "ttl-project",
        context,
      );
      assertEquals(getLoads(), 2);
      assertEquals(reloaded === first, false);
    });

    it("publishes one authoritative replacement on direct preload after expiry", async () => {
      const adapter = createMinimalAdapter();
      let now = 1_000;
      const { preloader, getLoads } = createTestPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 100,
        now: () => now,
      });
      const context = {
        contentSourceId: "source-a",
        projectDir: "/direct-expiry",
      };

      const expired = await preloader.preload(
        "/direct-expiry",
        adapter,
        "direct-expiry",
        context,
      );
      now = 1_100;
      const replacement = await preloader.preload(
        "/direct-expiry",
        adapter,
        "direct-expiry",
        context,
      );
      const cachedReplacement = await preloader.preload(
        "/direct-expiry",
        adapter,
        "direct-expiry",
        context,
      );

      assertEquals(replacement === expired, false);
      assertEquals(cachedReplacement, replacement);
      assertEquals(getLoads(), 2);
    });

    it("deduplicates concurrent direct refreshes at capacity after expiry", async () => {
      const adapter = createMinimalAdapter();
      let now = 1_000;
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 100,
        now: () => now,
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });
      const context = {
        contentSourceId: "source-a",
        projectDir: "/concurrent-direct-expiry",
      };

      const initialPromise = preloader.preload(
        "/concurrent-direct-expiry",
        adapter,
        "concurrent-direct-expiry",
        context,
      );
      await waitForLoadCount(loads, 1);
      loads[0]!.resolve({ imports: { loaded: "initial" } });
      const initial = await initialPromise;

      now = 1_100;
      const replacementPromise = preloader.preload(
        "/concurrent-direct-expiry",
        adapter,
        "concurrent-direct-expiry",
        context,
      );
      await waitForLoadCount(loads, 2);
      const duplicatePromise = preloader.preload(
        "/concurrent-direct-expiry",
        adapter,
        "concurrent-direct-expiry",
        context,
      );
      const cachedPromise = preloader.getCached(
        "concurrent-direct-expiry",
        context,
      );

      await Promise.resolve();
      assertEquals(loads.length, 2);
      loads[1]!.resolve({ imports: { loaded: "replacement" } });
      const [replacement, duplicate, cached] = await Promise.all([
        replacementPromise,
        duplicatePromise,
        cachedPromise,
      ]);

      assertEquals(replacement === initial, false);
      assertEquals(duplicate, replacement);
      assertEquals(cached, replacement);
      assertEquals(
        await preloader.preload(
          "/concurrent-direct-expiry",
          adapter,
          "concurrent-direct-expiry",
          context,
        ),
        replacement,
      );
      assertEquals(loads.length, 2);
    });

    it("removes a settled entry when the injected clock throws", async () => {
      const adapter = createMinimalAdapter();
      let clockReads = 0;
      let loads = 0;
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 100,
        now: () => {
          clockReads += 1;
          if (clockReads === 3) throw new Error("clock unavailable");
          return 1_000;
        },
        loadImportMap: async () => ({
          imports: { loaded: String(++loads) },
        }),
      });
      const context = {
        contentSourceId: "source-a",
        projectDir: "/throwing-clock",
      };

      const first = await preloader.preload(
        "/throwing-clock",
        adapter,
        "throwing-clock",
        context,
      );

      assertEquals(first.imports?.loaded, "1");
      assertEquals(
        await preloader.getCached("throwing-clock", context),
        undefined,
      );

      const second = await preloader.preload(
        "/throwing-clock",
        adapter,
        "throwing-clock",
        context,
      );
      assertEquals(second.imports?.loaded, "2");
      assertEquals(loads, 2);
    });

    it("preserves explicit project invalidation in a bounded cache", async () => {
      const adapter = createMinimalAdapter();
      const { preloader } = createTestPreloader({
        maxProjects: 2,
        maxVariantsPerProject: 2,
        ttlMs: 1_000,
      });

      await preloader.preload("/project-a", adapter, "project-a");
      await preloader.preload("/project-b", adapter, "project-b");
      preloader.clear("project-a");

      assertEquals(
        await preloader.getCached("project-a", { projectDir: "/project-a" }),
        undefined,
      );
      assertEquals(
        await preloader.getCached("project-b", { projectDir: "/project-b" }) !== undefined,
        true,
      );
    });

    it("does not publish pre-clear work after identity hashing resumes", async () => {
      const adapter = createMinimalAdapter();
      let loads = 0;
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadImportMap: async () => ({
          imports: { loaded: String(++loads) },
        }),
      });
      const context = { contentSourceId: "source-a", projectDir: "/project-a" };

      const preClear = preloader.preload(
        "/project-a",
        adapter,
        "project-a",
        context,
      );
      preloader.clear("project-a");

      await assertRejects(
        () =>
          preloader.preload(
            "/project-a",
            adapter,
            "project-a",
            context,
          ),
        RangeError,
        "capacity is occupied by in-flight loads",
      );
      const staleResult = await preClear;
      assertEquals(staleResult.imports?.loaded, "1");
      assertEquals(Object.isFrozen(staleResult), true);
      assertEquals(Object.isFrozen(staleResult.imports), true);
      assertThrows(
        () => {
          staleResult.imports!.loaded = "caller-mutation";
        },
        TypeError,
      );
      assertEquals(await preloader.getCached("project-a", context), undefined);

      const reloaded = await preloader.preload(
        "/project-a",
        adapter,
        "project-a",
        context,
      );
      assertEquals(reloaded.imports?.loaded, "2");
      assertEquals(await preloader.getCached("project-a", context), reloaded);
    });

    it("does not publish pre-clear work into a new global generation", async () => {
      const adapter = createMinimalAdapter();
      let loads = 0;
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadImportMap: async () => ({
          imports: { loaded: String(++loads) },
        }),
      });
      const context = { contentSourceId: "source-a", projectDir: "/project-a" };

      const preClear = preloader.preload(
        "/project-a",
        adapter,
        "project-a",
        context,
      );
      preloader.clear();

      assertEquals((await preClear).imports?.loaded, "1");
      assertEquals(await preloader.getCached("project-a", context), undefined);
    });

    it("keeps in-flight project work admitted instead of evicting and duplicating it", async () => {
      const adapter = createMinimalAdapter();
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });

      const first = preloader.preload("/project-a", adapter, "project-a");
      await Promise.resolve();
      const sameKey = preloader.preload("/project-a", adapter, "project-a");
      await assertRejects(
        () => preloader.preload("/project-b", adapter, "project-b"),
        RangeError,
        "capacity is occupied by in-flight loads",
      );
      await waitForLoadCount(loads, 1);
      assertEquals(loads.length, 1);

      loads[0]!.resolve({ imports: { source: "a" } });
      const firstResult = await first;
      assertEquals(firstResult.imports?.source, "a");
      assertEquals(await sameKey, firstResult);

      const second = preloader.preload("/project-b", adapter, "project-b");
      await waitForLoadCount(loads, 2);
      loads[1]!.resolve({ imports: { source: "b" } });
      assertEquals((await second).imports?.source, "b");
    });

    it("bounds identity and loader work across variants and explicit invalidation", async () => {
      const adapter = createMinimalAdapter();
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });
      const sourceA = { contentSourceId: "source-a" };
      const sourceB = { contentSourceId: "source-b" };

      const first = preloader.preload("/project", adapter, "project", sourceA);
      await assertRejects(
        () => preloader.preload("/project", adapter, "project", sourceB),
        RangeError,
        "capacity is occupied by in-flight loads",
      );
      preloader.clear("project");
      await assertRejects(
        () => preloader.preload("/project", adapter, "project", sourceA),
        RangeError,
        "capacity is occupied by in-flight loads",
      );
      await waitForLoadCount(loads, 1);
      assertEquals(loads.length, 1);

      loads[0]!.resolve({ imports: { source: "a" } });
      await first;
      const reloaded = preloader.preload("/project", adapter, "project", sourceB);
      await waitForLoadCount(loads, 2);
      loads[1]!.resolve({ imports: { source: "b" } });
      assertEquals((await reloaded).imports?.source, "b");
    });

    it("keeps variant identity and capacity deterministic after primordial poisoning", async () => {
      const worker = new Worker(
        new URL("./preloader-primordial-poisoning.worker.ts", import.meta.url),
        { type: "module" },
      );
      try {
        const result = await new Promise<{
          firstLoaded: string | undefined;
          firstSame: boolean;
          secondLoaded: string | undefined;
          secondPackage: string | undefined;
          evicted: boolean;
          loads: number;
        }>((resolve, reject) => {
          worker.onmessage = (event) => {
            const message = event.data as
              | { ok: true; result: Parameters<typeof resolve>[0] }
              | { ok: false; error: string };
            if (message.ok) resolve(message.result);
            else reject(new Error(message.error));
          };
          worker.onerror = (event) => reject(event.error ?? new Error(event.message));
        });

        assertEquals(result.firstLoaded, "1");
        assertEquals(result.firstSame, true);
        assertEquals(result.secondLoaded, "2");
        assertEquals(
          result.secondPackage,
          "https://example.com/package-b.ts",
        );
        assertEquals(result.evicted, true);
        assertEquals(result.loads, 2);
      } finally {
        worker.terminate();
      }
    });
  });

  describe("clearImportMapCache", () => {
    it("should clear cache for specific project", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      await preloadImportMap("/test-clear-specific", adapter);
      clearImportMapCache("/test-clear-specific");

      const cached = await getCachedImportMap("/test-clear-specific");

      assertEquals(cached, undefined);
    });

    it("should clear all caches when no project specified", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      await preloadImportMap("/test-clear-all-a", adapter);
      await preloadImportMap("/test-clear-all-b", adapter);

      clearImportMapCache();

      const cachedA = await getCachedImportMap("/test-clear-all-a");
      const cachedB = await getCachedImportMap("/test-clear-all-b");

      assertEquals(cachedA, undefined);
      assertEquals(cachedB, undefined);
    });

    it("should not affect other projects when clearing specific project", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();

      await preloadImportMap("/test-clear-keep-a", adapter);
      await preloadImportMap("/test-clear-keep-b", adapter);

      clearImportMapCache("/test-clear-keep-a");

      const cachedA = await getCachedImportMap("/test-clear-keep-a");
      const cachedB = await getCachedImportMap("/test-clear-keep-b");

      assertEquals(cachedA, undefined);
      assertEquals(cachedB !== undefined, true);
    });
  });
});
