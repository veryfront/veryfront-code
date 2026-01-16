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
import { getElementTypeName } from "../../element-validator/primitive-checks.ts";
import { getProjectReact } from "@veryfront/react";
import { ensureValidChild } from "./ensure-valid-child.ts";

const IS_DENO = typeof (globalThis as { Deno?: unknown }).Deno !== "undefined";

/**
 * Transform bare npm imports to npm: specifiers for Deno SSR.
 *
 * IMPORTANT: React packages are NOT transformed to npm: specifiers.
 * They stay as bare specifiers so Deno resolves them via deno.json's import map.
 * This ensures all React code (page, providers, layouts) uses the same React instance,
 * preventing Symbol mismatches (React error #31).
 */
function transformBareImportsToNpm(code: string): string {
  if (!IS_DENO) return code;

  return code.replace(
    /from\s+["']([^"'./][^"']*)["']/g,
    (_match, specifier) => {
      if (
        specifier.startsWith("npm:") ||
        specifier.startsWith("http://") ||
        specifier.startsWith("https://") ||
        specifier.startsWith("file://") ||
        specifier.startsWith("node:")
      ) {
        return `from "${specifier}"`;
      }
      if (specifier.startsWith("@/")) {
        return `from "${specifier}"`;
      }
      // Don't transform React packages - let Deno resolve via import map
      // This ensures a single React instance across all modules
      if (
        specifier === "react" ||
        specifier.startsWith("react/") ||
        specifier === "react-dom" ||
        specifier.startsWith("react-dom/")
      ) {
        return `from "${specifier}"`;
      }
      logger.debug("[applicator] Transforming bare import to npm:", { specifier });
      return `from "npm:${specifier}"`;
    },
  );
}

/** Transform file:// local imports to module server URLs for Deno SSR */
function transformLocalFileImportsToModuleServer(code: string): string {
  if (!IS_DENO) return code;

  const port = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } })
    .Deno?.env?.get("PORT") || "3001";
  const cacheBuster = Date.now();

  return code.replace(
    /from\s+["'](file:\/\/[^"']+)["']/g,
    (_match, fileUrl) => {
      if (/\.(js|ts|tsx|jsx|mjs|cjs)$/.test(fileUrl)) {
        return `from "${fileUrl}"`;
      }

      const relativePath = fileUrl.replace(
        /file:\/\/.*?\/(?=shared\/|lib\/|components\/|features\/|app\/)/,
        "",
      );

      if (relativePath !== fileUrl) {
        const moduleUrl =
          `http://localhost:${port}/_vf_modules/${relativePath}.js?ssr=true&v=${cacheBuster}`;
        logger.debug("[applicator] Transforming file:// to module server:", {
          original: fileUrl,
          moduleUrl,
        });
        return `from "${moduleUrl}"`;
      }

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
  projectId?: string,
  projectSlug?: string,
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
            projectId,
            projectSlug,
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
            projectId,
          );
        }
      } catch (e) {
        logger.error("Failed to apply nested layout:", e);
        throw e;
      }
    }
  }

  if (layoutBundle) {
    logger.debug("[applyLayoutsESM] Applying named layoutBundle (frontmatter layout)");
    element = await applyMDXLayout(
      element,
      layoutBundle,
      projectDir,
      mergedComponents,
      adapter,
      projectId,
      projectSlug,
    );
    logger.debug("[applyLayoutsESM] Named layoutBundle applied successfully");
  } else {
    logger.debug("[applyLayoutsESM] No layoutBundle to apply");
  }

  if (providerItems.length > 0) {
    element = await applyProviders(
      element,
      providerItems,
      projectDir,
      mergedComponents,
      tsxLayoutModuleCache,
      adapter,
      projectId,
      projectSlug,
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
  projectId?: string,
  _projectSlug?: string,
): Promise<BundledReact.ReactElement> {
  const React = await getProjectReact();
  let element = pageElement;

  logger.debug("Using function-body wrapping for layouts");
  logger.debug("Nested layouts to apply:", {
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
      logger.debug(`Applying layout ${i}:`, {
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
            projectId,
          );
          const child = ensureValidChild(element, React);
          logger.debug("Applying TSX layout:", {
            layoutName: LayoutComponent.name || "Anonymous",
            childType: React.isValidElement(child)
              ? getElementTypeName(child as BundledReact.ReactElement)
              : typeof child,
          });
          const props = item.componentPath ? layoutDataMap?.get(item.componentPath) : undefined;
          element = React.createElement(LayoutComponent, props, child) as BundledReact.ReactElement;
          logger.debug("After TSX layout applied:", {
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
            projectId,
          );
          const child = ensureValidChild(element, React);
          logger.debug("Applying TSX provider:", {
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
  projectId?: string,
  projectSlug?: string,
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
        providerCode = transformBareImportsToNpm(providerCode);
        providerCode = transformLocalFileImportsToModuleServer(providerCode);
        const providerModule = await mdxRenderer.loadModuleESM(
          providerCode,
          adapter,
          projectId,
          projectDir,
          projectSlug,
        );
        const providerMod = providerModule as MDXModule;
        const ProviderFn = providerMod.MDXLayout || providerMod.default;
        if (ProviderFn) {
          const child = ensureValidChild(result, React);
          logger.debug("Applying MDX provider", {
            childIsElement: React.isValidElement(child),
          });
          result = React.createElement(
            ProviderFn as BundledReact.ComponentType<{ components?: MDXComponents }>,
            { components: mergedComponents },
            child,
          ) as BundledReact.ReactElement;
        }
      } else if (providerItem.kind === "tsx" && providerItem.componentPath) {
        const ProviderComponent = await loadTSXComponent(
          providerItem.componentPath,
          projectDir,
          tsxLayoutModuleCache,
          adapter,
          projectId,
        );
        const child = ensureValidChild(result, React);
        logger.debug("Applying TSX provider", {
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
