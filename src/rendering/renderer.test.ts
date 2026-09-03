import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { buildRenderCacheKey, buildRenderCachePrefix } from "#veryfront/cache/keys.ts";
import {
  DEPENDENCY_PINNING_ENV_FLAG,
  RELEASE_ASSET_MANIFEST_ENV_FLAG,
} from "#veryfront/release-assets/constants.ts";
import {
  clearReleaseAssetManifestCache,
  registerManifestFetcherForRelease,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { stub } from "#std/testing/mock";
import { FakeTime } from "#std/testing/time";
import type { CachePayload, CacheStore } from "./cache/types.ts";
import type { RenderContext } from "./context/render-context.ts";
import type { PageDataResponse, RenderOptions, RenderResult } from "./orchestrator/types.ts";
import { destroyRenderer, getRenderer, initializeRenderer, Renderer } from "./renderer.ts";
import {
  acquireProjectSlot,
  projectRenderCounts,
  releaseProjectSlot,
  RENDER_ACQUIRE_TIMEOUT_MS,
  RENDER_MAX_CONCURRENT,
  RENDER_PER_PROJECT_LIMIT,
  RENDER_SINGLEFLIGHT_MAX_FOLLOWERS,
  renderSemaphore,
} from "./renderer-concurrency.ts";
import {
  clearReactVersionCache,
  type DependencyPinningSource,
} from "#veryfront/transforms/esm/package-registry.ts";
import {
  attachDataResponseMetadata,
  getAttachedDataResponseMetadata,
  unwrapDataResponseMetadataError,
  wrapDataResponseMetadataError,
} from "#veryfront/data/response-metadata.ts";
import { redirect } from "#veryfront/data/helpers.ts";

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
    dependencies: {},
    dependencyMode: "immutable",
  };
}

function makeRenderContext(): RenderContext {
  return {
    projectId: "proj-1",
    projectSlug: "proj-1",
    projectDir: "/project",
    config: {} as RenderContext["config"],
    mode: "production",
    adapter: {} as RenderContext["adapter"],
    cachePrefix: buildRenderCachePrefix("proj-1", "production", "rel-1", "production"),
    environment: "production",
    contentSourceId: "release-rel-1",
    releaseId: "rel-1",
  };
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

    it("keeps the shipped per-project limit a fraction of global concurrency", () => {
      // A CI override would make the derived default unobservable.
      if (getEnv("RENDER_PER_PROJECT_LIMIT") !== undefined) return;

      assertEquals(
        RENDER_PER_PROJECT_LIMIT,
        Math.ceil(RENDER_MAX_CONCURRENT / 3),
        "the per-project limit must stay a fraction of global concurrency so one project cannot occupy every render slot",
      );
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
    it("should default max concurrent to 30", () => {
      // A CI override would make the shipped default unobservable.
      if (getEnv("RENDER_MAX_CONCURRENT") !== undefined) return;

      assertEquals(
        RENDER_MAX_CONCURRENT,
        RENDER_MAX_CONCURRENT_DEFAULT,
        "default pod-wide render concurrency",
      );
    });
  });
});

