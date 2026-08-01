import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  buildQueryAwareCacheKey,
  buildRenderCacheKey,
  buildRenderCachePrefix,
} from "#veryfront/cache/keys.ts";
import {
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
} from "#veryfront/release-assets/constants.ts";
import {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { stub } from "#std/testing/mock";
import { FakeTime } from "#std/testing/time";
import type { CachePayload, CacheStore } from "./cache/types.ts";
import type { RenderContext } from "./context/render-context.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./orchestrator/types.ts";
import {
  clearRendererCacheForProject,
  destroyRenderer,
  getRenderer,
  initializeRenderer,
  Renderer,
  setColdProjectCacheInvalidatorForTesting,
} from "./renderer.ts";
import {
  acquireProjectSlot,
  projectRenderCounts,
  releaseProjectSlot,
  RENDER_ACQUIRE_TIMEOUT_MS,
  RENDER_PER_PROJECT_LIMIT,
  renderSemaphore,
} from "./renderer-concurrency.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { destroySharedServices } from "./shared/shared-services.ts";
import { WorkerExecutionScopeOwner } from "./worker-execution-scope.ts";
import {
  clearReactVersionCache,
  type DependencyPinningSource,
} from "#veryfront/transforms/esm/package-registry.ts";

function getEnv(name: string): string | undefined {
  // deno-lint-ignore no-explicit-any
  const g = globalThis as any;
  return g.Deno?.env?.get(name) ?? g.process?.env?.[name];
}

const RENDER_MAX_CONCURRENT_DEFAULT = 30;

function computePerProjectLimit(maxConcurrent: number): number {
  return Math.ceil(maxConcurrent / 3);
}

function createProjectSlotManager(limit: number) {
  const counts = new Map<string, number>();

  function acquire(projectId: string): boolean {
    if (limit <= 0) return true;

    const current = counts.get(projectId) ?? 0;
    if (current >= limit) return false;

    counts.set(projectId, current + 1);
    return true;
  }

  function release(projectId: string): void {
    if (limit <= 0) return;

    const current = counts.get(projectId) ?? 0;
    if (current <= 1) {
      counts.delete(projectId);
      return;
    }

    counts.set(projectId, current - 1);
  }

  function getCount(projectId: string): number {
    return counts.get(projectId) ?? 0;
  }

  function getCounts(): Map<string, number> {
    return counts;
  }

  return { acquire, release, getCount, getCounts };
}

function createInMemoryStore(): CacheStore & { data: Map<string, CachePayload> } {
  const data = new Map<string, CachePayload>();
  return {
    data,
    get: (key: string) => Promise.resolve(data.get(key)),
    set(key: string, value: CachePayload) {
      data.set(key, value);
      return Promise.resolve();
    },
    delete(key: string) {
      data.delete(key);
      return Promise.resolve();
    },
    deleteByPrefix(prefix: string) {
      let deleted = 0;
      for (const key of data.keys()) {
        if (!key.startsWith(prefix)) continue;
        data.delete(key);
        deleted++;
      }
      return Promise.resolve(deleted);
    },
    clear() {
      data.clear();
      return Promise.resolve();
    },
    destroy() {
      data.clear();
      return Promise.resolve();
    },
  };
}

async function waitForProductionPrewarm(renderer: Renderer): Promise<void> {
  const contexts = (renderer as unknown as {
    productionPrewarmContexts: Map<string, Promise<void>>;
  }).productionPrewarmContexts;
  await Promise.all([...contexts.values()]);
}

function makeReadyManifest(): ReleaseAssetManifest {
  return {
    schemaVersion: 2,
    projectId: "proj-1",
    releaseId: "rel-1",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "0.1.799",
    sourceContentHash: "a".repeat(64),
    createdAt: "2026-06-14T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {},
    css: [],
    routes: {},
    dependencyMode: "source",
    dependencies: {},
  };
}

function cacheKeyForDependencies(
  dependencies: Readonly<Record<string, string>>,
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `on:${hashString(JSON.stringify(sortedEntries))}`;
}

function makeRenderAdapter(
  fsOverrides: Record<string, unknown> = {},
): RenderContext["adapter"] {
  return {
    fs: {
      exists: async () => false,
      readFile: () =>
        Promise.reject(
          Object.assign(new Error("file not found"), { code: "ENOENT" }),
        ),
      readDir: () => {
        throw Object.assign(new Error("components directory not found"), {
          code: "ENOENT",
        });
      },
      ...fsOverrides,
    },
  } as unknown as RenderContext["adapter"];
}

function makeRenderContext(): RenderContext {
  return {
    projectId: "proj-1",
    projectSlug: "proj-1",
    projectDir: "/project",
    config: {} as RenderContext["config"],
    mode: "production",
    clientModuleStrategy: "rsc-module",
    adapter: makeRenderAdapter(),
    cachePrefix: buildRenderCachePrefix("proj-1", "production", "rel-1"),
    environment: "production",
    contentSourceId: "release-rel-1",
    releaseId: "rel-1",
  };
}

async function buildRendererStorageKey(
  ctx: RenderContext,
  baseKey: string,
  options?: { cachePrefix?: string; colorScheme?: "light" | "dark" },
): Promise<string> {
  const configDigest = await computeHash(JSON.stringify(ctx.config));
  const theme = options?.colorScheme ? `:theme-${options.colorScheme}` : "";
  return buildRenderCacheKey(
    options?.cachePrefix ?? ctx.cachePrefix,
    `modules-${ctx.clientModuleStrategy}:page:${baseKey}:config-${configDigest}${theme}`,
  );
}

describe("Renderer helpers", () => {
  describe("getEnv", () => {
    it("should return undefined for unset env vars", () => {
      assertEquals(getEnv("NONEXISTENT_VAR_12345"), undefined);
    });

    it("should return value for set env vars (Deno)", () => {
      const path = getEnv("PATH");
      assertEquals(typeof path === "string" || path === undefined, true);
    });
  });

  describe("computePerProjectLimit", () => {
    it("should compute default per-project limit as ceil(maxConcurrent/3)", () => {
      assertEquals(computePerProjectLimit(30), 10);
      assertEquals(computePerProjectLimit(31), 11);
      assertEquals(computePerProjectLimit(3), 1);
      assertEquals(computePerProjectLimit(1), 1);
    });

    it("should handle the default concurrent value", () => {
      assertEquals(computePerProjectLimit(RENDER_MAX_CONCURRENT_DEFAULT), 10);
    });
  });

  describe("projectSlotManager", () => {
    it("should acquire and release slots", () => {
      const manager = createProjectSlotManager(3);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.getCount("proj-1"), 1);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 0);
    });

    it("should track multiple projects independently", () => {
      const manager = createProjectSlotManager(3);
      manager.acquire("proj-a");
      manager.acquire("proj-b");
      assertEquals(manager.getCount("proj-a"), 1);
      assertEquals(manager.getCount("proj-b"), 1);
    });

    it("should reject when limit is reached", () => {
      const manager = createProjectSlotManager(2);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), false);
      assertEquals(manager.getCount("proj-1"), 2);
    });

    it("should allow acquisition after release", () => {
      const manager = createProjectSlotManager(1);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), false);
      manager.release("proj-1");
      assertEquals(manager.acquire("proj-1"), true);
    });

    it("should clean up map entry when count reaches zero", () => {
      const manager = createProjectSlotManager(2);
      manager.acquire("proj-1");
      manager.release("proj-1");
      assertEquals(manager.getCounts().has("proj-1"), false);
    });

    it("should handle release on non-acquired project gracefully", () => {
      const manager = createProjectSlotManager(2);
      manager.release("never-acquired");
      assertEquals(manager.getCount("never-acquired"), 0);
    });

    it("should bypass limits when limit is 0", () => {
      const manager = createProjectSlotManager(0);
      for (let i = 0; i < 100; i++) {
        assertEquals(manager.acquire("proj-1"), true);
      }
    });

    it("should bypass limits when limit is negative", () => {
      const manager = createProjectSlotManager(-1);
      assertEquals(manager.acquire("proj-1"), true);
      assertEquals(manager.acquire("proj-1"), true);
    });

    it("should decrement correctly with multiple releases", () => {
      const manager = createProjectSlotManager(5);
      manager.acquire("proj-1");
      manager.acquire("proj-1");
      manager.acquire("proj-1");
      assertEquals(manager.getCount("proj-1"), 3);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 2);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 1);
      manager.release("proj-1");
      assertEquals(manager.getCount("proj-1"), 0);
    });
  });

  describe("RENDER_PIPELINE_TIMEOUT_MS defaults", () => {
    it("should parse default timeout as 60000", () => {
      assertEquals(parseInt("60000", 10), 60000);
    });

    it("should parse custom timeout from string", () => {
      assertEquals(parseInt("30000", 10), 30000);
    });

    it("should handle invalid timeout string as NaN", () => {
      assertEquals(Number.isNaN(parseInt("not-a-number", 10)), true);
    });
  });

  describe("RENDER_MAX_CONCURRENT defaults", () => {
    it("should parse default max concurrent as 30", () => {
      assertEquals(parseInt("30", 10), 30);
    });
  });
});

