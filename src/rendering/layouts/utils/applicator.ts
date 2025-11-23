import { rendererLogger as logger } from "@veryfront/utils";
import * as React from "react";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type {
  LayoutItem,
  MdxBundle,
  MDXComponents,
  MDXModule,
  ProviderItem,
} from "@veryfront/types";
import type { LayoutComponentCache } from "./component-loader.ts";
import { loadImportMap, transformImportsWithMap } from "@veryfront/modules/import-map/index.ts";
import { mdxRenderer } from "@veryfront/transforms/mdx/index.ts";
import { applyMDXLayout, applyTSXLayout, loadTSXComponent } from "./component-loader.ts";
import {
  getElementDebugInfo,
  getElementTypeName,
} from "../../element-validator/primitive-checks.ts";

export async function applyLayoutsESM(
  pageElement: React.ReactElement,
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  providerItems: ProviderItem[],
  projectDir: string,
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  adapter: RuntimeAdapter,
): Promise<React.ReactElement> {
  let element = pageElement;

  if (nestedLayouts.length > 0) {
    for (let i = nestedLayouts.length - 1; i >= 0; i--) {
      const item = nestedLayouts[i];
      if (!item) continue;
      try {
        if (item.kind === "mdx" && item.bundle?.compiledCode) {
          element = await applyMDXLayout(
            element,
            item.bundle,
            projectDir,
            mergedComponents,
            adapter,
          );
        } else if (item.kind === "tsx") {
          element = await applyTSXLayout(element, item, tsxLayoutModuleCache, projectDir, adapter);
        }
      } catch (e) {
        logger.error("Failed to apply nested layout:", e);
        throw e;
      }
    }
  }

  if (layoutBundle) {
    element = await applyMDXLayout(element, layoutBundle, projectDir, mergedComponents, adapter);
  }

  if (providerItems.length > 0) {
    element = await applyProviders(
      element,
      providerItems,
      projectDir,
      mergedComponents,
      tsxLayoutModuleCache,
      adapter,
    );
  }

  return element;
}

export async function applyLayoutsFunctionBody(
  pageElement: React.ReactElement,
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  providerItems: ProviderItem[],
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  projectDir: string,
  adapter: RuntimeAdapter,
): Promise<React.ReactElement> {
  let element = pageElement;

  logger.debug("Using function-body wrapping for layouts");
  logger.info("Nested layouts to apply:", {
    count: nestedLayouts.length,
    layouts: nestedLayouts.map((l) => ({
      kind: l.kind,
      path: l.componentPath || l.bundle?.compiledCode?.substring(0, 50),
    })),
  });

  if (nestedLayouts.length > 0) {
    for (let i = nestedLayouts.length - 1; i >= 0; i--) {
      const item = nestedLayouts[i];
      if (!item) continue;
      logger.info(`Applying layout ${i}:`, {
        kind: item.kind,
        path: item.componentPath,
      });
      if (item.kind === "mdx" && item.bundle?.compiledCode) {
        element = mdxRenderer.render(item.bundle.compiledCode, {
          components: mergedComponents,
          extractLayout: true,
          children: element,
        });
      } else if (item.kind === "tsx") {
        try {
          const LayoutComponent = await loadTSXComponent(
            item.componentPath!,
            projectDir,
            tsxLayoutModuleCache,
            adapter,
          );
          const child = ensureValidChild(element);
          logger.info("Applying TSX layout:", {
            layoutName: LayoutComponent.name || "Anonymous",
            childType: React.isValidElement(child) ? getElementTypeName(child) : typeof child,
          });
          element = React.createElement(LayoutComponent, undefined, child);
          logger.info("After TSX layout applied:", {
            pageElementType: React.isValidElement(element)
              ? getElementTypeName(element)
              : typeof element,
          });
        } catch (e) {
          logger.error("Failed to compile/import TSX layout (non-ESM path)", e);
          throw e;
        }
      }
    }
  }

  if (layoutBundle?.compiledCode) {
    element = mdxRenderer.render(layoutBundle.compiledCode, {
      components: mergedComponents,
      extractLayout: true,
      children: element,
    });
  }

  if (providerItems.length > 0) {
    // Reverse providers so lower priority wraps higher priority (outer wraps inner)
    for (const providerItem of [...providerItems].reverse()) {
      if (providerItem.kind === "mdx" && providerItem.bundle?.compiledCode) {
        element = mdxRenderer.render(providerItem.bundle.compiledCode, {
          components: mergedComponents,
          extractLayout: true,
          children: element,
        });
      } else if (providerItem.kind === "tsx") {
        try {
          const ProviderComponent = await loadTSXComponent(
            providerItem.componentPath!,
            projectDir,
            tsxLayoutModuleCache,
            adapter,
          );
          const child = ensureValidChild(element);
          logger.info("Applying TSX provider:", {
            providerName: ProviderComponent.name || "Anonymous",
            childType: React.isValidElement(child) ? getElementTypeName(child) : typeof child,
          });
          element = React.createElement(ProviderComponent, undefined, child);
        } catch (e) {
          logger.error("Failed to compile/import TSX provider (non-ESM path)", e);
          throw e;
        }
      }
    }
  }

  return element;
}

async function applyProviders(
  element: React.ReactElement,
  providerItems: ProviderItem[],
  projectDir: string,
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  adapter: RuntimeAdapter,
): Promise<React.ReactElement> {
  let result = element;
  // Reverse providers so lower priority wraps higher priority (outer wraps inner)
  for (const providerItem of [...providerItems].reverse()) {
    try {
      if (providerItem.kind === "mdx" && providerItem.bundle?.compiledCode) {
        // MDX provider: load via MDX renderer
        const providerImportMap = await loadImportMap(projectDir, adapter);
        const providerCode = transformImportsWithMap(
          providerItem.bundle.compiledCode,
          providerImportMap,
        );
        const providerModule = await mdxRenderer.loadModuleESM(providerCode);
        const providerMod = providerModule as MDXModule;
        const ProviderFn = providerMod.MDXLayout || providerMod.default;
        if (ProviderFn) {
          const child = ensureValidChild(result);
          logger.info("Applying MDX provider", {
            childIsElement: React.isValidElement(child),
          });
          result = React.createElement(
            ProviderFn as React.ComponentType<{ components?: MDXComponents }>,
            { components: mergedComponents },
            child,
          );
        }
      } else if (providerItem.kind === "tsx" && providerItem.componentPath) {
        // TSX provider: load via TSX loader
        const ProviderComponent = await loadTSXComponent(
          providerItem.componentPath,
          projectDir,
          tsxLayoutModuleCache,
          adapter,
        );
        const child = ensureValidChild(result);
        logger.info("Applying TSX provider", {
          providerName: ProviderComponent.name || "Anonymous",
          childIsElement: React.isValidElement(child),
        });
        result = React.createElement(ProviderComponent, undefined, child);
      }
    } catch (e) {
      logger.error("Failed to load ESM provider module:", e);
      throw e;
    }
  }
  return result;
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
