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

// Check if running in Deno (not Node.js)
const IS_DENO = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";

/**
 * Transform bare npm imports to npm: specifiers for Deno SSR.
 * Bare imports are those that don't start with: . / http:// https:// npm: file:// node://
 */
function transformBareImportsToNpm(code: string): string {
  if (!IS_DENO) return code;

  return code.replace(
    /from\s+["']([^"'./][^"']*)["']/g,
    (_match, specifier) => {
      // Skip if already has protocol prefix
      if (
        specifier.startsWith("npm:") ||
        specifier.startsWith("http://") ||
        specifier.startsWith("https://") ||
        specifier.startsWith("file://") ||
        specifier.startsWith("node:")
      ) {
        return `from "${specifier}"`;
      }
      // Skip @/ path aliases - these are project-relative paths, not npm packages
      if (specifier.startsWith("@/")) {
        return `from "${specifier}"`;
      }
      // Convert bare import to npm: specifier
      logger.debug("[applicator] Transforming bare import to npm:", { specifier });
      return `from "npm:${specifier}"`;
    },
  );
}

/**
 * Transform file:// local imports to module server URLs for Deno SSR.
 * These file:// paths don't have extensions and point to the wrong directory.
 * Convert them to module server URLs which can properly resolve and transform the files.
 */
function transformLocalFileImportsToModuleServer(code: string): string {
  if (!IS_DENO) return code;

  const port = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } })
    .Deno?.env?.get("PORT") || "3001";
  const cacheBuster = Date.now();

  // Match file:// imports that look like local project files (without extension)
  // Pattern: file:///path/to/project/relative/path (no .js/.ts extension at end)
  return code.replace(
    /from\s+["'](file:\/\/[^"']+)["']/g,
    (_match, fileUrl) => {
      // Skip if already has an extension
      if (/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(fileUrl)) {
        return `from "${fileUrl}"`;
      }

      // Extract the relative path from the file:// URL
      // Look for common project path patterns like /shared/, /lib/, /components/, /features/, /app/
      const relativePath = fileUrl.replace(
        /file:\/\/.*?\/(?=shared\/|lib\/|components\/|features\/|app\/)/,
        "",
      );

      if (relativePath !== fileUrl) {
        // Found a recognizable project path - use module server
        const moduleUrl =
          `http://localhost:${port}/_vf_modules/${relativePath}.js?ssr=true&v=${cacheBuster}`;
        logger.debug("[applicator] Transforming file:// to module server:", {
          original: fileUrl,
          moduleUrl,
        });
        return `from "${moduleUrl}"`;
      }

      // If no recognizable pattern, leave as-is
      return `from "${fileUrl}"`;
    },
  );
}

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
    logger.info("[applyLayoutsESM] Applying named layoutBundle (frontmatter layout)");
    element = await applyMDXLayout(element, layoutBundle, projectDir, mergedComponents, adapter);
    logger.info("[applyLayoutsESM] Named layoutBundle applied successfully");
  } else {
    logger.info("[applyLayoutsESM] No layoutBundle to apply");
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
      } else if (item.kind === "tsx" && item.componentPath) {
        try {
          const LayoutComponent = await loadTSXComponent(
            item.componentPath,
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
      } else if (providerItem.kind === "tsx" && providerItem.componentPath) {
        try {
          const ProviderComponent = await loadTSXComponent(
            providerItem.componentPath,
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
        let providerCode = transformImportsWithMap(
          providerItem.bundle.compiledCode,
          providerImportMap,
        );
        // Transform any remaining bare imports to npm: specifiers for Deno SSR
        providerCode = transformBareImportsToNpm(providerCode);
        // Transform file:// local imports to module server URLs for Deno SSR
        providerCode = transformLocalFileImportsToModuleServer(providerCode);
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
