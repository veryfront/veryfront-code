import {
  awaitAbortable,
  computeHash,
  rendererLogger as logger,
  throwIfAborted,
  TSX_LAYOUT_MAX_ENTRIES,
  TSX_LAYOUT_PER_PROJECT_MAX_ENTRIES,
} from "#veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { getRuntimeModuleLoader } from "#veryfront/platform/adapters/module-loader.ts";
import { extractComponent } from "#veryfront/modules/react-loader/extract-component.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { LayoutItem, MdxBundle, MDXComponents, MDXModule } from "#veryfront/types";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { createError, toError } from "#veryfront/errors";
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
import type { RenderModes } from "#veryfront/rendering/context/render-context.ts";
import {
  type DependencyPinningSourceInput,
  resolveDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { buildDependencyPinningCacheVariant } from "#veryfront/cache/keys/dependency-pinning.ts";
import { Singleflight } from "#veryfront/utils/singleflight.ts";
import { buildServerExternalPackagesIdentity } from "#veryfront/config/server-external-packages.ts";
import { hashString } from "#veryfront/cache/hash.ts";

const loadMdxLayoutLog = logger.component("load-mdx-layout");
const applyTsxLayoutLog = logger.component("apply-tsx-layout");
const applyMdxLayoutLog = logger.component("apply-mdx-layout");
const APP_ROUTER_SCRIPT_LAYOUT_EXTENSIONS = LAYOUT_EXTENSIONS.filter((extension) =>
  extension !== "md" && extension !== "mdx"
);
const TSX_COMPONENT_FLIGHT_STALE_EVICTION_MS = 5 * 60_000;

type AppRouterDocumentLayoutFunction = (
  props: { children?: BundledReact.ReactNode },
) => BundledReact.ReactNode;

export interface LayoutComponentCache {
  get(key: string): BundledReact.ComponentType | undefined;
  set(key: string, value: BundledReact.ComponentType): void;
  delete(key: string): void;
  clear(): void;
  clearForProject?(projectId: string): void;
}

interface LoadTSXComponentDeps {
  loadComponentFromSource: typeof loadComponentFromSource;
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

  set(key: string, value: BundledReact.ComponentType): void {
    const projectId = this.projectIdFromKey(key);
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
  modes: RenderModes,
  reactVersion?: string,
  deps: LoadTSXComponentDeps = { loadComponentFromSource },
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
  signal?: AbortSignal,
): Promise<BundledReact.ComponentType> {
  throwIfAborted(signal);
  const prepared = getRuntimeModuleLoader(adapter);
  if (prepared) {
    const module = await awaitAbortable(
      prepared.importModule({ kind: "source", path: componentPath }),
      signal,
    );
    throwIfAborted(signal);
    return extractComponent(module, componentPath);
  }
  const dev = modes.compileMode === "development";
  const source = await adapter.fs.readFile(componentPath);
  const dependencySnapshot = await resolveDependencyPinningSnapshot(
    dependencyPinningSource ?? projectDir,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
  );
  const hash = await computeHash(source);
  const legacyCacheKey =
    buildLayoutComponentCacheKey(projectId, componentPath, hash, contentSourceId) +
    ":" + (reactVersion ?? "default");
  const cacheVariant = buildDependencyPinningCacheVariant(
    dependencySnapshot.cacheKey,
    moduleServerOrigin,
  );
  const serverExternalPackagesIdentity = buildServerExternalPackagesIdentity(
    serverExternalPackages,
  );
  let cacheKey = cacheVariant ? `${legacyCacheKey}:pins:${cacheVariant}` : legacyCacheKey;
  if (serverExternalPackagesIdentity) {
    cacheKey += `:server-externals:${hashString(serverExternalPackagesIdentity)}`;
  }
  // The transform output differs by mode, so the two modes must not share an
  // entry. Production keeps the historical key shape. Preview instruments the
  // output with node positions on top of a production compile, so it needs its
  // own entry too.
  if (dev) cacheKey += ":dev";
  if (modes.environment === "preview") cacheKey += ":preview";

  throwIfAborted(signal);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const loaded = await getTSXComponentFlights(cache).do(
    cacheKey,
    async (control) => {
      throwIfAborted(control.signal);
      const cachedDuringFlight = cache.get(cacheKey);
      if (cachedDuringFlight) return cachedDuringFlight;

      const loaded = await deps.loadComponentFromSource(
        source,
        componentPath,
        projectDir,
        adapter,
        {
          dev,
          projectId,
          projectSlug,
          ssr: true,
          contentSourceId,
          reactVersion,
          serverExternalPackages,
          moduleServerOrigin,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
          dependencyPinningDependencies: dependencySnapshot.dependencies,
          dependencyPinningSource: dependencyPinningSource ?? projectDir,
          mode: modes.environment,
          signal: control.signal,
        },
      );

      if (!loaded) {
        throw toError(
          createError({
            type: "render",
            message: "Component loading failed",
          }),
        );
      }

      if (control.isCurrent()) {
        cache.set(cacheKey, loaded);
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
      signal,
      cancelWhenUnobserved: true,
    },
  );
  return loaded;
}

/**
 * Inputs shared by every MDX layout module load.
 *
 * These are named rather than positional because the chain is long enough that
 * a value in the wrong slot still type-checks. `modes` in particular carries
 * two vocabularies that are both mode-shaped and disagree on a hosted preview
 * render, so it travels as the pair and is unpacked at the one seam that
 * consumes it.
 */
export interface MDXLayoutModuleOptions {
  bundle: MdxBundle;
  /** Original layout source identity for prepared execution. */
  sourcePath?: string;
  projectDir: string;
  adapter: RuntimeAdapter;
  projectId: string;
  projectSlug: string;
  contentSourceId: string;
  /**
   * Compile and request vocabularies for this render. `compileMode` selects the
   * compile mode of the layout's own `/_vf_modules/*` imports. `environment`
   * has no consumer below this seam today and is carried so that no caller has
   * to choose between the two, which is the choice that type-checks when made
   * wrongly.
   */
  modes: RenderModes;
  reactVersion?: string;
  dependencyPinningCacheKey?: string;
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  dependencyPinningSource?: DependencyPinningSourceInput;
  moduleServerOrigin?: string;
  config?: VeryfrontConfig;
  isLocalProject?: boolean;
  /**
   * Request cancellation. The import-map preloader and ESM module loader do
   * not take a signal themselves, so each stage is guarded and the module wait
   * is raced against cancellation.
   */
  signal?: AbortSignal;
}

/** Inputs for {@link loadMDXLayout}. */
export interface LoadMDXLayoutOptions extends MDXLayoutModuleOptions {
  preloadedImportMap?: ImportMapConfig;
}

/** Load an MDX layout module from a bundle. */
export function loadMDXLayout(
  options: LoadMDXLayoutOptions,
): Promise<BundledReact.ComponentType<{ components?: MDXComponents }> | undefined> {
  const {
    bundle,
    projectDir,
    adapter,
    projectId,
    projectSlug,
    contentSourceId,
    modes,
    preloadedImportMap,
    reactVersion,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
    dependencyPinningSource,
    moduleServerOrigin,
    config,
    isLocalProject,
    signal,
  } = options;

  return withSpan(
    SpanNames.LAYOUT_LOAD_MDX,
    async () => {
      loadMdxLayoutLog.debug("START", {
        projectSlug,
        hasPreloadedImportMap: !!preloadedImportMap,
      });

      throwIfAborted(signal);
      if (getRuntimeModuleLoader(adapter)) {
        const mod = await awaitAbortable(
          mdxRenderer.loadModuleESM("", {
            adapter,
            sourcePath: options.sourcePath,
          }),
          signal,
        );
        throwIfAborted(signal);
        return mod.MDXLayout || mod.MainLayout || mod.default;
      }
      const map = preloadedImportMap ?? (await awaitAbortable(
        preloadImportMap(projectDir, adapter, projectId, {
          projectDir,
          contentSourceId,
          config,
        }),
        signal,
      ));
      if (preloadedImportMap) {
        loadMdxLayoutLog.debug("Using preloaded import map", { projectSlug });
      }

      throwIfAborted(signal);
      const code = transformImportsWithMap(bundle.compiledCode, map);
      loadMdxLayoutLog.debug("Loading module via loadModuleESM START", {
        projectSlug,
        codeLength: code.length,
      });

      const mod = (await awaitAbortable(
        mdxRenderer.loadModuleESM(code, {
          adapter,
          sourcePath: options.sourcePath,
          projectId,
          projectDir,
          projectSlug,
          contentSourceId,
          mode: modes.compileMode,
          reactVersion,
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          dependencyPinningSource,
          moduleServerOrigin,
          isLocalProject,
          serverExternalPackages: config?.build?.serverExternalPackages,
        }),
        signal,
      )) as MDXModule;
      throwIfAborted(signal);

      loadMdxLayoutLog.debug("loadModuleESM DONE", {
        projectSlug,
        exports: Object.keys(mod),
      });

      return mod.MDXLayout || mod.MainLayout || mod.default;
    },
    {
      "layout.project_slug": projectSlug || "",
      "layout.has_preloaded_import_map": !!preloadedImportMap,
      "layout.code_length": bundle.compiledCode?.length || 0,
    },
  );
}

/**
 * Preload an MDX layout module into cache for faster subsequent loads.
 *
 * The preload resolves the import map itself, so it takes no
 * `preloadedImportMap`.
 */
export async function preloadMDXLayoutModule(
  options: MDXLayoutModuleOptions,
): Promise<void> {
  await loadMDXLayout(options);
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
  modes: RenderModes,
  reactVersion?: string,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
  serverExternalPackages?: readonly string[],
  signal?: AbortSignal,
): Promise<BundledReact.ReactElement> {
  const start = performance.now();
  applyTsxLayoutLog.debug("START", {
    componentPath: item.componentPath,
    projectId,
    projectSlug,
  });

  const React = await getProjectReact(reactVersion, adapter);

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
      modes,
      reactVersion,
      undefined,
      dependencyPinningCacheKey,
      dependencyPinningDependencies,
      dependencyPinningSource,
      moduleServerOrigin,
      serverExternalPackages,
      signal,
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

/** Inputs for {@link applyMDXLayout}. */
export interface ApplyMDXLayoutOptions extends LoadMDXLayoutOptions {
  element: BundledReact.ReactElement;
  mergedComponents: MDXComponents;
}

export async function applyMDXLayout(
  options: ApplyMDXLayoutOptions,
): Promise<BundledReact.ReactElement> {
  const { element, mergedComponents, reactVersion } = options;
  const React = await getProjectReact(reactVersion, options.adapter);
  const LayoutFn = await loadMDXLayout(options);

  if (!LayoutFn) {
    applyMdxLayoutLog.debug("No layout function found");
    return element;
  }

  const child = ensureValidChild(element, React);
  return React.createElement(
    LayoutFn,
    { components: mergedComponents },
    child,
  ) as BundledReact.ReactElement;
}
