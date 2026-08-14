import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  clearImportMapCache,
  getCachedImportMap,
  ImportMapPreloader,
  preloadImportMap,
} from "./preloader.ts";
import { validateVeryfrontConfig, type VeryfrontConfig } from "#veryfront/config";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { MAX_TIMER_DELAY_MS } from "#veryfront/utils/constants/limits.ts";
import type { ImportMapConfig } from "./types.ts";

interface RuntimeWorker {
  subscribe(
    onMessage: (value: unknown) => void,
    onError: (error: unknown) => void,
  ): void;
  terminate(): void;
}

async function createRuntimeWorker(url: URL): Promise<RuntimeWorker> {
  if (typeof globalThis.Worker === "function") {
    const worker = new globalThis.Worker(url, { type: "module" });
    return {
      subscribe(onMessage, onError) {
        worker.onmessage = (event) => onMessage(event.data);
        worker.onerror = (event) => onError(event.error ?? new Error(event.message));
      },
      terminate() {
        worker.terminate();
      },
    };
  }

  const { Worker: NodeWorker } = await import("node:worker_threads");
  const worker = new NodeWorker(url);
  return {
    subscribe(onMessage, onError) {
      worker.once("message", onMessage);
      worker.once("error", onError);
    },
    terminate() {
      void worker.terminate();
    },
  };
}

/**
 * Budget for loads whose deadline must not fire during the test.
 *
 * Deliberately far larger than any test needs. A test that wants a deadline to
 * fire no longer shortens this value and waits for the host clock to catch up —
 * it injects `setTimer`/`cancelTimer` from `createInertTimers` and fires the
 * deadline explicitly. So no assertion here depends on how much wall time the
 * host took, and reaching this value means the test hung on its own logic.
 */
const TIMEOUT_NOT_UNDER_TEST_MS = 600_000;

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

/**
 * Timer seam that never fires on its own.
 *
 * Tests that inject a virtual clock must inject timers too. Otherwise the
 * preloader's deadline is measured against the wall clock while the rest of the
 * test advances by fake ticks, so a starved CI worker can trip a timeout during
 * work that consumed no virtual time at all. That turned a millisecond test into
 * a ten-minute hang that only reproduced under full-shard load.
 */
function createInertTimers() {
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  return {
    setTimer: (callback: () => void, _delayMs: number) => {
      const handle = nextHandle++;
      pending.set(handle, callback);
      return handle as unknown as ReturnType<typeof setTimeout>;
    },
    cancelTimer: (handle: ReturnType<typeof setTimeout>) => {
      pending.delete(handle as unknown as number);
    },
    /** Fire a pending deadline explicitly when the timeout *is* under test. */
    fireAll: () => {
      const callbacks = [...pending.values()];
      pending.clear();
      for (const callback of callbacks) callback();
    },
    /** Deadlines currently armed, so a test can wait for one to exist. */
    pendingCount: () => pending.size,
  };
}

/**
 * Fire the preloader's next armed deadline, once it is actually armed.
 *
 * A deadline the test wants to trigger is armed several async turns after the
 * call that requests it — a capacity wait, for instance, is only armed after
 * admission has already failed. Spinning until one appears ties the trigger to
 * the arming rather than to a guessed turn count, which is what keeps these
 * tests independent of how fast the host happens to be.
 */
