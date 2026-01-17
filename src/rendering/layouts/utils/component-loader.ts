import { rendererLogger as logger } from "@veryfront/utils";
import { getContentHash, TSX_LAYOUT_MAX_ENTRIES } from "@veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents, MDXModule } from "@veryfront/types";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import { loadImportMap, transformImportsWithMap } from "@veryfront/modules/import-map/index.ts";
import { mdxRenderer } from "@veryfront/transforms/mdx/index.ts";
import { loadComponentFromSource } from "@veryfront/modules/react-loader/component-loader.ts";
import { getProjectReact } from "@veryfront/react";
import { ensureValidChild } from "./ensure-valid-child.ts";
import { buildLayoutComponentCacheKey } from "../../../core/cache/keys.ts";

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
  const hash = await getContentHash(source);
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
): Promise<BundledReact.ComponentType<{ components?: MDXComponents }> | undefined> {
  const map = await loadImportMap(projectDir, adapter);
  const code = transformImportsWithMap(bundle.compiledCode, map);
  logger.debug("[loadMDXLayout] Loading module", { codeLength: code.length });
  const mod = (await mdxRenderer.loadModuleESM(
    code,
    adapter,
    projectId,
    projectDir,
    projectSlug,
  )) as MDXModule;
  logger.debug("[loadMDXLayout] Module loaded", { exports: Object.keys(mod) });
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
  const React = await getProjectReact();
  try {
    const LayoutComponent = await loadTSXComponent(
      item.componentPath!,
      projectDir,
      tsxLayoutModuleCache,
      adapter,
      projectId,
    );
    return React.createElement(LayoutComponent, props || {}, element) as BundledReact.ReactElement;
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
): Promise<BundledReact.ReactElement> {
  const React = await getProjectReact();
  const LayoutFn = await loadMDXLayout(bundle, projectDir, adapter, projectId, projectSlug);

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