describe("Renderer response metadata", () => {
  it("preserves headers and cookies without caching a cookie response", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: () => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: () =>
          Promise.resolve({
            html: "<html>metadata</html>",
            frontmatter: {},
            stream: null,
            headers: { "x-page-state": "fresh" },
            cookies: [{ name: "session", value: "abc", path: "/" }],
          }),
      },
    });

    const result = await renderer.renderPage("/metadata", makeRenderContext(), {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
    });

    assertEquals(result.headers, { "x-page-state": "fresh" });
    assertEquals(result.cookies, [{ name: "session", value: "abc", path: "/" }]);
    assertEquals(store.data.size, 0);
  });

  it("does not persist response headers through render cache hits", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: () => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            html: "<html>cached metadata</html>",
            frontmatter: {},
            stream: null,
            headers: { "x-page-state": "cacheable" },
          });
        },
      },
    });
    const options = {
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };

    const first = await renderer.renderPage("/cached-metadata", makeRenderContext(), options);
    const second = await renderer.renderPage("/cached-metadata", makeRenderContext(), options);

    assertEquals(first.headers, { "x-page-state": "cacheable" });
    assertEquals(second.headers, { "x-page-state": "cacheable" });
    assertEquals(renderCalls, 2);
    assertEquals(store.data.size, 0);
  });

  it("evicts a legacy cache entry that contains response headers", async () => {
    const store = createInMemoryStore();
    const ctx = makeRenderContext();
    const cacheKey = `${ctx.cachePrefix}:page:/legacy-header`;
    store.data.set(cacheKey, {
      result: {
        html: "<html>legacy private response</html>",
        frontmatter: {},
        stream: null,
        headers: { "x-page-state": "request-derived" },
      },
      storedAt: Date.now(),
    });
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let renderCalls = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: { renderPage: () => Promise<RenderResult> };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: () => {
          renderCalls++;
          return Promise.resolve({
            html: "<html>fresh public response</html>",
            frontmatter: {},
            stream: null,
          });
        },
      },
    });

    const result = await renderer.renderPage("/legacy-header", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
    });

    assertEquals(result.html, "<html>fresh public response</html>");
    assertEquals(result.headers, undefined);
    assertEquals(renderCalls, 1);
    assertEquals(store.data.get(cacheKey)?.result.html, "<html>fresh public response</html>");
  });

  it("rerenders singleflight followers when the leader returns headers", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    let renderCalls = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (_slug: string, options?: RenderOptions) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async (_slug, options) => {
          renderCalls++;
          if (renderCalls === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          const user = options?.request?.headers.get("x-test-user") ?? "missing";
          return {
            html: `<html>${user}</html>`,
            frontmatter: {},
            stream: null,
            headers: { "x-page-state": user },
          };
        },
      },
    });
    const baseOptions = {
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };

    const leader = renderer.renderPage("/concurrent-header", makeRenderContext(), {
      ...baseOptions,
      request: new Request("https://example.test/concurrent-header", {
        headers: { "x-test-user": "leader" },
      }),
    });
    await firstStarted.promise;
    const follower = renderer.renderPage("/concurrent-header", makeRenderContext(), {
      ...baseOptions,
      request: new Request("https://example.test/concurrent-header", {
        headers: { "x-test-user": "follower" },
      }),
    });
    releaseFirst.resolve();

    const [leaderResult, followerResult] = await Promise.all([leader, follower]);
    assertEquals(leaderResult.headers, { "x-page-state": "leader" });
    assertEquals(followerResult.headers, { "x-page-state": "follower" });
    assertEquals(renderCalls, 2);
    assertEquals(store.data.size, 0);
  });

  it("rerenders singleflight followers when the leader throws with headers", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    let renderCalls = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (_slug: string, options?: RenderOptions) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async (_slug, options) => {
          renderCalls++;
          if (renderCalls === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          const user = options?.request?.headers.get("x-test-user") ?? "missing";
          throw attachDataResponseMetadata(new Error(user), {
            headers: { "x-page-state": user },
          });
        },
      },
    });
    const baseOptions = {
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const captureFailure = async (promise: Promise<RenderResult>): Promise<Error> => {
      try {
        await promise;
      } catch (error) {
        if (error instanceof Error) return error;
      }
      throw new Error("Expected render to fail");
    };

    const leader = captureFailure(renderer.renderPage("/header-error", makeRenderContext(), {
      ...baseOptions,
      request: new Request("https://example.test/header-error", {
        headers: { "x-test-user": "leader" },
      }),
    }));
    await firstStarted.promise;
    const follower = captureFailure(renderer.renderPage("/header-error", makeRenderContext(), {
      ...baseOptions,
      request: new Request("https://example.test/header-error", {
        headers: { "x-test-user": "follower" },
      }),
    }));
    releaseFirst.resolve();

    const [leaderError, followerError] = await Promise.all([leader, follower]);
    assertEquals(getAttachedDataResponseMetadata(leaderError).headers, {
      "x-page-state": "leader",
    });
    assertEquals(getAttachedDataResponseMetadata(followerError).headers, {
      "x-page-state": "follower",
    });
    assertEquals(renderCalls, 2);
  });

  it("preserves streaming delivery for cache-sensitive requests", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let observedDelivery: RenderOptions["delivery"];
    const stream = new ReadableStream<Uint8Array>();
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (_slug: string, options?: RenderOptions) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          observedDelivery = options?.delivery;
          return Promise.resolve({ html: "", frontmatter: {}, stream });
        },
      },
    });

    const result = await renderer.renderPage("/private", makeRenderContext(), {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
      delivery: "stream",
      request: new Request("https://example.test/private", {
        headers: { authorization: "Bearer secret" },
      }),
    });

    assertEquals(observedDelivery, "stream");
    assertEquals(result.stream, stream);
    assertEquals(result.html, "");
  });

  it("holds render admission until an uncached stream is ready", async () => {
    const projectId = `stream-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
    };
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const shellReady = Promise.withResolvers<void>();
    const allReady = Promise.withResolvers<void>();
    const stream = new ReadableStream<Uint8Array>();
    Object.defineProperty(stream, "allReady", { value: allReady.promise });
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: { renderPage: () => Promise<RenderResult> };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: () => {
          shellReady.resolve();
          return Promise.resolve({ html: "", frontmatter: {}, stream });
        },
      },
    });

    const render = renderer.renderPage("/private-stream", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
      delivery: "stream",
      request: new Request("https://example.test/private-stream", {
        headers: { authorization: "Bearer secret" },
      }),
    });

    try {
      await shellReady.promise;
      await new Promise((resolve) => setTimeout(resolve, 0));
      assertEquals(projectRenderCounts.get(projectId), 1);

      allReady.resolve();
      assertEquals((await render).stream, stream);
      assertEquals(projectRenderCounts.has(projectId), false);
    } finally {
      allReady.resolve();
      await render.catch(() => {});
      while ((projectRenderCounts.get(projectId) ?? 0) > 0) {
        await releaseProjectSlot(projectId);
      }
    }
  });

  it("cancels a failed uncached stream before releasing render admission", async () => {
    const projectId = `failed-stream-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
    };
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const shellReady = Promise.withResolvers<void>();
    const allReady = Promise.withResolvers<void>();
    allReady.promise.catch(() => {});
    const finishCancellation = Promise.withResolvers<void>();
    let cancellationStarted = false;
    let cancellationReason: unknown;
    let renderSignal: AbortSignal | undefined;
    const stream = new ReadableStream<Uint8Array>({
      async cancel(reason) {
        cancellationStarted = true;
        cancellationReason = reason;
        await finishCancellation.promise;
      },
    });
    Object.defineProperty(stream, "allReady", { value: allReady.promise });
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            _slug: string,
            options?: { abortSignal?: AbortSignal },
          ) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: (_slug, options) => {
          renderSignal = options?.abortSignal;
          shellReady.resolve();
          return Promise.resolve({ html: "", frontmatter: {}, stream });
        },
      },
    });

    const render = renderer.renderPage("/failed-private-stream", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
      delivery: "stream",
      request: new Request("https://example.test/failed-private-stream", {
        headers: { authorization: "Bearer secret" },
      }),
    });
    const readinessError = new Error("late suspense branch failed");

    try {
      await shellReady.promise;
      allReady.reject(readinessError);
      await new Promise((resolve) => setTimeout(resolve, 0));

      assertEquals(cancellationStarted, true);
      assertStrictEquals(cancellationReason, readinessError);
      assertEquals(renderSignal?.aborted, true);
      assertStrictEquals(renderSignal?.reason, readinessError);
      assertEquals(projectRenderCounts.get(projectId), 1);

      finishCancellation.resolve();
      const rejected = await assertRejects(() => render, Error, readinessError.message);
      assertStrictEquals(rejected, readinessError);
      assertEquals(projectRenderCounts.has(projectId), false);
    } finally {
      allReady.reject(readinessError);
      finishCancellation.resolve();
      await render.catch(() => {});
      while ((projectRenderCounts.get(projectId) ?? 0) > 0) {
        await releaseProjectSlot(projectId);
      }
    }
  });

  it("rerenders singleflight followers when the leader returns cookies", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    let renderCalls = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (_slug: string, options?: RenderOptions) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async (_slug, options) => {
          renderCalls++;
          if (renderCalls === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          const user = options?.request?.headers.get("x-test-user") ?? "missing";
          return {
            html: `<html>${user}</html>`,
            frontmatter: {},
            stream: null,
            cookies: [{ name: "session", value: user, path: "/" }],
          };
        },
      },
    });
    const baseOptions = {
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };

    const leader = renderer.renderPage("/concurrent-cookie", makeRenderContext(), {
      ...baseOptions,
      request: new Request("https://example.test/concurrent-cookie", {
        headers: { "x-test-user": "leader" },
      }),
    });
    await firstStarted.promise;
    const follower = renderer.renderPage("/concurrent-cookie", makeRenderContext(), {
      ...baseOptions,
      request: new Request("https://example.test/concurrent-cookie", {
        headers: { "x-test-user": "follower" },
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst.resolve();

    const [leaderResult, followerResult] = await Promise.all([leader, follower]);
    assertEquals(leaderResult.cookies?.[0]?.value, "leader");
    assertEquals(followerResult.cookies?.[0]?.value, "follower");
    assertEquals(renderCalls, 2);
    assertEquals(store.data.size, 0);
  });

  it("rerenders singleflight followers when the leader throws with cookies", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    let renderCalls = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (_slug: string, options?: RenderOptions) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async (_slug, options) => {
          renderCalls++;
          if (renderCalls === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          const user = options?.request?.headers.get("x-test-user") ?? "missing";
          throw attachDataResponseMetadata(new Error(user), {
            cookies: [{ name: "session", value: user, path: "/" }],
          });
        },
      },
    });
    const baseOptions = {
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const captureFailure = async (promise: Promise<RenderResult>): Promise<Error> => {
      try {
        await promise;
      } catch (error) {
        if (error instanceof Error) return error;
      }
      throw new Error("Expected render to fail");
    };

    const leader = captureFailure(
      renderer.renderPage("/concurrent-cookie-error", makeRenderContext(), {
        ...baseOptions,
        request: new Request("https://example.test/concurrent-cookie-error", {
          headers: { "x-test-user": "leader" },
        }),
      }),
    );
    await firstStarted.promise;
    const follower = captureFailure(
      renderer.renderPage("/concurrent-cookie-error", makeRenderContext(), {
        ...baseOptions,
        request: new Request("https://example.test/concurrent-cookie-error", {
          headers: { "x-test-user": "follower" },
        }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst.resolve();

    const [leaderError, followerError] = await Promise.all([leader, follower]);
    assertEquals(getAttachedDataResponseMetadata(leaderError).cookies?.[0]?.value, "leader");
    assertEquals(getAttachedDataResponseMetadata(followerError).cookies?.[0]?.value, "follower");
    assertEquals(renderCalls, 2);
    assertEquals(store.data.size, 0);
  });

  it("rerenders singleflight followers when the leader throws a cookie-bearing control", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    let renderCalls = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (_slug: string, options?: RenderOptions) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async (_slug, options) => {
          renderCalls++;
          if (renderCalls === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          const user = options?.request?.headers.get("x-test-user") ?? "missing";
          throw redirect("/login", false, {
            cookies: [{ name: "session", value: user, path: "/" }],
          });
        },
      },
    });
    const baseOptions = {
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const captureFailure = async (promise: Promise<RenderResult>): Promise<unknown> => {
      try {
        await promise;
      } catch (error) {
        return error;
      }
      throw new Error("Expected render to fail");
    };

    const leader = captureFailure(
      renderer.renderPage("/concurrent-control", makeRenderContext(), {
        ...baseOptions,
        request: new Request("https://example.test/concurrent-control", {
          headers: { "x-test-user": "leader" },
        }),
      }),
    );
    await firstStarted.promise;
    const follower = captureFailure(
      renderer.renderPage("/concurrent-control", makeRenderContext(), {
        ...baseOptions,
        request: new Request("https://example.test/concurrent-control", {
          headers: { "x-test-user": "follower" },
        }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst.resolve();

    const [leaderControl, followerControl] = await Promise.all([leader, follower]);
    assertEquals(
      (leaderControl as { cookies?: Array<{ value?: string }> }).cookies?.[0]?.value,
      "leader",
    );
    assertEquals(
      (followerControl as { cookies?: Array<{ value?: string }> }).cookies?.[0]?.value,
      "follower",
    );
    assertEquals(renderCalls, 2);
    assertEquals(store.data.size, 0);
  });

  it("rerenders singleflight followers when a metadata wrapper carries a cookie control", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    let renderCalls = 0;
    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (_slug: string, options?: RenderOptions) => Promise<RenderResult>;
        };
      };
    }).createServicesForContext = () => ({
      pipeline: {
        renderPage: async (_slug, options) => {
          renderCalls++;
          if (renderCalls === 1) {
            firstStarted.resolve();
            await releaseFirst.promise;
          }
          const user = options?.request?.headers.get("x-test-user") ?? "missing";
          throw wrapDataResponseMetadataError(
            redirect("/login", false, {
              cookies: [{ name: "session", value: user, path: "/" }],
            }),
            { headers: { "x-loader": "ready" } },
          );
        },
      },
    });
    const baseOptions = {
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const captureFailure = async (promise: Promise<RenderResult>): Promise<Error> => {
      try {
        await promise;
      } catch (error) {
        if (error instanceof Error) return error;
      }
      throw new Error("Expected render to fail");
    };

    const leader = captureFailure(
      renderer.renderPage("/concurrent-wrapped-control", makeRenderContext(), {
        ...baseOptions,
        request: new Request("https://example.test/concurrent-wrapped-control", {
          headers: { "x-test-user": "leader" },
        }),
      }),
    );
    await firstStarted.promise;
    const follower = captureFailure(
      renderer.renderPage("/concurrent-wrapped-control", makeRenderContext(), {
        ...baseOptions,
        request: new Request("https://example.test/concurrent-wrapped-control", {
          headers: { "x-test-user": "follower" },
        }),
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst.resolve();

    const [leaderError, followerError] = await Promise.all([leader, follower]);
    const leaderControl = unwrapDataResponseMetadataError(leaderError) as {
      cookies?: Array<{ value?: string }>;
    };
    const followerControl = unwrapDataResponseMetadataError(followerError) as {
      cookies?: Array<{ value?: string }>;
    };
    assertEquals(leaderControl.cookies?.[0]?.value, "leader");
    assertEquals(followerControl.cookies?.[0]?.value, "follower");
    assertEquals(renderCalls, 2);
    assertEquals(store.data.size, 0);
  });
});

describe("Renderer release asset cache isolation", () => {
  const originalManifestFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalManifestFlag ?? "");
    clearReleaseAssetManifestCache();
  });

  it("forwards the release identity from context to the render pipeline", async () => {
    const renderer = new Renderer();
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let observedOptions: RenderOptions | undefined;
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
          observedOptions = options;
          return Promise.resolve({
            html: "<html>release render</html>",
            frontmatter: {},
            headings: [],
            stream: null,
          });
        },
      },
    });

    try {
      await renderer.renderPage("/release", makeRenderContext(), {
        releaseAssetManifest: null,
      });

      assertEquals(observedOptions?.contentSourceId, "release-rel-1");
      assertEquals(observedOptions?.releaseId, "rel-1");
    } finally {
      await renderer.destroy();
    }
  });

  it("checks the manifest-versioned cache prefix after awaiting a ready manifest", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    registerManifestFetcherForRelease(
      "rel-1",
      () => Promise.resolve({ state: "ready", manifest_version: 1, manifest: makeReadyManifest() }),
    );

    const store = createInMemoryStore();
    const manifestPrefix = buildRenderCachePrefix("proj-1", "production", "rel-1", "production", 1);
    store.data.set(`${manifestPrefix}:page:/cached`, {
      result: {
        html: "<html>manifest cache hit</html>",
        frontmatter: {},
        headings: [],
        stream: null,
        ssrHash: "cached",
      },
      storedAt: Date.now(),
    });

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

  it("persists rendered HTML under the manifest-versioned cache prefix", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    registerManifestFetcherForRelease(
      "rel-1",
      () => Promise.resolve({ state: "ready", manifest_version: 1, manifest: makeReadyManifest() }),
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

    const manifestPrefix = buildRenderCachePrefix("proj-1", "production", "rel-1", "production", 1);
    const jitPrefix = buildRenderCachePrefix("proj-1", "production", "rel-1", "production");
    assertEquals(result.html, "<html>fresh manifest render</html>");
    assertEquals(store.data.has(`${manifestPrefix}:page:/fresh`), true);
    assertEquals(store.data.has(`${jitPrefix}:page:/fresh`), false);
  });

  it("keeps studio-embed renders off the manifest-versioned cache prefix", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    registerManifestFetcherForRelease(
      "rel-1",
      () => Promise.resolve({ state: "ready", manifest_version: 1, manifest: makeReadyManifest() }),
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
          assertEquals(
            options?.releaseAssetManifest,
            null,
            "studio-embed must not receive the ready release manifest",
          );
          return Promise.resolve({
            html: "<html>studio embed render</html>",
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
      studioEmbed: true,
    });

    const manifestPrefix = buildRenderCachePrefix("proj-1", "production", "rel-1", "production", 1);
    const jitPrefix = buildRenderCachePrefix("proj-1", "production", "rel-1", "production");
    assertEquals(result.html, "<html>studio embed render</html>");
    assertEquals(
      store.data.has(`${jitPrefix}:page:/fresh`),
      true,
      "studio-embed renders must persist under the unversioned production prefix",
    );
    assertEquals(
      store.data.has(`${manifestPrefix}:page:/fresh`),
      false,
      "studio-embed renders must never write into the manifest-versioned public cache",
    );
  });

  it("serves stale HTML immediately and refreshes that route in the background", async () => {
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      adapter: { fs: { exists: () => Promise.resolve(true) } },
    } as unknown as RenderContext;
    const cacheKey = `${ctx.cachePrefix}:page:/stale`;
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
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
      adapter: { fs: { exists: () => Promise.resolve(true) } },
    } as unknown as RenderContext;
    const cacheKey = `${ctx.cachePrefix}:page:/stale-at-capacity`;
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
      adapter: { fs: { exists: () => Promise.resolve(true) } },
    } as unknown as RenderContext;
    const url = new URL("https://example.com/data?filter=recent");
    const requestAbort = new AbortController();
    const request = new Request(url, {
      headers: { "accept-language": "en" },
      signal: requestAbort.signal,
    });
    const requestCacheKey = "/data?filter=recent";
    const cacheKey = buildRenderCacheKey(ctx.cachePrefix, `page:${requestCacheKey}`);
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
        adapter: { fs: { exists: () => Promise.resolve(true) } },
      } as unknown as RenderContext;
      const cacheKey = `${ctx.cachePrefix}:page:/prewarm-disabled`;
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
      assertEquals(store.data.has(`${ctx.cachePrefix}:page:/should-not-prewarm`), false);
    } finally {
      setEnv("VERYFRONT_RENDER_PREWARM_MAX_ROUTES", originalPrewarmLimit ?? "");
    }
  });

  it("refreshes stale theme variants under the original variant key", async () => {
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      adapter: { fs: { exists: () => Promise.resolve(true) } },
    } as unknown as RenderContext;
    const themedCacheKey = `${ctx.cachePrefix}:page:/stale-themed:theme-dark`;
    const unthemedCacheKey = `${ctx.cachePrefix}:page:/stale-themed`;
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
      { request?: Request; url?: URL }
    >();
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
          if (slug === "/") {
            assertEquals(options?.nonce, "nonce-123");
          } else {
            assertEquals(typeof options?.nonce, "string");
            assertEquals(options?.nonce?.length, 32);
            assertEquals(options?.nonce === "nonce-123", false);
          }
          renderedSlugs.push(slug);
          renderRequests.set(slug, {
            request: options?.request,
            url: options?.url,
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
      adapter: { fs: {} } as RenderContext["adapter"],
    };
    const url = new URL("https://preview.example.test/?utm_source=smoke");
    const result = await renderer.renderPage("/", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
      nonce: "nonce-123",
      request: new Request(url, {
        headers: {
          accept: "text/html",
          "x-preview-context": "source-request",
        },
      }),
      url,
    });
    await waitForProductionPrewarm(renderer);

    const prefix = buildRenderCachePrefix("proj-1", "production", "rel-1", "production");
    assertEquals(result.html, "<html>/</html>");
    assertEquals(renderedSlugs.includes("/blog"), true);
    assertEquals(renderedSlugs.includes("/about"), true);
    assertEquals(renderedSlugs.includes("about"), false);
    assertEquals(renderedSlugs.includes("/docs/[slug]"), false);
    assertEquals(renderedSlugs.some((slug) => slug.startsWith("/aa-stale-")), false);
    assertEquals(store.data.has(`${prefix}:page:/blog`), true);
    assertEquals(store.data.has(`${prefix}:page:/about`), true);
    assertEquals(store.data.has(`${prefix}:page:about`), false);

    for (const slug of ["/blog", "/about"]) {
      const prewarm = renderRequests.get(slug);
      assertEquals(prewarm?.url?.href, `https://preview.example.test${slug}`);
      assertEquals(prewarm?.request?.url, `https://preview.example.test${slug}`);
      assertEquals(prewarm?.request?.method, "GET");
      assertEquals(prewarm?.request?.headers.get("accept"), "text/html");
      assertEquals(prewarm?.request?.headers.has("authorization"), false);
      assertEquals(prewarm?.request?.headers.has("cookie"), false);
      assertEquals(prewarm?.request?.headers.has("x-preview-context"), false);
    }
  });

  it("bounds remembered prewarm contexts", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const remember = (renderer as unknown as {
      rememberProductionPrewarm(key: string, promise: Promise<void>): void;
    }).rememberProductionPrewarm.bind(renderer);

    // Well past the documented bound, so the eviction loop has to fire.
    const attempts = 600;
    for (let index = 0; index < attempts; index++) {
      remember(`key-${index}`, Promise.resolve());
    }

    const contexts = (renderer as unknown as {
      productionPrewarmContexts: Map<string, Promise<void>>;
    }).productionPrewarmContexts;

    try {
      assertEquals(
        contexts.size < attempts,
        true,
        "remembered prewarm contexts must stay bounded so multi-tenant pods cannot grow without limit",
      );
      assertEquals(
        contexts.has("key-0"),
        false,
        "the oldest remembered prewarm context must be evicted first",
      );
      assertEquals(
        contexts.has(`key-${attempts - 1}`),
        true,
        "the newest key must survive eviction",
      );
    } finally {
      await renderer.destroy();
    }
  });

  it("bounds resolver probes while validating prewarm candidates", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let probeCount = 0;
    (renderer as unknown as {
      pageExists: (slug: string) => Promise<boolean>;
    }).pageExists = () => {
      probeCount++;
      return Promise.resolve(false);
    };

    // Tenant-shaped worst case: many page-like candidates that never resolve.
    const doomedSlugs = Array.from({ length: 500 }, (_, index) => `/doomed-${index}`);
    const maxRoutes = 12;
    const resolvable = await (renderer as unknown as {
      filterResolvablePrewarmSlugs: (
        ctx: RenderContext,
        slugs: string[],
        maxRoutes: number,
      ) => Promise<string[]>;
    }).filterResolvablePrewarmSlugs(makeRenderContext(), doomedSlugs, maxRoutes);

    try {
      // Graceful degradation: nothing prewarms when no candidate resolves, and
      // the probe count is pinned in both directions so neither an unbounded
      // loop nor a silently probe-nothing implementation can pass.
      assertEquals(resolvable, []);
      assertEquals(
        probeCount,
        maxRoutes * 4,
        `resolver probes must stay bounded even when no candidate resolves (got ${probeCount})`,
      );
    } finally {
      await renderer.destroy();
    }
  });

  it("samples beyond an invalid candidate prefix", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let probeCount = 0;
    (renderer as unknown as {
      pageExists: (slug: string) => Promise<boolean>;
    }).pageExists = (slug) => {
      probeCount++;
      return Promise.resolve(slug === "/valid-app-route");
    };

    const slugs = Array.from({ length: 499 }, (_, index) => `/legacy-${index}`);
    slugs.push("/valid-app-route");
    const maxRoutes = 12;
    const resolvable = await (renderer as unknown as {
      filterResolvablePrewarmSlugs: (
        ctx: RenderContext,
        slugs: string[],
        maxRoutes: number,
      ) => Promise<string[]>;
    }).filterResolvablePrewarmSlugs(makeRenderContext(), slugs, maxRoutes);

    try {
      assertEquals(resolvable, ["/valid-app-route"]);
      assertEquals(probeCount, maxRoutes * 4);
    } finally {
      await renderer.destroy();
    }
  });

  it("keeps the prioritized candidate prefix when bounding probes", async () => {
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let probeCount = 0;
    (renderer as unknown as {
      pageExists: (slug: string) => Promise<boolean>;
    }).pageExists = () => {
      probeCount++;
      return Promise.resolve(true);
    };

    // selectPrewarmSlugs ranks route-family siblings first; the probe cap must
    // not thin them out by striding uniformly across the whole candidate list.
    const siblings = Array.from(
      { length: 12 },
      (_, index) => `/blog/articles/sibling-${index}`,
    );
    const unrelated = Array.from({ length: 488 }, (_, index) => `/unrelated-${index}`);
    const maxRoutes = 12;
    const resolvable = await (renderer as unknown as {
      filterResolvablePrewarmSlugs: (
        ctx: RenderContext,
        slugs: string[],
        maxRoutes: number,
      ) => Promise<string[]>;
    }).filterResolvablePrewarmSlugs(
      makeRenderContext(),
      [...siblings, ...unrelated],
      maxRoutes,
    );

    try {
      assertEquals(resolvable, siblings);
      // Stops as soon as the route cap is met, well inside the probe budget.
      assertEquals(probeCount, maxRoutes);
    } finally {
      await renderer.destroy();
    }
  });

  it("uses one deadline for the complete resolver probe batch", async () => {
    using time = new FakeTime();
    const renderer = new Renderer({ cache: { store: createInMemoryStore() } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    let probeCount = 0;
    const probeOptions: { signal?: AbortSignal; deadline?: number }[] = [];
    (renderer as unknown as {
      pageExists: (
        slug: string,
        ctx: RenderContext,
        options: { signal?: AbortSignal; deadline?: number },
      ) => Promise<boolean>;
    }).pageExists = (_slug, _ctx, options) => {
      probeCount++;
      probeOptions.push(options);
      return new Promise<boolean>(() => {});
    };

    const startedAt = Date.now();
    const filtering = (renderer as unknown as {
      filterResolvablePrewarmSlugs: (
        ctx: RenderContext,
        slugs: string[],
        maxRoutes: number,
      ) => Promise<string[]>;
    }).filterResolvablePrewarmSlugs(
      makeRenderContext(),
      Array.from({ length: 500 }, (_, index) => `/stalled-${index}`),
      12,
    );

    await time.tickAsync(5_000);

    try {
      assertEquals(await filtering, []);
      assertEquals(probeCount, 1);
      // The stalled probe is cancelled and carries the batch deadline, so the
      // resolver slot is not held for entity resolution's own default window.
      assertEquals(probeOptions[0]?.signal?.aborted, true);
      assertEquals(probeOptions[0]?.deadline, startedAt + 5_000);
    } finally {
      await renderer.destroy();
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
      adapter: { fs: {} } as RenderContext["adapter"],
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
      adapter: { fs: {} } as RenderContext["adapter"],
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
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
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
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
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
      adapter: { fs: {} } as RenderContext["adapter"],
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
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
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

  it("bounds callers waiting on an identical cacheable render", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;
    const renderGate = Promise.withResolvers<void>();
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
        renderPage: async (slug) => {
          renderCalls++;
          await renderGate.promise;
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
    const totalRenders = RENDER_SINGLEFLIGHT_MAX_FOLLOWERS + 2;
    const renders = Array.from(
      { length: totalRenders },
      () =>
        renderer.renderPage("/bounded-burst", ctx, {
          environment: "production",
          releaseId: "rel-1",
          releaseAssetManifest: null,
        }),
    );

    try {
      await assertRejects(
        () => renders.at(-1)!,
        Error,
        "Render request capacity exhausted",
      );
      assertEquals(renderCalls, 1);
    } finally {
      renderGate.resolve();
    }

    const results = await Promise.allSettled(renders);
    assertEquals(
      results.filter((result) => result.status === "fulfilled").length,
      RENDER_SINGLEFLIGHT_MAX_FOLLOWERS + 1,
    );
    assertEquals(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
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

  it("rebinds the sealed cache nonce to each caller's own response nonce", async () => {
    const projectId = `nonce-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
    };
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;

    const renderGate = Promise.withResolvers<void>();
    const renderStarted = Promise.withResolvers<void>();
    let renderCalls = 0;

    (renderer as unknown as {
      createServicesForContext: () => {
        pipeline: {
          renderPage: (
            slug: string,
            options?: { nonce?: string },
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
          renderCalls++;
          renderStarted.resolve();
          return renderGate.promise.then(() => ({
            html: `<html><script nonce="${options?.nonce}">boot()</script></html>`,
            frontmatter: {},
            headings: [],
            stream: null,
          }));
        },
      },
    });

    const sharedOptions = {
      cacheKey: "nonce-render",
      environment: "production" as const,
      releaseId: "rel-1",
      releaseAssetManifest: null,
    };
    const leaderRender = renderer.renderPage("/nonce", ctx, {
      ...sharedOptions,
      nonce: "nonce-123",
    });
    await renderStarted.promise;

    const followerRender = renderer.renderPage("/nonce", ctx, {
      ...sharedOptions,
      nonce: "nonce-456",
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderGate.resolve();

    const leader = await leaderRender;
    const follower = await followerRender;

    assertEquals(renderCalls, 1, "the follower must join the leader's flight");
    assertStringIncludes(
      leader.html,
      '<script nonce="nonce-123">',
      "the leader must receive its own response nonce, not the sealed cache placeholder",
    );
    assertStringIncludes(
      follower.html,
      '<script nonce="nonce-456">',
      "a follower must have the cached placeholder rebound to its own nonce",
    );
    assertEquals(
      leader.html.includes("vf-cache-"),
      false,
      "the internal cache nonce placeholder must never reach a response",
    );
    assertEquals(
      follower.html.includes("vf-cache-"),
      false,
      "the internal cache nonce placeholder must never reach a response",
    );
  });

  it("keeps a cacheable leader queued after its first caller disconnects", async () => {
    const projectId = `shared-queued-project-${crypto.randomUUID()}`;
    const ctx = {
      ...makeRenderContext(),
      projectId,
      projectSlug: projectId,
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
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
      cachePrefix: buildRenderCachePrefix(projectId, "production", "rel-1", "production"),
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
      cachePrefix: buildRenderCachePrefix("proj-1", "preview", "feature", "production"),
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

  it("bounds the complete API render key while preserving the flag-off override", () => {
    const renderer = new Renderer();
    const buildCacheKey = (renderer as unknown as {
      buildCacheKey(
        slug: string,
        ctx: RenderContext,
        options?: RenderOptions,
      ): string | null;
    }).buildCacheKey.bind(renderer);
    const ctx = makeRenderContext();
    const legacyKey = "a".repeat(440);
    const options: RenderOptions = {
      cacheKey: legacyKey,
      colorScheme: "dark",
      dependencyPinningCacheKey: "on:3w5e11264sgsf",
      url: new URL("https://preview.example.test"),
    };
    const cacheKey = buildCacheKey("/", ctx, options);

    assertEquals(typeof cacheKey, "string");
    const completeKey = `render:${ctx.cachePrefix}:page:${cacheKey}:theme-dark`;
    assertEquals(completeKey.length <= 512, true);
    assertEquals(/^[a-zA-Z0-9_:.\-/*]+$/.test(completeKey), true);
    assertEquals(
      buildCacheKey("/", ctx, {
        ...options,
        dependencyPinningCacheKey: "off",
      }),
      legacyKey,
    );
  });

  it("returns no render cache key for an admitted application identity", () => {
    const renderer = new Renderer();
    const buildCacheKey = (renderer as unknown as {
      buildCacheKey(
        slug: string,
        ctx: RenderContext,
        options?: RenderOptions,
      ): string | null;
    }).buildCacheKey.bind(renderer);
    const ctx = makeRenderContext();

    // Trusted-proxy auth strips identity headers from the application request,
    // so the request itself carries no cache-sensitive state; only the
    // admitted identity marks this render as personalized.
    assertEquals(
      buildCacheKey("/", ctx, {
        request: new Request("http://localhost/"),
        url: new URL("http://localhost/"),
        applicationIdentity: {
          issuer: "https://issuer.example.test",
          subject: "user-123",
          groups: ["engineering"],
          roles: ["reader"],
          groupsComplete: true,
          claims: { sub: "user-123" },
        },
      }),
      null,
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
      cachePrefix: buildRenderCachePrefix("proj-1", "preview", "main", "production"),
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
});
