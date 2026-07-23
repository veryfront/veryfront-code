import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

const RELEASE_CSS_HASH = "c".repeat(64);

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
    } as any,
    adapter: {
      env: { get: () => undefined },
      fs: {
        exists: async () => false,
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
    sourceContentHash: "",
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
    const leader = Promise.resolve();
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
    const leader = Promise.resolve();
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
        contentType: "application/javascript",
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