async function fireWhenArmed(
  timers: ReturnType<typeof createInertTimers>,
  label: string,
  turns = 200,
): Promise<void> {
  for (let turn = 0; turn < turns; turn++) {
    if (timers.pendingCount() > 0) {
      timers.fireAll();
      return;
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  throw new Error(`${label} never armed a deadline within ${turns} macrotask turns`);
}

/**
 * Await `promise` within a bounded number of macrotask turns.
 *
 * With inert timers a missed signal would hang forever rather than fail, so the
 * bound is what keeps a genuine regression fast and legible instead of silent.
 */
async function settleWithin<T>(
  promise: Promise<T>,
  label: string,
  turns = 200,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;
  const deadline = new Promise<never>((_, reject) => {
    let turn = 0;
    const tick = () => {
      if (cancelled) return;
      if (++turn >= turns) {
        reject(new Error(`${label} did not settle within ${turns} macrotask turns`));
        return;
      }
      timer = setTimeout(tick, 0);
    };
    timer = setTimeout(tick, 0);
  });
  try {
    return await Promise.race([promise, deadline]);
  } finally {
    // The chain must be torn down explicitly: a pending tick would outlive the
    // test and trip the runner's timer-leak detector.
    cancelled = true;
    if (timer !== undefined) clearTimeout(timer);
    deadline.catch(() => {});
  }
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

      assertStrictEquals(map1, map2);
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

      assertStrictEquals(first, firstAgain);
      assertEquals(first.imports?.package, "https://example.com/package-v1.ts");
      assertEquals(changed.imports?.package, "https://example.com/package-v2.ts");
      assertEquals(first === changed, false);
    });

    it("ignores extra config import-map metadata without invoking accessors", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();
      let metadataCalls = 0;
      const importMap = {
        imports: { package: "https://example.com/package.ts" },
      };
      Object.defineProperty(importMap, "metadata", {
        enumerable: true,
        get() {
          metadataCalls++;
          return { source: "project" };
        },
      });
      const config = { resolve: { importMap } } as VeryfrontConfig;

      const result = await preloadImportMap(
        "/metadata-project",
        adapter,
        "metadata-project",
        { config },
      );

      assertEquals(result.imports?.package, "https://example.com/package.ts");
      assertEquals(metadataCalls, 0);
    });

    it("rejects accessor-backed config import-map fields without invoking them", async () => {
      clearImportMapCache();
      const adapter = createMinimalAdapter();
      let importsCalls = 0;
      const importMap = {};
      Object.defineProperty(importMap, "imports", {
        enumerable: true,
        get() {
          importsCalls++;
          return { package: "https://example.com/package.ts" };
        },
      });
      const config = { resolve: { importMap } } as VeryfrontConfig;

      await assertRejects(
        () =>
          preloadImportMap(
            "/accessor-import-map-project",
            adapter,
            "accessor-import-map-project",
            { config },
          ),
        TypeError,
        "imports cannot be an accessor",
      );
      assertEquals(importsCalls, 0);
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
      const config = {
        resolve: {
          importMap: {
            imports: { package: "https://example.com/package-a.ts" },
          },
        },
      } as VeryfrontConfig;
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
      assertStrictEquals(cachedOriginal, first);
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

    it("rejects accessor-backed config after inherited descriptor poisoning", async () => {
      const adapter = createMinimalAdapter();
      const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let getterCalls = 0;
      let accessorError: unknown;
      const context = Object.defineProperty({}, "config", {
        enumerable: true,
        get() {
          getterCalls++;
          return undefined;
        },
      });

      try {
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          value: {
            resolve: {
              importMap: {
                imports: { poisoned: "https://example.com/poisoned.ts" },
              },
            },
          },
        });
        try {
          await preloadImportMap(
            "/inherited-value-accessor-context",
            adapter,
            "inherited-value-accessor-context",
            context,
          );
        } catch (error) {
          accessorError = error;
        }
      } finally {
        if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
        else Reflect.deleteProperty(Object.prototype, "value");
      }

      assertEquals(accessorError instanceof TypeError, true);
      assertStringIncludes((accessorError as Error).message, "cannot be an accessor");
      assertEquals(getterCalls, 0);
    });

    it("rejects non-object config context values", async () => {
      const adapter = createMinimalAdapter();

      for (const config of [null, false, 0, "invalid"]) {
        await assertRejects(
          () =>
            preloadImportMap(
              "/invalid-config-context",
              adapter,
              `invalid-config-${String(config)}`,
              { config } as never,
            ),
          TypeError,
          "Import-map config must be an object",
        );
      }
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

    it("can isolate the same project id by explicit project directory context", async () => {
      const adapter = createMinimalAdapter();
      let loads = 0;
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 2,
        loadImportMap: async () => ({
          imports: { loaded: String(++loads) },
        }),
      });

      const first = await preloader.preload("/release-a", adapter, "project", {
        projectDir: "/release-a",
        contentSourceId: "source",
      });
      const second = await preloader.preload("/release-b", adapter, "project", {
        projectDir: "/release-b",
        contentSourceId: "source",
      });

      assertEquals(first.imports?.loaded, "1");
      assertEquals(second.imports?.loaded, "2");
      assertEquals(
        await preloader.getCached("project", {
          projectDir: "/release-a",
          contentSourceId: "source",
        }),
        first,
      );
      assertEquals(
        await preloader.getCached("project", {
          projectDir: "/release-b",
          contentSourceId: "source",
        }),
        second,
      );
    });

    it("falls back to the only retained variant for project-id cache lookups", async () => {
      const adapter = createMinimalAdapter();
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 2,
        loadImportMap: async () => ({
          imports: { loaded: "single" },
        }),
      });

      const loaded = await preloader.preload("/release-a", adapter, "project", {
        projectDir: "/release-a",
        contentSourceId: "source-a",
      });

      assertEquals(await preloader.getCached("project"), loaded);
      assertEquals(
        await preloader.getCached("project", { contentSourceId: "source-a" }),
        undefined,
      );
    });

    it("does not guess a project-id cache lookup across multiple variants", async () => {
      const adapter = createMinimalAdapter();
      let loads = 0;
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 2,
        loadImportMap: async () => ({
          imports: { loaded: String(++loads) },
        }),
      });

      await preloader.preload("/release-a", adapter, "project", {
        projectDir: "/release-a",
        contentSourceId: "source-a",
      });
      await preloader.preload("/release-b", adapter, "project", {
        projectDir: "/release-b",
        contentSourceId: "source-b",
      });

      assertEquals(await preloader.getCached("project"), undefined);
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

    it("rejects accessor-backed projectDir after inherited descriptor poisoning", async () => {
      const originalValue = Object.getOwnPropertyDescriptor(Object.prototype, "value");
      let getterCalls = 0;
      let accessorError: unknown;
      const context = Object.defineProperty({}, "projectDir", {
        enumerable: true,
        get() {
          getterCalls++;
          return "/accessed-project";
        },
      });

      try {
        Object.defineProperty(Object.prototype, "value", {
          configurable: true,
          value: "/inherited-project",
        });
        try {
          await getCachedImportMap("inherited-project", context);
        } catch (error) {
          accessorError = error;
        }
      } finally {
        if (originalValue) Object.defineProperty(Object.prototype, "value", originalValue);
        else Reflect.deleteProperty(Object.prototype, "value");
      }

      assertEquals(accessorError instanceof TypeError, true);
      assertStringIncludes((accessorError as Error).message, "cannot be an accessor");
      assertEquals(getterCalls, 0);
    });

    it("preserves project-id lookup compatibility only for one unambiguous variant", async () => {
      const preloader = new ImportMapPreloader({
        loadImportMap: () =>
          Promise.resolve({
            imports: { package: "https://example.com/package.ts" },
          }),
      });
      const adapter = createMinimalAdapter();

      await preloader.preload("/release/project", adapter, "project-id", {
        contentSourceId: "release-1",
      });

      const cached = await preloader.getCached("project-id");
      assertEquals(cached?.imports?.package, "https://example.com/package.ts");

      await preloader.preload("/branch/project", adapter, "project-id", {
        contentSourceId: "branch-1",
      });
      assertEquals(await preloader.getCached("project-id"), undefined);
      assertEquals(
        (await preloader.getCached("project-id", {
          projectDir: "/release/project",
          contentSourceId: "release-1",
        }))?.imports?.package,
        "https://example.com/package.ts",
      );
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

    it("rejects load timeouts that cannot be represented by the host timer", () => {
      assertThrows(
        () =>
          new ImportMapPreloader({
            loadTimeoutMs: MAX_TIMER_DELAY_MS + 1,
          }),
        RangeError,
        `loadTimeoutMs must not exceed ${MAX_TIMER_DELAY_MS}`,
      );
    });

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
      assertStrictEquals(cachedReplacement, replacement);
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
      assertStrictEquals(cached, replacement);
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

      const postClear = preloader.preload(
        "/project-a",
        adapter,
        "project-a",
        context,
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
      const reloaded = await postClear;
      assertEquals(reloaded.imports?.loaded, "2");
      assertStrictEquals(await preloader.getCached("project-a", context), reloaded);
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

    it("waits for in-flight project capacity instead of failing renders", async () => {
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
      const queued = preloader.preload("/project-b", adapter, "project-b");
      await waitForLoadCount(loads, 1);
      assertEquals(loads.length, 1);

      loads[0]!.resolve({ imports: { source: "a" } });
      const firstResult = await first;
      assertEquals(firstResult.imports?.source, "a");
      assertStrictEquals(await sameKey, firstResult);

      await waitForLoadCount(loads, 2);
      loads[1]!.resolve({ imports: { source: "b" } });
      assertEquals((await queued).imports?.source, "b");
    });

    it("waits for in-flight variant capacity across explicit invalidation", async () => {
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
      const sourceA = { contentSourceId: "source-a", projectDir: "/project" };
      const sourceB = { contentSourceId: "source-b", projectDir: "/project" };

      const first = preloader.preload("/project", adapter, "project", sourceA);
      const queued = preloader.preload("/project", adapter, "project", sourceB);
      preloader.clear("project");
      await waitForLoadCount(loads, 1);
      assertEquals(loads.length, 1);

      loads[0]!.resolve({ imports: { source: "a" } });
      await first;
      await waitForLoadCount(loads, 2);
      loads[1]!.resolve({ imports: { source: "b" } });
      assertEquals((await queued).imports?.source, "b");
      assertEquals(await preloader.getCached("project", sourceA), undefined);
      assertEquals((await preloader.getCached("project", sourceB))?.imports?.source, "b");
    });

    it("returns undefined from getCached when identity capacity is occupied", async () => {
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

      const first = preloader.preload("/project", adapter, "project", {
        contentSourceId: "source-a",
      });
      await waitForLoadCount(loads, 1);

      assertEquals(
        await preloader.getCached("project", { contentSourceId: "source-b" }),
        undefined,
      );

      loads[0]!.resolve({ imports: { source: "a" } });
      await first;
    });

    it("counts cleared underlying work against the total project bound", async () => {
      const adapter = createMinimalAdapter();
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      const preloader = new ImportMapPreloader({
        maxProjects: 2,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadTimeoutMs: TIMEOUT_NOT_UNDER_TEST_MS,
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });

      const cached = preloader.preload("/cached", adapter, "cached");
      await waitForLoadCount(loads, 1);
      loads[0]!.resolve({ imports: { source: "cached" } });
      await cached;

      const cleared = preloader.preload("/project-a", adapter, "project-a");
      await waitForLoadCount(loads, 2);
      preloader.clear("project-a");

      const activeB = preloader.preload("/project-b", adapter, "project-b");
      await waitForLoadCount(loads, 3);
      const queuedD = preloader.preload("/project-d", adapter, "project-d");
      await Promise.resolve();
      assertEquals(loads.length, 3);

      loads[1]!.resolve({ imports: { source: "late-a" } });
      assertEquals((await cleared).imports?.source, "late-a");
      await waitForLoadCount(loads, 4);
      loads[2]!.resolve({ imports: { source: "b" } });
      loads[3]!.resolve({ imports: { source: "d" } });
      assertEquals((await activeB).imports?.source, "b");
      assertEquals((await queuedD).imports?.source, "d");
    });

    it("keeps timed-out underlying work scoped to its project capacity", async () => {
      const adapter = createMinimalAdapter();
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      const timers = createInertTimers();
      const preloader = new ImportMapPreloader({
        maxProjects: 2,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadTimeoutMs: TIMEOUT_NOT_UNDER_TEST_MS,
        setTimer: timers.setTimer,
        cancelTimer: timers.cancelTimer,
        monotonicNow: () => 0,
        now: () => 1,
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });

      // Both deadlines below are the subject of the test, so they are fired
      // explicitly. The frozen clocks keep every other load in flight for the
      // rest of the test no matter how long the host takes to get there.
      const hungA = preloader.preload("/hung-a", adapter, "hung-a");
      await waitForLoadCount(loads, 1);
      const hungARejected = assertRejects(
        () => hungA,
        RangeError,
        "load timed out",
      );
      await fireWhenArmed(timers, "hung-a load");
      await hungARejected;

      const capacityBlocked = assertRejects(
        () => preloader.preload("/hung-a", adapter, "hung-a"),
        RangeError,
        "capacity wait timed out",
      );
      await fireWhenArmed(timers, "hung-a capacity wait");
      await capacityBlocked;
      assertEquals(loads.length, 1);

      const hungB = preloader.preload("/hung-b", adapter, "hung-b");
      await waitForLoadCount(loads, 2);
      const nextBlockedByCapacity = preloader.preload("/next", adapter, "next");
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      assertEquals(loads.length, 2);

      loads[1]!.resolve({ imports: { source: "b" } });
      assertEquals((await settleWithin(hungB, "hung-b preload")).imports?.source, "b");
      loads[0]!.resolve({ imports: { source: "late" } });
      await waitForLoadCount(loads, 3);
      loads[2]!.resolve({ imports: { source: "next" } });
      assertEquals(
        (await settleWithin(nextBlockedByCapacity, "next preload")).imports?.source,
        "next",
      );

      await Promise.resolve();
      const sameProjectRecovered = preloader.preload("/hung-a", adapter, "hung-a");
      await waitForLoadCount(loads, 4);
      loads[3]!.resolve({ imports: { source: "hung-recovered" } });
      assertEquals(
        (await settleWithin(sameProjectRecovered, "hung-a recovery preload")).imports
          ?.source,
        "hung-recovered",
      );
    });

    it("reserves project capacity before an invalidated load times out", async () => {
      const adapter = createMinimalAdapter();
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      const preloader = new ImportMapPreloader({
        maxProjects: 2,
        maxVariantsPerProject: 2,
        ttlMs: 1_000,
        loadTimeoutMs: TIMEOUT_NOT_UNDER_TEST_MS,
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });

      const invalidated = preloader.preload("/project-a", adapter, "project-a");
      await waitForLoadCount(loads, 1);
      preloader.clear("project-a");

      const second = preloader.preload("/project-b", adapter, "project-b");
      await waitForLoadCount(loads, 2);
      const queued = preloader.preload("/project-c", adapter, "project-c");
      for (let attempt = 0; attempt < 10; attempt++) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
      assertEquals(loads.length, 2);

      loads[1]!.resolve({ imports: { source: "b" } });
      assertEquals((await second).imports?.source, "b");
      await waitForLoadCount(loads, 3);
      loads[2]!.resolve({ imports: { source: "c" } });
      assertEquals((await queued).imports?.source, "c");

      loads[0]!.resolve({ imports: { source: "a" } });
      assertEquals((await invalidated).imports?.source, "a");
    });

    it("counts timed-out work against the total project bound", async () => {
      const adapter = createMinimalAdapter();
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      const timers = createInertTimers();
      const preloader = new ImportMapPreloader({
        maxProjects: 2,
        maxVariantsPerProject: 1,
        ttlMs: 1_000,
        loadTimeoutMs: TIMEOUT_NOT_UNDER_TEST_MS,
        setTimer: timers.setTimer,
        cancelTimer: timers.cancelTimer,
        monotonicNow: () => 0,
        now: () => 1,
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });

      // Only project-a's deadline is under test; it is fired explicitly so the
      // later loads can stay in flight for as long as the host needs.
      const timedOutA = preloader.preload("/project-a", adapter, "project-a");
      await waitForLoadCount(loads, 1);
      const timedOutARejected = assertRejects(
        () => timedOutA,
        RangeError,
        "load timed out",
      );
      await fireWhenArmed(timers, "project-a load");
      await timedOutARejected;

      const activeB = preloader.preload("/project-b", adapter, "project-b");
      await waitForLoadCount(loads, 2);
      const queuedC = preloader.preload("/project-c", adapter, "project-c");
      await Promise.resolve();
      assertEquals(loads.length, 2);

      loads[0]!.resolve({ imports: { source: "late-a" } });
      await waitForLoadCount(loads, 3);
      loads[1]!.resolve({ imports: { source: "b" } });
      loads[2]!.resolve({ imports: { source: "c" } });
      assertEquals(
        (await settleWithin(activeB, "project-b preload")).imports?.source,
        "b",
      );
      assertEquals(
        (await settleWithin(queuedC, "project-c preload")).imports?.source,
        "c",
      );
    });

    it("does not miss capacity released before a waiter observes its signal", async () => {
      const adapter = createMinimalAdapter();
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      let releaseDuringAdmission = false;
      let admissionClockReads = 0;
      let clock = 0;
      const timers = createInertTimers();
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 2,
        ttlMs: 1_000,
        loadTimeoutMs: TIMEOUT_NOT_UNDER_TEST_MS,
        setTimer: timers.setTimer,
        cancelTimer: timers.cancelTimer,
        now: () => {
          if (releaseDuringAdmission && admissionClockReads++ === 0) {
            loads[0]!.resolve({ imports: { source: "a" } });
          }
          return ++clock;
        },
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });

      const first = preloader.preload("/project", adapter, "project", {
        contentSourceId: "source-a",
      });
      // Wait for source-a to reach the loader before starting source-b. The
      // loader runs in a microtask after an async identity hash, so two
      // concurrently started preloads can reach it in either order under load,
      // and this test indexes `loads` positionally.
      await waitForLoadCount(loads, 1);
      const unrelated = preloader.preload("/project", adapter, "project", {
        contentSourceId: "source-b",
      });
      await waitForLoadCount(loads, 2);

      releaseDuringAdmission = true;
      const queued = preloader.preload("/project", adapter, "project", {
        contentSourceId: "source-c",
      });

      await waitForLoadCount(loads, 3);
      loads[2]!.resolve({ imports: { source: "c" } });
      assertEquals((await settleWithin(first, "first preload")).imports?.source, "a");
      assertEquals((await settleWithin(queued, "queued preload")).imports?.source, "c");
      loads[1]!.resolve({ imports: { source: "b" } });
      assertEquals(
        (await settleWithin(unrelated, "unrelated preload")).imports?.source,
        "b",
      );
    });

    it("measures the capacity deadline on the injected monotonic clock", async () => {
      // The injected monotonic clock is frozen while host time keeps running.
      // A capacity-blocked caller must therefore never reach its deadline: if
      // the retry still consulted performance.now, real time would sail past
      // loadTimeoutMs and reject it. Keeping this seam separate from `now` also
      // matters, because `now` defaults to Date.now, which NTP can move
      // backwards, and deadline arithmetic needs a monotonic source.
      const adapter = createMinimalAdapter();
      const loads: Array<ReturnType<typeof createDeferred<ImportMapConfig>>> = [];
      const timers = createInertTimers();
      const preloader = new ImportMapPreloader({
        maxProjects: 1,
        maxVariantsPerProject: 1,
        ttlMs: TIMEOUT_NOT_UNDER_TEST_MS,
        loadTimeoutMs: 50,
        setTimer: timers.setTimer,
        cancelTimer: timers.cancelTimer,
        monotonicNow: () => 1_000,
        now: () => 1,
        loadImportMap: () => {
          const load = createDeferred<ImportMapConfig>();
          loads.push(load);
          return load.promise;
        },
      });

      const occupying = preloader.preload("/project", adapter, "project", {
        contentSourceId: "source-a",
      });
      await waitForLoadCount(loads, 1);

      const blocked = preloader.preload("/project", adapter, "project", {
        contentSourceId: "source-b",
      });

      let settledEarly = false;
      const observed = blocked.then(
        () => {
          settledEarly = true;
        },
        () => {
          settledEarly = true;
        },
      );
      // Host time must genuinely pass loadTimeoutMs, otherwise this proves
      // nothing: a retry still reading performance.now would also be inside its
      // deadline, and the test would pass with the bug present. Yield on timed
      // sleeps rather than a fixed turn count, so the wait is bounded by the
      // real clock advancing instead of by a turn budget that can run out first.
      const hostDeadline = performance.now() + 50;
      while (performance.now() < hostDeadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 5));
      }
      assertEquals(performance.now() >= hostDeadline, true);
      assertEquals(settledEarly, false);

      // Releasing capacity, not the passage of host time, is what lets it run.
      loads[0]!.resolve({ imports: { source: "a" } });
      assertEquals(
        (await settleWithin(occupying, "occupying preload")).imports?.source,
        "a",
      );
      await waitForLoadCount(loads, 2);
      loads[1]!.resolve({ imports: { source: "b" } });
      assertEquals(
        (await settleWithin(blocked, "capacity-blocked preload")).imports?.source,
        "b",
      );
      await observed;
    });

    it("keeps variant identity and capacity deterministic after primordial poisoning", async () => {
      const worker = await createRuntimeWorker(
        new URL("./preloader-primordial-poisoning.worker.ts", import.meta.url),
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
          const timeoutId = setTimeout(
            () => reject(new Error("primordial poisoning worker timed out")),
            30_000,
          );
          worker.subscribe((value) => {
            clearTimeout(timeoutId);
            const message = value as
              | { ok: true; result: Parameters<typeof resolve>[0] }
              | { ok: false; error: string };
            if (message.ok) resolve(message.result);
            else reject(new Error(message.error));
          }, (error) => {
            clearTimeout(timeoutId);
            reject(error);
          });
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
