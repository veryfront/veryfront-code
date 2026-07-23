import { rendererLogger } from "#veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { LayoutComponentCache } from "./component-loader.ts";
import { applyMDXLayout, applyTSXLayout } from "./component-loader.ts";

const logger = rendererLogger.component("apply-layouts-esm");

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
  reactVersion?: string,
): Promise<BundledReact.ReactElement> {
  return withSpan(
    SpanNames.LAYOUT_APPLY_LAYOUTS_ESM,
    async () => {
      let element = pageElement;

      logger.debug("START", {
        projectSlug,
        nestedLayoutsCount: nestedLayouts.length,
        hasLayoutBundle: !!layoutBundle,
      });

      for (let i = nestedLayouts.length - 1; i >= 0; i--) {
        const item = nestedLayouts[i];
        if (!item) continue;

        logger.debug("Processing layout", {
          projectSlug,
          index: i,
          kind: item.kind,
          componentPath: item.componentPath,
          hasBundleCode: !!item.bundle?.compiledCode,
        });

        const spanAttrs = {
          "layout.index": i,
          "layout.kind": item.kind,
          "layout.path": item.componentPath || item.path || "",
        } as const;

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
                  reactVersion,
                ),
              spanAttrs,
            );
            continue;
          }

          if (item.kind !== "tsx") continue;

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
                reactVersion,
              ),
            spanAttrs,
          );
        } catch (e) {
          logger.error("Failed to apply nested layout:", e);
          throw e;
        }
      }

      logger.debug("All nested layouts applied", { projectSlug });

      if (!layoutBundle) {
        logger.debug("No layoutBundle to apply");
        return element;
      }

      logger.debug("Applying named layoutBundle (frontmatter layout)");
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
            reactVersion,
          ),
        { "layout.kind": "mdx", "layout.type": "named" },
      );
      logger.debug("Named layoutBundle applied successfully");

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
  reactVersion?: string,
  preloadedImportMap?: ImportMapConfig,
): Promise<BundledReact.ReactElement> {
  return await applyLayoutsESM(
    pageElement,
    layoutBundle,
    nestedLayouts,
    projectDir,
    mergedComponents,
    tsxLayoutModuleCache,
    adapter,
    layoutDataMap,
    projectId,
    projectSlug,
    contentSourceId,
    preloadedImportMap,
    reactVersion,
  );
}
