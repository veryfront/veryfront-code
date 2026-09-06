/****
 * Component Page Handling (TSX/JSX files)
 */

import { computeHash, rendererLogger as logger } from "#veryfront/utils";
import { createError, getErrorMessage, RENDER_ERROR, toError } from "#veryfront/errors";
import type * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { EntityInfo, PageBundle } from "#veryfront/types";
import { getProjectReact } from "#veryfront/react";
import { buildComponentCacheKey } from "#veryfront/cache/keys.ts";
import { LRUCache } from "#veryfront/utils/lru-wrapper.ts";
import { registerLRUCache } from "#veryfront/cache";
import { getDependencyPinningCacheKey } from "#veryfront/transforms/esm/package-registry.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import type { RenderEnvironment } from "#veryfront/rendering/context/render-context.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { DEFAULT_REACT_VERSION } from "#veryfront/transforms/import-rewriter/url-builder.ts";
import { buildServerExternalPackagesIdentity } from "#veryfront/config/server-external-packages.ts";

interface ComponentPageResult {
  pageElement: BundledReact.ReactElement;
  pageBundle: PageBundle;
}

/**
 * Cache for transformed component hydration bundles.
 * Keys are content-addressed and scoped to transform-affecting inputs.
 * Safe for multi-tenant use (project-scoped + content/transform-hashed).
 * Evicted when exceeding MAX_COMPONENT_CACHE_SIZE to prevent unbounded memory growth.
 */
const MAX_COMPONENT_CACHE_SIZE = 5_000;
const componentHydrationCache = new LRUCache<string, string>({
  maxEntries: MAX_COMPONENT_CACHE_SIZE,
});
const componentHydrationFlights = new Singleflight<string>();
const COMPONENT_HYDRATION_FLIGHT_STALE_EVICTION_MS = 5 * 60_000;

interface BundleComponentForClientDeps {
  transformToESM: (
    source: string,
    filePath: string,
    projectDir: string,
    adapter: RuntimeAdapter,
    options: {
      projectId: string;
      dev: boolean;
      jsxImportSource: string;
      moduleServerUrl?: string;
      moduleServerOrigin?: string;
      reactVersion?: string;
      serverExternalPackages?: readonly string[];
      dependencyPinningCacheKey?: string;
      dependencyPinningDependencies?: Readonly<Record<string, string>>;
      dependencyPinningSource?: DependencyPinningSourceInput;
    },
  ) => Promise<string>;
}

async function getBundleComponentForClientDeps(): Promise<BundleComponentForClientDeps> {
  const { transformToESM } = await import("#veryfront/transforms/esm-transform.ts");
  return { transformToESM };
}

// Register cache for monitoring
registerLRUCache("component-hydration-cache", componentHydrationCache);

async function buildComponentHydrationCacheHash(
  source: string,
  dev: boolean,
  moduleServerUrl?: string,
  reactVersion?: string,
  serverExternalPackages?: readonly string[],
): Promise<string> {
  const sourceHash = await computeHash(source);
  const effectiveReactVersion = reactVersion ?? DEFAULT_REACT_VERSION;
  const legacyCacheIdentity = [
    sourceHash,
    moduleServerUrl ?? null,
    effectiveReactVersion,
  ];
  const serverExternalPackagesIdentity = buildServerExternalPackagesIdentity(
    serverExternalPackages,
  );
  const packageScopedIdentity = serverExternalPackagesIdentity
    ? [...legacyCacheIdentity, serverExternalPackagesIdentity]
    : legacyCacheIdentity;
  // The compile mode decides minification, tree shaking and whether an inline
  // sourcemap is emitted, so two modes must never share one hydration entry.
  const cacheIdentity = JSON.stringify([
    ...packageScopedIdentity,
    dev ? "compile-dev" : "compile-production",
  ]);
  return (await computeHash(cacheIdentity)).slice(0, 16);
}

/**
 * Load and render a TSX/JSX component page
 */
