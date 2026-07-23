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
import type { CachePayload, CacheStore } from "./cache/types.ts";
import type { RenderContext } from "./context/render-context.ts";
import { destroyRenderer, getRenderer, initializeRenderer, Renderer } from "./renderer.ts";
import { projectRenderCounts } from "./renderer-concurrency.ts";

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
        destroy() {},
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
    assertEquals(store.data.has(`${manifestPrefix}:page:/fresh`), true);
    assertEquals(store.data.has(`${jitPrefix}:page:/fresh`), false);
  });

  it("serves stale HTML immediately and refreshes that route in the background", async () => {
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      adapter: { fs: { exists: async () => true } },
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
        destroy() {},
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

  it("preserves the original request while refreshing stale HTML", async () => {
    const store = createInMemoryStore();
    const ctx = {
      ...makeRenderContext(),
      adapter: { fs: { exists: async () => true } },
    } as unknown as RenderContext;
    const url = new URL("https://example.com/data?filter=recent");
    const request = new Request(url, { headers: { "accept-language": "en" } });
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
        destroy() {},
        renderPage: (_slug, options) => {
          assertEquals(options?.skipCacheCheck, true);
          assertEquals(options?.request, request);
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
          destroy() {},
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
      adapter: { fs: { exists: async () => true } },
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
        destroy() {},
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
        destroy() {},
        renderPage: (slug, options) => {
          assertEquals(options?.releaseAssetManifest, null);
          assertEquals(options?.nonce, slug === "/" ? "nonce-123" : undefined);
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
      nonce: "nonce-123",
    });
    await waitForProductionPrewarm(renderer);

    const prefix = buildRenderCachePrefix("proj-1", "production", "rel-1");
    assertEquals(result.html, "<html>/</html>");
    assertEquals(renderedSlugs.includes("/blog"), true);
    assertEquals(renderedSlugs.includes("/about"), true);
    assertEquals(renderedSlugs.includes("about"), false);
    assertEquals(renderedSlugs.includes("/docs/[slug]"), false);
    assertEquals(renderedSlugs.some((slug) => slug.startsWith("/aa-stale-")), false);
    assertEquals(store.data.has(`${prefix}:page:/blog`), true);
    assertEquals(store.data.has(`${prefix}:page:/about`), true);
    assertEquals(store.data.has(`${prefix}:page:about`), false);
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
        destroy() {},
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
        destroy() {},
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
        destroy() {},
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
});

describe("rendering/renderer lifecycle", () => {
  it("stops accepting work and waits for background renders before destroying caches", async () => {
    const store = createInMemoryStore();
    const renderer = new Renderer({ cache: { store } });
    (renderer as unknown as { initialized: boolean }).initialized = true;

    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    (renderer as unknown as {
      productionPrewarmContexts: Map<string, Promise<void>>;
    }).productionPrewarmContexts.set("pending", pending);

    let destroyed = false;
    const destruction = renderer.destroy().then(() => {
      destroyed = true;
    });
    await Promise.resolve();

    assertEquals((renderer as unknown as { initialized: boolean }).initialized, false);
    assertEquals(destroyed, false);

    release();
    await destruction;
    assertEquals(destroyed, true);
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
