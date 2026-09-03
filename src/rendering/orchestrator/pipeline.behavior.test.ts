import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { FakeTime } from "#std/testing/time";
import { RenderPipeline, type RenderPipelineConfig } from "./pipeline.ts";
import type { RenderOptions, RenderResult } from "./types.ts";
import { isTenantBuildFailure, markBuildFailure } from "./module-loader/build-failure.ts";
import {
  COMPILATION_ERROR,
  createError,
  FILE_NOT_FOUND,
  SSG_GENERATION_ERROR,
  toError,
  VeryfrontError,
} from "#veryfront/errors";
import { __resetStaleMdxEsmRecoveryStateForTests } from "../page-rendering.ts";
import { cachePageCss, getPageCssCacheKey } from "./css-cache.ts";
import { cacheCSSAsync, hashCSS } from "#veryfront/html/styles-builder/index.ts";
import { RELEASE_ASSET_MANIFEST_ENV_FLAG } from "#veryfront/release-assets/constants.ts";
import {
  clearReleaseAssetManifestCache,
  getReadyManifestForRender,
  registerManifestFetcherForRelease,
} from "#veryfront/release-assets/manifest-cache.ts";
import type { ReleaseAssetManifest } from "#veryfront/release-assets/manifest-schema.ts";
import { deleteEnv, getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
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
import { hashString } from "#veryfront/cache/hash.ts";
import { resolveSSRControlOutcome } from "#veryfront/rendering/ssr-outcome.ts";
import {
  getAttachedDataResponseMetadata,
  unwrapDataResponseMetadataError,
} from "#veryfront/data/response-metadata.ts";
import { notFound } from "#veryfront/data/helpers.ts";
import { createNotFoundLikeError } from "#veryfront/platform/adapters/fs/veryfront/read-operations-helpers.ts";
import { isMissingProjectSourceError } from "#veryfront/rendering/ssr-outcome.ts";
import {
  __registerLogRecordEmitter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

const RELEASE_CSS_HASH = "c".repeat(64);

function cacheKeyForDependencies(
  dependencies: Readonly<Record<string, string>>,
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  return `on:${hashString(JSON.stringify(sortedEntries))}`;
}

const SNAPSHOT_A_DEPENDENCIES = { react: "^18.3.1" } as const;
const SNAPSHOT_B_DEPENDENCIES = { react: "^19.0.0" } as const;
const SNAPSHOT_A_PIN_KEY = cacheKeyForDependencies(SNAPSHOT_A_DEPENDENCIES);
const SNAPSHOT_B_PIN_KEY = cacheKeyForDependencies(SNAPSHOT_B_DEPENDENCIES);

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
      },
    } as any,
    mode: "production",
    projectDir: "/project",
    isLocalProject: true,
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
    schemaVersion: 2,
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
      styleProfileHash: "b".repeat(64),
      cssPipelineIdentity: "tailwind-v4",
    }],
    routes: { "/behavior-release-css": { modules: [], css: [RELEASE_CSS_HASH] } },
    dependencies: {},
    dependencyMode: "immutable",
  };
}

async function primeReadyReleaseCssManifest(): Promise<void> {
  registerManifestFetcherForRelease(
    "rel-css",
    () =>
      Promise.resolve({ state: "ready", manifest_version: 1, manifest: releaseManifestWithCss() }),
  );
  setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, "1");
  getReadyManifestForRender("rel-css");
  await new Promise((r) => setTimeout(r, 0));
}

/** Collect the warn-and-above log records emitted while a test runs. Reset by the suite's afterEach. */
function captureLogs(): LogEntry[] {
  const entries: LogEntry[] = [];
  setEnv("LOG_LEVEL", "WARN");
  __resetLoggerConfigForTests();
  __registerLogRecordEmitter((entry) => entries.push(entry));
  return entries;
}

/** The record reporting that `path` failed to load, ignoring surrounding progress logs. */
function findModuleFailureLog(entries: LogEntry[], path: string): LogEntry | undefined {
  return entries.find((entry) =>
    entry.context?.path === path && typeof entry.context?.error === "string"
  );
}