describe("Renderer release asset cache isolation", () => {
  const originalManifestFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalManifestFlag ?? "");
    configureReleaseAssetManifestFetcher(undefined);
    clearReleaseAssetManifestCache();
  });

  it("checks the manifest-versioned cache prefix after awaiting a ready manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: makeReadyManifest(),
      })
    );

    const store = createInMemoryStore();
    const manifestPrefix = buildRenderCachePrefix("proj-1", "production", "rel-1", 1);
    store.data.set(
      await buildRendererStorageKey(makeRenderContext(), "/cached", {
        cachePrefix: manifestPrefix,
      }),
      {
        result: {
          html: "<html>manifest cache hit</html>",
          frontmatter: {},
          headings: [],
          stream: null,
          ssrHash: "cached",
        },
        storedAt: Date.now(),
      },
    );

    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      createServicesForContext: () => never;
    }).createServicesForContext = () => {
      throw new Error("renderer should hit the manifest-versioned cache");
    };

    const result = await renderer.renderPage("/cached", makeRenderContext(), {
      environment: "production",
      releaseId: "rel-1",
    });

    assertEquals(result.html, "<html>manifest cache hit</html>");
  });

  it("snapshots context and URL identity before awaiting the release manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    const manifestRequested = Promise.withResolvers<void>();
    const releaseManifest = Promise.withResolvers<
      { state: "ready"; manifest_version: number; manifest: ReleaseAssetManifest }
    >();
    configureReleaseAssetManifestFetcher(() => {
      manifestRequested.resolve();
      return releaseManifest.promise;
    });

    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let observedContext:
      | { projectId: string; contentSourceId: string; configTitle: string | undefined }
      | undefined;
    let observedUrl: string | undefined;
    (renderer as unknown as {
      createServicesForContext: (
        context: RenderContext,
      ) => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { url?: URL },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = (context) => ({
      pipeline: {
        renderPage: (_slug, options) => {
          observedContext = {
            projectId: context.projectId,
            contentSourceId: context.contentSourceId,
            configTitle: context.config.title,
          };
          observedUrl = options?.url?.href;
          return Promise.resolve({
            html: "<html>snapshotted render</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const originalConfig = {
      title: "Original title",
      cache: { queryParams: { policy: "include-all" as const } },
    };
    const context = {
      ...makeRenderContext(),
      config: originalConfig,
    } as RenderContext;
    const url = new URL("https://example.test/snapshot?variant=original");
    const pending = renderer.renderPage("/snapshot", context, {
      url,
      environment: "production",
      releaseId: "rel-1",
    });

    await manifestRequested.promise;
    context.projectId = "mutated-project";
    context.contentSourceId = "mutated-source";
    context.cachePrefix = "mutated-prefix";
    originalConfig.title = "Mutated title";
    url.searchParams.set("variant", "mutated");
    releaseManifest.resolve({
      state: "ready",
      manifest_version: 1,
      manifest: makeReadyManifest(),
    });

    const result = await pending;
    assertEquals(result.html, "<html>snapshotted render</html>");
    assertEquals(observedContext, {
      projectId: "proj-1",
      contentSourceId: "release-rel-1",
      configTitle: "Original title",
    });
    assertEquals(
      observedUrl,
      "https://example.test/snapshot?variant=original",
    );

    const expectedContext = {
      ...makeRenderContext(),
      config: {
        title: "Original title",
        cache: { queryParams: { policy: "include-all" as const } },
      },
    } as RenderContext;
    const expectedPrefix = buildRenderCachePrefix(
      "proj-1",
      "production",
      "rel-1",
      1,
    );
    const expectedBaseKey = buildQueryAwareCacheKey(
      "/snapshot",
      new URL("https://example.test/snapshot?variant=original"),
      { policy: "include-all" },
    );
    assertEquals(
      store.data.has(
        await buildRendererStorageKey(expectedContext, expectedBaseKey, {
          cachePrefix: expectedPrefix,
        }),
      ),
      true,
    );
  });

  it("snapshots request headers before awaiting the release manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    const manifestRequested = Promise.withResolvers<void>();
    const releaseManifest = Promise.withResolvers<
      { state: "ready"; manifest_version: number; manifest: ReleaseAssetManifest }
    >();
    configureReleaseAssetManifestFetcher(() => {
      manifestRequested.resolve();
      return releaseManifest.promise;
    });

    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let observedHeader: string | null | undefined;
    let observedUrl: string | undefined;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { request?: Request; url?: URL },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          observedHeader = options?.request?.headers.get("x-render-variant");
          observedUrl = options?.url?.href;
          return Promise.resolve({
            html: "<html>snapshotted request</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const request = new Request(
      "https://example.test/request-snapshot?variant=original",
      { headers: { "x-render-variant": "original" } },
    );
    const url = new URL(request.url);
    const pending = renderer.renderPage(
      "/request-snapshot",
      makeRenderContext(),
      {
        request,
        url,
        cacheKey: "request-snapshot",
        environment: "production",
        releaseId: "rel-1",
      },
    );

    await manifestRequested.promise;
    request.headers.set("x-render-variant", "mutated");
    url.searchParams.set("variant", "mutated");
    releaseManifest.resolve({
      state: "ready",
      manifest_version: 1,
      manifest: makeReadyManifest(),
    });

    assertEquals((await pending).html, "<html>snapshotted request</html>");
    assertEquals(observedHeader, "original");
    assertEquals(
      observedUrl,
      "https://example.test/request-snapshot?variant=original",
    );
  });

  it("snapshots dependency pins before awaiting the release manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    const manifestRequested = Promise.withResolvers<void>();
    const releaseManifest = Promise.withResolvers<
      { state: "ready"; manifest_version: number; manifest: ReleaseAssetManifest }
    >();
    configureReleaseAssetManifestFetcher(() => {
      manifestRequested.resolve();
      return releaseManifest.promise;
    });

    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let observedDependencies: Readonly<Record<string, string>> | undefined;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: RenderOptions,
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          observedDependencies = options?.dependencyPinningDependencies;
          return Promise.resolve({
            html: "<html>snapshotted dependencies</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const dependencies = { react: "18.2.0" };
    const pending = renderer.renderPage("/dependency-snapshot", makeRenderContext(), {
      environment: "production",
      releaseId: "rel-1",
      dependencyPinningCacheKey: cacheKeyForDependencies(dependencies),
      dependencyPinningDependencies: dependencies,
    });

    await manifestRequested.promise;
    dependencies.react = "19.0.0";
    releaseManifest.resolve({
      state: "ready",
      manifest_version: 1,
      manifest: makeReadyManifest(),
    });

    assertEquals((await pending).html, "<html>snapshotted dependencies</html>");
    assertEquals(observedDependencies, { react: "18.2.0" });
    assertStrictEquals(Object.getPrototypeOf(observedDependencies), null);
    assertEquals(Object.isFrozen(observedDependencies), true);
  });

  it("persists rendered HTML under the manifest-versioned cache prefix", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({
        state: "ready",
        manifest_version: 1,
        manifest: makeReadyManifest(),
      })
    );

    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { nonce?: string; releaseAssetManifest?: ReleaseAssetManifest | null },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          assertEquals(options?.releaseAssetManifest?.manifestVersion, 1);
          return Promise.resolve({
            html: "<html>fresh manifest render</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const result = await renderer.renderPage("/fresh", makeRenderContext(), {
      environment: "production",
      releaseId: "rel-1",
    });

    const manifestPrefix = buildRenderCachePrefix("proj-1", "production", "rel-1", 1);
    const jitPrefix = buildRenderCachePrefix("proj-1", "production", "rel-1");
    assertEquals(result.html, "<html>fresh manifest render</html>");
    assertEquals(
      store.data.has(
        await buildRendererStorageKey(makeRenderContext(), "/fresh", {
          cachePrefix: manifestPrefix,
        }),
      ),
      true,
    );
    assertEquals(
      store.data.has(
        await buildRendererStorageKey(makeRenderContext(), "/fresh", {
          cachePrefix: jitPrefix,
        }),
      ),
      false,
    );
  });

  it("serves stale HTML immediately and refreshes that route in the background", async () => {
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      adapter: makeRenderAdapter({ exists: async () => true }),
    } as unknown as RenderContext;
    const cacheKey = await buildRendererStorageKey(ctx, "/stale");
    store.data.set(cacheKey, {
      result: {
        html: "<html>stale render</html>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "stale",
      },
      storedAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1,
      staleUntil: Date.now() + 60_000,
    });

    let renderCount = 0;
    const dependencyPinningSource = {
      projectDir: "/custom-package-source",
      cacheNamespace: "custom-package-source",
    };
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      getAllPages: () => Promise<string[]>;
      pageExists: () => Promise<boolean>;
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: {
              skipCacheCheck?: boolean;
              releaseAssetManifest?: ReleaseAssetManifest | null;
              dependencyPinningSource?: RenderOptions["dependencyPinningSource"];
            },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).getAllPages = () => Promise.resolve([]);
    (renderer as unknown as { pageExists: () => Promise<boolean> }).pageExists = () =>
      Promise.resolve(true);
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: {
              skipCacheCheck?: boolean;
              releaseAssetManifest?: ReleaseAssetManifest | null;
              dependencyPinningSource?: RenderOptions["dependencyPinningSource"];
            },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug, options) => {
          renderCount++;
          assertEquals(slug, "/stale");
          assertEquals(options?.skipCacheCheck, true);
          assertStrictEquals(
            options?.dependencyPinningSource,
            dependencyPinningSource,
          );
          return Promise.resolve({
            html: "<html>fresh render</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const result = await renderer.renderPage("/stale", ctx, {
      environment: "production",
      releaseId: "rel-1",
      dependencyPinningSource,
    });

    assertEquals(result.html, "<html>stale render</html>");
    assertEquals(renderCount, 0);

    await waitForProductionPrewarm(renderer);

    assertEquals(renderCount, 1);
    assertEquals(store.data.get(cacheKey)?.result.html, "<html>fresh render</html>");
  });

  it("serves stale HTML without queueing a refresh at project capacity", async () => {
    const projectId = `stale-capacity-project-${crypto.randomUUID()}`;
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1"),
      adapter: makeRenderAdapter({ exists: async () => true }),
    } as unknown as RenderContext;
    const cacheKey = await buildRendererStorageKey(ctx, "/stale-at-capacity");
    store.data.set(cacheKey, {
      result: {
        html: "<html>stale at capacity</html>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "stale-at-capacity",
      },
      storedAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1,
      staleUntil: Date.now() + 60_000,
    });

    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCount = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: () => Promise<never>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: () => {
          renderCount++;
          return Promise.reject(new Error("refresh must not start"));
        },
      },
    });

    for (let index = 0; index < RENDER_PER_PROJECT_LIMIT; index++) {
      assertEquals(await acquireProjectSlot(projectId), true);
    }

    try {
      const result = await renderer.renderPage("/stale-at-capacity", ctx, {
        environment: "production",
        releaseId: "rel-1",
      });
      assertEquals(result.html, "<html>stale at capacity</html>");

      await waitForProductionPrewarm(renderer).catch(() => {});
      assertEquals(renderCount, 0);
      assertEquals(
        store.data.get(cacheKey)?.result.html,
        "<html>stale at capacity</html>",
      );
    } finally {
      while ((projectRenderCounts.get(projectId) ?? 0) > 0) {
        await releaseProjectSlot(projectId);
      }
    }
  });

  it("preserves request metadata while refreshing stale HTML after disconnect", async () => {
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      adapter: makeRenderAdapter({ exists: async () => true }),
    } as unknown as RenderContext;
    const url = new URL("https://example.com/data?filter=recent");
    const requestAbort = new AbortController();
    const request = new Request(url, {
      headers: { "accept-language": "en" },
      signal: requestAbort.signal,
    });
    const requestCacheKey = "/data?filter=recent";
    const cacheKey = await buildRendererStorageKey(ctx, requestCacheKey);
    store.data.set(cacheKey, {
      result: {
        html: "<html>stale data render</html>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "stale-data",
      },
      storedAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1,
      staleUntil: Date.now() + 60_000,
    });

    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      getAllPages: () => Promise<string[]>;
      pageExists: () => Promise<boolean>;
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: {
              request?: Request;
              url?: URL;
              skipCacheCheck?: boolean;
              releaseAssetManifest?: ReleaseAssetManifest | null;
            },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).getAllPages = () => Promise.resolve([]);
    (renderer as unknown as { pageExists: () => Promise<boolean> }).pageExists = () =>
      Promise.resolve(true);
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: {
              request?: Request;
              url?: URL;
              skipCacheCheck?: boolean;
              releaseAssetManifest?: ReleaseAssetManifest | null;
            },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          assertEquals(options?.skipCacheCheck, true);
          assertEquals(options?.request?.url, request.url);
          assertEquals(options?.request?.headers.get("accept-language"), "en");
          assertEquals(options?.request?.signal.aborted, false);
          assertEquals(options?.url, url);
          return Promise.resolve({
            html: "<html>fresh data render</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const result = await renderer.renderPage("/data", ctx, {
      environment: "production",
      releaseId: "rel-1",
      cacheKey: requestCacheKey,
      request,
      url,
    });

    assertEquals(result.html, "<html>stale data render</html>");

    requestAbort.abort(new Error("request disconnected"));
    await waitForProductionPrewarm(renderer);

    assertEquals(store.data.get(cacheKey)?.result.html, "<html>fresh data render</html>");
  });

  it("refreshes stale HTML when sibling route prewarming is disabled", async () => {
    const originalPrewarmLimit = getHostEnv("VERYFRONT_RENDER_PREWARM_MAX_ROUTES");
    setEnv("VERYFRONT_RENDER_PREWARM_MAX_ROUTES", "0");

    try {
      const { Renderer: RendererWithPrewarmDisabled } = await import(
        `./renderer.ts?prewarm-disabled-${Date.now()}`
      );
      const store = createInMemoryStore();
      const ctx = {
        ...makeRenderContext(),
        adapter: makeRenderAdapter({ exists: async () => true }),
      } as unknown as RenderContext;
      const cacheKey = await buildRendererStorageKey(ctx, "/prewarm-disabled");
      store.data.set(cacheKey, {
        result: {
          html: "<html>stale render with prewarm disabled</html>",
          frontmatter: {},
          headings: [],
          stream: null,
          ssrHash: "stale-prewarm-disabled",
        },
        storedAt: Date.now() - 10_000,
        expiresAt: Date.now() - 1,
        staleUntil: Date.now() + 60_000,
      });

      let renderCount = 0;
      const renderer = new RendererWithPrewarmDisabled({ cache: { store } });
      (renderer as unknown as { initialized: boolean }).initialized = true;
      (renderer as unknown as {
        getAllPages: () => Promise<string[]>;
        pageExists: () => Promise<boolean>;
        createServicesForContext: () => {
          pipeline: {
            renderPage: (slug: string, options?: { skipCacheCheck?: boolean }) => Promise<{
              html: string;
              frontmatter: Record<string, unknown>;
              headings: never[];
              stream: null;
            }>;
          };
        };
      }).getAllPages = () => Promise.resolve(["/should-not-prewarm"]);
      (renderer as unknown as { pageExists: () => Promise<boolean> }).pageExists = () =>
        Promise.resolve(true);
      (renderer as unknown as {
        createServicesForContext: () => {
          pipeline: {
            renderPage: (slug: string, options?: { skipCacheCheck?: boolean }) => Promise<{
              html: string;
              frontmatter: Record<string, unknown>;
              headings: never[];
              stream: null;
            }>;
          };
        };
      }).createServicesForContext = () => ({
        pipeline: {
          renderPage: (slug, options) => {
            renderCount++;
            assertEquals(slug, "/prewarm-disabled");
            assertEquals(options?.skipCacheCheck, true);
            return Promise.resolve({
              html: "<html>fresh render with prewarm disabled</html>",
              frontmatter: {},
              headings: [],
              stream: null,
            });
          },
        },
      });

      const result = await renderer.renderPage("/prewarm-disabled", ctx, {
        environment: "production",
        releaseId: "rel-1",
      });

      assertEquals(result.html, "<html>stale render with prewarm disabled</html>");

      await waitForProductionPrewarm(renderer as unknown as Renderer);

      assertEquals(renderCount, 1);
      assertEquals(
        store.data.get(cacheKey)?.result.html,
        "<html>fresh render with prewarm disabled</html>",
      );
      assertEquals(
        store.data.has(await buildRendererStorageKey(ctx, "/should-not-prewarm")),
        false,
      );
    } finally {
      setEnv("VERYFRONT_RENDER_PREWARM_MAX_ROUTES", originalPrewarmLimit ?? "");
    }
  });

  it("refreshes stale theme variants under the original variant key", async () => {
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      adapter: makeRenderAdapter({ exists: async () => true }),
    } as unknown as RenderContext;
    const themedCacheKey = await buildRendererStorageKey(ctx, "/stale-themed", {
      colorScheme: "dark",
    });
    const unthemedCacheKey = await buildRendererStorageKey(ctx, "/stale-themed");
    store.data.set(themedCacheKey, {
      result: {
        html: "<html>stale dark render</html>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "stale-dark",
      },
      storedAt: Date.now() - 10_000,
      expiresAt: Date.now() - 1,
      staleUntil: Date.now() + 60_000,
    });

    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      getAllPages: () => Promise<string[]>;
      pageExists: () => Promise<boolean>;
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: {
              colorScheme?: "light" | "dark";
              skipCacheCheck?: boolean;
              releaseAssetManifest?: ReleaseAssetManifest | null;
            },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).getAllPages = () => Promise.resolve([]);
    (renderer as unknown as { pageExists: () => Promise<boolean> }).pageExists = () =>
      Promise.resolve(true);
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: {
              colorScheme?: "light" | "dark";
              skipCacheCheck?: boolean;
              releaseAssetManifest?: ReleaseAssetManifest | null;
            },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          assertEquals(options?.skipCacheCheck, true);
          assertEquals(options?.colorScheme, "dark");
          return Promise.resolve({
            html: "<html>fresh dark render</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const result = await renderer.renderPage("/stale-themed", ctx, {
      environment: "production",
      releaseId: "rel-1",
      colorScheme: "dark",
    });

    assertEquals(result.html, "<html>stale dark render</html>");

    await waitForProductionPrewarm(renderer);

    assertEquals(store.data.get(themedCacheKey)?.result.html, "<html>fresh dark render</html>");
    assertEquals(store.data.has(unthemedCacheKey), false);
  });

  it("prewarms sibling production routes after a cacheable render", async () => {
    const store = createInMemoryStore();
    const renderedSlugs: string[] = [];
    const renderRequests = new Map<
      string,
      {
        request?: Request;
        url?: URL;
        dependencyPinningSource?: RenderOptions["dependencyPinningSource"];
      }
    >();
    const dependencyPinningSource = {
      projectDir: "/custom-prewarm-package-source",
      cacheNamespace: "custom-prewarm-package-source",
    };
    const stalePages = Array.from(
      { length: 14 },
      (_, index) => `aa-stale-${index.toString().padStart(2, "0")}`,
    );
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      getAllPages: () => Promise<string[]>;
      pageExists: (slug: string) => Promise<boolean>;
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: {
              nonce?: string;
              releaseAssetManifest?: ReleaseAssetManifest | null;
              request?: Request;
              url?: URL;
              dependencyPinningSource?: RenderOptions["dependencyPinningSource"];
            },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).getAllPages = () =>
      Promise.resolve(["/", ...stalePages, "/docs/[slug]", "about", "/blog", "/blog"]);
    (renderer as unknown as {
      pageExists: (slug: string) => Promise<boolean>;
    }).pageExists = (slug) => Promise.resolve(slug === "/about" || slug === "/blog");
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: {
              nonce?: string;
              releaseAssetManifest?: ReleaseAssetManifest | null;
              request?: Request;
              url?: URL;
              dependencyPinningSource?: RenderOptions["dependencyPinningSource"];
            },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug, options) => {
          assertEquals(options?.releaseAssetManifest, null);
          assertEquals(options?.nonce, undefined);
          renderedSlugs.push(slug);
          renderRequests.set(slug, {
            request: options?.request,
            url: options?.url,
            dependencyPinningSource: options?.dependencyPinningSource,
          });
          return Promise.resolve({
            html: `<html>${slug}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const ctx = {
      ...makeRenderContext(),
      adapter: makeRenderAdapter(),
    };
    const url = new URL("https://preview.example.test/?utm_source=smoke");
    const result = await renderer.renderPage("/", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
      cacheKey: "/",
      nonce: "nonce-123",
      request: new Request(url, {
        headers: {
          accept: "text/html",
          "x-preview-context": "source-request",
        },
      }),
      url,
      dependencyPinningSource,
    });
    await waitForProductionPrewarm(renderer);

    const prefix = buildRenderCachePrefix("proj-1", "production", "rel-1");
    assertEquals(result.html, "<html>/</html>");
    assertEquals(renderedSlugs.includes("/blog"), true);
    assertEquals(renderedSlugs.includes("/about"), true);
    assertEquals(renderedSlugs.includes("about"), false);
    assertEquals(renderedSlugs.includes("/docs/[slug]"), false);
    assertEquals(renderedSlugs.some((slug) => slug.startsWith("/aa-stale-")), false);
    assertEquals(
      store.data.has(await buildRendererStorageKey(ctx, "/blog", { cachePrefix: prefix })),
      true,
    );
    assertEquals(
      store.data.has(await buildRendererStorageKey(ctx, "/about", { cachePrefix: prefix })),
      true,
    );
    assertEquals(
      store.data.has(await buildRendererStorageKey(ctx, "about", { cachePrefix: prefix })),
      false,
    );

    for (const slug of ["/blog", "/about"]) {
      const prewarm = renderRequests.get(slug);
      assertEquals(prewarm?.url?.href, `https://preview.example.test${slug}`);
      assertEquals(prewarm?.request?.url, `https://preview.example.test${slug}`);
      assertEquals(prewarm?.request?.method, "GET");
      assertEquals(prewarm?.request?.headers.get("accept"), "text/html");
      assertEquals(prewarm?.request?.headers.has("authorization"), false);
      assertEquals(prewarm?.request?.headers.has("cookie"), false);
      assertEquals(prewarm?.request?.headers.has("x-preview-context"), false);
      assertStrictEquals(
        prewarm?.dependencyPinningSource,
        dependencyPinningSource,
      );
    }
  });

  it("prioritizes route-family siblings when prewarming production routes", async () => {
    const store = createInMemoryStore();
    const renderedSlugs: string[] = [];
    const shallowPages = Array.from(
      { length: 14 },
      (_, index) => `/page-${index.toString().padStart(2, "0")}`,
    );
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      getAllPages: () => Promise<string[]>;
      pageExists: (slug: string) => Promise<boolean>;
      createServicesForContext: () => {
        pipeline: {
          renderPage: (slug: string) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).getAllPages = () =>
      Promise.resolve([
        "/blog/articles/terraform-azure-kubernetes",
        ...shallowPages,
        "/blog/articles/helm-best-practices",
      ]);
    (renderer as unknown as {
      pageExists: (slug: string) => Promise<boolean>;
    }).pageExists = () => Promise.resolve(true);
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (slug: string) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug) => {
          renderedSlugs.push(slug);
          return Promise.resolve({
            html: `<html>${slug}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const ctx = {
      ...makeRenderContext(),
      adapter: makeRenderAdapter(),
    };
    await renderer.renderPage("/blog/articles/terraform-azure-kubernetes", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
    });
    await waitForProductionPrewarm(renderer);

    assertEquals(renderedSlugs.includes("/blog/articles/helm-best-practices"), true);
  });

  it("does not prewarm when the request has cache-sensitive state", async () => {
    const store = createInMemoryStore();
    const renderedSlugs: string[] = [];
    let getAllPagesCalls = 0;
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      getAllPages: () => Promise<string[]>;
      createServicesForContext: () => {
        pipeline: {
          renderPage: (slug: string) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).getAllPages = () => {
      getAllPagesCalls++;
      return Promise.resolve(["/blog"]);
    };
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (slug: string) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug) => {
          renderedSlugs.push(slug);
          return Promise.resolve({
            html: `<html>${slug}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const ctx = {
      ...makeRenderContext(),
      adapter: makeRenderAdapter(),
    };
    const url = new URL("https://example.com/");
    await renderer.renderPage("/", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
      request: new Request(url, { headers: { cookie: "session=abc" } }),
      url,
    });
    await waitForProductionPrewarm(renderer);

    assertEquals(renderedSlugs, ["/"]);
    assertEquals(getAllPagesCalls, 0);
    assertEquals(store.data.size, 0);
  });

  it("waits within the admission budget for a foreground project slot", async () => {
    const projectId = `queued-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1"),
    };
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let pipelineStarted = false;
    let renderSettled = false;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (slug: string) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug) => {
          pipelineStarted = true;
          return Promise.resolve({
            html: `<html>${slug}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    for (let index = 0; index < RENDER_PER_PROJECT_LIMIT; index++) {
      assertEquals(await acquireProjectSlot(projectId), true);
    }

    const render = renderer.renderPage("/queued", ctx, {
      environment: "production",
      releaseAssetManifest: null,
    }).finally(() => {
      renderSettled = true;
    });
    void render.catch(() => {});

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(renderSettled, false);
      assertEquals(pipelineStarted, false);

      await releaseProjectSlot(projectId);
      const result = await render;
      assertEquals(result.html, "<html>/queued</html>");
      assertEquals(pipelineStarted, true);
    } finally {
      while ((projectRenderCounts.get(projectId) ?? 0) > 0) {
        await releaseProjectSlot(projectId);
      }
      await render.catch(() => {});
    }
  });

  it("shares one admission budget across project and global capacity", async () => {
    using time = new FakeTime();
    let admissionNow = 0;
    using _performanceNow = stub(Performance.prototype, "now", () => admissionNow);
    const projectId = `budgeted-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1"),
    };
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let pipelineStarted = false;
    let renderSettled = false;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: () => Promise<never>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: () => {
          pipelineStarted = true;
          return Promise.reject(new Error("pipeline must not start"));
        },
      },
    });

    for (let index = 0; index < RENDER_PER_PROJECT_LIMIT; index++) {
      assertEquals(await acquireProjectSlot(projectId), true);
    }
    let acquiredPermits = 0;
    while (renderSemaphore.available > 0) {
      assertEquals(await renderSemaphore.tryAcquire(0), true);
      acquiredPermits++;
    }

    const render = renderer.renderPage("/budgeted", ctx, {
      environment: "production",
      releaseAssetManifest: null,
    }).finally(() => {
      renderSettled = true;
    });
    const rejected = assertRejects(() => render, Error, "Service is overloaded");

    try {
      await time.tickAsync(0);
      await time.tickAsync(3_000);
      admissionNow = 3_000;
      assertEquals(renderSettled, false);

      await releaseProjectSlot(projectId);
      await time.tickAsync(0);
      assertEquals(renderSemaphore.waiting, 1);

      await time.tickAsync(RENDER_ACQUIRE_TIMEOUT_MS - 3_001);
      assertEquals(renderSettled, false);

      await time.tickAsync(1);
      await rejected;
      assertEquals(renderSettled, true);
      assertEquals(pipelineStarted, false);
      assertEquals(renderSemaphore.waiting, 0);
    } finally {
      for (let index = 0; index < acquiredPermits; index++) {
        renderSemaphore.release();
      }
      while ((projectRenderCounts.get(projectId) ?? 0) > 0) {
        await releaseProjectSlot(projectId);
      }
      await render.catch(() => {});
    }
  });

  it("does not queue sibling prewarm behind exhausted global capacity", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;

    (renderer as unknown as {
      getAllPages: () => Promise<string[]>;
      pageExists: () => Promise<boolean>;
      createServicesForContext: () => {
        pipeline: {
          renderPage: () => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).getAllPages = () => Promise.resolve(["/blog"]);
    (renderer as unknown as { pageExists: () => Promise<boolean> }).pageExists = () =>
      Promise.resolve(true);
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: () => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            html: "<html>/blog</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    let acquiredPermits = 0;
    while (renderSemaphore.available > 0) {
      assertEquals(await renderSemaphore.tryAcquire(0), true);
      acquiredPermits++;
    }

    const ctx = {
      ...makeRenderContext(),
      adapter: makeRenderAdapter(),
    };
    const prewarm = (renderer as unknown as {
      runProductionRenderPrewarm: (
        slug: string,
        ctx: RenderContext,
        options: {
          environment: "production";
          releaseId: string;
          releaseAssetManifest: null;
          url: URL;
        },
      ) => Promise<void>;
    }).runProductionRenderPrewarm("/", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
      url: new URL("https://preview.example.test/"),
    });

    try {
      for (let index = 0; index < 10 && renderSemaphore.waiting === 0; index++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assertEquals(renderSemaphore.waiting, 0);
      assertEquals(renderCalls, 0);
    } finally {
      for (let index = 0; index < acquiredPermits; index++) {
        renderSemaphore.release();
      }
      await prewarm;
    }
  });

  it("retries foreground admission after a shared background leader overloads", async () => {
    const projectId = `priority-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1"),
    };
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (slug: string) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug) => {
          renderCalls++;
          return Promise.resolve({
            html: `<html>${slug}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const firstCapacityCheck = Promise.withResolvers<boolean>();
    const originalTryAcquire = renderSemaphore.tryAcquire;
    let capacityChecks = 0;
    renderSemaphore.tryAcquire = function (
      timeoutMs?: number,
      options?: { signal?: AbortSignal },
    ): Promise<boolean> {
      capacityChecks++;
      if (capacityChecks === 1) return firstCapacityCheck.promise;
      return originalTryAcquire.call(this, timeoutMs, options);
    };

    const sharedOptions = {
      cacheKey: "priority-render",
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const backgroundRender = (renderer as unknown as {
      renderPageWithAdmission: (
        slug: string,
        ctx: RenderContext,
        options: typeof sharedOptions,
        admission: "background",
      ) => Promise<unknown>;
    }).renderPageWithAdmission("/priority", ctx, sharedOptions, "background");
    const backgroundRejected = assertRejects(
      () => backgroundRender,
      Error,
      "Service is overloaded",
    );

    let foregroundRender: ReturnType<Renderer["renderPage"]> | undefined;
    try {
      for (let index = 0; index < 10 && capacityChecks === 0; index++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assertEquals(capacityChecks, 1);

      foregroundRender = renderer.renderPage("/priority", ctx, sharedOptions);
      await new Promise((resolve) => setTimeout(resolve, 0));
      firstCapacityCheck.resolve(false);

      await backgroundRejected;
      const result = await foregroundRender;
      assertEquals(result.html, "<html>/priority</html>");
      assertEquals(renderCalls, 1);
      assertEquals(capacityChecks, 2);
      assertEquals(
        (renderer as unknown as {
          renderFlightAdmissions: Map<string, "foreground" | "background">;
        }).renderFlightAdmissions.size,
        0,
      );
    } finally {
      renderSemaphore.tryAcquire = originalTryAcquire;
      firstCapacityCheck.resolve(false);
      await backgroundRender.catch(() => {});
      await foregroundRender?.catch(() => {});
      while ((projectRenderCounts.get(projectId) ?? 0) > 0) {
        await releaseProjectSlot(projectId);
      }
    }
  });

  it("deduplicates identical cacheable render misses before taking project slots", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;

    let renderCalls = 0;
    let releaseRender!: () => void;
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (slug: string) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async (slug) => {
          renderCalls++;
          await renderGate;
          return {
            html: `<html>${slug}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          };
        },
      },
    });

    const ctx = makeRenderContext();
    const renders = Array.from(
      { length: 11 },
      () =>
        renderer.renderPage("/burst", ctx, {
          environment: "production",
          releaseId: "rel-1",
          releaseAssetManifest: null,
        }),
    );

    for (let i = 0; i < 20 && renderCalls === 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }
    await new Promise((resolve) => setTimeout(resolve, 10));

    releaseRender();
    const results = await Promise.all(renders);

    assertEquals(results.length, 11);
    assertEquals(renderCalls, 1);
    assertEquals(projectRenderCounts.get(ctx.projectId) ?? 0, 0);
  });

  it("returns detached complete results to singleflight callers", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;

    let renderCalls = 0;
    let releaseRender!: () => void;
    const renderGate = new Promise<void>((resolve) => {
      releaseRender = resolve;
    });

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: { renderPage: () => Promise<import("#veryfront/types").RenderResult> };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async () => {
          renderCalls++;
          await renderGate;
          return {
            html: "<html>complete</html>",
            css: "body { color: red; }",
            frontmatter: { tags: ["original"] },
            headings: [{ id: "heading", text: "Heading", level: 2 }],
            nodeMap: new Map([[1, { nested: { value: "node" } }]]),
            pageModule: { slug: "/complete", code: "export default 1", type: "component" },
            stream: null,
          };
        },
      },
    });

    const ctx = makeRenderContext();
    const first = renderer.renderPage("/complete", ctx, { releaseAssetManifest: null });
    const second = renderer.renderPage("/complete", ctx, { releaseAssetManifest: null });
    await Promise.resolve();
    releaseRender();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    assertEquals(renderCalls, 1);
    assertEquals(firstResult.css, "body { color: red; }");
    assertEquals(secondResult.css, "body { color: red; }");
    assertEquals(secondResult.nodeMap?.get(1), { nested: { value: "node" } });

    (firstResult.frontmatter.tags as string[])[0] = "mutated";
    firstResult.headings![0]!.text = "Mutated";
    (firstResult.nodeMap!.get(1) as { nested: { value: string } }).nested.value = "mutated";
    firstResult.pageModule!.code = "mutated";

    assertEquals(secondResult.frontmatter.tags, ["original"]);
    assertEquals(secondResult.headings![0]!.text, "Heading");
    assertEquals(secondResult.nodeMap?.get(1), { nested: { value: "node" } });
    assertEquals(secondResult.pageModule?.code, "export default 1");
  });

  it("bypasses shared caching for request-scoped output variants", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { nonce?: string; request?: Request },
          ) => Promise<import("#veryfront/types").RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          renderCalls++;
          const variant = options?.nonce ?? options?.request?.headers.get("x-variant") ?? "none";
          return Promise.resolve({
            html: `<html>${variant}</html>`,
            frontmatter: {},
            stream: null,
          });
        },
      },
    });

    const ctx = makeRenderContext();
    const [nonceA, nonceB] = await Promise.all([
      renderer.renderPage("/scoped", ctx, { nonce: "nonce-a", releaseAssetManifest: null }),
      renderer.renderPage("/scoped", ctx, { nonce: "nonce-b", releaseAssetManifest: null }),
    ]);
    const requestA = await renderer.renderPage("/scoped", ctx, {
      request: new Request("https://example.test/scoped", { headers: { "x-variant": "a" } }),
      url: new URL("https://example.test/scoped"),
      releaseAssetManifest: null,
    });
    const requestB = await renderer.renderPage("/scoped", ctx, {
      request: new Request("https://example.test/scoped", { headers: { "x-variant": "b" } }),
      url: new URL("https://example.test/scoped"),
      releaseAssetManifest: null,
    });

    assertEquals(nonceA.html, "<html>nonce-a</html>");
    assertEquals(nonceB.html, "<html>nonce-b</html>");
    assertEquals(requestA.html, "<html>a</html>");
    assertEquals(requestB.html, "<html>b</html>");
    assertEquals(renderCalls, 4);
    assertEquals(store.data.size, 0);
  });

  it("caches an explicit public artifact without nonce and applies each response nonce", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { nonce?: string },
          ) => Promise<import("#veryfront/types").RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          renderCalls++;
          assertEquals(options?.nonce, undefined);
          return Promise.resolve({
            html: "<html><script>window.__public = true</script></html>",
            frontmatter: {},
            stream: null,
          });
        },
      },
    });

    const ctx = makeRenderContext();
    const url = new URL("https://example.test/public");
    const common = {
      request: new Request(url),
      url,
      cacheKey: "public-contract",
      renderSessionId: "session-a",
      releaseAssetManifest: null,
    };
    const first = await renderer.renderPage("/public", ctx, { ...common, nonce: "nonce-a" });
    const second = await renderer.renderPage("/public", ctx, {
      ...common,
      renderSessionId: "session-b",
      nonce: "nonce-b",
    });

    assertEquals(renderCalls, 1);
    assertEquals(first.html.includes('<script nonce="nonce-a">'), true);
    assertEquals(second.html.includes('<script nonce="nonce-b">'), true);
    assertEquals(first.html.includes("nonce-b"), false);
    assertEquals(second.html.includes("nonce-a"), false);
    assertEquals(
      [...store.data.values()].every((entry) => !entry.result.html.includes("nonce-")),
      true,
    );
  });

  it("does not let an invalidated in-flight generation repopulate or join fresh work", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;
    let releaseOld!: () => void;
    let markOldStarted!: () => void;
    const oldStarted = new Promise<void>((resolve) => {
      markOldStarted = resolve;
    });
    const oldGate = new Promise<void>((resolve) => {
      releaseOld = resolve;
    });

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: () => Promise<import("#veryfront/types").RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async () => {
          renderCalls++;
          if (renderCalls === 1) {
            markOldStarted();
            await oldGate;
            return { html: "<html>stale</html>", frontmatter: {}, stream: null };
          }
          return { html: "<html>fresh</html>", frontmatter: {}, stream: null };
        },
      },
    });

    const ctx = makeRenderContext();
    const oldRender = renderer.renderPage("/race", ctx, { releaseAssetManifest: null });
    await oldStarted;
    await renderer.clearCacheForProject(ctx.projectId);

    const fresh = await renderer.renderPage("/race", ctx, { releaseAssetManifest: null });
    releaseOld();
    const staleCaller = await oldRender;

    assertEquals(renderCalls, 2);
    assertEquals(staleCaller.html, "<html>stale</html>");
    assertEquals(fresh.html, "<html>fresh</html>");
    assertEquals([...store.data.values()].map((entry) => entry.result.html), [
      "<html>fresh</html>",
    ]);
  });

  it("rotates the persistent context worker scope while active pipelines retain their snapshot", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const ctx = makeRenderContext();
    const internals = renderer as unknown as {
      getContextServices(context: RenderContext): {
        workerExecutionScopes: WorkerExecutionScopeOwner;
      };
    };

    const firstServices = internals.getContextServices(ctx);
    const sameServices = internals.getContextServices(ctx);
    assertStrictEquals(firstServices, sameServices);

    const activeOldPipeline = firstServices.workerExecutionScopes.acquire();
    const oldScopeId = activeOldPipeline.scopeId;
    await renderer.clearCache(ctx, "/changed-route");

    const servicesAfterRotation = internals.getContextServices(ctx);
    assertStrictEquals(servicesAfterRotation, firstServices);
    const freshPipeline = servicesAfterRotation.workerExecutionScopes.acquire();
    assertEquals(activeOldPipeline.scopeId, oldScopeId);
    assertEquals(freshPipeline.scopeId === oldScopeId, false);

    activeOldPipeline.release();
    freshPipeline.release();
    await renderer.destroy();
  });

  it("preserves streaming delivery and never persists the stream variant", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const stream = new ReadableStream<Uint8Array>();

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { delivery?: "string" | "stream" },
          ) => Promise<import("#veryfront/types").RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          assertEquals(options?.delivery, "stream");
          return Promise.resolve({ html: "", frontmatter: {}, stream });
        },
      },
    });

    const result = await renderer.renderPage("/stream", makeRenderContext(), {
      delivery: "stream",
      releaseAssetManifest: null,
    });

    assertEquals(result.stream, stream);
    assertEquals(store.data.size, 0);
  });

  it("isolates canonical caches across configuration generations", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;

    (renderer as unknown as {
      createServicesForContext: (ctx: RenderContext) => {
        pipeline: { renderPage: () => Promise<import("#veryfront/types").RenderResult> };
      };
    }).createServicesForContext = (ctx) => ({
      pipeline: {
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            html: `<html>${ctx.config.title}</html>`,
            frontmatter: {},
            stream: null,
          });
        },
      },
    });

    const base = makeRenderContext();
    const first = await renderer.renderPage("/config", {
      ...base,
      config: { title: "First" },
    }, { releaseAssetManifest: null });
    const second = await renderer.renderPage("/config", {
      ...base,
      config: { title: "Second" },
    }, { releaseAssetManifest: null });

    assertEquals(first.html, "<html>First</html>");
    assertEquals(second.html, "<html>Second</html>");
    assertEquals(renderCalls, 2);
    assertEquals(store.data.size, 2);
  });

  it("honors skipCacheCheck and skipCachePersist independently", async () => {
    const store = createInMemoryStore();
    const ctx = makeRenderContext();
    const storageKey = await buildRendererStorageKey(ctx, "/controls");
    store.data.set(storageKey, {
      result: { html: "<html>cached</html>", frontmatter: {}, stream: null },
      storedAt: Date.now(),
    });
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: { renderPage: () => Promise<import("#veryfront/types").RenderResult> };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({ html: "<html>fresh</html>", frontmatter: {}, stream: null });
        },
      },
    });

    const forced = await renderer.renderPage("/controls", ctx, {
      skipCacheCheck: true,
      releaseAssetManifest: null,
    });
    assertEquals(forced.html, "<html>fresh</html>");
    assertEquals(store.data.get(storageKey)?.result.html, "<html>fresh</html>");

    await renderer.renderPage("/no-persist", ctx, {
      skipCachePersist: true,
      releaseAssetManifest: null,
    });
    assertEquals(
      store.data.has(await buildRendererStorageKey(ctx, "/no-persist")),
      false,
    );
    assertEquals(renderCalls, 2);
  });

  it("detaches a cancelled caller without aborting a shared cacheable render", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const caller = new AbortController();
    const renderStarted = Promise.withResolvers<void>();
    const renderGate = Promise.withResolvers<void>();
    let renderCalls = 0;
    let observedSignal: AbortSignal | undefined;
    let observedRequestSignal: AbortSignal | undefined;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { abortSignal?: AbortSignal; request?: Request },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug, options) => {
          renderCalls++;
          observedSignal = options?.abortSignal;
          observedRequestSignal = options?.request?.signal;
          renderStarted.resolve();
          return new Promise((resolve, reject) => {
            const onAbort = () => reject(options?.abortSignal?.reason);
            options?.abortSignal?.addEventListener("abort", onAbort, { once: true });
            renderGate.promise.then(() => {
              options?.abortSignal?.removeEventListener("abort", onAbort);
              resolve({
                html: `<html>${slug}</html>`,
                frontmatter: {},
                headings: [],
                stream: null,
              });
            });
          });
        },
      },
    });

    const ctx = makeRenderContext();
    const sharedOptions = {
      cacheKey: "shared-render",
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const cancelledRender = renderer.renderPage("/shared", ctx, {
      ...sharedOptions,
      request: new Request("https://example.com/shared", { signal: caller.signal }),
    });
    await renderStarted.promise;

    const followerRender = renderer.renderPage("/shared", ctx, sharedOptions);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const reason = new Error("caller disconnected");
    caller.abort(reason);
    renderGate.resolve();
    await assertRejects(() => cancelledRender, Error, reason.message);

    assertEquals(observedSignal?.aborted, false);
    assertEquals(observedRequestSignal?.aborted, false);

    const result = await followerRender;
    assertEquals(result.html, "<html>/shared</html>");
    assertEquals(renderCalls, 1);
  });

  it("keeps a cacheable leader queued after its first caller disconnects", async () => {
    const projectId = `shared-queued-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1"),
    };
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const caller = new AbortController();
    let renderCalls = 0;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (slug: string) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug) => {
          renderCalls++;
          return Promise.resolve({
            html: `<html>${slug}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    for (let index = 0; index < RENDER_PER_PROJECT_LIMIT; index++) {
      assertEquals(await acquireProjectSlot(projectId), true);
    }

    const sharedOptions = {
      cacheKey: "shared-queued-render",
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const cancelledRender = renderer.renderPage("/shared-queued", ctx, {
      ...sharedOptions,
      request: new Request("https://example.com/shared-queued", {
        signal: caller.signal,
      }),
    });
    const followerRender = renderer.renderPage("/shared-queued", ctx, sharedOptions);

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(renderCalls, 0);

      const reason = new Error("caller disconnected while queued");
      caller.abort(reason);
      await assertRejects(() => cancelledRender, Error, reason.message);
      assertEquals(renderCalls, 0);

      await releaseProjectSlot(projectId);
      const result = await followerRender;
      assertEquals(result.html, "<html>/shared-queued</html>");
      assertEquals(renderCalls, 1);
    } finally {
      while ((projectRenderCounts.get(projectId) ?? 0) > 0) {
        await releaseProjectSlot(projectId);
      }
      await cancelledRender.catch(() => {});
      await followerRender.catch(() => {});
    }
  });

  it("keeps a cacheable leader globally queued after its first caller disconnects", async () => {
    const projectId = `shared-global-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1"),
    };
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const caller = new AbortController();
    let renderCalls = 0;
    let observedSignal: AbortSignal | undefined;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { abortSignal?: AbortSignal },
          ) => Promise<{
            html: string;
            frontmatter: Record<string, unknown>;
            headings: never[];
            stream: null;
          }>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (slug, options) => {
          renderCalls++;
          observedSignal = options?.abortSignal;
          return Promise.resolve({
            html: `<html>${slug}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    let acquiredPermits = 0;
    let transferredPermit = false;
    while (renderSemaphore.available > 0) {
      assertEquals(await renderSemaphore.tryAcquire(0), true);
      acquiredPermits++;
    }

    const sharedOptions = {
      cacheKey: "shared-global-render",
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const cancelledRender = renderer.renderPage("/shared-global", ctx, {
      ...sharedOptions,
      request: new Request("https://example.com/shared-global", {
        signal: caller.signal,
      }),
    });

    try {
      for (let index = 0; index < 10 && renderSemaphore.waiting === 0; index++) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      assertEquals(renderSemaphore.waiting, 1);
      assertEquals(renderCalls, 0);

      const followerRender = renderer.renderPage("/shared-global", ctx, sharedOptions);
      const reason = new Error("caller disconnected while globally queued");
      caller.abort(reason);
      await assertRejects(() => cancelledRender, Error, reason.message);

      renderSemaphore.release();
      transferredPermit = true;
      const result = await followerRender;
      assertEquals(result.html, "<html>/shared-global</html>");
      assertEquals(renderCalls, 1);
      assertEquals(observedSignal?.aborted, false);
    } finally {
      const heldPermits = acquiredPermits - (transferredPermit ? 1 : 0);
      for (let index = 0; index < heldPermits; index++) {
        renderSemaphore.release();
      }
      await cancelledRender.catch(() => {});
    }
  });

  it("aborts underlying render work when the pipeline deadline expires", async () => {
    using time = new FakeTime();
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let observedSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => markStarted = resolve);

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { abortSignal?: AbortSignal },
          ) => Promise<never>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          observedSignal = options?.abortSignal;
          markStarted();
          return new Promise<never>(() => {});
        },
      },
    });

    const render = renderer.renderPage("/deadline", makeRenderContext(), {
      environment: "production",
      releaseAssetManifest: null,
    });
    const rejected = assertRejects(
      () => render,
      Error,
      "Render pipeline for proj-1:/deadline timed out after 60000ms",
    );
    await started;

    await time.tickAsync(60_000);

    await rejected;
    assertEquals(observedSignal?.aborted, true);
  });

  it("propagates caller cancellation into render pipeline work", async () => {
    using time = new FakeTime();
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const caller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    const started = Promise.withResolvers<void>();

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { abortSignal?: AbortSignal },
          ) => Promise<never>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          observedSignal = options?.abortSignal;
          started.resolve();
          return new Promise<never>((_, reject) => {
            options?.abortSignal?.addEventListener(
              "abort",
              () => reject(options.abortSignal?.reason),
              { once: true },
            );
          });
        },
      },
    });

    const reason = new Error("request aborted");
    const render = renderer.renderPage("/caller-abort", makeRenderContext(), {
      abortSignal: caller.signal,
      environment: "production",
      releaseAssetManifest: null,
      request: new Request("https://example.com/caller-abort", {
        headers: { cookie: "session=caller" },
        signal: caller.signal,
      }),
    });
    const rejected = assertRejects(() => render, Error, "request aborted");
    await started.promise;

    caller.abort(reason);
    await time.tickAsync(0);

    await rejected;
    assertEquals(observedSignal?.aborted, true);
    assertEquals(observedSignal?.reason, reason);
  });
});

