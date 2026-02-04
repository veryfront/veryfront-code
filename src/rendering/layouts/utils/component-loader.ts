import { computeHash, rendererLogger as logger, TSX_LAYOUT_MAX_ENTRIES } from "#veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents, MDXModule } from "#veryfront/types";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { SpanNames } from "#veryfront/observability/tracing/span-names.ts";
import { preloadImportMap, transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import { getProjectReact } from "#veryfront/react";
import { ensureValidChild } from "./ensure-valid-child.ts";
import { buildLayoutComponentCacheKey, CacheKeyPrefix } from "../../../cache/keys.ts";

export interface LayoutComponentCache {
  get(key: string): BundledReact.ComponentType | undefined;
  set(key: string, value: BundledReact.ComponentType): void;
  delete(key: string): void;
  clear(): void;
  clearForProject?(projectId: string): void;
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

export function createLayoutComponentCache(
  maxEntries = TSX_LAYOUT_MAX_ENTRIES,
): LayoutComponentCache {
  return new InMemoryLayoutComponentCache(maxEntries);
}

export async function loadTSXComponent(
  componentPath: string,
  projectDir: string,
  cache: LayoutComponentCache,
  adapter: RuntimeAdapter,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
): Promise<BundledReact.ComponentType> {
  const source = await adapter.fs.readFile(componentPath);
  const hash = await computeHash(source);
  const cacheKey = buildLayoutComponentCacheKey(projectId, componentPath, hash, contentSourceId);

  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const loaded = await loadComponentFromSource(source, componentPath, projectDir, adapter, {
    dev: true,
    projectId,
    projectSlug,
    ssr: true,
    contentSourceId,
  });

  if (!loaded) {
    throw toError(
      createError({
        type: "render",
        message: "Component loading failed",
      }),
    );
  }

  cache.set(cacheKey, loaded);
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
): Promise<BundledReact.ComponentType<{ components?: MDXComponents }> | undefined> {
  return withSpan(
    SpanNames.LAYOUT_LOAD_MDX,
    async () => {
      logger.debug("[loadMDXLayout] START", {
        projectSlug,
        hasPreloadedImportMap: !!preloadedImportMap,
      });

      const map = preloadedImportMap ?? (await preloadImportMap(projectDir, adapter));
      if (preloadedImportMap) {
        logger.debug("[loadMDXLayout] Using preloaded import map", { projectSlug });
      }

      const code = transformImportsWithMap(bundle.compiledCode, map);
      logger.debug("[loadMDXLayout] Loading module via loadModuleESM START", {
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
      )) as MDXModule;

      logger.debug("[loadMDXLayout] loadModuleESM DONE", {
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

/** Preload an MDX layout module into cache for faster subsequent loads. */
export async function preloadMDXLayoutModule(
  bundle: MdxBundle,
  projectDir: string,
  adapter: RuntimeAdapter,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
): Promise<void> {
  await loadMDXLayout(bundle, projectDir, adapter, projectId, projectSlug, contentSourceId);
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
): Promise<BundledReact.ReactElement> {
  const start = performance.now();
  logger.debug("[applyTSXLayout] START", {
    componentPath: item.componentPath,
    projectId,
    projectSlug,
  });

  const React = await getProjectReact();

  try {
    logger.debug("[applyTSXLayout] loadTSXComponent START", { componentPath: item.componentPath });
    const loadStart = performance.now();

    const LayoutComponent = await loadTSXComponent(
      item.componentPath!,
      projectDir,
      tsxLayoutModuleCache,
      adapter,
      projectId,
      projectSlug,
      contentSourceId,
    );

    logger.debug("[applyTSXLayout] loadTSXComponent DONE", {
      componentPath: item.componentPath,
      duration: `${(performance.now() - loadStart).toFixed(2)}ms`,
    });

    const result = React.createElement(
      LayoutComponent,
      props ?? {},
      element,
    ) as BundledReact.ReactElement;

    logger.debug("[applyTSXLayout] DONE", {
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
): Promise<BundledReact.ReactElement> {
  const React = await getProjectReact();
  const LayoutFn = await loadMDXLayout(
    bundle,
    projectDir,
    adapter,
    projectId,
    projectSlug,
    contentSourceId,
    preloadedImportMap,
  );

  if (!LayoutFn) {
    logger.debug("[applyMDXLayout] No layout function found");
    return element;
  }

  const child = ensureValidChild(element, React);
  return React.createElement(
    LayoutFn,
    { components: mergedComponents },
    child,
  ) as BundledReact.ReactElement;
}
