import {
  computeHash,
  rendererLogger as logger,
  TSX_LAYOUT_MAX_ENTRIES,
  TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES,
} from "#veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents, MDXModule } from "#veryfront/types";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { preloadImportMap, transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import { resolveRelativePath } from "#veryfront/modules/react-loader/path-resolver.ts";
import { getProjectReact } from "#veryfront/react";
import { ensureValidChild } from "./ensure-valid-child.ts";
import { buildLayoutComponentCacheKey, CacheKeyPrefix } from "#veryfront/cache/keys.ts";
import { LAYOUT_EXTENSIONS } from "#veryfront/rendering/layouts/types.ts";
import {
  fingerprintPipelineImportMap,
  snapshotImportMap,
} from "#veryfront/transforms/pipeline/cache-identity.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { assertReactComponentType } from "../../react-component-type.ts";

const loadMdxLayoutLog = logger.component("load-mdx-layout");
const applyTsxLayoutLog = logger.component("apply-tsx-layout");
const APP_ROUTER_SCRIPT_LAYOUT_EXTENSIONS = LAYOUT_EXTENSIONS.filter((extension) =>
  extension !== "md" && extension !== "mdx"
);
const TSX_COMPONENT_FLIGHT_STALE_EVICTION_MS = 5 * 60_000;

type AppRouterDocumentLayoutFunction = (
  props: { children?: BundledReact.ReactNode },
) => BundledReact.ReactNode;

export interface LayoutComponentCache {
  get(key: string): BundledReact.ComponentType | undefined;
  getForProject?(
    projectId: string,
    key: string,
  ): BundledReact.ComponentType | undefined;
  set(key: string, value: BundledReact.ComponentType): void;
  setForProject?(
    projectId: string,
    key: string,
    value: BundledReact.ComponentType,
  ): void;
  delete(key: string): void;
  clear(): void;
  clearForProject?(projectId: string): void;
}

export interface LoadTSXComponentOptions {
  loadComponentFromSource?: typeof loadComponentFromSource;
  mode?: "development" | "production";
  moduleServerUrl?: string;
}

const tsxComponentFlights = new WeakMap<
  LayoutComponentCache,
  Singleflight<BundledReact.ComponentType>
>();

function getTSXComponentFlights(
  cache: LayoutComponentCache,
): Singleflight<BundledReact.ComponentType> {
  let flights = tsxComponentFlights.get(cache);
  if (!flights) {
    flights = new Singleflight<BundledReact.ComponentType>();
    tsxComponentFlights.set(cache, flights);
  }
  return flights;
}

class InMemoryLayoutComponentCache implements LayoutComponentCache {
  private readonly entries = new Map<string, BundledReact.ComponentType>();

  constructor(private readonly maxEntries = TSX_LAYOUT_MAX_ENTRIES) {}

  get(key: string): BundledReact.ComponentType | undefined {
    const value = this.entries.get(key);
    if (!value) return undefined;

    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  set(key: string, value: BundledReact.ComponentType): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
      this.entries.set(key, value);
      return;
    }

    if (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey) this.entries.delete(oldestKey);
    }

    this.entries.set(key, value);
  }

  get size(): number {
    return this.entries.size;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  clearForProject(projectId: string): void {
    const prefix = `${CacheKeyPrefix.LAYOUT}:${projectId}:`;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix)) {
        this.entries.delete(key);
      }
    }
  }
}

/**
 * Per-project layout component cache.
 *
 * Wraps a Map of per-project LRU sub-caches so that one noisy project cannot
 * evict another project's cached layouts. Two limits apply:
 *
 * 1. **Per-project cap** (`perProjectMaxEntries`): each project's sub-cache is
 *    bounded independently. Configurable via `TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES`.
 * 2. **Global project-count cap** (`maxProjects`): the number of distinct
 *    projects that can have a sub-cache is bounded. When the cap is reached the
 *    project whose sub-cache has the fewest entries (i.e. least active) is
 *    evicted first to make room. This keeps total memory bounded even when many
 *    projects exist. Defaults to `floor(maxEntries / perProjectMaxEntries)`.
 *
 * Cache keys are expected to start with `layout:{projectId}:` (the format
 * produced by `buildLayoutComponentCacheKey`). The projectId is extracted from
 * the key so no extra argument is needed for `get`/`set`.
 */