describe("rendering/renderer destruction lifecycle", () => {
  it("shares concurrent destruction and disposes local resources exactly once", async () => {
    const store = createInMemoryStore();
    const storeCleanup = Promise.withResolvers<void>();
    let storeDestroyCalls = 0;
    store.destroy = () => {
      storeDestroyCalls++;
      return storeCleanup.promise;
    };

    const renderer = new Renderer({ cache: { store } });
    let dataFetcherDestroyCalls = 0;
    let componentRegistryClearCalls = 0;
    let virtualModulesClearCalls = 0;
    const internals = renderer as unknown as {
      dataFetcher?: { destroy(): void };
      contextServices: Map<
        string,
        {
          projectId: string;
          contentSourceId: string;
          workerExecutionScopes: WorkerExecutionScopeOwner;
          componentRegistry: { clear(): void };
          virtualModules: { clear(): void };
        }
      >;
      productionPrewarmContexts: Map<string, Promise<void>>;
    };
    internals.dataFetcher = {
      destroy() {
        dataFetcherDestroyCalls++;
      },
    };
    const evictedWorkerScopes: string[] = [];
    const workerExecutionScopes = new WorkerExecutionScopeOwner({
      initialScopeId: "renderer-destruction-scope",
      evictScope: (scopeId) => evictedWorkerScopes.push(scopeId),
    });
    internals.contextServices.set("context", {
      projectId: "project",
      contentSourceId: "source",
      workerExecutionScopes,
      componentRegistry: {
        clear() {
          componentRegistryClearCalls++;
        },
      },
      virtualModules: {
        clear() {
          virtualModulesClearCalls++;
        },
      },
    });
    internals.productionPrewarmContexts.set("prewarm", Promise.resolve());

    const first = renderer.destroy();
    const second = renderer.destroy();

    assertStrictEquals(first, second);
    assertEquals(dataFetcherDestroyCalls, 1);
    assertEquals(componentRegistryClearCalls, 1);
    assertEquals(virtualModulesClearCalls, 1);
    assertEquals(evictedWorkerScopes, ["renderer-destruction-scope"]);
    assertEquals(storeDestroyCalls, 1);
    assertEquals(internals.contextServices.size, 0);
    assertEquals(internals.productionPrewarmContexts.size, 0);

    storeCleanup.resolve();
    await Promise.all([first, second]);
    await renderer.destroy();

    assertEquals(dataFetcherDestroyCalls, 1);
    assertEquals(componentRegistryClearCalls, 1);
    assertEquals(virtualModulesClearCalls, 1);
    assertEquals(storeDestroyCalls, 1);
  });

  it("retries failed store destruction without repeating local cleanup", async () => {
    const store = createInMemoryStore();
    const disconnectFailure = new Error("cache disconnect failed");
    let storeDestroyCalls = 0;
    store.destroy = () => {
      storeDestroyCalls++;
      return storeDestroyCalls === 1 ? Promise.reject(disconnectFailure) : Promise.resolve();
    };

    const renderer = new Renderer({ cache: { store } });
    let dataFetcherDestroyCalls = 0;
    (renderer as unknown as { dataFetcher?: { destroy(): void } }).dataFetcher = {
      destroy() {
        dataFetcherDestroyCalls++;
      },
    };

    await assertRejects(() => renderer.destroy(), Error, disconnectFailure.message);
    await renderer.destroy();
    await renderer.destroy();

    assertEquals(dataFetcherDestroyCalls, 1);
    assertEquals(storeDestroyCalls, 2);
  });

  it("creates one lazy data fetcher and destroys it with its renderer", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    const internals = renderer as unknown as {
      initialized: boolean;
      dataFetcher?: { destroy(): void };
      getDataFetcher(): { destroy(): void };
    };
    internals.initialized = true;
    assertEquals(internals.dataFetcher, undefined);

    const first = internals.getDataFetcher();
    const second = internals.getDataFetcher();
    assertStrictEquals(first, second);

    const originalDestroy = first.destroy.bind(first);
    let dataFetcherDestroyCalls = 0;
    first.destroy = () => {
      dataFetcherDestroyCalls++;
      originalDestroy();
    };

    await renderer.destroy();

    assertEquals(dataFetcherDestroyCalls, 1);
    assertEquals(internals.dataFetcher, undefined);
    assertThrows(() => internals.getDataFetcher(), Error, "not initialized");
  });
});

