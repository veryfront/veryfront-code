import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { buildRenderCacheKey, buildRenderCachePrefix } from "#veryfront/cache/keys.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { FakeTime } from "#std/testing/time";
import type { CachePayload, CacheStore } from "./cache/types.ts";
import type { RenderContext } from "./context/render-context.ts";
import {
  clearRendererCacheForProject,
  destroyRenderer,
  getRenderer,
  initializeRenderer,
  Renderer,
  setColdProjectCacheInvalidatorForTesting,
} from "./renderer.ts";
import { projectRenderCounts } from "./renderer-concurrency.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";
import { destroySharedServices } from "./shared/shared-services.ts";

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
    schemaVersion: 1,
    projectId: "proj-1",
    releaseId: "rel-1",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "0.1.799",
    sourceContentHash: "",
    createdAt: "2026-06-14T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {},
    css: [],
    routes: {},
    dependencies: {},
    fallback: { mode: "jit", gaps: [] },
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
    `page:${baseKey}:config-${configDigest}${theme}`,
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
      Promise.resolve({ state: "ready", manifest: makeReadyManifest() })
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

  it("persists rendered HTML under the manifest-versioned cache prefix", async () => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
    configureReleaseAssetManifestFetcher(() =>
      Promise.resolve({ state: "ready", manifest: makeReadyManifest() })
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
      adapter: { fs: { exists: async () => true } },
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

  it("preserves request metadata while refreshing stale HTML after disconnect", async () => {
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      adapter: { fs: { exists: async () => true } },
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
        adapter: { fs: { exists: async () => true } },
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
      adapter: { fs: { exists: async () => true } },
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
            options?: { nonce?: string; releaseAssetManifest?: ReleaseAssetManifest | null },
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
        renderPage: (slug, options) => {
          assertEquals(options?.releaseAssetManifest, null);
          assertEquals(options?.nonce, undefined);
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
    const result = await renderer.renderPage("/", ctx, {
      environment: "production",
      releaseId: "rel-1",
      releaseAssetManifest: null,
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
});
