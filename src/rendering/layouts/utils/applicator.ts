import { rendererLogger as logger } from "@veryfront/utils";
import * as BundledReact from "react";
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
import { getProjectReact } from "@veryfront/react";

export async function applyLayoutsESM(
  pageElement: BundledReact.ReactElement,
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  providerItems: ProviderItem[],
  projectDir: string,
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  adapter: RuntimeAdapter,
  layoutDataMap?: Map<string, Record<string, unknown>>,
): Promise<BundledReact.ReactElement> {
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
          const props = item.componentPath ? layoutDataMap?.get(item.componentPath) : undefined;
          element = await applyTSXLayout(
            element,
            item,
            tsxLayoutModuleCache,
            projectDir,
            adapter,
            props,
          );
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
  pageElement: BundledReact.ReactElement,
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  providerItems: ProviderItem[],
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  projectDir: string,
  adapter: RuntimeAdapter,
  layoutDataMap?: Map<string, Record<string, unknown>>,
): Promise<BundledReact.ReactElement> {
  const React = await getProjectReact();
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
          const child = ensureValidChild(element, React);
          logger.info("Applying TSX layout:", {
            layoutName: LayoutComponent.name || "Anonymous",
            childType: React.isValidElement(child)
              ? getElementTypeName(child as BundledReact.ReactElement)
              : typeof child,
          });
          const props = item.componentPath ? layoutDataMap?.get(item.componentPath) : undefined;
          element = React.createElement(LayoutComponent, props, child) as BundledReact.ReactElement;
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
          const child = ensureValidChild(element, React);
          logger.info("Applying TSX provider:", {
            providerName: ProviderComponent.name || "Anonymous",
            childType: React.isValidElement(child)
              ? getElementTypeName(child as BundledReact.ReactElement)
              : typeof child,
          });
          element = React.createElement(
            ProviderComponent,
            undefined,
            child,
          ) as BundledReact.ReactElement;
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
  element: BundledReact.ReactElement,
  providerItems: ProviderItem[],
  projectDir: string,
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  adapter: RuntimeAdapter,
): Promise<BundledReact.ReactElement> {
  const React = await getProjectReact();
  let result = element;
  for (const providerItem of [...providerItems].reverse()) {
    try {
      if (providerItem.kind === "mdx" && providerItem.bundle?.compiledCode) {
        const providerImportMap = await loadImportMap(projectDir, adapter);
        const providerCode = transformImportsWithMap(
          providerItem.bundle.compiledCode,
          providerImportMap,
        );
        const providerModule = await mdxRenderer.loadModuleESM(providerCode);
        const providerMod = providerModule as MDXModule;
        const ProviderFn = providerMod.MDXLayout || providerMod.default;
        if (ProviderFn) {
          const child = ensureValidChild(result, React);
          logger.info("Applying MDX provider", {
            childIsElement: React.isValidElement(child),
          });
          result = React.createElement(
            ProviderFn as BundledReact.ComponentType<{ components?: MDXComponents }>,
            { components: mergedComponents },
            child,
          ) as BundledReact.ReactElement;
        }
      } else if (providerItem.kind === "tsx" && providerItem.componentPath) {
        // TSX provider: load via TSX loader
        const ProviderComponent = await loadTSXComponent(
          providerItem.componentPath,
          projectDir,
          tsxLayoutModuleCache,
          adapter,
        );
        const child = ensureValidChild(result, React);
        logger.info("Applying TSX provider", {
          providerName: ProviderComponent.name || "Anonymous",
          childIsElement: React.isValidElement(child),
        });
        result = React.createElement(
          ProviderComponent,
          undefined,
          child,
        ) as BundledReact.ReactElement;
      }
    } catch (e) {
      logger.error("Failed to load ESM provider module:", e);
      throw e;
    }
  }
  return result;
}

function ensureValidChild(
  child: BundledReact.ReactNode,
  React: typeof BundledReact,
): BundledReact.ReactNode {
  if (React.isValidElement(child)) {
    logger.debug("[ensureValidChild] Valid React element", {
      type: getElementTypeName(child as BundledReact.ReactElement),
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
