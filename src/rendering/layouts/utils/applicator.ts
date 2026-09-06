import { rendererLogger } from "#veryfront/utils";
import * as BundledReact from "react";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { SpanNames } from "#veryfront/observability";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import type { LayoutComponentCache } from "./component-loader.ts";
import { applyMDXLayout, applyTSXLayout } from "./component-loader.ts";
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";
import type { RenderModes } from "#veryfront/rendering/context/render-context.ts";
import { COMPILATION_ERROR } from "#veryfront/errors";

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
  modes: RenderModes,
  preloadedImportMap?: ImportMapConfig,
  reactVersion?: string,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
  config?: VeryfrontConfig,
  isLocalProject?: boolean,
  signal?: AbortSignal,
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
                applyMDXLayout({
                  element,
                  bundle: item.bundle!,
                  sourcePath: item.path,
                  projectDir,
                  mergedComponents,
                  adapter,
                  projectId,
                  projectSlug,
                  contentSourceId,
                  modes,
                  preloadedImportMap,
                  reactVersion,
                  dependencyPinningCacheKey,
                  dependencyPinningDependencies,
                  dependencyPinningSource,
                  moduleServerOrigin,
                  config,
                  isLocalProject,
                  signal,
                }),
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
                modes,
                reactVersion,
                dependencyPinningCacheKey,
                dependencyPinningDependencies,
                dependencyPinningSource,
                moduleServerOrigin,
                config?.build?.serverExternalPackages,
                signal,
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
          applyMDXLayout({
            element,
            bundle: layoutBundle,
            projectDir,
            mergedComponents,
            adapter,
            projectId,
            projectSlug,
            contentSourceId,
            modes,
            preloadedImportMap,
            reactVersion,
            dependencyPinningCacheKey,
            dependencyPinningDependencies,
            dependencyPinningSource,
            moduleServerOrigin,
            config,
            isLocalProject,
            signal,
          }),
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

/**
 * Rejects a legacy function-body layout bundle before it reaches the ESM
 * loader, where its top-level `return` would surface as an opaque syntax
 * error. A compiled ESM bundle always contains an `export`; a function-body
 * bundle produces its layout with a top-level `return` instead.
 */
function assertESMLayoutBundle(compiledCode: string | undefined, source: string): void {
  if (!compiledCode) return;
  if (/\bexport\b/.test(compiledCode) || !/\breturn\b/.test(compiledCode)) return;
  throw COMPILATION_ERROR.create({
    detail: `applyLayoutsFunctionBody received a legacy function-body layout bundle (${source}). ` +
      "Compiled layout code must be an ES module (e.g. `export default Layout`); " +
      "the synchronous function-body evaluator was removed for security reasons. " +
      "Recompile the layout with the current MDX pipeline, or migrate to applyLayoutsESM.",
  });
}

/**
 * Compatibility alias for layout application through the secure ESM loader.
 *
 * Accepts the same bundle format as {@link applyLayoutsESM}: compiled layout
 * code must be an ES module. Legacy function-body bundles (top-level
 * `return { default: Layout }`) are rejected with a migration error; their
 * synchronous evaluator was removed for security reasons and pre-dates this
 * alias delegating to the ESM path.
 *
 * @deprecated Use {@link applyLayoutsESM}.
 */
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
  modes: RenderModes,
  reactVersion?: string,
  dependencyPinningCacheKey?: string,
  dependencyPinningDependencies?: Readonly<Record<string, string>>,
  dependencyPinningSource?: DependencyPinningSourceInput,
  moduleServerOrigin?: string,
  config?: VeryfrontConfig,
  signal?: AbortSignal,
  isLocalProject?: boolean,
): Promise<BundledReact.ReactElement> {
  assertESMLayoutBundle(layoutBundle?.compiledCode, "named layout");
  for (let index = 0; index < nestedLayouts.length; index++) {
    const item = nestedLayouts[index]!;
    if (item.kind !== "mdx") continue;
    assertESMLayoutBundle(
      item.bundle?.compiledCode,
      `nested layout ${index + 1}`,
    );
  }

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
    modes,
    undefined,
    reactVersion,
    dependencyPinningCacheKey,
    dependencyPinningDependencies,
    dependencyPinningSource,
    moduleServerOrigin,
    config,
    isLocalProject,
    signal,
  );
}