class PerProjectLayoutComponentCache implements LayoutComponentCache {
  private readonly projects = new Map<string, InMemoryLayoutComponentCache>();

  constructor(
    private readonly perProjectMaxEntries: number,
    private readonly maxProjects: number,
  ) {}

  /** Extract projectId from a `layout:{projectId}:…` cache key. */
  private projectIdFromKey(key: string): string {
    const second = key.indexOf(":", key.indexOf(":") + 1);
    return second === -1 ? key : key.slice(key.indexOf(":") + 1, second);
  }

  private getOrCreateBucket(projectId: string): InMemoryLayoutComponentCache {
    let bucket = this.projects.get(projectId);
    if (bucket) return bucket;

    // Evict the least-active project when the project-count cap is reached.
    if (this.projects.size >= this.maxProjects) {
      let smallestId: string | undefined;
      let smallestSize = Infinity;
      for (const [id, b] of this.projects) {
        if (b.size < smallestSize) {
          smallestSize = b.size;
          smallestId = id;
        }
      }
      if (smallestId !== undefined) this.projects.delete(smallestId);
    }

    bucket = new InMemoryLayoutComponentCache(this.perProjectMaxEntries);
    this.projects.set(projectId, bucket);
    return bucket;
  }

  get(key: string): BundledReact.ComponentType | undefined {
    const projectId = this.projectIdFromKey(key);
    return this.projects.get(projectId)?.get(key);
  }

  getForProject(
    projectId: string,
    key: string,
  ): BundledReact.ComponentType | undefined {
    return this.projects.get(projectId)?.get(key);
  }

  set(key: string, value: BundledReact.ComponentType): void {
    const projectId = this.projectIdFromKey(key);
    this.getOrCreateBucket(projectId).set(key, value);
  }

  setForProject(
    projectId: string,
    key: string,
    value: BundledReact.ComponentType,
  ): void {
    this.getOrCreateBucket(projectId).set(key, value);
  }

  delete(key: string): void {
    const projectId = this.projectIdFromKey(key);
    this.projects.get(projectId)?.delete(key);
  }

  clear(): void {
    this.projects.clear();
  }

  clearForProject(projectId: string): void {
    this.projects.delete(projectId);
  }
}

export function createLayoutComponentCache(
  maxEntries = TSX_LAYOUT_MAX_ENTRIES,
  perProjectMaxEntries = TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES,
): LayoutComponentCache {
  // A single bucket may never exceed the caller's total budget: with a small
  // custom maxEntries (e.g. tests passing 2), the env-derived per-project
  // default would otherwise let one project hold more than the whole cache.
  const perProject = Math.max(1, Math.min(perProjectMaxEntries, maxEntries));
  const maxProjects = Math.max(1, Math.floor(maxEntries / perProject));
  return new PerProjectLayoutComponentCache(perProject, maxProjects);
}

function getCachedLayout(
  cache: LayoutComponentCache,
  projectId: string,
  key: string,
): BundledReact.ComponentType | undefined {
  if (cache.getForProject) return cache.getForProject(projectId, key);
  return cache.get(key);
}

function setCachedLayout(
  cache: LayoutComponentCache,
  projectId: string,
  key: string,
  value: BundledReact.ComponentType,
): void {
  if (cache.setForProject) {
    cache.setForProject(projectId, key, value);
    return;
  }
  cache.set(key, value);
}

export function shouldUnwrapAppRouterDocumentLayout(
  componentPath: string | undefined,
  projectDir: string,
  appDirectory = "app",
): boolean {
  if (!componentPath) return false;

  const relativePath = resolveRelativePath(componentPath.replace(/\\/g, "/"), projectDir)
    .replace(/^\/+/, "");
  const relativeAppDirectory = resolveRelativePath(
    appDirectory.replace(/\\/g, "/"),
    projectDir,
  )
    .replace(/^\.\/+/, "")
    .replace(/^\/+|\/+$/g, "");

  return APP_ROUTER_SCRIPT_LAYOUT_EXTENSIONS.some((extension) =>
    relativePath === `${relativeAppDirectory}/layout.${extension}`
  );
}

