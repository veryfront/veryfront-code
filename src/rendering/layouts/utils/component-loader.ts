import { rendererLogger as logger } from "#veryfront/utils";
import { computeHash, TSX_LAYOUT_MAX_ENTRIES } from "#veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents, MDXModule } from "#veryfront/types";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { loadImportMap, transformImportsWithMap } from "#veryfront/modules/import-map/index.ts";
import { mdxRenderer } from "#veryfront/transforms/mdx/index.ts";
import { loadComponentFromSource } from "#veryfront/modules/react-loader/component-loader.ts";
import { getProjectReact } from "#veryfront/react";
import { ensureValidChild } from "./ensure-valid-child.ts";
import { buildLayoutComponentCacheKey } from "../../../cache/keys.ts";

export interface LayoutComponentCache {
  get(key: string): BundledReact.ComponentType | undefined;
  set(key: string, value: BundledReact.ComponentType): void;
  delete(key: string): void;
  clear(): void;
}

class InMemoryLayoutComponentCache implements LayoutComponentCache {
  private readonly entries = new Map<string, BundledReact.ComponentType>();

  constructor(private readonly maxEntries = TSX_LAYOUT_MAX_ENTRIES) {}

  get(key: string): BundledReact.ComponentType | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: BundledReact.ComponentType): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    } else if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) {
        this.entries.delete(oldest.value);
      }
    }
    this.entries.set(key, value);
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
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
  projectId?: string,
): Promise<BundledReact.ComponentType> {
  const source = await adapter.fs.readFile(componentPath);
  const hash = await computeHash(source);
  const effectiveProjectId = projectId ?? projectDir;
  const cacheKey = buildLayoutComponentCacheKey(effectiveProjectId, componentPath, hash);
  let component = cache.get(cacheKey);

  if (!component) {
    const loadedComponent = await loadComponentFromSource(
      source,
      componentPath,
      projectDir,
      adapter,
      { dev: true, projectId: projectId ?? projectDir, ssr: true },
    );

    if (loadedComponent) {
      component = loadedComponent;
      cache.set(cacheKey, component);
    }
  }

  if (!component) {
    throw toError(createError({
      type: "render",
      message: "Component loading failed",
    }));
  }

  return component;
}

export async function loadMDXLayout(
  bundle: MdxBundle,
  projectDir: string,
  adapter: RuntimeAdapter,
  projectId?: string,
  projectSlug?: string,
  contentSourceId?: string,
): Promise<BundledReact.ComponentType<{ components?: MDXComponents }> | undefined> {
  const loadStart = performance.now();
  logger.debug("[loadMDXLayout] START", { projectSlug });

  logger.debug("[loadMDXLayout] loadImportMap START", { projectSlug });
  const mapStart = performance.now();
  const map = await loadImportMap(projectDir, adapter);
  logger.debug("[loadMDXLayout] loadImportMap DONE", {
    projectSlug,
    duration: `${(performance.now() - mapStart).toFixed(2)}ms`,
  });

  const code = transformImportsWithMap(bundle.compiledCode, map);
  logger.debug("[loadMDXLayout] Loading module via loadModuleESM START", {
    projectSlug,
    codeLength: code.length,
  });

  const modStart = performance.now();
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
    duration: `${(performance.now() - modStart).toFixed(2)}ms`,
    exports: Object.keys(mod),
  });

  logger.debug("[loadMDXLayout] DONE", {
    projectSlug,
    totalDuration: `${(performance.now() - loadStart).toFixed(2)}ms`,
  });
  return mod.MDXLayout || mod.MainLayout || mod.default;
}

export async function applyTSXLayout(
  element: BundledReact.ReactElement,
  item: LayoutItem,
  tsxLayoutModuleCache: LayoutComponentCache,
  projectDir: string,
  adapter: RuntimeAdapter,
  props?: Record<string, unknown>,
  projectId?: string,
): Promise<BundledReact.ReactElement> {
  const start = performance.now();
  logger.debug("[applyTSXLayout] START", { componentPath: item.componentPath, projectId });
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
    );
    logger.debug("[applyTSXLayout] loadTSXComponent DONE", {
      componentPath: item.componentPath,
      duration: `${(performance.now() - loadStart).toFixed(2)}ms`,
    });
    const result = React.createElement(LayoutComponent, props || {}, element) as BundledReact.ReactElement;
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
  projectId?: string,
  projectSlug?: string,
  contentSourceId?: string,
): Promise<BundledReact.ReactElement> {
  const React = await getProjectReact();
  const LayoutFn = await loadMDXLayout(
    bundle,
    projectDir,
    adapter,
    projectId,
    projectSlug,
    contentSourceId,
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