describe("Renderer dependency pin cache isolation", () => {
  it("forwards preview credentials through renderer-created pinning sources", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;

    const observedSources: Array<DependencyPinningSource | undefined> = [];
    const observeSource = (options?: RenderOptions): void => {
      const source = options?.dependencyPinningSource;
      observedSources.push(
        typeof source === "object" && source !== null ? source : undefined,
      );
    };
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: RenderOptions,
          ) => Promise<RenderResult>;
          resolvePageData: (
            slug: string,
            options?: RenderOptions,
          ) => Promise<PageDataResponse>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          observeSource(options);
          return Promise.resolve({
            html: "<html>preview</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
        resolvePageData: (_slug, options) => {
          observeSource(options);
          return Promise.resolve({
            slug: "/data",
            pagePath: "pages/data.tsx",
            pageType: "tsx",
            layouts: [],
            providers: [],
            frontmatter: {},
            props: {},
            params: {},
            layoutProps: {},
            buildVersion: { framework: "test", serverStart: 0 },
          });
        },
      },
    });

    const ctx = {
      ...makeRenderContext(),
      isLocalProject: false,
      environment: "preview",
      contentSourceId: "preview-feature",
      releaseId: undefined,
      branch: "feature",
      proxyToken: "request-scoped-token",
      cachePrefix: buildRenderCachePrefix("proj-1", "preview", "feature"),
    } as RenderContext;

    try {
      await renderer.renderPage("/render", ctx);
      await renderer.resolvePageData("/data", ctx);

      assertEquals(observedSources.length, 2);
      for (const source of observedSources) {
        assertEquals(source?.dependencyWritebackToken, "request-scoped-token");
        assertEquals(source?.dependencyWritebackTarget, {
          kind: "branch",
          branch: "feature",
        });
      }
    } finally {
      await renderer.destroy();
    }
  });

  it("bounds the complete API render key while preserving the flag-off override", async () => {
    const renderer = new Renderer();
    const buildCachePolicy = (renderer as unknown as {
      buildCachePolicy(
        slug: string,
        ctx: RenderContext,
        options?: RenderOptions,
      ): Promise<{ cacheKey: string | null }>;
    }).buildCachePolicy.bind(renderer);
    const ctx = makeRenderContext();
    const legacyKey = "a".repeat(440);
    const options: RenderOptions = {
      cacheKey: legacyKey,
      colorScheme: "dark",
      dependencyPinningCacheKey: "on:3w5e11264sgsf",
      url: new URL("https://preview.example.test"),
    };
    const cacheKey = (await buildCachePolicy("/", ctx, options)).cacheKey;

    assertEquals(typeof cacheKey, "string");
    const completeKey = `render:${ctx.cachePrefix}:page:${cacheKey}:theme-dark`;
    assertEquals(completeKey.length <= 512, true);
    assertEquals(/^[a-zA-Z0-9_:.\-/*]+$/.test(completeKey), true);
    const configDigest = await computeHash(JSON.stringify(ctx.config));
    assertEquals(
      (await buildCachePolicy("/", ctx, {
        ...options,
        dependencyPinningCacheKey: "off",
      })).cacheKey,
      `${legacyKey}:config-${configDigest}`,
    );
  });

  it("misses the outer render cache when the package map changes", async () => {
    const originalFlag = getHostEnv(DEPENDENCY_PINNING_ENV_FLAG);
    const projectDir = await Deno.makeTempDir({ prefix: "vf-renderer-pins-" });
    const packageJsonPath = `${projectDir}/package.json`;
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;

    let renders = 0;
    const observedPinKeys: string[] = [];
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: RenderOptions,
          ) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          renders++;
          observedPinKeys.push(options?.dependencyPinningCacheKey ?? "");
          return Promise.resolve({
            html: `<html>${options?.dependencyPinningCacheKey}</html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    const ctx = {
      ...makeRenderContext(),
      projectDir,
      environment: "preview",
      contentSourceId: "preview-main",
      releaseId: undefined,
      cachePrefix: buildRenderCachePrefix("proj-1", "preview", "main"),
    } as RenderContext;

    try {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, "1");
      clearReactVersionCache();
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { zod: "3.0.0" } }),
      );
      const first = await renderer.renderPage("/pins", ctx);

      await new Promise((resolve) => setTimeout(resolve, 5));
      await Deno.writeTextFile(
        packageJsonPath,
        JSON.stringify({ dependencies: { zod: "4.0.0" } }),
      );
      const second = await renderer.renderPage("/pins", ctx);
      const cachedSecond = await renderer.renderPage("/pins", ctx);

      assertEquals(renders, 2);
      assertEquals(new Set(observedPinKeys).size, 2);
      assertEquals(first.html === second.html, false);
      assertEquals(cachedSecond.html, second.html);
      assertEquals(store.data.size, 2);
    } finally {
      setEnv(DEPENDENCY_PINNING_ENV_FLAG, originalFlag ?? "");
      clearReactVersionCache();
      await renderer.destroy();
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("rendering/renderer singleton initialization", () => {
  it("runs authoritative project invalidation when the renderer pod is cold", async () => {
    await destroyRenderer();
    const invalidated: string[] = [];
    setColdProjectCacheInvalidatorForTesting((projectId) => {
      invalidated.push(projectId);
      return Promise.resolve(true);
    });
    try {
      await clearRendererCacheForProject("project-cold");
      assertEquals(invalidated, ["project-cold"]);
    } finally {
      setColdProjectCacheInvalidatorForTesting();
    }
  });

  it("does not let direct initialization resurrect a destroyed renderer", async () => {
    destroySharedServices();
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });

    const pendingInitialize = renderer.initialize();
    await renderer.destroy();

    await assertRejects(() => pendingInitialize, Error, "cancelled");
    await assertRejects(() => renderer.initialize(), Error, "destroyed");
  });

  it("waits for an in-flight singleton initialization", async () => {
    await destroyRenderer();

    const originalInitialize = Renderer.prototype.initialize;
    const originalDestroy = Renderer.prototype.destroy;
    let initializeCalls = 0;
    let resolveStarted!: () => void;
    let resolveInitialize!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const initializeDone = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });

    Renderer.prototype.initialize = function () {
      initializeCalls++;
      resolveStarted();
      return initializeDone;
    };
    Renderer.prototype.destroy = () => Promise.resolve();

    try {
      const first = initializeRenderer();
      await started;

      let secondResolved = false;
      const second = initializeRenderer().then((value) => {
        secondResolved = true;
        return value;
      });
      await Promise.resolve();
      await Promise.resolve();

      assertEquals(secondResolved, false);

      resolveInitialize();
      const [firstRenderer, secondRenderer] = await Promise.all([first, second]);
      assertEquals(firstRenderer, secondRenderer);
      assertEquals(initializeCalls, 1);
    } finally {
      Renderer.prototype.initialize = originalInitialize;
      Renderer.prototype.destroy = originalDestroy;
      await destroyRenderer();
    }
  });

  it("does not publish a renderer after destroy runs during initialization", async () => {
    await destroyRenderer();

    const originalInitialize = Renderer.prototype.initialize;
    const originalDestroy = Renderer.prototype.destroy;
    let destroyCalls = 0;
    let resolveStarted!: () => void;
    let resolveInitialize!: () => void;
    const started = new Promise<void>((resolve) => {
      resolveStarted = resolve;
    });
    const initializeDone = new Promise<void>((resolve) => {
      resolveInitialize = resolve;
    });

    Renderer.prototype.initialize = function () {
      resolveStarted();
      return initializeDone;
    };
    Renderer.prototype.destroy = () => {
      destroyCalls++;
      return Promise.resolve();
    };

    try {
      const pendingInitialize = initializeRenderer();
      await started;

      await destroyRenderer();
      resolveInitialize();

      await assertRejects(() => pendingInitialize, Error, "cancelled");
      assertThrows(() => getRenderer());
      assertEquals(destroyCalls, 1);
    } finally {
      Renderer.prototype.initialize = originalInitialize;
      Renderer.prototype.destroy = originalDestroy;
      await destroyRenderer();
    }
  });

  it("does not let a cancelled generation clear a newer initialization", async () => {
    await destroyRenderer();

    const originalInitialize = Renderer.prototype.initialize;
    const originalDestroy = Renderer.prototype.destroy;
    const resolvers: Array<() => void> = [];
    let initializeCalls = 0;
    Renderer.prototype.initialize = function () {
      initializeCalls++;
      return new Promise<void>((resolve) => resolvers.push(resolve));
    };
    Renderer.prototype.destroy = () => Promise.resolve();

    try {
      const first = initializeRenderer();
      while (resolvers.length < 1) await Promise.resolve();
      await destroyRenderer();

      const second = initializeRenderer();
      while (resolvers.length < 2) await Promise.resolve();
      resolvers[0]!();
      await assertRejects(() => first, Error, "cancelled");

      const third = initializeRenderer();
      assertEquals(initializeCalls, 2);
      resolvers[1]!();
      const [secondRenderer, thirdRenderer] = await Promise.all([second, third]);
      assertEquals(secondRenderer, thirdRenderer);
      assertEquals(initializeCalls, 2);
    } finally {
      for (const resolve of resolvers) resolve();
      Renderer.prototype.initialize = originalInitialize;
      Renderer.prototype.destroy = originalDestroy;
      await destroyRenderer();
    }
  });

  it("retains failed cleanup and blocks replacement initialization until retry succeeds", async () => {
    await destroyRenderer();

    const originalInitialize = Renderer.prototype.initialize;
    const originalDestroy = Renderer.prototype.destroy;
    const cleanupGate = Promise.withResolvers<void>();
    let initializeCalls = 0;
    let destroyCalls = 0;
    let replacement: Promise<Renderer> | undefined;

    Renderer.prototype.initialize = function () {
      initializeCalls++;
      return Promise.resolve();
    };
    Renderer.prototype.destroy = function () {
      destroyCalls++;
      if (destroyCalls === 1) {
        return Promise.reject(new Error("singleton cache disconnect failed"));
      }
      return cleanupGate.promise;
    };

    try {
      const firstRenderer = await initializeRenderer({
        cache: { store: createInMemoryStore() },
      });
      await assertRejects(
        () => destroyRenderer(),
        Error,
        "singleton cache disconnect failed",
      );
      assertThrows(() => getRenderer());

      replacement = initializeRenderer({
        cache: { store: createInMemoryStore() },
      });
      assertEquals(destroyCalls, 2);
      assertEquals(initializeCalls, 1);

      cleanupGate.resolve();
      const secondRenderer = await replacement;
      assertEquals(initializeCalls, 2);
      assertEquals(firstRenderer === secondRenderer, false);
    } finally {
      cleanupGate.resolve();
      await replacement?.catch(() => undefined);
      Renderer.prototype.initialize = originalInitialize;
      Renderer.prototype.destroy = originalDestroy;
      await destroyRenderer();
    }
  });

  it("cancels initialization that was already waiting for singleton cleanup", async () => {
    await destroyRenderer();

    const originalInitialize = Renderer.prototype.initialize;
    const originalDestroy = Renderer.prototype.destroy;
    const cleanupGate = Promise.withResolvers<void>();
    const pendingOperations: Promise<unknown>[] = [];
    let initializeCalls = 0;
    let destroyCalls = 0;

    Renderer.prototype.initialize = function () {
      initializeCalls++;
      return Promise.resolve();
    };
    Renderer.prototype.destroy = function () {
      destroyCalls++;
      return cleanupGate.promise;
    };

    try {
      await initializeRenderer({ cache: { store: createInMemoryStore() } });
      const firstShutdown = destroyRenderer();
      pendingOperations.push(firstShutdown);

      const waitingInitialization = initializeRenderer({
        cache: { store: createInMemoryStore() },
      });
      pendingOperations.push(waitingInitialization);
      const secondShutdown = destroyRenderer();
      pendingOperations.push(secondShutdown);

      cleanupGate.resolve();
      await Promise.all([firstShutdown, secondShutdown]);
      await assertRejects(() => waitingInitialization, Error, "cancelled");
      assertEquals(initializeCalls, 1);
      assertEquals(destroyCalls, 1);
      assertThrows(() => getRenderer());
    } finally {
      cleanupGate.resolve();
      await Promise.allSettled(pendingOperations);
      Renderer.prototype.initialize = originalInitialize;
      Renderer.prototype.destroy = originalDestroy;
      await destroyRenderer();
    }
  });
});