export function unwrapAppRouterDocumentLayout(
  React: typeof BundledReact,
  LayoutComponent: AppRouterDocumentLayoutFunction,
): BundledReact.FunctionComponent<{ children?: BundledReact.ReactNode }> {
  return function AppRouterDocumentLayout(props: { children?: BundledReact.ReactNode }) {
    const element = LayoutComponent(props);
    if (!React.isValidElement(element) || element.type !== "html") {
      return element;
    }

    const elementProps = element.props as { children?: BundledReact.ReactNode };
    const body = React.Children.toArray(elementProps.children).find((child) =>
      React.isValidElement(child) && child.type === "body"
    ) as BundledReact.ReactElement<{ children?: BundledReact.ReactNode }> | undefined;

    return body?.props?.children ?? props.children ?? null;
  };
}

export async function loadTSXComponent(
  componentPath: string,
  projectDir: string,
  cache: LayoutComponentCache,
  adapter: RuntimeAdapter,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
  reactVersion?: string,
  importMap?: ImportMapConfig,
  options: LoadTSXComponentOptions = {},
): Promise<BundledReact.ComponentType> {
  const mode = options.mode ?? "development";
  const source = await adapter.fs.readFile(componentPath);
  const resolvedImportMap = snapshotImportMap(
    importMap ?? await preloadImportMap(projectDir, adapter, projectId),
  );
  const [hash, importMapFingerprint, runtimeFingerprint] = await Promise.all([
    computeHash(source),
    fingerprintPipelineImportMap(resolvedImportMap),
    computeHash(JSON.stringify([
      projectSlug,
      reactVersion ?? null,
      mode,
      options.moduleServerUrl ?? null,
    ])),
  ]);
  const cacheKey = buildLayoutComponentCacheKey(
    projectId,
    componentPath,
    hash,
    contentSourceId,
    importMapFingerprint,
  ) + ":" + runtimeFingerprint;

  const cached = getCachedLayout(cache, projectId, cacheKey);
  if (cached) return cached;

  const loaded = await getTSXComponentFlights(cache).do(
    cacheKey,
    async (control) => {
      const cachedDuringFlight = getCachedLayout(cache, projectId, cacheKey);
      if (cachedDuringFlight) return cachedDuringFlight;

      const exported = await (options.loadComponentFromSource ?? loadComponentFromSource)(
        source,
        componentPath,
        projectDir,
        adapter,
        {
          dev: mode === "development",
          mode,
          projectId,
          projectSlug,
          moduleServerUrl: options.moduleServerUrl,
          ssr: true,
          contentSourceId,
          reactVersion,
          importMap: resolvedImportMap,
        },
      );
      const loaded = assertReactComponentType(
        exported,
        `TSX layout module "${componentPath}"`,
      );

      if (control.isCurrent()) {
        setCachedLayout(cache, projectId, cacheKey, loaded);
      }
      return loaded;
    },
    {
      staleAfterMs: TSX_COMPONENT_FLIGHT_STALE_EVICTION_MS,
      onStaleEvicted: () => {
        applyTsxLayoutLog.warn("Evicted stale TSX layout component load flight", {
          componentPath,
        });
      },
    },
  );
  return loaded;
}

