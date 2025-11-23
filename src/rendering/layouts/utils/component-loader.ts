import { rendererLogger as logger } from "@veryfront/utils";
import { getContentHash, TSX_LAYOUT_MAX_ENTRIES } from "@veryfront/utils";
import * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents, MDXModule } from "@veryfront/types";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import { loadImportMap, transformImportsWithMap } from "@veryfront/modules/import-map/index.ts";
import { mdxRenderer } from "@veryfront/transforms/mdx/index.ts";
import { loadComponentFromSource } from "@veryfront/modules/react-loader/component-loader.ts";
import {
  getElementDebugInfo,
  getElementTypeName,
} from "../../element-validator/primitive-checks.ts";

export interface LayoutComponentCache {
  get(key: string): React.ComponentType | undefined;
  set(key: string, value: React.ComponentType): void;
  delete(key: string): void;
  clear(): void;
}

class InMemoryLayoutComponentCache implements LayoutComponentCache {
  private readonly entries = new Map<string, React.ComponentType>();

  constructor(private readonly maxEntries = TSX_LAYOUT_MAX_ENTRIES) {}

  get(key: string): React.ComponentType | undefined {
    const value = this.entries.get(key);
    if (value) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: React.ComponentType): void {
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
): Promise<React.ComponentType> {
  const source = await adapter.fs.readFile(componentPath);
  const hash = await getContentHash(source);
  const cacheKey = `${componentPath}:${hash}`;
  let component = cache.get(cacheKey);

  if (!component) {
    // Load component using real react-module-loader
    // Pass ssr: true to prevent module server import rewriting for server-side execution
    const loadedComponent = await loadComponentFromSource(
      source,
      componentPath,
      projectDir,
      adapter,
      { dev: true, projectId: projectDir, ssr: true },
    );

    // Only set cache if component was successfully loaded
    if (loadedComponent) {
      component = loadedComponent;
      cache.set(cacheKey, component);
    }
  }

  // TypeScript guard: component is definitely defined here
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
): Promise<React.ComponentType<{ components?: MDXComponents }> | undefined> {
  const map = await loadImportMap(projectDir, adapter);
  const code = transformImportsWithMap(bundle.compiledCode, map);
  const mod = (await mdxRenderer.loadModuleESM(code)) as MDXModule;
  return mod.MDXLayout || mod.MainLayout || mod.default;
}

export async function applyTSXLayout(
  element: React.ReactElement,
  item: LayoutItem,
  tsxLayoutModuleCache: LayoutComponentCache,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<React.ReactElement> {
  try {
    const LayoutComponent = await loadTSXComponent(
      item.componentPath!,
      projectDir,
      tsxLayoutModuleCache,
      adapter,
    );
    return React.createElement(LayoutComponent, {}, element);
  } catch (e) {
    logger.error("Failed to compile/import TSX layout", e);

    throw e;
  }
}

export async function applyMDXLayout(
  element: React.ReactElement,
  bundle: MdxBundle,
  projectDir: string,
  mergedComponents: MDXComponents,
  adapter: RuntimeAdapter,
): Promise<React.ReactElement> {
  const LayoutFn = await loadMDXLayout(bundle, projectDir, adapter);
  if (LayoutFn) {
    const child = ensureValidChild(element);
    return React.createElement(LayoutFn, { components: mergedComponents }, child);
  }
  return element;
}

function ensureValidChild(child: React.ReactNode): React.ReactNode {
  if (React.isValidElement(child)) {
    logger.debug("[ensureValidChild] Valid React element", {
      type: getElementTypeName(child),
      isValidElement: true,
    });
    return child;
  }

  if (
    child === null || child === undefined || typeof child === "string" ||
    typeof child === "number" || Array.isArray(child)
  ) {
    logger.debug("[ensureValidChild] Valid primitive or array", { type: typeof child });
    return child;
  }

  if (child && typeof child === "object") {
    const debugInfo = getElementDebugInfo(child);
    logger.error("[ensureValidChild] Invalid child: object is not a React element", {
      keys: Object.keys(child).slice(0, 10),
      hasSymbol: debugInfo.hasSymbol,
      symbolValue: debugInfo.symbolValue,
      type: debugInfo.type,
    });
  }

  return null;
}
