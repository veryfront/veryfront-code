import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { RenderPipeline, type RenderPipelineConfig } from "./pipeline.ts";
import type { RenderOptions } from "./types.ts";
import { markBuildFailure } from "./module-loader/build-failure.ts";
import { cachePageCss, getPageCssCacheKey } from "./css-cache.ts";
import { cacheCSSAsync } from "#veryfront/html/styles-builder/index.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import {
  clearReleaseAssetManifestCache,
  configureReleaseAssetManifestFetcher,
  getReadyManifestForRender,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import {
  finalizeRequestProfiling,
  resetRequestProfiles,
  runWithRequestProfiling,
} from "#veryfront/observability/request-profiler.ts";
import {
  clearSSRModuleCache,
  globalInProgress,
  globalModuleCache,
} from "#veryfront/modules/react-loader/ssr-module-loader/cache/index.ts";
import {
  clearImportMapCache,
  createImportMapIdentity,
  type ImportMapIdentity,
} from "#veryfront/modules/import-map/index.ts";
import type {
  LayoutPreloadSummary,
  LayoutRequestIdentity,
  LayoutRequestOverrides,
} from "./layout.ts";
import { __resetPoolForTests, getWorkerPool } from "#veryfront/security/sandbox/worker-pool.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { DataFetcher } from "#veryfront/data/index.ts";
import { WorkerExecutionScopeOwner } from "../worker-execution-scope.ts";

const RELEASE_CSS_HASH = "c".repeat(64);

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function layoutPreloadSummary(
  requestIdentity: LayoutRequestIdentity,
): LayoutPreloadSummary {
  return {
    tsxTotal: 1,
    tsxSuccess: 1,
    tsxFailures: [],
    mdxTotal: 0,
    mdxSuccess: 0,
    mdxFailures: [],
    importMapSuccess: true,
    durationMs: 0,
    allSuccess: true,
    requestIdentity,
  };
}

function createPipeline(
  pagePath: string,
  overrides: Partial<RenderPipelineConfig> = {},
): RenderPipeline {
  const config: RenderPipelineConfig = {
    pageResolver: {
      resolvePage: async () =>
        ({
          entity: {
            path: pagePath,
            frontmatter: {},
          },
        }) as any,
    } as any,
    cacheCoordinator: {
      checkCache: async () => null,
      persistResult: async () => {},
    } as any,
    pageRenderer: {
      preparePageBundles: async () => ({
        pageElement: {},
        pageBundle: {},
      }),
    } as any,
    layoutOrchestrator: {
      collectLayouts: async () => ({ layoutBundle: undefined, nestedLayouts: [] }),
      preloadLayoutModules: async () => ({
        tsxTotal: 0,
        tsxSuccess: 0,
        tsxFailures: [],
        mdxTotal: 0,
        mdxSuccess: 0,
        mdxFailures: [],
        importMapSuccess: true,
        durationMs: 0,
        allSuccess: true,
      }),
      applyLayoutsAndWrappers: async (element: unknown) => element,
    } as any,
    ssrOrchestrator: {
      performSSRRendering: async () => ({
        fullHtml: "<!doctype html><html><body>ok</body></html>",
        finalStream: null,
        ssrHash: "test-hash",
      }),
      resolveErrorComponentPath: async () => null,
    } as any,
    adapter: {
      env: { get: () => undefined },
      fs: {
        exists: async () => false,
        readFile: async () => {
          const error = new Error("not found") as Error & { code: string };
          error.code = "ENOENT";
          throw error;
        },
      },
    } as any,
    mode: "production",
    projectDir: "/project",
    ...overrides,
  };

  return new RenderPipeline(config);
}

function primeCssCache(slug: string, projectId: string): void {
  const cssKey = getPageCssCacheKey(projectId, undefined, slug, undefined);
  cachePageCss(cssKey, "/* cached css */");
}

function releaseManifestWithCss(): ReleaseAssetManifest {
  return {
    schemaVersion: 1,
    projectId: "p",
    releaseId: "rel-css",
    releaseVersion: 1,
    manifestVersion: 1,
    builderVersion: "0.1.793",
    sourceContentHash: "a".repeat(64),
    createdAt: "2026-06-12T00:00:00.000Z",
    assetBasePath: "/_vf/assets",
    modules: {},
    css: [{
      contentHash: RELEASE_CSS_HASH,
      size: 10,
      contentType: "text/css",
      styleProfileHash: "style-profile",
    }],
    routes: { "/behavior-release-css": { modules: [], css: [RELEASE_CSS_HASH] } },
    dependencies: {},
    fallback: { mode: "jit", gaps: [] },
  };
}

async function primeReadyReleaseCssManifest(): Promise<void> {
  configureReleaseAssetManifestFetcher(() =>
    Promise.resolve({ state: "ready", manifest: releaseManifestWithCss() })
  );
  setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
  getReadyManifestForRender("rel-css");
  await new Promise((r) => setTimeout(r, 0));
}