/** Load an MDX layout module from a bundle. */
export function loadMDXLayout(
  bundle: MdxBundle,
  projectDir: string,
  adapter: RuntimeAdapter,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
  preloadedImportMap?: ImportMapConfig,
  reactVersion?: string,
): Promise<BundledReact.ComponentType<{ components?: MDXComponents }>> {
  return withSpan(
    SpanNames.LAYOUT_LOAD_MDX,
    async () => {
      loadMdxLayoutLog.debug("START", {
        projectSlug,
        hasPreloadedImportMap: !!preloadedImportMap,
      });

      const map = preloadedImportMap ?? (await preloadImportMap(projectDir, adapter, projectId));
      if (preloadedImportMap) {
        loadMdxLayoutLog.debug("Using preloaded import map", { projectSlug });
      }

      const code = transformImportsWithMap(bundle.compiledCode, map);
      loadMdxLayoutLog.debug("Loading module via loadModuleESM START", {
        projectSlug,
        codeLength: code.length,
      });

      const mod = (await mdxRenderer.loadModuleESM(
        code,
        adapter,
        projectId,
        projectDir,
        projectSlug,
        contentSourceId,
        reactVersion,
        map,
      )) as MDXModule;

      loadMdxLayoutLog.debug("loadModuleESM DONE", {
        projectSlug,
        exports: Object.keys(mod),
      });

      return assertReactComponentType(
        mod.MDXLayout || mod.MainLayout || mod.default,
        `MDX layout module for project "${projectSlug}"`,
      ) as BundledReact.ComponentType<{ components?: MDXComponents }>;
    },
    {
      "layout.project_slug": projectSlug || "",
      "layout.has_preloaded_import_map": !!preloadedImportMap,
      "layout.code_length": bundle.compiledCode?.length || 0,
    },
  );
}

/** Preload an MDX layout module into cache for faster subsequent loads. */
export async function preloadMDXLayoutModule(
  bundle: MdxBundle,
  projectDir: string,
  adapter: RuntimeAdapter,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
  reactVersion?: string,
  preloadedImportMap?: ImportMapConfig,
): Promise<void> {
  await loadMDXLayout(
    bundle,
    projectDir,
    adapter,
    projectId,
    projectSlug,
    contentSourceId,
    preloadedImportMap,
    reactVersion,
  );
}

export async function applyTSXLayout(
  element: BundledReact.ReactElement,
  item: LayoutItem,
  tsxLayoutModuleCache: LayoutComponentCache,
  projectDir: string,
  adapter: RuntimeAdapter,
  props: Record<string, unknown> | undefined,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
  reactVersion?: string,
  importMap?: ImportMapConfig,
  mode: "development" | "production" = "development",
  moduleServerUrl?: string,
): Promise<BundledReact.ReactElement> {
  const start = performance.now();
  applyTsxLayoutLog.debug("START", {
    componentPath: item.componentPath,
    projectId,
    projectSlug,
  });

  const React = await getProjectReact(reactVersion);

  try {
    applyTsxLayoutLog.debug("loadTSXComponent START", { componentPath: item.componentPath });
    const loadStart = performance.now();

    const LayoutComponent = await loadTSXComponent(
      item.componentPath!,
      projectDir,
      tsxLayoutModuleCache,
      adapter,
      projectId,
      projectSlug,
      contentSourceId,
      reactVersion,
      importMap,
      { mode, moduleServerUrl },
    );

    applyTsxLayoutLog.debug("loadTSXComponent DONE", {
      componentPath: item.componentPath,
      duration: `${(performance.now() - loadStart).toFixed(2)}ms`,
    });

    const result = React.createElement(
      LayoutComponent,
      props ?? {},
      element,
    ) as BundledReact.ReactElement;

    applyTsxLayoutLog.debug("DONE", {
      componentPath: item.componentPath,
      totalDuration: `${(performance.now() - start).toFixed(2)}ms`,
    });

    return result;
  } catch (e) {
    logger.error("Failed to compile/import TSX layout", e);
    throw e;
  }
}

export async function applyMDXLayout(
  element: BundledReact.ReactElement,
  bundle: MdxBundle,
  projectDir: string,
  mergedComponents: MDXComponents,
  adapter: RuntimeAdapter,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
  preloadedImportMap?: ImportMapConfig,
  reactVersion?: string,
): Promise<BundledReact.ReactElement> {
  const React = await getProjectReact(reactVersion);
  const LayoutFn = await loadMDXLayout(
    bundle,
    projectDir,
    adapter,
    projectId,
    projectSlug,
    contentSourceId,
    preloadedImportMap,
    reactVersion,
  );

  const child = ensureValidChild(element, React);
  return React.createElement(
    LayoutFn,
    { components: mergedComponents },
    child,
  ) as BundledReact.ReactElement;
}