describe("RenderPipeline behavior", () => {
  const originalManifestFlag = getHostEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG);
  const originalLogLevel = getHostEnv("LOG_LEVEL");

  afterEach(() => {
    setEnv(RELEASE_ASSET_MANIFEST_ENV_FLAG, originalManifestFlag ?? "");
    Deno.env.delete("VERYFRONT_ENABLE_SERVER_TIMING");
    resetRequestProfiles();
    clearReleaseAssetManifestCache();
    if (originalLogLevel === undefined) deleteEnv("LOG_LEVEL");
    else setEnv("LOG_LEVEL", originalLogLevel);
    __resetLoggerConfigForTests();
    __resetLogRecordEmitterForTests();
    __resetStaleMdxEsmRecoveryStateForTests();
  });

  it("threads render cancellation through layout preload and application", async () => {
    const controller = new AbortController();
    let preloadSignal: AbortSignal | undefined;
    let applySignal: AbortSignal | undefined;
    const pipeline = createPipeline("/project/pages/cancel-layout.tsx", {
      layoutOrchestrator: {
        collectLayouts: async () => ({
          layoutBundle: undefined,
          nestedLayouts: [{ kind: "tsx", componentPath: "/project/layout.tsx" }],
        }),
        preloadLayoutModules: async (
          _layouts: unknown,
          _pinKey: unknown,
          _dependencies: unknown,
          _source: unknown,
          _origin: unknown,
          signal: AbortSignal | undefined,
        ) => {
          preloadSignal = signal;
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
          };
        },
        applyLayoutsAndWrappers: async (...args: unknown[]) => {
          applySignal = args[15] as AbortSignal | undefined;
          return args[0];
        },
      } as any,
    });

    await pipeline.renderPage("/cancel-layout", {
      delivery: "string",
      abortSignal: controller.signal,
    });

    assertEquals(preloadSignal, controller.signal);
    assertEquals(applySignal, controller.signal);
  });

  /** Build a pipeline whose single TSX layout fails to load with `error`. */
  function createPipelineWithFailingLayout(error: Error): RenderPipeline {
    const pipeline = createPipeline("/project/pages/index.tsx", {
      layoutOrchestrator: {
        collectLayouts: async () => ({
          layoutBundle: undefined,
          nestedLayouts: [{ kind: "tsx", componentPath: "/project/app/layout.tsx" }],
        }),
        preloadLayoutModules: async () => ({
          tsxTotal: 1,
          tsxSuccess: 0,
          tsxFailures: ["/project/app/layout.tsx"],
          mdxTotal: 0,
          mdxSuccess: 0,
          mdxFailures: [],
          importMapSuccess: true,
          durationMs: 0,
          allSuccess: false,
        }),
        applyLayoutsAndWrappers: async (element: unknown) => element,
      },
    } as unknown as Partial<RenderPipelineConfig>);

    (pipeline as unknown as { loadModule: (path: string) => Promise<unknown> }).loadModule = (
      path: string,
    ) => path === "/project/app/layout.tsx" ? Promise.reject(error) : Promise.resolve({});

    return pipeline;
  }

  it("does not call a terminal layout failure non-critical", async () => {
    // The apply phase reloads the layout from the same source. When that source
    // is gone the reload fails identically and the render is over, so a warning
    // labelled "non-critical" misleads anyone triaging by severity.
    const entries = captureLogs();
    const pipeline = createPipelineWithFailingLayout(
      createNotFoundLikeError("app/layout.tsx"),
    );

    await pipeline.resolvePageData("/", {
      request: new Request("http://localhost/"),
      url: new URL("http://localhost/"),
    });

    const entry = findModuleFailureLog(entries, "/project/app/layout.tsx");
    assert(entry, "expected a log entry for the failed layout module");
    assertEquals(entry.level, "error", "a failure about to be terminal is not a warning");
    assertEquals(
      entry.message.includes("non-critical"),
      false,
      "the message must not claim non-critical for a terminal failure",
    );
  });

  it("still treats a recoverable layout load failure as a warning", async () => {
    const entries = captureLogs();
    const pipeline = createPipelineWithFailingLayout(new Error("connection reset"));

    await pipeline.resolvePageData("/", {
      request: new Request("http://localhost/"),
      url: new URL("http://localhost/"),
    });

    const entry = findModuleFailureLog(entries, "/project/app/layout.tsx");
    assert(entry, "expected a log entry for the failed layout module");
    assertEquals(entry.level, "warn", "the apply phase can still recover this one");
  });

  it("keeps the file-not-found identity of an unretrievable page module", async () => {
    // The page module reads the same unreachable source as the layout. A
    // render-error wrapper would drop that identity and answer 500 for the very
    // deletion the layout path already answers 404 for.
    const pipeline = createPipeline("/project/pages/index.tsx");
    (pipeline as unknown as { loadModule: () => Promise<unknown> }).loadModule = () =>
      Promise.reject(createNotFoundLikeError("pages/index.tsx"));

    const error = await assertRejects(() =>
      pipeline.resolvePageData("/", {
        request: new Request("http://localhost/"),
        url: new URL("http://localhost/"),
      })
    );

    assertEquals(
      (error as VeryfrontError).slug,
      "file-not-found",
      "resolveSSRFailure reads this slug to answer 404",
    );
    assertEquals(
      isMissingProjectSourceError(error),
      true,
      "the absent-source identity must survive the re-raise intact",
    );
  });

  it("keeps a render-error identity for an infrastructure file-not-found", async () => {
    // http-cache raises `file-not-found` when a bundle write reports success and
    // the file still is not there. That is a server fault reachable from
    // loadModule, and routing it to 404 would page nobody.
    const pipeline = createPipeline("/project/pages/index.tsx");
    (pipeline as unknown as { loadModule: () => Promise<unknown> }).loadModule = () =>
      Promise.reject(
        FILE_NOT_FOUND.create({
          detail: "[HTTP-CACHE] INVARIANT VIOLATION: File write succeeded but file does not exist",
        }),
      );

    const error = await assertRejects(() =>
      pipeline.resolvePageData("/", {
        request: new Request("http://localhost/"),
        url: new URL("http://localhost/"),
      })
    );

    assertEquals(
      (error as VeryfrontError).slug,
      "render-error",
      "an infrastructure fault must keep a 500 identity",
    );
  });

  it("keeps a render-error identity for a page module that loaded and threw", async () => {
    const pipeline = createPipeline("/project/pages/index.tsx");
    (pipeline as unknown as { loadModule: () => Promise<unknown> }).loadModule = () =>
      Promise.reject(new Error("Cannot read properties of undefined (reading 'map')"));

    const error = await assertRejects(() =>
      pipeline.resolvePageData("/", {
        request: new Request("http://localhost/"),
        url: new URL("http://localhost/"),
      })
    );

    assertEquals(
      isMissingProjectSourceError(error),
      false,
      "a genuine fault must not be downgraded to a 404",
    );
    assertEquals(
      (error as VeryfrontError).slug,
      "render-error",
      "the existing render-error identity is unchanged",
    );
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

  it("keeps a historical request on React A after a newer snapshot uses React B", async () => {
    const pipeline = createPipeline("/project/pages/index.tsx");
    const observedVersions: string[] = [];
    (pipeline as any).loadModule = async (
      _path: string,
      config: { reactVersion?: string },
    ) => {
      observedVersions.push(config.reactVersion ?? "");
      return {};
    };
    const requestOptions = {
      request: new Request("http://localhost/"),
      url: new URL("http://localhost/"),
    };

    await pipeline.resolvePageData("/", {
      ...requestOptions,
      dependencyPinningCacheKey: SNAPSHOT_B_PIN_KEY,
      dependencyPinningDependencies: SNAPSHOT_B_DEPENDENCIES,
    });
    const afterSnapshotB = observedVersions.slice();
    observedVersions.length = 0;

    await pipeline.resolvePageData("/", {
      ...requestOptions,
      dependencyPinningCacheKey: SNAPSHOT_A_PIN_KEY,
      dependencyPinningDependencies: SNAPSHOT_A_DEPENDENCIES,
    });

    assert(afterSnapshotB.length > 0);
    assertEquals(afterSnapshotB.every((version) => version === "19.0.0"), true);
    assert(observedVersions.length > 0);
    assertEquals(observedVersions.every((version) => version === "18.3.1"), true);
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
        }, 1_000);
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
    await time.tickAsync(41_000);

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

    assertEquals(checks, [{ slug: "", cacheKey: "index:environment-production" }]);
    assertEquals(persists, [{ slug: "", cacheKey: "index:environment-production" }]);
  });

  it("returns the cached render without re-resolving or re-rendering the page", async () => {
    let resolveCalls = 0;
    let ssrCalls = 0;
    let persists = 0;
    const cachedResult = {
      html: "<html>cached</html>",
      frontmatter: {},
      headings: [],
      stream: null,
      ssrHash: "cached-hash",
    };
    const pipeline = createPipeline("/project/pages/index.mdx", {
      pageResolver: {
        resolvePage: async () => {
          resolveCalls += 1;
          return {
            entity: { path: "/project/pages/index.mdx", frontmatter: {} },
          } as any;
        },
      } as any,
      ssrOrchestrator: {
        performSSRRendering: async () => {
          ssrCalls += 1;
          return {
            fullHtml: "<html>fresh</html>",
            finalStream: null,
            ssrHash: "fresh-hash",
          };
        },
        resolveErrorComponentPath: async () => null,
      } as any,
      cacheCoordinator: {
        checkCache: async () => ({
          cachedResult,
          cacheStatus: "hit",
          depAwareSlug: "",
          moduleCacheKey: "index:environment-production",
          lookupDurationMs: 0,
        }),
        persistResult: async () => {
          persists += 1;
        },
      } as any,
    } as Partial<RenderPipelineConfig>);

    const result = await pipeline.renderPage("", { delivery: "string" });

    assertEquals(result.html, "<html>cached</html>", "a cache hit must be served verbatim");
    assertEquals(resolveCalls, 0, "a cache hit must not resolve the page");
    assertEquals(ssrCalls, 0, "a cache hit must not re-render");
    assertEquals(persists, 0, "a cache hit must not persist a new entry");

    const bypassed = await pipeline.renderPage("", {
      delivery: "string",
      skipCacheCheck: true,
    });

    assertEquals(bypassed.html, "<html>fresh</html>", "skipCacheCheck must bypass the cache hit");
    assertEquals(ssrCalls, 1, "skipCacheCheck must re-render the page");
  });

  it("isolates preview HTML from the production render cache", () => {
    const pipeline = createPipeline("/project/pages/index.mdx");
    const buildCacheKey = (pipeline as unknown as {
      buildCacheKey(
        slug: string,
        options: RenderOptions | undefined,
        dependencyPinningCacheKey: string,
      ): string | null;
    }).buildCacheKey.bind(pipeline);

    assertEquals(
      buildCacheKey("", { environment: "production" }, "off"),
      "index:environment-production",
    );
    assertEquals(buildCacheKey("", undefined, "off"), "index:environment-production");
    assertEquals(
      buildCacheKey("", { environment: "preview" }, "off"),
      "index:environment-preview",
    );
    assertEquals(
      buildCacheKey("", { cacheKey: "custom", environment: "preview" }, "off"),
      "custom:environment-preview",
    );
    assertEquals(
      buildCacheKey("", { cacheKey: "custom", environment: "production" }, "off"),
      "custom:environment-production",
    );
    assert(
      buildCacheKey("", { cacheKey: "custom", environment: "preview" }, "off") !==
        buildCacheKey(
          "",
          { cacheKey: "custom:environment-preview", environment: "production" },
          "off",
        ),
      "preview and production custom cache identities must not collide",
    );
    assert(
      buildCacheKey("foo", { environment: "preview" }, "off") !==
        buildCacheKey("foo:environment-preview", { environment: "production" }, "off"),
      "preview and production route cache identities must not collide",
    );

    assertEquals(
      buildCacheKey("", {
        request: new Request("http://localhost/", {
          headers: { authorization: "Bearer x" },
        }),
      }, "off"),
      null,
      "a request carrying credentials must not produce a shared render cache key",
    );
    assertEquals(
      buildCacheKey("", {
        request: new Request("http://localhost/", {
          headers: { cookie: "vf_session=abc" },
        }),
      }, "off"),
      null,
      "a request carrying a session cookie must not produce a shared render cache key",
    );
    assert(
      buildCacheKey("", {
        cacheKey: "custom",
        request: new Request("http://localhost/", {
          headers: { authorization: "Bearer x" },
        }),
      }, "off") !== null,
      "an explicit cacheKey override stays authoritative",
    );
  });

  it("never caches HTML rendered for a request that carries credentials", async () => {
    const checks: Array<string | undefined> = [];
    const persists: Array<string | undefined> = [];
    const pipeline = createPipeline("/project/pages/index.mdx", {
      cacheCoordinator: {
        checkCache: async (slug, cacheKey) => {
          checks.push(cacheKey);
          return {
            depAwareSlug: slug,
            moduleCacheKey: cacheKey ?? slug,
            cacheStatus: "miss",
            lookupDurationMs: 0,
          };
        },
        persistResult: async (_result, _slug, cacheKey) => {
          persists.push(cacheKey);
        },
      },
    } as Partial<RenderPipelineConfig>);

    await pipeline.renderPage("", {
      delivery: "string",
      request: new Request("http://localhost/", {
        headers: { authorization: "Bearer x" },
      }),
    });

    assertEquals(checks, [], "personalized HTML must never be read from the shared render cache");
    assertEquals(persists, [], "personalized HTML must never be persisted");
  });

  it("bounds the complete API render key for a flag-off override", () => {
    const cachePrefix = "project:preview:branch:v1";
    const pipeline = createPipeline("/project/pages/index.mdx", {
      renderCacheKeyComposition: {
        backendPrefix: "render",
        cachePrefix,
        addPagePrefix: true,
      },
    });
    const buildCacheKey = (pipeline as unknown as {
      buildCacheKey(
        slug: string,
        options: RenderOptions | undefined,
        dependencyPinningCacheKey: string,
      ): string | null;
    }).buildCacheKey.bind(pipeline);
    const legacyKey = "a".repeat(440);
    const options: RenderOptions = {
      cacheKey: legacyKey,
      colorScheme: "dark",
      url: new URL("https://preview.example.test/"),
    };
    const cacheKey = buildCacheKey("/", options, "on:3w5e11264sgsf");

    assert(cacheKey);
    const completeKey = `render:${cachePrefix}:page:${cacheKey}:theme-dark`;
    assert(completeKey.length <= 512);
    assert(/^[a-zA-Z0-9_:.\-/*]+$/.test(completeKey));
    assertEquals(
      buildCacheKey("/", options, "off"),
      `${legacyKey}:environment-production`,
    );
  });

  it("renderPage preserves active SSR transforms during development cache freshness clears", async () => {
    clearSSRModuleCache();
    const projectId = "project-dev-render-active-transform";
    const moduleKey = `prefix:${projectId}:module`;
    const inProgressKey = `prefix:${projectId}:in-progress`;
    const leader = Promise.resolve({ tempPath: "/tmp/leader.mjs", contentHash: "leader" });
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
    const leader = Promise.resolve({ tempPath: "/tmp/leader.mjs", contentHash: "leader" });
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

  it("merges layout and page response metadata and does not cache cookies", async () => {
    const pagePath = "/project/pages/response-metadata.tsx";
    const rootLayoutPath = "/project/layouts/root.tsx";
    const nestedLayoutPath = "/project/layouts/docs.tsx";
    let cacheWrites = 0;
    const pipeline = createPipeline(pagePath, {
      cacheCoordinator: {
        checkCache: async () => null,
        persistResult: async () => {
          cacheWrites++;
        },
      } as any,
      layoutOrchestrator: {
        collectLayouts: async () => ({
          layoutBundle: undefined,
          nestedLayouts: [
            { kind: "tsx", componentPath: rootLayoutPath },
            { kind: "tsx", componentPath: nestedLayoutPath },
          ],
        }),
        preloadLayoutModules: async () => ({
          tsxTotal: 2,
          tsxSuccess: 2,
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
    });

    (pipeline as any).loadModule = async (path: string) => ({
      getServerData: () => {
        if (path === rootLayoutPath) {
          return {
            props: {},
            headers: { "x-owner": "root", "x-root": "yes" },
            cookies: [{ name: "root", value: "1", path: "/" }],
          };
        }
        if (path === nestedLayoutPath) {
          return {
            props: {},
            headers: { "x-owner": "nested", "x-nested": "yes" },
            cookies: [{ name: "nested", value: "2", path: "/" }],
          };
        }
        return {
          props: {},
          headers: { "x-owner": "page", "x-page": "yes" },
          cookies: [{ name: "page", value: "3", path: "/" }],
        };
      },
    });

    const result = await pipeline.renderPage("/response-metadata", {
      request: new Request("http://localhost/response-metadata"),
      url: new URL("http://localhost/response-metadata"),
    }) as RenderResult;

    assertEquals(result.headers, {
      "x-owner": "page",
      "x-root": "yes",
      "x-nested": "yes",
      "x-page": "yes",
    });
    assertEquals(result.cookies?.map((cookie) => cookie.name), ["root", "nested", "page"]);
    assertEquals(cacheWrites, 0);
  });

  it("merges response metadata into script page results", async () => {
    const pagePath = "/project/pages/response-metadata.ts";
    const pipeline = createPipeline(pagePath, {
      pageRenderer: {
        preparePageBundles: async () => ({
          collectedMetadata: {},
          scriptResult: {
            html: "<!doctype html><html><body>script</body></html>",
            frontmatter: {},
            stream: null,
          },
        }),
      } as any,
    });

    (pipeline as any).loadModule = async () => ({
      getServerData: () => ({
        props: {},
        headers: { "x-script-state": "resolved" },
        cookies: [{ name: "script-seen", value: "1", path: "/" }],
      }),
    });

    const result = await pipeline.renderPage("/response-metadata", {
      request: new Request("http://localhost/response-metadata"),
      url: new URL("http://localhost/response-metadata"),
    });

    assertEquals(result.headers, { "x-script-state": "resolved" });
    assertEquals(result.cookies, [{ name: "script-seen", value: "1", path: "/" }]);
  });

  it("preserves successful layout metadata when page data fails", async () => {
    const pagePath = "/project/pages/response-metadata-data-error.tsx";
    const layoutPath = "/project/layouts/root.tsx";
    const pageError = new Error("Page data failed");
    const pipeline = createPipeline(pagePath, {
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
    });
    (pipeline as any).loadModule = async (path: string) => ({
      getServerData: () => {
        if (path === layoutPath) {
          return {
            props: {},
            headers: { "x-layout-state": "resolved" },
            cookies: [{ name: "layout-seen", value: "1", path: "/" }],
          };
        }
        throw pageError;
      },
    });

    let thrown: unknown;
    try {
      await pipeline.renderPage("/response-metadata-data-error", {
        request: new Request("http://localhost/response-metadata-data-error"),
        url: new URL("http://localhost/response-metadata-data-error"),
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error);
    assertEquals(unwrapDataResponseMetadataError(thrown), pageError);
    assertEquals(getAttachedDataResponseMetadata(thrown), {
      headers: { "x-layout-state": "resolved" },
      cookies: [{ name: "layout-seen", value: "1", path: "/" }],
    });
  });

  it("preserves an earlier page control when later layout data fails", async () => {
    const pagePath = "/project/pages/page-control-before-layout-error.tsx";
    const layoutPath = "/project/layouts/root.tsx";
    const pipeline = createPipeline(pagePath, {
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
    });
    (pipeline as any).loadModule = async (path: string) => ({
      getServerData: () => {
        if (path === pagePath) {
          return {
            notFound: true,
            headers: { "x-missing-reason": "page-control" },
          };
        }
        throw new Error("Layout data failed after page control");
      },
    });

    const error = await assertRejects(
      () =>
        pipeline.resolvePageData("/page-control-before-layout-error", {
          request: new Request("http://localhost/page-control-before-layout-error"),
          url: new URL("http://localhost/page-control-before-layout-error"),
        }),
      Error,
      "Page/Layout returned notFound",
    );

    assertEquals(resolveSSRControlOutcome(error), {
      kind: "not-found",
      headers: { "x-missing-reason": "page-control" },
    });
  });

  it("attaches resolved response metadata when SSR later fails", async () => {
    const pagePath = "/project/pages/response-metadata-error.tsx";
    const sharedRenderError = new Error("SSR failed after data resolution");
    let dataCalls = 0;
    const pipeline = createPipeline(pagePath, {
      ssrOrchestrator: {
        performSSRRendering: async () => {
          throw sharedRenderError;
        },
        resolveErrorComponentPath: async () => null,
      } as any,
    });
    (pipeline as any).loadModule = async () => ({
      getServerData: () => {
        dataCalls++;
        return dataCalls === 1
          ? {
            props: {},
            headers: { "x-page-state": "resolved" },
            cookies: [{ name: "session", value: "request-specific", path: "/" }],
          }
          : { props: {} };
      },
    });

    const thrown: unknown[] = [];
    for (let requestIndex = 0; requestIndex < 2; requestIndex++) {
      try {
        await pipeline.renderPage("/response-metadata-error", {
          request: new Request("http://localhost/response-metadata-error"),
          url: new URL("http://localhost/response-metadata-error"),
        });
      } catch (error) {
        thrown.push(error);
      }
    }

    assert(thrown[0] instanceof Error);
    assertEquals(getAttachedDataResponseMetadata(thrown[0]), {
      headers: { "x-page-state": "resolved" },
      cookies: [{ name: "session", value: "request-specific", path: "/" }],
    });
    assert(thrown[1] instanceof Error);
    assertEquals(
      getAttachedDataResponseMetadata(thrown[1]),
      {},
      "a reused project Error cannot retain another request's response metadata",
    );
  });

  it("carries resolved metadata through a non-Error SSR control", async () => {
    const pagePath = "/project/pages/response-metadata-control.tsx";
    const control = notFound({ headers: { "x-control": "missing" } });
    const pipeline = createPipeline(pagePath, {
      ssrOrchestrator: {
        performSSRRendering: async () => {
          throw control;
        },
        resolveErrorComponentPath: async () => null,
      } as any,
    });
    (pipeline as any).loadModule = async () => ({
      getServerData: () => ({
        props: {},
        headers: { "x-page-state": "resolved" },
        cookies: [{ name: "page-seen", value: "1", path: "/" }],
      }),
    });

    let thrown: unknown;
    try {
      await pipeline.renderPage("/response-metadata-control", {
        request: new Request("http://localhost/response-metadata-control"),
        url: new URL("http://localhost/response-metadata-control"),
      });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof Error);
    assertEquals(unwrapDataResponseMetadataError(thrown), control);
    assertEquals(getAttachedDataResponseMetadata(thrown), {
      headers: { "x-page-state": "resolved" },
      cookies: [{ name: "page-seen", value: "1", path: "/" }],
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

  it("renderPage recovers preview caches from the pipeline's configured content source", async () => {
    const slug = "/behavior-configured-preview-stale-mdx";
    let renderAttempts = 0;
    let sourceRefreshes = 0;
    // The pipeline carries the preview content source in its own config and the
    // request supplies no override, which is how resolveModuleLoaderConfig
    // resolves the namespace. Recovery must use the same fallback.
    const pipeline = createPipeline("/project/pages/behavior-configured-preview-stale-mdx.mdx", {
      mode: "production",
      contentSourceId: "preview-main",
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
    });

    assertEquals(result.html, "<!doctype html><html><body>ok</body></html>");
    assertEquals(
      renderAttempts,
      2,
      "a preview source configured on the pipeline must still get its recovery retry",
    );
    assertEquals(
      sourceRefreshes,
      1,
      "recovery must classify the configured content source, not the missing request override",
    );
  });

  it("renderPage does not recover caches for a released production content source", async () => {
    const slug = "/behavior-release-stale-mdx";
    let renderAttempts = 0;
    let sourceRefreshes = 0;
    const pipeline = createPipeline("/project/pages/behavior-release-stale-mdx.mdx", {
      mode: "production",
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
        preparePageBundles: () => {
          renderAttempts++;
          // A shipped broken import keeps producing this message, so an
          // unauthenticated request must not be able to buy a cache purge
          // with it.
          throw new Error(
            "The requested module 'file:///cache/vfmod.mjs' does not provide an export named 'default'",
          );
        },
      } as any,
    } as Partial<RenderPipelineConfig>);

    await assertRejects(
      () =>
        pipeline.renderPage(slug, {
          delivery: "string",
          projectId: "project-1",
          projectSlug: "project-slug",
          contentSourceId: "release-abc123",
        }),
      Error,
      "does not provide an export named",
    );

    assertEquals(renderAttempts, 1, "a released source must not pay a recovery retry");
    assertEquals(sourceRefreshes, 0, "a released source must not flush its source snapshot");
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

    function tenantBuildFailureFlag(error: unknown): unknown {
      const context = (error as { context?: { tenantBuildFailure?: unknown } }).context;
      return context?.tenantBuildFailure;
    }

    it("reports a source compilation failure as tenant-owned", async () => {
      const error = await rejectLoad(pipelineWithFailingPageModule(() => {
        throw markBuildFailure(COMPILATION_ERROR.create({
          detail: "Cannot import the static asset",
          context: { tenantBuildFailure: true },
        }));
      }));

      assertEquals(buildFailureFlag(error), true);
      assertEquals(tenantBuildFailureFlag(error), true);
    });

    it("keeps generic compilation failures at framework severity", () => {
      const infrastructureError = markBuildFailure(COMPILATION_ERROR.create({
        detail: "esbuild service exited unexpectedly",
      }));

      assertEquals(isTenantBuildFailure(infrastructureError), false);
    });

    it("keeps framework failures inside the transform phase distinct", async () => {
      const frameworkError = markBuildFailure(toError(createError({
        type: "build",
        message: "cache write failed",
      })));
      assertEquals(isTenantBuildFailure(frameworkError), false);

      const error = await rejectLoad(pipelineWithFailingPageModule(() => {
        throw frameworkError;
      }));

      assertEquals(buildFailureFlag(error), true);
      assertEquals(tenantBuildFailureFlag(error), false);
    });

    it("does not infer tenant source from an SSG wrapper", () => {
      const infrastructureError = markBuildFailure(SSG_GENERATION_ERROR.create({
        detail: "Failed to write generated page output",
        cause: Object.assign(new Error("No space left on device"), { code: "ENOSPC" }),
        context: { route: "/" },
      }));

      assertEquals(isTenantBuildFailure(infrastructureError), false);
    });

    it("does not report a module-scope runtime throw as a build failure", async () => {
      const error = await rejectLoad(pipelineWithFailingPageModule(() => {
        throw new Error("Missing API key");
      }));

      assertEquals(buildFailureFlag(error), false);
      assertEquals(tenantBuildFailureFlag(error), false);
    });
  });

  it("resolvePageData surfaces notFound from data hooks", async () => {
    const slug = "/behavior-not-found";
    const projectId = "proj-not-found";
    const pipeline = createPipeline("/project/pages/behavior-not-found.tsx");
    primeCssCache(slug, projectId);

    (pipeline as any).loadModule = async () => ({ getServerData: () => ({}) });
    (pipeline as any).dataFetcher = {
      fetchData: async () => ({
        notFound: true,
        headers: { "x-missing-reason": "gone" },
      }),
    };

    const error = await assertRejects(
      () =>
        pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        }),
      Error,
      "Page/Layout returned notFound",
    );
    assertEquals((error as { context?: { headers?: unknown } }).context?.headers, undefined);
    assertEquals(JSON.stringify(error).includes("gone"), false);
    assertEquals(resolveSSRControlOutcome(error), {
      kind: "not-found",
      headers: { "x-missing-reason": "gone" },
    });
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
      fetchData: async () => ({
        redirect: { destination: "/login", permanent: false },
        headers: { "x-auth-result": "required" },
        cookies: [{ name: "return-to", value: "/private", path: "/" }],
      }),
    };

    const error = await assertRejects(
      () =>
        pipeline.resolvePageData(slug, {
          projectId,
          request: new Request(`http://localhost${slug}`),
          url: new URL(`http://localhost${slug}`),
        }),
      Error,
      "Redirect to /login",
    );
    assertEquals((error as { context?: { headers?: unknown } }).context?.headers, undefined);
    assertEquals((error as { context?: { cookies?: unknown } }).context?.cookies, undefined);
    assertEquals(JSON.stringify(error).includes("/private"), false);
    assertEquals(resolveSSRControlOutcome(error), {
      kind: "redirect",
      location: "/login",
      permanent: false,
      headers: { "x-auth-result": "required" },
      cookies: [{ name: "return-to", value: "/private", path: "/" }],
    });
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
      // Server-owned page islands use the hosted module transport rather than
      // the local filesystem transport exercised by the default fixture.
      isLocalProject: false,
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
    const expectedCss = ".from-data{color:blue}";
    const cssHash = hashCSS(expectedCss);
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
        resolveErrorComponentPath: async () => null,
      } as any,
    });

    await cacheCSSAsync(expectedCss, cssHash);

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
    const expectedCss = ".from-ssr{color:red}";
    const cssHash = hashCSS(expectedCss);

    await cacheCSSAsync(expectedCss, cssHash);

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

  it("resolvePageData falls back to generated CSS when no CSS link in HTML", async () => {
    const slug = "/behavior-css-fallback";
    const projectId = "proj-css-fallback";
    const pipeline = createPipeline("/project/pages/behavior-css-fallback.tsx");
    const renderedHtml =
      `<!DOCTYPE html><html><head></head><body><div class="fallback">hello</div></body></html>`;
    let seenHtml = "";

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).renderPage = async () => ({ html: renderedHtml });
    (pipeline as any).resolveCssFromRenderedHtml = async () => undefined;
    (pipeline as any).generatePageCssFromHtml = async (_slug: string, html: string) => {
      seenHtml = html;
      return ".fallback{display:block}";
    };

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      environment: "production",
    });

    assertEquals(
      pageData.css,
      ".fallback{display:block}",
      "page data falls back to generated CSS when the HTML carries no /_vf/css link",
    );
    assertEquals(pageData.cssAction, undefined, "the fallback path must not clear client CSS");
    assertEquals(pageData.cssError, undefined, "a successful fallback reports no CSS error");
    assertStringIncludes(
      seenHtml,
      'class="fallback"',
      "the fallback generator receives the rendered HTML",
    );
  });

  it("resolvePageData reports a CSS generation failure instead of swallowing it", async () => {
    const slug = "/behavior-css-error";
    const projectId = "proj-css-error";
    const pipeline = createPipeline("/project/pages/behavior-css-error.tsx");

    (pipeline as any).loadModule = async () => ({});
    (pipeline as any).renderPage = () => Promise.reject(new Error("css ssr blew up"));

    const pageData = await pipeline.resolvePageData(slug, {
      projectId,
      request: new Request(`http://localhost${slug}`),
      url: new URL(`http://localhost${slug}`),
      environment: "production",
    });

    assertEquals(
      pageData.cssError,
      "CSS generation failed: css ssr blew up",
      "clients must be able to distinguish a CSS failure from no CSS",
    );
    assertEquals(pageData.css, undefined, "a failed CSS render must not report CSS");
    assertEquals(pageData.cssAction, undefined, "a failed CSS render must not clear client CSS");
  });
});