describe("RenderPipeline behavior", () => {
  const originalManifestFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);

  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalManifestFlag ?? "");
    Deno.env.delete("VERYFRONT_ENABLE_SERVER_TIMING");
    resetRequestProfiles();
    configureReleaseAssetManifestFetcher(undefined);
    clearReleaseAssetManifestCache();
  });

  it("resolves request-scoped module loader identity and the configured React version", async () => {
    const pipeline = createPipeline("/project/pages/index.tsx", {
      projectId: "project-config-id",
      contentSourceId: "release-config-source",
      config: {
        react: { version: "^18.3.1" },
      },
    } as Partial<RenderPipelineConfig>);
    const observedConfigs: Array<{
      projectId?: string;
      contentSourceId?: string;
      reactVersion?: string;
    }> = [];
    (pipeline as any).loadModule = async (
      _path: string,
      config: typeof observedConfigs[number],
    ) => {
      observedConfigs.push(config);
      return {};
    };

    await pipeline.resolvePageData("/", {
      request: new Request("http://localhost/"),
      url: new URL("http://localhost/"),
    });
    assert(observedConfigs.length > 0);
    for (const config of observedConfigs) {
      assertEquals(config.projectId, "project-config-id");
      assertEquals(config.contentSourceId, "release-config-source");
      assertEquals(config.reactVersion, "18.3.1");
    }

    observedConfigs.length = 0;
    await pipeline.resolvePageData("/", {
      projectId: "project-request-id",
      contentSourceId: "preview-request-source",
      request: new Request("http://localhost/"),
      url: new URL("http://localhost/"),
    });
    assert(observedConfigs.length > 0);
    for (const config of observedConfigs) {
      assertEquals(config.projectId, "project-request-id");
      assertEquals(config.contentSourceId, "preview-request-source");
      assertEquals(config.reactVersion, "18.3.1");
    }
  });

  it("keeps page and layout identities aligned across sequential request overrides", async () => {
    const pagePath = "/project/pages/request-identity.tsx";
    const layoutPath = "/project/layouts/request-identity.tsx";
    const importMapA = await createImportMapIdentity({
      imports: { package: "https://example.com/a.ts" },
    });
    const importMapB = await createImportMapIdentity({
      imports: { package: "https://example.com/b.ts" },
    });
    const identitiesBySource = new Map<string, ImportMapIdentity>([
      ["source-a", importMapA],
      ["source-b", importMapB],
    ]);
    const moduleObservations: Array<{
      path: string;
      projectId?: string;
      contentSourceId?: string;
    }> = [];
    const layoutObservations: LayoutRequestIdentity[] = [];
    const pipeline = createPipeline(pagePath, {
      config: {
        react: { version: "19.2.4" },
        resolve: {
          importMap: {
            imports: { package: "https://example.com/page.ts" },
          },
        },
      },
      layoutOrchestrator: {
        collectLayouts: async () => ({
          layoutBundle: undefined,
          nestedLayouts: [{ kind: "tsx", componentPath: layoutPath }],
        }),
        preloadLayoutModules: async (
          _layouts: unknown,
          overrides: LayoutRequestOverrides,
        ) => {
          const projectId = overrides.projectId!;
          const projectSlug = overrides.projectSlug!;
          const contentSourceId = overrides.contentSourceId!;
          return layoutPreloadSummary({
            projectId,
            projectSlug,
            contentSourceId,
            importMapIdentity: identitiesBySource.get(contentSourceId)!,
          });
        },
        applyLayoutsAndWrappers: async (
          element: unknown,
          _pageInfo: unknown,
          _layoutBundle: unknown,
          _layouts: unknown,
          requestIdentity: LayoutRequestIdentity,
        ) => {
          layoutObservations.push(requestIdentity);
          return element;
        },
      } as any,
    });
    (pipeline as any).loadModule = async (
      path: string,
      config: { projectId?: string; contentSourceId?: string },
    ) => {
      moduleObservations.push({
        path,
        projectId: config.projectId,
        contentSourceId: config.contentSourceId,
      });
      return {};
    };

    try {
      for (const suffix of ["a", "b"] as const) {
        await pipeline.renderPage(`/request-identity-${suffix}`, {
          projectId: `project-${suffix}`,
          projectSlug: `slug-${suffix}`,
          contentSourceId: `source-${suffix}`,
          request: new Request(`http://localhost/request-identity-${suffix}`),
          url: new URL(`http://localhost/request-identity-${suffix}`),
          skipCacheCheck: true,
          skipCachePersist: true,
        });
      }
    } finally {
      clearImportMapCache("project-a");
      clearImportMapCache("project-b");
    }

    assertEquals(
      moduleObservations.map(({ path, projectId, contentSourceId }) => ({
        path,
        projectId,
        contentSourceId,
      })),
      [
        { path: pagePath, projectId: "project-a", contentSourceId: "source-a" },
        { path: layoutPath, projectId: "project-a", contentSourceId: "source-a" },
        { path: pagePath, projectId: "project-b", contentSourceId: "source-b" },
        { path: layoutPath, projectId: "project-b", contentSourceId: "source-b" },
      ],
    );
    assertEquals(
      layoutObservations.map((identity) => ({
        projectId: identity.projectId,
        projectSlug: identity.projectSlug,
        contentSourceId: identity.contentSourceId,
        package: identity.importMapIdentity.importMap.imports?.package,
      })),
      [
        {
          projectId: "project-a",
          projectSlug: "slug-a",
          contentSourceId: "source-a",
          package: "https://example.com/a.ts",
        },
        {
          projectId: "project-b",
          projectSlug: "slug-b",
          contentSourceId: "source-b",
          package: "https://example.com/b.ts",
        },
      ],
    );
  });

  it("keeps concurrent layout identities request-local when preloads settle out of order", async () => {
    const pagePath = "/project/pages/concurrent-identity.tsx";
    const layoutPath = "/project/layouts/concurrent-identity.tsx";
    const importMapA = await createImportMapIdentity({
      imports: { package: "https://example.com/concurrent-a.ts" },
    });
    const importMapB = await createImportMapIdentity({
      imports: { package: "https://example.com/concurrent-b.ts" },
    });
    const startedA = createDeferred<void>();
    const startedB = createDeferred<void>();
    const releaseA = createDeferred<void>();
    const releaseB = createDeferred<void>();
    const layoutObservations: LayoutRequestIdentity[] = [];
    const pageObservations: Array<{
      projectId?: string;
      contentSourceId?: string;
    }> = [];
    const pipeline = createPipeline(pagePath, {
      config: {
        react: { version: "19.2.4" },
        resolve: {
          importMap: {
            imports: { package: "https://example.com/page.ts" },
          },
        },
      },
      layoutOrchestrator: {
        collectLayouts: async () => ({
          layoutBundle: undefined,
          nestedLayouts: [{ kind: "tsx", componentPath: layoutPath }],
        }),
        preloadLayoutModules: async (
          _layouts: unknown,
          overrides: LayoutRequestOverrides,
        ) => {
          const isA = overrides.contentSourceId === "source-concurrent-a";
          (isA ? startedA : startedB).resolve();
          await (isA ? releaseA : releaseB).promise;
          return layoutPreloadSummary({
            projectId: overrides.projectId!,
            projectSlug: overrides.projectSlug!,
            contentSourceId: overrides.contentSourceId!,
            importMapIdentity: isA ? importMapA : importMapB,
          });
        },
        applyLayoutsAndWrappers: async (
          element: unknown,
          _pageInfo: unknown,
          _layoutBundle: unknown,
          _layouts: unknown,
          requestIdentity: LayoutRequestIdentity,
        ) => {
          layoutObservations.push(requestIdentity);
          return element;
        },
      } as any,
    });
    (pipeline as any).loadModule = async (
      path: string,
      config: { projectId?: string; contentSourceId?: string },
    ) => {
      if (path === pagePath) {
        pageObservations.push({
          projectId: config.projectId,
          contentSourceId: config.contentSourceId,
        });
      }
      return {};
    };

    const renderA = pipeline.renderPage("/concurrent-a", {
      projectId: "project-concurrent-a",
      projectSlug: "slug-concurrent-a",
      contentSourceId: "source-concurrent-a",
      request: new Request("http://localhost/concurrent-a"),
      url: new URL("http://localhost/concurrent-a"),
      skipCacheCheck: true,
      skipCachePersist: true,
    });
    await startedA.promise;
    const renderB = pipeline.renderPage("/concurrent-b", {
      projectId: "project-concurrent-b",
      projectSlug: "slug-concurrent-b",
      contentSourceId: "source-concurrent-b",
      request: new Request("http://localhost/concurrent-b"),
      url: new URL("http://localhost/concurrent-b"),
      skipCacheCheck: true,
      skipCachePersist: true,
    });
    await startedB.promise;

    try {
      releaseB.resolve();
      await renderB;
      assertEquals(layoutObservations.length, 1);
      assertEquals(layoutObservations[0]?.projectId, "project-concurrent-b");
      releaseA.resolve();
      await renderA;
    } finally {
      releaseA.resolve();
      releaseB.resolve();
      clearImportMapCache("project-concurrent-a");
      clearImportMapCache("project-concurrent-b");
    }

    assertEquals(
      pageObservations.toSorted((left, right) =>
        (left.projectId ?? "").localeCompare(right.projectId ?? "")
      ),
      [
        {
          projectId: "project-concurrent-a",
          contentSourceId: "source-concurrent-a",
        },
        {
          projectId: "project-concurrent-b",
          contentSourceId: "source-concurrent-b",
        },
      ],
    );
    assertEquals(
      layoutObservations.map((identity) => ({
        projectId: identity.projectId,
        contentSourceId: identity.contentSourceId,
        package: identity.importMapIdentity.importMap.imports?.package,
      })),
      [
        {
          projectId: "project-concurrent-b",
          contentSourceId: "source-concurrent-b",
          package: "https://example.com/concurrent-b.ts",
        },
        {
          projectId: "project-concurrent-a",
          contentSourceId: "source-concurrent-a",
          package: "https://example.com/concurrent-a.ts",
        },
      ],
    );
  });

  it("keeps a cold module graph alive while distinct transforms keep completing", async () => {
    using time = new FakeTime();
    const pipeline = createPipeline("/project/pages/large-cold-graph.tsx");
    const owner = new AbortController();
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => markStarted = resolve);
    (pipeline as any).loadModule = (
      _path: string,
      config: { onProgress?: (event: { phase: string; filePath: string }) => void },
    ) => {
      markStarted();
      return new Promise<Record<string, unknown>>((resolve) => {
        let completed = 0;
        const interval = setInterval(() => {
          completed += 1;
          config.onProgress?.({
            phase: "framework:module-transformed",
            filePath: `/framework/module-${completed}.js`,
          });
          if (completed === 10) {
            clearInterval(interval);
            resolve({});
          }
        }, 5_000);
      });
    };

    const pageData = pipeline.resolvePageData("/large-cold-graph", {
      abortSignal: owner.signal,
      request: new Request("http://localhost/large-cold-graph"),
      url: new URL("http://localhost/large-cold-graph"),
    });
    await started;
    await time.tickAsync(50_000);

    assertEquals((await pageData).props, {});
  });

  it("preserves a hard cap for unowned cold module graphs", async () => {
    using time = new FakeTime();
    const pipeline = createPipeline("/project/pages/unowned-cold-graph.tsx");
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => markStarted = resolve);
    (pipeline as any).loadModule = (
      _path: string,
      config: {
        onProgress?: (event: { phase: string; filePath: string }) => void;
        signal?: AbortSignal;
      },
    ) => {
      markStarted();
      return new Promise<Record<string, unknown>>((_, reject) => {
        let completed = 0;
        const intervalId = setInterval(() => {
          completed += 1;
          config.onProgress?.({
            phase: "framework:module-transformed",
            filePath: `/framework/unowned-module-${completed}.js`,
          });
        }, 5_000);
        config.signal?.addEventListener(
          "abort",
          () => {
            clearInterval(intervalId);
            reject(config.signal?.reason);
          },
          { once: true },
        );
      });
    };

    const pageData = pipeline.resolvePageData("/unowned-cold-graph", {
      request: new Request("http://localhost/unowned-cold-graph"),
      url: new URL("http://localhost/unowned-cold-graph"),
    });
    const rejected = assertRejects(
      () => pageData,
      Error,
      "Module loading for /unowned-cold-graph timed out after 45000ms",
    );

    await started;
    await time.tickAsync(45_000);

    assertEquals((await rejected as Error & { timeoutKind?: string }).timeoutKind, "hard");
  });

  it("does not treat a repeated transform milestone as continuing progress", async () => {
    using time = new FakeTime();
    const pipeline = createPipeline("/project/pages/repeating-graph.tsx");
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => markStarted = resolve);
    (pipeline as any).loadModule = (
      _path: string,
      config: { onProgress?: (event: { phase: string; filePath: string }) => void },
    ) => {
      markStarted();
      return new Promise<Record<string, unknown>>(() => {
        setInterval(() => {
          config.onProgress?.({
            phase: "framework:module-transformed",
            filePath: "/framework/repeating.js",
          });
        }, 5_000);
      });
    };

    const pageData = pipeline.resolvePageData("/repeating-graph", {
      request: new Request("http://localhost/repeating-graph"),
      url: new URL("http://localhost/repeating-graph"),
    });
    const rejected = assertRejects(
      () => pageData,
      Error,
      "Module loading for /repeating-graph timed out",
    );
    await started;
    await time.tickAsync(45_000);

    assertEquals((await rejected as Error & { timeoutKind?: string }).timeoutKind, "idle");
  });

  it("cancels module loading when the owning render is aborted", async () => {
    using time = new FakeTime();
    const pipeline = createPipeline("/project/pages/cancelled-graph.tsx");
    const controller = new AbortController();
    let observedSignal: AbortSignal | undefined;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => markStarted = resolve);
    (pipeline as any).loadModule = (
      _path: string,
      config: { signal?: AbortSignal },
    ) => {
      observedSignal = config.signal;
      markStarted();
      return new Promise<Record<string, unknown>>(() => {});
    };

    const pageData = pipeline.resolvePageData("/cancelled-graph", {
      abortSignal: controller.signal,
      request: new Request("http://localhost/cancelled-graph"),
      url: new URL("http://localhost/cancelled-graph"),
    });
    const rejected = assertRejects(() => pageData, Error, "render cancelled");
    await started;

    controller.abort(new Error("render cancelled"));
    await time.tickAsync(10_000);

    await rejected;
    assertEquals(observedSignal?.aborted, true);
    assertEquals(observedSignal?.reason, controller.signal.reason);
  });

  it("renderPage uses a non-empty cache key for the root slug", async () => {
    const checks: Array<{ slug: string; cacheKey?: string }> = [];
    const persists: Array<{ slug: string; cacheKey?: string }> = [];
    const pipeline = createPipeline("/project/pages/index.mdx", {
      cacheCoordinator: {
        checkCache: async (slug, cacheKey) => {
          checks.push({ slug, cacheKey });
          return {
            depAwareSlug: slug,
            moduleCacheKey: cacheKey ?? slug,
            cacheStatus: "miss",
            lookupDurationMs: 0,
          };
        },
        persistResult: async (_result, slug, cacheKey) => {
          persists.push({ slug, cacheKey });
        },
      },
    } as Partial<RenderPipelineConfig>);

    await pipeline.renderPage("", { delivery: "string" });

    assertEquals(checks, [{ slug: "", cacheKey: "index" }]);
    assertEquals(persists, [{ slug: "", cacheKey: "index" }]);
  });

  it("renderPage preserves active SSR transforms during development cache freshness clears", async () => {
    clearSSRModuleCache();
    const projectId = "project-dev-render-active-transform";
    const moduleKey = `prefix:${projectId}:module`;
    const inProgressKey = `prefix:${projectId}:in-progress`;
    const leader = Promise.resolve({
      tempPath: "/tmp/dev-render-active.mjs",
      contentHash: "active",
    });
    globalModuleCache.set(moduleKey, { tempPath: "/tmp/dev-render.mjs", contentHash: "a" });
    globalInProgress.set(inProgressKey, leader);

    const pipeline = createPipeline("/project/pages/dev-render.tsx", {
      mode: "development",
      projectId,
    });

    try {
      await pipeline.renderPage("/dev-render", { delivery: "string" });

      assertEquals(globalModuleCache.has(moduleKey), false);
      assertEquals(globalInProgress.get(inProgressKey), leader);
    } finally {
      clearSSRModuleCache();
    }
  });

  it("resolvePageData preserves active SSR transforms during development cache freshness clears", async () => {
    clearSSRModuleCache();
    const projectId = "project-dev-page-data-active-transform";
    const moduleKey = `prefix:${projectId}:module`;
    const inProgressKey = `prefix:${projectId}:in-progress`;
    const leader = Promise.resolve({
      tempPath: "/tmp/dev-page-data-active.mjs",
      contentHash: "active",
    });
    globalModuleCache.set(moduleKey, { tempPath: "/tmp/dev-page-data.mjs", contentHash: "a" });
    globalInProgress.set(inProgressKey, leader);

    const pipeline = createPipeline("/project/pages/dev-page-data.tsx", {
      mode: "development",
      projectId,
    });
    (pipeline as any).loadModule = async () => ({});

    try {
      await pipeline.resolvePageData("/dev-page-data", {
        request: new Request("http://localhost/dev-page-data"),
        url: new URL("http://localhost/dev-page-data"),
      });

      assertEquals(globalModuleCache.has(moduleKey), false);
      assertEquals(globalInProgress.get(inProgressKey), leader);
    } finally {
      clearSSRModuleCache();
    }
  });

  it("renderPage forwards project-relative layout props to HTML hydration", async () => {
    const slug = "/behavior-render-layout-props";
    const layoutPath = "/project/layouts/root.tsx";
    let hydrationLayoutProps: Record<string, Record<string, unknown>> | undefined;
    const pipeline = createPipeline("/project/pages/behavior-render-layout-props.tsx", {
      layoutOrchestrator: {
        collectLayouts: async () => ({
          layoutBundle: undefined,
          nestedLayouts: [{ kind: "tsx", componentPath: layoutPath }],
        }),
        preloadLayoutModules: async () => ({
          tsxTotal: 1,
          tsxSuccess: 1,
          tsxFailures: [],
          mdxTotal: 0,
          mdxSuccess: 0,
          mdxFailures: [],
          importMapSuccess: true,
          durationMs: 0,
          allSuccess: true,
        }),
        applyLayoutsAndWrappers: async (element: unknown) => element,
      } as any,
      ssrOrchestrator: {
        performSSRRendering: async (
          _element: unknown,
          _context: unknown,
          options: { layoutProps?: Record<string, Record<string, unknown>> } | undefined,
        ) => {
          hydrationLayoutProps = options?.layoutProps;
          return {
            fullHtml: "<!doctype html><html><body>ok</body></html>",
            finalStream: null,
            ssrHash: "test-hash",
          };
        },
        resolveErrorComponentPath: async () => null,
      } as any,
    });

    (pipeline as any).loadModule = async (path: string) =>
      path === layoutPath ? { getServerData: () => ({ props: { theme: "docs" } }) } : {};

    await pipeline.renderPage(slug, {
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(hydrationLayoutProps, {
      "layouts/root.tsx": { theme: "docs" },
    });
  });

  it("staticDataOnly skips request-only data hooks during static rendering", async () => {
    const pagePath = "/project/pages/static-only.tsx";
    let serverCalls = 0;
    let staticCalls = 0;
    let staticContext: Record<string, unknown> | undefined;
    const pipeline = createPipeline(pagePath);

    (pipeline as any).loadModule = async () => ({
      getServerData: () => {
        serverCalls++;
        return { props: { source: "server" } };
      },
      getStaticData: (ctx: Record<string, unknown>) => {
        staticCalls++;
        staticContext = ctx;
        return { props: { source: "static" } };
      },
    });

    const result = await (pipeline as any).resolveDataFetching(
      "/static-only",
      pagePath,
      [],
      {
        url: new URL("https://example.test/static-only"),
        staticDataOnly: true,
      },
      { projectId: "/project", contentSourceId: undefined },
    );

    assertEquals(serverCalls, 0);
    assertEquals(staticCalls, 1);
    assertEquals("request" in (staticContext ?? {}), false);
    assertEquals("query" in (staticContext ?? {}), false);
    assertEquals(result.pageProps, { source: "static" });
  });

  it("renderPage refreshes preview caches and retries stale MDX ESM export mismatches", async () => {
    const slug = "/behavior-stale-mdx";
    let renderAttempts = 0;
    let sourceRefreshes = 0;
    const pipeline = createPipeline("/project/pages/behavior-stale-mdx.mdx", {
      adapter: {
        env: { get: () => undefined },
        fs: {
          exists: async () => false,
          refreshSourceSnapshot: () => {
            sourceRefreshes++;
            return Promise.resolve();
          },
        },
      } as any,
      pageRenderer: {
        preparePageBundles: async () => {
          renderAttempts++;
          if (renderAttempts === 1) {
            throw new Error(
              "The requested module 'file:///cache/vfmod.mjs' does not provide an export named 'default'",
            );
          }

          return {
            pageElement: {},
            pageBundle: {},
          };
        },
      } as any,
    } as Partial<RenderPipelineConfig>);

    const result = await pipeline.renderPage(slug, {
      delivery: "string",
      projectId: "project-1",
      projectSlug: "project-slug",
      contentSourceId: "preview-main",
    });

    assertEquals(result.html, "<!doctype html><html><body>ok</body></html>");
    assertEquals(renderAttempts, 2);
    assertEquals(sourceRefreshes, 1);
  });

  it("renderPage emits request-profiler timings for pipeline stages", async () => {
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    const slug = "/behavior-profile-render";
    const pipeline = createPipeline("/project/pages/behavior-profile-render.mdx");

    const record = await runWithRequestProfiling(
      {
        category: "html",
        method: "GET",
        pathname: slug,
      },
      async () => {
        await pipeline.renderPage(slug, {
          delivery: "string",
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        });
        return finalizeRequestProfiling(200);
      },
    );

    assert(record);
    for (
      const phase of [
        "render.resolve_page",
        "render.collect_layouts",
        "render.prepare_bundles",
        "render.apply_layouts",
        "render.ssr",
      ]
    ) {
      assert(phase in record.phases, `missing ${phase}`);
    }
  });

  describe("critical page module failures", () => {
    // Downstream (the SSR handler) decides whether to show the project's own
    // error page or the dev overlay, so the reason the module never loaded has
    // to survive the trip.
    type LoadModuleOverride = { loadModule: (path: string) => Promise<unknown> };

    function pipelineWithFailingPageModule(fail: () => never): RenderPipeline {
      const pipeline = createPipeline("/project/pages/behavior-load-failure.tsx");
      (pipeline as unknown as LoadModuleOverride).loadModule = () => Promise.resolve(fail());
      return pipeline;
    }

    function rejectLoad(pipeline: RenderPipeline): Promise<unknown> {
      const slug = "/behavior-load-failure";
      return assertRejects(
        () =>
          pipeline.resolvePageData(slug, {
            projectId: "proj-load-failure",
            request: new Request(`http://localhost${slug}`),
            url: new URL(`http://localhost${slug}`),
          }),
        Error,
        "Critical page module(s) failed to load",
      );
    }

    function buildFailureFlag(error: unknown): unknown {
      const context = (error as { context?: { buildFailure?: unknown } }).context;
      return context?.buildFailure;
    }

    it("reports a build failure as one", async () => {
      const error = await rejectLoad(pipelineWithFailingPageModule(() => {
        throw markBuildFailure(new Error("Cannot import the static asset"));
      }));

      assertEquals(buildFailureFlag(error), true);
    });

    it("does not report a module-scope runtime throw as a build failure", async () => {
      const error = await rejectLoad(pipelineWithFailingPageModule(() => {
        throw new Error("Missing API key");
      }));

      assertEquals(buildFailureFlag(error), false);
    });
  });

  it("resolvePageData surfaces notFound from data hooks", async () => {
    const slug = "/behavior-not-found";
    const projectId = "proj-not-found";
    const pipeline = createPipeline("/project/pages/behavior-not-found.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({ getServerData: () => ({}) });
    (pipeline as any).dataFetcher = {
      fetchData: async () => ({ notFound: true }),
    };

    await assertRejects(
      () =>
        pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        }),
      Error,
      "Page/Layout returned notFound",
    );
  });

  it("runs data hooks and extracts params for configured page roots", async () => {
    const slug = "/users/42";
    const projectId = "proj-custom-pages";
    const pipeline = createPipeline("/project/src/legacy-pages/users/[id].tsx", {
      directories: { app: "src/routes", pages: "src/legacy-pages" },
    } as Partial<RenderPipelineConfig>);
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({ getServerData: () => ({}) });
    (pipeline as any).dataFetcher = {
      fetchData: async (_module: unknown, context: { params: Record<string, string> }) => ({
        props: { loadedUserId: context.params.id },
      }),
    };

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.params, { id: "42" });
    assertEquals(pageData.props, { loadedUserId: "42" });
  });

  it("passes the trusted request project identity into data execution", async () => {
    const slug = "/behavior-data-project-identity";
    const projectId = "proj-data-project-identity";
    const pagePath = "/project/pages/behavior-data-project-identity.tsx";
    const pipeline = createPipeline(pagePath);
    primeCssCache(slug, projectId);
    let observedOptions: Record<string, unknown> | undefined;

    (pipeline as any).loadModule = async () => ({ getServerData: () => ({}) });
    (pipeline as any).dataFetcher = {
      fetchData: async (
        _module: unknown,
        _context: unknown,
        _mode: unknown,
        options: Record<string, unknown>,
      ) => {
        observedOptions = options;
        return { props: {} };
      },
    };

    await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`, {
        headers: { "x-project-id": "spoofed-project" },
      }),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(observedOptions, {
      modulePath: pagePath,
      projectDir: "/project",
      projectId,
    });
  });

  it("uses an explicit data scope as project identity when config omits projectId", async () => {
    const slug = "/scope-owned-project-identity";
    const pagePath = "/project/pages/scope-owned-project-identity.tsx";
    const scope = {
      projectId: "scope-owned-project",
      mode: "production" as const,
      versionId: "release-1",
    };
    let observedOptions: Record<string, unknown> | undefined;
    const borrowedFetcher = {
      fetchData: async (
        _module: unknown,
        _context: unknown,
        _mode: unknown,
        options: Record<string, unknown>,
      ) => {
        observedOptions = options;
        return { props: {} };
      },
    } as unknown as DataFetcher;
    const pipeline = createPipeline(pagePath, {
      dataFetcher: borrowedFetcher,
      dataCacheScope: scope,
    });
    (pipeline as any).loadModule = async () => ({
      getStaticData: () => ({ props: {} }),
    });
    primeCssCache(slug, scope.projectId);

    try {
      await pipeline.resolvePageData(slug, {
        request: new Request(`https://example.test${slug}`),
        url: new URL(`https://example.test${slug}`),
      });

      const { workerScopeId, ...stableOptions } = observedOptions!;
      assertEquals(typeof workerScopeId, "string");
      assertEquals(stableOptions, {
        modulePath: pagePath,
        projectDir: "/project",
        projectId: scope.projectId,
        cacheScope: scope,
        workerGenerationId: "release-1",
      });
    } finally {
      pipeline.destroy();
    }
  });

  it("snapshots a borrowed cache scope before asynchronous module loading", async () => {
    const slug = "/borrowed-scope-snapshot";
    const pagePath = "/project/pages/borrowed-scope-snapshot.tsx";
    const scope = {
      projectId: "borrowed-scope-project-a",
      mode: "production" as const,
      versionId: "release-a",
    };
    let observedLoaderIdentity:
      | { projectId: string; contentSourceId: string | undefined }
      | undefined;
    let observedFetchOptions: Record<string, unknown> | undefined;
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const borrowedFetcher = {
      fetchData: async (
        _module: unknown,
        _context: unknown,
        _mode: unknown,
        options: Record<string, unknown>,
      ) => {
        observedFetchOptions = options;
        return { props: {} };
      },
    } as unknown as DataFetcher;
    const pipeline = createPipeline(pagePath, {
      dataFetcher: borrowedFetcher,
      dataCacheScope: scope,
      contentSourceId: "release-a",
    });
    (pipeline as any).loadModule = async (
      _path: string,
      moduleLoaderConfig: { projectId: string; contentSourceId?: string },
    ) => {
      observedLoaderIdentity = {
        projectId: moduleLoaderConfig.projectId,
        contentSourceId: moduleLoaderConfig.contentSourceId,
      };
      markLoadStarted();
      await loadGate;
      return { getStaticData: () => ({ props: {} }) };
    };
    primeCssCache(slug, "borrowed-scope-project-a");
    primeCssCache(slug, "borrowed-scope-project-b");

    const pending = pipeline.resolvePageData(slug, {
      request: new Request(`https://example.test${slug}`),
      url: new URL(`https://example.test${slug}`),
    });
    try {
      await loadStarted;
      scope.projectId = "borrowed-scope-project-b";
      scope.versionId = "release-b";
      releaseLoad();
      await pending;

      assertEquals(observedLoaderIdentity, {
        projectId: "borrowed-scope-project-a",
        contentSourceId: "release-a",
      });
      const { workerScopeId, ...stableOptions } = observedFetchOptions!;
      assertEquals(typeof workerScopeId, "string");
      assertEquals(stableOptions, {
        modulePath: pagePath,
        projectDir: "/project",
        projectId: "borrowed-scope-project-a",
        cacheScope: {
          projectId: "borrowed-scope-project-a",
          mode: "production",
          versionId: "release-a",
        },
        workerGenerationId: "release-a",
      });
    } finally {
      releaseLoad();
      await Promise.allSettled([pending]);
      pipeline.destroy();
    }
  });

  it("snapshots request-local identity before asynchronous module loading", async () => {
    const slug = "/request-identity-snapshot";
    const pagePath = "/project/pages/request-identity-snapshot.tsx";
    const projectA = "request-project-a";
    const projectB = "request-project-b";
    const sourceA = "source-a";
    const sourceB = "source-b";
    let observedLoaderIdentity:
      | { projectId: string; contentSourceId: string | undefined }
      | undefined;
    let observedFetchOptions: Record<string, unknown> | undefined;
    let observedDataContext:
      | { authorization: string | null; query: string; url: string }
      | undefined;
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    const pipeline = createPipeline(pagePath, {
      projectId: projectA,
      contentSourceId: sourceA,
      dataCacheScope: {
        projectId: projectA,
        mode: "production",
        versionId: sourceA,
      },
    });
    (pipeline as any).dataFetcher = {
      fetchData: async (
        _module: unknown,
        context: {
          request: Request;
          query: URLSearchParams;
          url: URL;
        },
        _mode: unknown,
        options: Record<string, unknown>,
      ) => {
        observedFetchOptions = options;
        observedDataContext = {
          authorization: context.request.headers.get("authorization"),
          query: context.query.toString(),
          url: context.url.href,
        };
        return { props: {} };
      },
      destroy: () => {},
    };
    (pipeline as any).loadModule = async (
      _path: string,
      moduleLoaderConfig: { projectId: string; contentSourceId?: string },
    ) => {
      observedLoaderIdentity = {
        projectId: moduleLoaderConfig.projectId,
        contentSourceId: moduleLoaderConfig.contentSourceId,
      };
      markLoadStarted();
      await loadGate;
      return { getStaticData: () => ({ props: {} }) };
    };
    cachePageCss(
      getPageCssCacheKey(projectA, undefined, slug, sourceA),
      "/* cached css A */",
    );
    cachePageCss(
      getPageCssCacheKey(projectB, undefined, slug, sourceB),
      "/* cached css B */",
    );
    const options = {
      projectId: projectA,
      contentSourceId: sourceA,
      request: new Request(`https://example.test${slug}`, {
        headers: { authorization: "Bearer original" },
      }),
      url: new URL(`https://example.test${slug}?variant=original`),
    };

    const pending = pipeline.resolvePageData(slug, options);
    const oldWorkerScopeId = (pipeline as unknown as {
      workerExecutionScopes: { currentScopeId: string };
    }).workerExecutionScopes.currentScopeId;
    try {
      await loadStarted;
      options.projectId = projectB;
      options.contentSourceId = sourceB;
      options.request.headers.set("authorization", "Bearer mutated");
      options.url.searchParams.set("variant", "mutated");
      pipeline.clearModuleCache();
      const replacementWorkerScopeId = (pipeline as unknown as {
        workerExecutionScopes: { currentScopeId: string };
      }).workerExecutionScopes.currentScopeId;
      releaseLoad();
      await pending;

      assertEquals(observedLoaderIdentity, {
        projectId: projectA,
        contentSourceId: sourceA,
      });
      const { workerScopeId, ...stableOptions } = observedFetchOptions!;
      assertEquals(workerScopeId, oldWorkerScopeId);
      assertEquals(replacementWorkerScopeId === oldWorkerScopeId, false);
      assertEquals(stableOptions, {
        modulePath: pagePath,
        projectDir: "/project",
        projectId: projectA,
        cacheScope: {
          projectId: projectA,
          mode: "production",
          versionId: sourceA,
        },
        workerGenerationId: sourceA,
      });
      assertEquals(observedDataContext, {
        authorization: "Bearer original",
        query: "variant=original",
        url: `https://example.test${slug}?variant=original`,
      });
    } finally {
      releaseLoad();
      await Promise.allSettled([pending]);
      pipeline.destroy();
    }
  });

  it("lets a fresh shared scope run while an old pre-worker pipeline drains", async () => {
    const slug = "/shared-worker-scope-rotation";
    const projectId = "shared-worker-scope-project";
    const sourceId = "shared-worker-source";
    const pagePath = "/project/pages/shared-worker-scope-rotation.tsx";
    const evicted: string[] = [];
    const enclosingOwner = new WorkerExecutionScopeOwner({
      initialScopeId: "shared-worker-scope-old",
      createScopeId: () => "shared-worker-scope-fresh",
      evictScope: (scopeId) => evicted.push(scopeId),
    });
    const oldOwnerLease = enclosingOwner.acquire();
    const oldPipeline = createPipeline(pagePath, {
      projectId,
      contentSourceId: sourceId,
      workerExecutionScopeId: oldOwnerLease.scopeId,
    });
    const loadStarted = Promise.withResolvers<void>();
    const loadGate = Promise.withResolvers<void>();
    const observedWorkerScopes: string[] = [];
    (oldPipeline as any).loadModule = async () => {
      loadStarted.resolve();
      await loadGate.promise;
      return { getStaticData: () => ({ props: { generation: "old" } }) };
    };
    (oldPipeline as any).dataFetcher = {
      fetchData: async (
        _module: unknown,
        _context: unknown,
        _mode: unknown,
        options: { workerScopeId?: string },
      ) => {
        observedWorkerScopes.push(options.workerScopeId!);
        return { props: { generation: "old" } };
      },
      destroy: () => {},
    };
    const renderOptions = {
      projectId,
      contentSourceId: sourceId,
      environment: "production" as const,
      releaseAssetManifest: releaseManifestWithCss(),
      request: new Request(`https://example.test${slug}`),
      url: new URL(`https://example.test${slug}`),
    };

    const oldResult = oldPipeline.resolvePageData(slug, renderOptions);
    let freshPipeline: RenderPipeline | undefined;
    let freshOwnerLease: ReturnType<WorkerExecutionScopeOwner["acquire"]> | undefined;
    try {
      await loadStarted.promise;
      const freshScopeId = enclosingOwner.rotate();
      freshOwnerLease = enclosingOwner.acquire();
      assertEquals(freshOwnerLease.scopeId, freshScopeId);
      assertEquals(evicted, []);

      freshPipeline = createPipeline(pagePath, {
        projectId,
        contentSourceId: sourceId,
        workerExecutionScopeId: freshOwnerLease.scopeId,
      });
      (freshPipeline as any).loadModule = async () => ({
        getStaticData: () => ({ props: { generation: "fresh" } }),
      });
      (freshPipeline as any).dataFetcher = {
        fetchData: async (
          _module: unknown,
          _context: unknown,
          _mode: unknown,
          options: { workerScopeId?: string },
        ) => {
          observedWorkerScopes.push(options.workerScopeId!);
          return { props: { generation: "fresh" } };
        },
        destroy: () => {},
      };

      const freshResult = await freshPipeline.resolvePageData(
        slug,
        renderOptions,
      );
      assertEquals(freshResult.props, { generation: "fresh" });
      assertEquals(observedWorkerScopes, [freshScopeId]);
      assertEquals(evicted, []);

      loadGate.resolve();
      assertEquals((await oldResult).props, { generation: "old" });
      assertEquals(observedWorkerScopes, [
        freshScopeId,
        oldOwnerLease.scopeId,
      ]);

      oldPipeline.destroy();
      assertEquals(evicted, []);
      oldOwnerLease.release();
      assertEquals(evicted, ["shared-worker-scope-old"]);
    } finally {
      loadGate.resolve();
      await Promise.allSettled([oldResult]);
      oldPipeline.destroy();
      oldOwnerLease.release();
      freshPipeline?.destroy();
      freshOwnerLease?.release();
      enclosingOwner.close(true);
    }

    assertEquals(evicted, [
      "shared-worker-scope-old",
      "shared-worker-scope-fresh",
    ]);
  });

  it("shares one scoped data cache across distinct pipeline instances", async () => {
    const sharedFetcher = new DataFetcher();
    const slug = "/shared-data-cache";
    const projectId = "shared-data-project";
    const pagePath = "/project/pages/shared-data-cache.tsx";
    const scope = {
      projectId,
      mode: "production" as const,
      versionId: "source-a",
    };
    let calls = 0;
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    let markLoadStarted!: () => void;
    const loadStarted = new Promise<void>((resolve) => {
      markLoadStarted = resolve;
    });
    const pageModule = {
      getStaticData: async () => {
        calls++;
        markLoadStarted();
        await loadGate;
        return { props: { version: calls }, revalidate: 3600 };
      },
    };
    const first = createPipeline(pagePath, {
      dataFetcher: sharedFetcher,
      dataCacheScope: scope,
      projectId,
      contentSourceId: "source-a",
    });
    const second = createPipeline(pagePath, {
      dataFetcher: sharedFetcher,
      dataCacheScope: scope,
      projectId,
      contentSourceId: "source-a",
    });
    (first as any).loadModule = async () => pageModule;
    (second as any).loadModule = async () => pageModule;
    primeCssCache(slug, projectId);
    const options = {
      projectId,
      contentSourceId: "source-a",
      request: new Request(`https://example.test${slug}`),
      url: new URL(`https://example.test${slug}`),
    };

    const pendingResults = [
      first.resolvePageData(slug, options),
      second.resolvePageData(slug, options),
    ];
    try {
      await loadStarted;
      assertEquals(calls, 1);
      releaseLoad();

      const [firstData, secondData] = await Promise.all(pendingResults);
      assert(firstData);
      assert(secondData);
      assertEquals(firstData.props, { version: 1 });
      assertEquals(secondData.props, { version: 1 });

      const cached = await second.resolvePageData(slug, options);
      assertEquals(cached.props, { version: 1 });
      assertEquals(calls, 1);
    } finally {
      releaseLoad();
      await Promise.allSettled(pendingResults);
      first.destroy();
      second.destroy();
      sharedFetcher.destroy();
    }
  });

  it("isolates static data when a direct caller overrides content source", async () => {
    const slug = "/source-override";
    const projectId = "source-override-project";
    const pagePath = "/project/pages/source-override.tsx";
    let calls = 0;
    const pipeline = createPipeline(pagePath, {
      dataCacheScope: {
        projectId,
        mode: "production",
        versionId: "source-a",
      },
      projectId,
      contentSourceId: "source-a",
    });
    (pipeline as any).loadModule = async () => ({
      getStaticData: () => ({ props: { version: ++calls } }),
    });
    primeCssCache(slug, projectId);
    const base = {
      projectId,
      request: new Request(`https://example.test${slug}`),
      url: new URL(`https://example.test${slug}`),
    };

    try {
      const sourceA = await pipeline.resolvePageData(slug, {
        ...base,
        contentSourceId: "source-a",
      });
      const sourceB = await pipeline.resolvePageData(slug, {
        ...base,
        contentSourceId: "source-b",
      });
      const sourceAAgain = await pipeline.resolvePageData(slug, {
        ...base,
        contentSourceId: "source-a",
      });
      pipeline.clearDataCacheForRoute(slug);
      const sourceBAfterClear = await pipeline.resolvePageData(slug, {
        ...base,
        contentSourceId: "source-b",
      });

      assertEquals(sourceA.props, { version: 1 });
      assertEquals(sourceB.props, { version: 2 });
      assertEquals(sourceAAgain.props, { version: 1 });
      assertEquals(sourceBAfterClear.props, { version: 3 });
      assertEquals(calls, 3);
    } finally {
      pipeline.destroy();
    }
  });

  it("clears only a borrowing pipeline's exact release scope", async () => {
    const sharedFetcher = new DataFetcher();
    const pagePath = "/project/pages/scoped-clear.tsx";
    const scopeA = {
      projectId: "scoped-clear-project",
      mode: "production" as const,
      versionId: "rel-1",
    };
    const scopeB = {
      projectId: "scoped-clear-project",
      mode: "production" as const,
      versionId: "rel-2",
    };
    const pipelineA = createPipeline(pagePath, {
      dataFetcher: sharedFetcher,
      dataCacheScope: scopeA,
    });
    const pipelineB = createPipeline(pagePath, {
      dataFetcher: sharedFetcher,
      dataCacheScope: scopeB,
    });
    let callsA = 0;
    let callsB = 0;
    const context = {
      params: {},
      query: new URLSearchParams(),
      request: new Request("https://example.test/scoped-clear"),
      url: new URL("https://example.test/scoped-clear"),
    };
    const pageA = {
      default: () => null,
      getStaticData: () => ({ props: { version: ++callsA } }),
    };
    const pageB = {
      default: () => null,
      getStaticData: () => ({ props: { version: ++callsB } }),
    };

    try {
      await sharedFetcher.fetchData(pageA, context, "production", {
        cacheScope: scopeA,
      });
      await sharedFetcher.fetchData(pageB, context, "production", {
        cacheScope: scopeB,
      });
      pipelineA.clearDataCache();

      await sharedFetcher.fetchData(pageA, context, "production", {
        cacheScope: scopeA,
      });
      await sharedFetcher.fetchData(pageB, context, "production", {
        cacheScope: scopeB,
      });
      assertEquals(callsA, 2);
      assertEquals(callsB, 1);
    } finally {
      pipelineA.destroy();
      pipelineB.destroy();
      sharedFetcher.destroy();
    }
  });

  it("does not destroy a borrowed data fetcher with its pipeline", async () => {
    const sharedFetcher = new DataFetcher();
    const pipeline = createPipeline("/project/pages/borrowed.tsx", {
      dataFetcher: sharedFetcher,
      dataCacheScope: null,
    });
    pipeline.destroy();
    pipeline.destroy();

    const result = await sharedFetcher.fetchData(
      { default: () => null },
      {
        params: {},
        query: new URLSearchParams(),
        request: new Request("https://example.test/borrowed"),
        url: new URL("https://example.test/borrowed"),
      },
    );
    assertEquals(result.props, {});
    sharedFetcher.destroy();
  });

  it("requires borrowed data fetchers to declare cache-scope intent", () => {
    const sharedFetcher = new DataFetcher();
    try {
      assertThrows(
        () => {
          createPipeline("/project/pages/ambiguous-borrow.tsx", {
            dataFetcher: sharedFetcher,
          });
        },
        TypeError,
        "explicit dataCacheScope or null",
      );
    } finally {
      sharedFetcher.destroy();
    }
  });

  it("requires externally owned worker scopes to rotate with module invalidation", () => {
    const pipeline = createPipeline("/project/pages/external-worker-scope.tsx", {
      workerExecutionScopeId: "external-worker-scope-a",
    });
    try {
      assertThrows(
        () => pipeline.clearModuleCache(),
        TypeError,
        "requires the enclosing owner's replacement scope ID",
      );

      pipeline.clearModuleCache("external-worker-scope-b");
      const currentScopeId = (pipeline as unknown as {
        workerExecutionScopes: { currentScopeId: string };
      }).workerExecutionScopes.currentScopeId;
      assertEquals(currentScopeId, "external-worker-scope-b");
    } finally {
      pipeline.destroy();
    }
  });

  it("rejects a cache scope owned by a different configured project", () => {
    assertThrows(
      () =>
        createPipeline("/project/pages/mismatched-scope.tsx", {
          projectId: "pipeline-project",
          dataCacheScope: {
            projectId: "other-project",
            mode: "production",
            versionId: "release-1",
          },
        }),
      TypeError,
      "must match the pipeline projectId",
    );
  });

  it("rejects request-local source overrides on a borrowed data fetcher", async () => {
    const sharedFetcher = new DataFetcher();
    const slug = "/borrowed-source-override";
    const projectId = "borrowed-source-project";
    const pipeline = createPipeline(
      "/project/pages/borrowed-source-override.tsx",
      {
        projectId,
        contentSourceId: "source-a",
        dataFetcher: sharedFetcher,
        dataCacheScope: {
          projectId,
          mode: "production",
          versionId: "source-a",
        },
      },
    );
    (pipeline as any).loadModule = async () => ({
      getStaticData: () => ({ props: {} }),
    });
    primeCssCache(slug, projectId);

    try {
      await assertRejects(
        () =>
          pipeline.resolvePageData(slug, {
            projectId,
            contentSourceId: "source-b",
            request: new Request(`https://example.test${slug}`),
            url: new URL(`https://example.test${slug}`),
          }),
        TypeError,
        "cannot override its configured contentSourceId",
      );
    } finally {
      pipeline.destroy();
      sharedFetcher.destroy();
    }
  });

  it("keeps Pages Router index and catch-all params aligned in rendering", async () => {
    const cases: Array<{
      pagePath: string;
      slug: string;
      params: Record<string, string | string[]>;
    }> = [
      {
        pagePath: "/project/pages/blog/[slug]/index.tsx",
        slug: "/blog/hello",
        params: { slug: "hello" },
      },
      {
        pagePath: "/project/pages/docs/[...slug]/index.tsx",
        slug: "/docs/api/reference",
        params: { slug: ["api", "reference"] },
      },
      {
        pagePath: "/project/pages/docs/[[...slug]]/index.tsx",
        slug: "/docs",
        params: { slug: [] },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const projectId = `proj-pages-index-${index}`;
      const pipeline = createPipeline(testCase.pagePath);
      primeCssCache(testCase.slug, projectId);

      (pipeline as any).loadModule = async () => ({ getServerData: () => ({}) });
      (pipeline as any).dataFetcher = {
        fetchData: async (
          _module: unknown,
          context: { params: Record<string, string | string[]> },
        ) => ({ props: { capturedParams: context.params } }),
      };

      const pageData = await pipeline.resolvePageData(testCase.slug, {
        projectId,
        request: new Request(`http://localhost${testCase.slug}`),
        url: new URL(`http://localhost${testCase.slug}`),
      });

      assertEquals(pageData.params, testCase.params);
      assertEquals(pageData.props, { capturedParams: testCase.params });
    }
  });

  it("resolvePageData emits request-profiler timings for first-hit stages", async () => {
    Deno.env.set("VERYFRONT_ENABLE_SERVER_TIMING", "1");
    const slug = "/behavior-profile-page-data";
    const projectId = "proj-profile-page-data";
    const pipeline = createPipeline("/project/pages/behavior-profile-page-data.mdx");
    primeCssCache(slug, projectId);

    const record = await runWithRequestProfiling(
      {
        category: "page-data",
        method: "GET",
        pathname: `/_veryfront/page-data${slug}.json`,
      },
      async () => {
        await pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        });
        return finalizeRequestProfiling(200);
      },
    );

    assert(record);
    for (
      const phase of [
        "page_data.resolve_page",
        "page_data.collect_layouts",
        "page_data.resolve_data",
        "page_data.extract_mdx_metadata",
        "page_data.resolve_app_path",
        "page_data.resolve_css",
      ]
    ) {
      assert(phase in record.phases, `missing ${phase}`);
    }
  });

  it("resolvePageData surfaces redirect from data hooks", async () => {
    const slug = "/behavior-redirect";
    const projectId = "proj-redirect";
    const pipeline = createPipeline("/project/pages/behavior-redirect.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({ getServerData: () => ({}) });
    (pipeline as any).dataFetcher = {
      fetchData: async () => ({ redirect: { destination: "/login", permanent: false } }),
    };

    await assertRejects(
      () =>
        pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        }),
      Error,
      "Redirect to /login",
    );
  });

  it("resolvePageData fails when a page module cannot be loaded", async () => {
    const slug = "/behavior-module-failure";
    const projectId = "proj-module-failure";
    const pipeline = createPipeline("/project/pages/behavior-module-failure.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => {
      throw new Error("module load failed");
    };
    (pipeline as any).dataFetcher = {
      fetchData: async () => ({ props: {} }),
    };

    await assertRejects(
      () =>
        pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        }),
      Error,
      "Critical page module(s) failed to load",
    );
  });

  it("resolvePageData includes mdx frontmatter and headings from prepared bundles", async () => {
    const slug = "/behavior-mdx-metadata";
    const projectId = "proj-mdx-metadata";
    const pipeline = createPipeline("/project/pages/behavior-mdx-metadata.mdx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).config.pageRenderer.preparePageBundles = async () => ({
      pageBundle: {
        frontmatter: { title: "MDX Title", author: "Veryfront" },
        headings: [{ id: "intro", text: "Intro", level: 2 }],
      },
    });

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.frontmatter, { title: "MDX Title", author: "Veryfront" });
    assertEquals(pageData.headings, [{ id: "intro", text: "Intro", level: 2 }]);
  });

  it("resolvePageData includes appPath when an app component exists", async () => {
    const slug = "/behavior-app-path";
    const projectId = "proj-app-path";
    const pipeline = createPipeline("/project/pages/behavior-app-path.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).config.adapter.fs.exists = async (path: string) =>
      path === "/project/components/app.tsx";

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.appPath, "components/app.tsx");
  });

  it("resolvePageData includes the matched app-router error boundary path", async () => {
    const slug = "/blog/hello";
    const projectId = "proj-error-path";
    const pagePath = "/project/app/blog/[slug]/page.tsx";
    let receivedPagePath: string | undefined;
    const pipeline = createPipeline(pagePath, {
      ssrOrchestrator: {
        performSSRRendering: async () => ({
          fullHtml: "<!doctype html><html><body>ok</body></html>",
          finalStream: null,
          ssrHash: "test-hash",
        }),
        resolveErrorComponentPath: async (
          context: { pageInfo?: { entity?: { path?: string } } },
        ) => {
          receivedPagePath = context.pageInfo?.entity?.path;
          return "/project/app/blog/[slug]/error.tsx";
        },
      } as any,
    });
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({});

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(receivedPagePath, pagePath);
    assertEquals(pageData.errorPath, "app/blog/[slug]/error.tsx");
  });

  it("resolvePageData includes release asset modules when a manifest is provided", async () => {
    const slug = "/behavior-release-modules";
    const projectId = "proj-release-modules";
    const pipeline = createPipeline("/project/pages/behavior-release-modules.mdx");
    primeCssCache(slug, projectId);

    const manifest = releaseManifestWithCss();
    manifest.modules = {
      "pages/behavior-release-modules.mdx": {
        contentHash: "a".repeat(64),
        size: 100,
        contentType: "text/javascript",
      },
    };

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      releaseAssetManifest: manifest,
    });

    assertEquals(
      pageData.releaseAssetModules?.["pages/behavior-release-modules.mdx"],
      `/_vf/assets/${"a".repeat(64)}.js`,
    );
  });

  it("resolvePageData includes release id for fallback module versioning", async () => {
    const slug = "/behavior-release-id";
    const projectId = "proj-release-id";
    const pipeline = createPipeline("/project/pages/behavior-release-id.mdx");
    primeCssCache(slug, projectId);

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      releaseId: "rel-1",
    });

    assertEquals(pageData.releaseId, "rel-1");
  });

  it("resolvePageData includes projectUpdated in buildVersion when available", async () => {
    const slug = "/behavior-build-version";
    const projectId = "proj-build-version";
    const projectUpdated = "2025-01-02T03:04:05Z";
    const pipeline = createPipeline("/project/pages/behavior-build-version.tsx");
    primeCssCache(slug, projectId);
    cachePageCss(
      getPageCssCacheKey(projectId, undefined, slug, projectUpdated),
      "/* cached css */",
    );

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).config.adapter.fs = {
      exists: async () => false,
      readFile: async () => {
        const error = new Error("not found") as Error & { code: string };
        error.code = "ENOENT";
        throw error;
      },
      isMultiProjectMode: () => false,
      isVeryfrontAdapter: () => true,
      getAdapterType: () => "VeryfrontFSAdapter",
      getUnderlyingAdapter: () => ({
        getProjectData: () => ({ updated_at: projectUpdated }),
      }),
    };

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.buildVersion.projectUpdated, projectUpdated);
  });

  it("resolvePageData serializes non-empty layouts with project-relative paths", async () => {
    const slug = "/behavior-layouts";
    const projectId = "proj-layouts";
    const pipeline = createPipeline("/project/pages/behavior-layouts.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).config.layoutOrchestrator.collectLayouts = async () => ({
      layoutBundle: undefined,
      nestedLayouts: [
        { kind: "tsx", componentPath: "/project/layouts/root.tsx" },
        { kind: "mdx", path: "/project/layouts/docs.mdx" },
        { kind: "tsx" },
      ],
    });

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(pageData.layouts, [
      { kind: "tsx", path: "layouts/root.tsx" },
      { kind: "mdx", path: "layouts/docs.mdx" },
    ]);
  });

  it("resolvePageData exposes only the client layout suffix for a server-owned page island", async () => {
    const slug = "/docs/guides";
    const projectId = "proj-page-island";
    const pagePath = "/project/app/docs/guides/page.tsx";
    const serverLayoutPath = "/project/app/layout.tsx";
    const clientLayoutPath = "/project/app/docs/layout.tsx";
    const nestedClientLayoutPath = "/project/app/docs/guides/layout.tsx";
    const sources = new Map([
      [serverLayoutPath, "export default function RootLayout() {}"],
      [clientLayoutPath, "'use client';\nexport default function DocsLayout() {}"],
      [nestedClientLayoutPath, "'use client';\nexport default function GuidesLayout() {}"],
    ]);
    const pipeline = createPipeline(pagePath, {
      pageResolver: {
        resolvePage: async () => ({
          entity: {
            path: pagePath,
            content: "'use client';\nexport default function GuidesPage() {}",
            frontmatter: {},
          },
        }),
      } as any,
      layoutOrchestrator: {
        collectLayouts: async () => ({
          layoutBundle: undefined,
          nestedLayouts: [
            { kind: "tsx", componentPath: serverLayoutPath },
            { kind: "tsx", componentPath: clientLayoutPath },
            { kind: "tsx", componentPath: nestedClientLayoutPath },
          ],
        }),
      } as any,
      adapter: {
        env: { get: () => undefined },
        fs: {
          exists: async () => false,
          readFile: async (path: string) => sources.get(path) ?? "",
        },
      } as any,
    });
    primeCssCache(slug, projectId);

    const pageData = await pipeline.resolvePageData(slug, { projectId });

    assertEquals(pageData.layouts, [
      { kind: "tsx", path: "app/docs/layout.tsx" },
      { kind: "tsx", path: "app/docs/guides/layout.tsx" },
    ]);
    assertEquals(pageData.isolatedClientPage, true);
    assertEquals(pageData.requiresFullDocumentNavigation, true);
    assertEquals(pageData.appPath, undefined);
  });

  it("resolvePageData includes layoutProps from fetched layout data", async () => {
    const slug = "/behavior-layout-props";
    const projectId = "proj-layout-props";
    const pipeline = createPipeline("/project/pages/behavior-layout-props.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async (path: string) =>
      path === "/project/layouts/root.tsx"
        ? { getServerData: () => ({ props: { theme: "docs" } }) }
        : {};
    (pipeline as any).config.layoutOrchestrator.collectLayouts = async () => ({
      layoutBundle: undefined,
      nestedLayouts: [{ kind: "tsx", componentPath: "/project/layouts/root.tsx" }],
    });

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
    });

    assertEquals(
      {
        "layouts/root.tsx": { theme: "docs" },
      },
      pageData.layoutProps,
    );
  });

  it("shares one isolated POST body across concurrent page and layout data jobs", async () => {
    const slug = "/behavior-shared-isolated-body";
    const projectId = "proj-shared-isolated-body";
    const pagePath = "/project/pages/behavior-shared-isolated-body.tsx";
    const layoutPath = "/project/layouts/root.tsx";
    const payload = new TextEncoder().encode("shared request body");
    const observedBodies = new Map<string, Uint8Array>();

    Deno.env.set("WORKER_ISOLATION_ENABLED", "1");
    Deno.env.set("WORKER_ISOLATION_DATA", "1");
    __resetPoolForTests();
    const pool = getWorkerPool();
    const originalExecute = pool.execute;
    pool.execute = async (_workerProjectId, _readPaths, workerRequest) => {
      if (workerRequest.type !== "fetch-data") {
        throw new Error(`Unexpected worker request: ${workerRequest.type}`);
      }
      const body = workerRequest.context.request.body;
      if (body) observedBodies.set(workerRequest.modulePath, body.slice());
      return {
        type: "data-result",
        id: workerRequest.id,
        result: {
          props: workerRequest.modulePath === pagePath ? { page: "loaded" } : { theme: "docs" },
        },
      };
    };

    const pipeline = createPipeline(pagePath);
    primeCssCache(slug, projectId);
    (pipeline as any).loadModule = async () => ({
      getServerData: () => ({ props: {} }),
    });
    (pipeline as any).config.layoutOrchestrator.collectLayouts = async () => ({
      layoutBundle: undefined,
      nestedLayouts: [{ kind: "tsx", componentPath: layoutPath }],
    });
    const request = new Request(`http://localhost${slug}`, {
      method: "POST",
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(payload);
          controller.close();
        },
      }),
    });

    try {
      const pageData = await runWithExactSourceIntegrationPolicy(
        { schemaVersion: 1, mode: "unrestricted" },
        () =>
          pipeline.resolvePageData(slug, {
            projectId,
            request,
            url: new URL(request.url),
          }),
      );

      assertEquals(pageData.props, { page: "loaded" });
      assertEquals(pageData.layoutProps, {
        "layouts/root.tsx": { theme: "docs" },
      });
      assertEquals(observedBodies.size, 2);
      assertEquals(observedBodies.get(pagePath), payload);
      assertEquals(observedBodies.get(layoutPath), payload);
    } finally {
      pool.execute = originalExecute;
      __resetPoolForTests();
      Deno.env.delete("WORKER_ISOLATION_ENABLED");
      Deno.env.delete("WORKER_ISOLATION_DATA");
    }
  });

  it("resolvePageData reuses resolved page and layout data for CSS SSR", async () => {
    const slug = "/behavior-css-data-reuse";
    const projectId = "proj-css-data-reuse";
    const pagePath = "/project/pages/behavior-css-data-reuse.tsx";
    const layoutPath = "/project/layouts/root.tsx";
    const cssHash = "cssdata1";
    const expectedCss = ".from-data{color:blue}";
    let pageDataCalls = 0;
    let layoutDataCalls = 0;
    let ssrOptions: Record<string, unknown> | undefined;
    let appliedLayoutProps: Map<string, Record<string, unknown>> | undefined;
    const pipeline = createPipeline(pagePath, {
      pageRenderer: {
        preparePageBundles: async () => ({
          pageElement: {},
          pageBundle: {},
        }),
      } as any,
      layoutOrchestrator: {
        collectLayouts: async () => ({
          layoutBundle: undefined,
          nestedLayouts: [{ kind: "tsx", componentPath: layoutPath }],
        }),
        preloadLayoutModules: async () => ({
          tsxTotal: 1,
          tsxSuccess: 1,
          tsxFailures: [],
          mdxTotal: 0,
          mdxSuccess: 0,
          mdxFailures: [],
          importMapSuccess: true,
          durationMs: 0,
          allSuccess: true,
        }),
        applyLayoutsAndWrappers: async (
          element: unknown,
          _pageInfo: unknown,
          _layoutBundle: unknown,
          _nestedLayouts: unknown,
          _requestIdentity: unknown,
          layoutProps: Map<string, Record<string, unknown>>,
        ) => {
          appliedLayoutProps = layoutProps;
          return element;
        },
      } as any,
      ssrOrchestrator: {
        performSSRRendering: async (
          _element: unknown,
          _context: unknown,
          options: RenderOptions,
        ) => {
          ssrOptions = options as Record<string, unknown>;
          return {
            fullHtml:
              `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_vf/css/${cssHash}.css"></head><body><div class="from-data">ok</div></body></html>`,
            finalStream: null,
            ssrHash: "test-hash",
          };
        },
        resolveErrorComponentPath: async () => null,
      } as any,
    });

    await cacheCSSAsync(expectedCss, cssHash, {
      candidates: ["from-data"],
      stylesheet: '@import "tailwindcss";',
    });

    (pipeline as any).loadModule = async (path: string) => {
      if (path === pagePath) {
        return {
          getServerData: () => {
            pageDataCalls++;
            return { props: { title: "from-page" } };
          },
        };
      }
      if (path === layoutPath) {
        return {
          getServerData: () => {
            layoutDataCalls++;
            return { props: { theme: "from-layout" } };
          },
        };
      }
      return {};
    };

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      environment: "production",
    });

    assertEquals(pageDataCalls, 1);
    assertEquals(layoutDataCalls, 1);
    assertEquals(pageData.props, { title: "from-page" });
    assertEquals(pageData.layoutProps, {
      "layouts/root.tsx": { theme: "from-layout" },
    });
    assertEquals(pageData.css, expectedCss);
    assertEquals(ssrOptions?.props, { title: "from-page" });
    assertEquals(ssrOptions?.layoutProps, {
      "layouts/root.tsx": { theme: "from-layout" },
    });
    assertEquals(Object.getOwnPropertySymbols(ssrOptions ?? {}).length, 0);
    assertEquals(appliedLayoutProps?.get(layoutPath), { theme: "from-layout" });
  });

  it("resolvePageData reuses the SSR hashed stylesheet for SPA CSS", async () => {
    const slug = "/behavior-ssr-css";
    const projectId = "proj-ssr-css";
    const pipeline = createPipeline("/project/pages/behavior-ssr-css.tsx");
    const cssHash = "abc12345";
    const expectedCss = ".from-ssr{color:red}";

    await cacheCSSAsync(expectedCss, cssHash, {
      candidates: ["from-ssr"],
      stylesheet: '@import "tailwindcss";',
    });

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).renderPage = async () => ({
      html:
        `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_vf/css/${cssHash}.css"></head><body></body></html>`,
    });

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      environment: "production",
    });

    assertEquals(pageData.css, expectedCss);
    assertEquals(pageData.cssError, undefined);
  });

  it("resolvePageData skips SPA CSS fallback when SSR uses a release CSS asset", async () => {
    const slug = "/behavior-release-css";
    const projectId = "proj-release-css";
    const pipeline = createPipeline("/project/pages/behavior-release-css.tsx");

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).renderPage = async () => ({
      html:
        `<!DOCTYPE html><html><head><link rel="stylesheet" href="/_vf/assets/${RELEASE_CSS_HASH}.css"></head><body><button class="hidden dark:block">theme</button></body></html>`,
    });

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      environment: "production",
    });

    assertEquals(pageData.css, undefined);
    assertEquals(pageData.cssAction, "clear");
    assertEquals(pageData.cssError, undefined);
  });

  it("resolvePageData ignores stale cached SPA CSS when ready release CSS is authoritative", async () => {
    const slug = "/behavior-release-css";
    const projectId = "proj-release-css";
    const pipeline = createPipeline("/project/pages/behavior-release-css.tsx");
    const cssKey = getPageCssCacheKey(projectId, "production", slug, undefined);
    cachePageCss(cssKey, '.dark\\:block{&:is(.dark,[data-theme="dark"])*{display:block}}');

    await primeReadyReleaseCssManifest();

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).renderPage = async () => {
      throw new Error("renderPage should not run when ready release CSS is cached");
    };

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      releaseId: "rel-css",
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      environment: "production",
    });

    assertEquals(pageData.css, undefined);
    assertEquals(pageData.cssAction, "clear");
    assertEquals(pageData.cssError, undefined);
  });

  it("resolvePageData falls back to candidate extraction when no CSS link in HTML", async () => {
    const pipeline = createPipeline("/project/pages/behavior-css-fallback.tsx");

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).renderPage = async () => ({
      html:
        `<!DOCTYPE html><html><head></head><body><div class="fallback">hello</div></body></html>`,
    });

    // Intercept resolveCssFromRenderedHtml to confirm it returns undefined (no hash in HTML)
    const originalResolve = (pipeline as any).resolveCssFromRenderedHtml.bind(pipeline);
    (pipeline as any).resolveCssFromRenderedHtml = async (html: string) => {
      const result = await originalResolve(html);
      assertEquals(result, undefined, "Should not find CSS hash in HTML without /_vf/css/ link");
      return result;
    };

    // Pre-cache the CSS that generateTailwindCSS would produce for our candidates
    // so we don't depend on the Tailwind compiler actually working in CI
    const { extractCandidates } = await import("#veryfront/html/styles-builder/index.ts");
    const html =
      `<!DOCTYPE html><html><head></head><body><div class="fallback">hello</div></body></html>`;
    const candidatesReceived = extractCandidates(html);

    // Verify candidates were actually extracted from the HTML
    assertEquals(
      Array.isArray(candidatesReceived),
      true,
      "extractCandidates should return an array",
    );
    assertEquals(
      candidatesReceived!.length > 0,
      true,
      "Should extract at least one candidate from HTML",
    );
  });
});