export async function handleComponentPage(
  pageInfo: EntityInfo,
  slug: string,
  projectDir: string,
  _componentRegistry: unknown,
  adapter: RuntimeAdapter,
  options?: {
    props?: Record<string, unknown>;
    cachedClientModule?: string;
    moduleServerUrl?: string;
    /** Absolute request origin used to identify same-origin module URLs. */
    moduleServerOrigin?: string;
    /** Project ID for multi-project SSR module isolation */
    projectId?: string;
    /** Enable node position injection for Studio Navigator */
    studioEmbed?: boolean;
    /**
     * Compile mode ("development" | "production"). Selects minification and
     * tree shaking. Not the request mode: see `environment`.
     */
    mode?: string;
    /**
     * Request environment ("preview" | "production"). Selects preview-only
     * instrumentation such as Studio Navigator node positions. A hosted
     * preview render is compile mode "production" with environment "preview",
     * so this cannot be derived from `mode`.
     */
    environment?: RenderEnvironment;
    /** Content source ID for cache isolation (branch name or release ID) */
    contentSourceId?: string;
    /** React version for transforms (from project config) */
    reactVersion?: string;
    /** Request-scoped dependency-pinning state used by transform caches. */
    dependencyPinningCacheKey?: string;
    /** Immutable package map paired with dependencyPinningCacheKey. */
    dependencyPinningDependencies?: Readonly<Record<string, string>>;
    /** Exact package source namespace paired with the immutable snapshot. */
    dependencyPinningSource?: DependencyPinningSourceInput;
    /** Bare npm package roots that the runtime resolves without bundling. */
    serverExternalPackages?: readonly string[];
    /** Cooperative cancellation for this render's SSR transforms. */
    signal?: AbortSignal;
  },
): Promise<ComponentPageResult> {
  try {
    logger.debug(`Loading TSX/JSX file: ${pageInfo.entity.path}`);

    // Node positions are injected by the SSR module loader (for all files
    // including this entry point) when dev || environment === "preview", so
    // injecting here too would double-inject and shift positions.
    const fileContent = await adapter.fs.readFile(pageInfo.entity.path);
    const dependencyPinningCacheKey = options?.dependencyPinningCacheKey ??
      await getDependencyPinningCacheKey(projectDir);
    const dev = options?.mode === "development";

    const clientModuleCode = options?.cachedClientModule ??
      (await bundleComponentForClient(
        fileContent,
        pageInfo.entity.path,
        projectDir,
        adapter,
        options?.moduleServerUrl,
        options?.projectId,
        options?.reactVersion,
        undefined,
        options?.moduleServerOrigin,
        dependencyPinningCacheKey,
        options?.dependencyPinningDependencies,
        options?.dependencyPinningSource,
        options?.serverExternalPackages,
        dev,
      ));

    const { loadComponentFromSource } = await import("#veryfront/modules/react-loader/index.ts");
    const PageComponent = await loadComponentFromSource(
      fileContent,
      pageInfo.entity.path,
      projectDir,
      adapter,
      {
        projectId: options?.projectId ?? projectDir,
        dev,
        moduleServerUrl: options?.moduleServerUrl,
        moduleServerOrigin: options?.moduleServerOrigin,
        ssr: true,
        contentSourceId: options?.contentSourceId,
        reactVersion: options?.reactVersion,
        serverExternalPackages: options?.serverExternalPackages,
        dependencyPinningCacheKey,
        dependencyPinningDependencies: options?.dependencyPinningDependencies,
        dependencyPinningSource: options?.dependencyPinningSource,
        mode: options?.environment,
        signal: options?.signal,
      },
    );

    if (!PageComponent) {
      throw toError(
        createError({
          type: "render",
          message: `Component does not export a default: ${pageInfo.entity.path}`,
        }),
      );
    }

    const React = await getProjectReact(options?.reactVersion, adapter);
    const pageElement = React.createElement(
      PageComponent,
      options?.props ?? {},
    ) as BundledReact.ReactElement;

    const pageBundle: PageBundle = {
      compiledCode: "",
      frontmatter: pageInfo.entity.frontmatter ?? {},
      globals: {},
      headings: [],
      nodeMap: new Map(),
    };

    if (clientModuleCode) pageBundle.clientModuleCode = clientModuleCode;

    logger.debug(`Successfully loaded TSX/JSX component for ${slug}`);
    return { pageElement, pageBundle };
  } catch (error) {
    logger.error(`Failed to import TSX/JSX file: ${pageInfo.entity.path}`, error);
    throw RENDER_ERROR.create({
      detail: `Failed to load TSX/JSX component: ${(error as Error).message}`,
      context: { slug, error },
    });
  }
}

export async function bundleComponentForClient(
  source: string,
  filePath: string,
  projectDir: string,
  adapter: RuntimeAdapter,
  moduleServerUrl?: string,
  projectId?: string,
  reactVersion?: string,
  injectedDeps?: BundleComponentForClientDeps,
  moduleServerOrigin?: string,
  dependencyPinningCacheKey = "off",
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  serverExternalPackages?: readonly string[],
  /**
   * Compile the hydration bundle in development mode. Production renders must
   * leave this false: dev output is unminified, not tree-shaken and carries an
   * inline sourcemap that discloses the project source.
   */
  dev = false,
): Promise<string> {
  try {
    const cacheHash = await buildComponentHydrationCacheHash(
      source,
      dev,
      moduleServerUrl,
      reactVersion,
      serverExternalPackages,
    );
    const cacheKey = buildComponentCacheKey(
      projectId ?? projectDir,
      filePath,
      cacheHash,
      dependencyPinningCacheKey,
      moduleServerOrigin,
    );
    const cached = componentHydrationCache.get(cacheKey);
    if (cached) return cached;

    const transformed = await componentHydrationFlights.do(
      cacheKey,
      async (control) => {
        const cachedDuringFlight = componentHydrationCache.get(cacheKey);
        if (cachedDuringFlight) return cachedDuringFlight;

        const { transformToESM } = injectedDeps ?? await getBundleComponentForClientDeps();
        const transformed = await transformToESM(source, filePath, projectDir, adapter, {
          projectId: projectId ?? projectDir,
          dev,
          jsxImportSource: "react",
          moduleServerUrl,
          moduleServerOrigin,
          reactVersion,
          serverExternalPackages,
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          dependencyPinningSource,
        });

        if (control.isCurrent()) {
          componentHydrationCache.set(cacheKey, transformed);
        }
        return transformed;
      },
      {
        staleAfterMs: COMPONENT_HYDRATION_FLIGHT_STALE_EVICTION_MS,
        onStaleEvicted: () => {
          logger.warn("Evicted stale component hydration transform flight", { filePath });
        },
      },
    );

    return transformed;
  } catch (error) {
    const errorMessage = getErrorMessage(error);
    logger.error("Failed to transform component for client hydration", {
      filePath,
      error: errorMessage,
    });
    throw toError(
      createError({
        type: "render",
        message: `Component transformation failed for ${filePath}: ${errorMessage}`,
      }),
    );
  }
}
