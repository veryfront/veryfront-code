import { rendererLogger as logger } from "../../../utils/index.js";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import type { LayoutItem, MdxBundle, MDXComponents } from "../../../types/index.js";
import type { ImportMapConfig } from "../../../modules/import-map/types.js";
import { withSpan } from "../../../observability/tracing/otlp-setup.js";
import { SpanNames } from "../../../observability/tracing/span-names.js";
import type { LayoutComponentCache } from "./component-loader.js";
import { mdxRenderer } from "../../../transforms/mdx/index.js";
import { applyMDXLayout, applyTSXLayout, loadTSXComponent } from "./component-loader.js";
import { getElementTypeName } from "../../element-validator/primitive-checks.js";
import { getProjectReact } from "../../../react/index.js";
import { ensureValidChild } from "./ensure-valid-child.js";

export function applyLayoutsESM(
  pageElement: BundledReact.ReactElement,
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  projectDir: string,
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  adapter: RuntimeAdapter,
  layoutDataMap: Map<string, Record<string, unknown>> | undefined,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
  preloadedImportMap?: ImportMapConfig,
): Promise<BundledReact.ReactElement> {
  return withSpan(
    SpanNames.LAYOUT_APPLY_LAYOUTS_ESM,
    async () => {
      let element = pageElement;

      logger.debug("[applyLayoutsESM] START", {
        projectSlug,
        nestedLayoutsCount: nestedLayouts.length,
        hasLayoutBundle: !!layoutBundle,
      });

      for (let i = nestedLayouts.length - 1; i >= 0; i--) {
        const item = nestedLayouts[i];
        if (!item) continue;

        logger.debug("[applyLayoutsESM] Processing layout", {
          projectSlug,
          index: i,
          kind: item.kind,
          componentPath: item.componentPath,
          hasBundleCode: !!item.bundle?.compiledCode,
        });

        try {
          if (item.kind === "mdx" && item.bundle?.compiledCode) {
            element = await withSpan(
              SpanNames.LAYOUT_APPLY_MDX,
              () =>
                applyMDXLayout(
                  element,
                  item.bundle!,
                  projectDir,
                  mergedComponents,
                  adapter,
                  projectId,
                  projectSlug,
                  contentSourceId,
                  preloadedImportMap,
                ),
              {
                "layout.index": i,
                "layout.kind": "mdx",
                "layout.path": item.componentPath || item.path || "",
              },
            );
            continue;
          }

          if (item.kind === "tsx") {
            const props = item.componentPath ? layoutDataMap?.get(item.componentPath) : undefined;
            element = await withSpan(
              SpanNames.LAYOUT_APPLY_TSX,
              () =>
                applyTSXLayout(
                  element,
                  item,
                  tsxLayoutModuleCache,
                  projectDir,
                  adapter,
                  props,
                  projectId,
                  projectSlug,
                  contentSourceId,
                ),
              {
                "layout.index": i,
                "layout.kind": "tsx",
                "layout.path": item.componentPath || item.path || "",
              },
            );
          }
        } catch (e) {
          logger.error("Failed to apply nested layout:", e);
          throw e;
        }
      }

      logger.debug("[applyLayoutsESM] All nested layouts applied", { projectSlug });

      if (!layoutBundle) {
        logger.debug("[applyLayoutsESM] No layoutBundle to apply");
        return element;
      }

      logger.debug("[applyLayoutsESM] Applying named layoutBundle (frontmatter layout)");
      element = await withSpan(
        SpanNames.LAYOUT_APPLY_MDX,
        () =>
          applyMDXLayout(
            element,
            layoutBundle,
            projectDir,
            mergedComponents,
            adapter,
            projectId,
            projectSlug,
            contentSourceId,
            preloadedImportMap,
          ),
        { "layout.kind": "mdx", "layout.type": "named" },
      );
      logger.debug("[applyLayoutsESM] Named layoutBundle applied successfully");

      return element;
    },
    {
      "layout.nested_count": nestedLayouts.length,
      "layout.has_bundle": !!layoutBundle,
      "layout.project_slug": projectSlug || "",
    },
  );
}

export async function applyLayoutsFunctionBody(
  pageElement: BundledReact.ReactElement,
  layoutBundle: MdxBundle | undefined,
  nestedLayouts: LayoutItem[],
  mergedComponents: MDXComponents,
  tsxLayoutModuleCache: LayoutComponentCache,
  projectDir: string,
  adapter: RuntimeAdapter,
  layoutDataMap: Map<string, Record<string, unknown>> | undefined,
  projectId: string,
  projectSlug: string,
  contentSourceId: string,
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
      continue;
    }

    if (item.kind !== "tsx" || !item.componentPath) continue;

    try {
      const LayoutComponent = await loadTSXComponent(
        item.componentPath,
        projectDir,
        tsxLayoutModuleCache,
        adapter,
        projectId,
        projectSlug,
        contentSourceId,
      );

      const child = ensureValidChild(element, React);

      logger.debug("Applying TSX layout:", {
        layoutName: LayoutComponent.name || "Anonymous",
        childType: React.isValidElement(child) ? getElementTypeName(child) : typeof child,
      });

      const props = layoutDataMap?.get(item.componentPath);
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

  if (layoutBundle?.compiledCode) {
    element = mdxRenderer.render(layoutBundle.compiledCode, {
      components: mergedComponents,
      extractLayout: true,
      children: element,
    });
  }

  return element;
}
