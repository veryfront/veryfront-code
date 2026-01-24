import * as React from "react";
import type { EntityInfo, LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { LayoutApplicator } from "../layouts/index.ts";
import { createDefaultMDXComponents } from "../utils/index.ts";
import type { LayoutCollector, LayoutCompiler } from "../layouts/index.ts";
import type { LayoutComponentCache } from "../layouts/utils/component-loader.ts";
import { loadTSXComponent } from "../layouts/utils/component-loader.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

export interface LayoutOrchestratorConfig {
  projectDir: string;
  projectId?: string;
  /** Project slug for HTTP fallback in multi-project mode */
  projectSlug?: string;
  /** Content source identifier for cache isolation (branch name or release ID) */
  contentSourceId?: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  mode: "development" | "production";
  moduleServerUrl?: string;
  layoutCollector: LayoutCollector;
  layoutCompiler: LayoutCompiler;
  layoutCache: LayoutComponentCache;
  componentRegistry: MDXComponents;
}

export interface LayoutCollectionResult {
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
}

export class LayoutOrchestrator {
  private config: LayoutOrchestratorConfig;

  constructor(config: LayoutOrchestratorConfig) {
    this.config = config;
  }

  clearCache(): void {
    this.config.layoutCache.clear();
    clearSSRModuleCacheForProject(this.config.projectId ?? this.config.projectDir);
  }

  collectLayouts(pageInfo: EntityInfo): Promise<LayoutCollectionResult> {
    return withSpan(
      "layout.collectLayouts",
      async () => {
        const result = await this.config.layoutCollector.collectLayouts(pageInfo);
        await this.config.layoutCompiler.compileLayouts(result.nestedLayouts);
        return result;
      },
      { "layout.pagePath": pageInfo.entity.path },
    );
  }

  preloadLayoutModules(nestedLayouts: LayoutItem[]): Promise<void> {
    return withSpan(
      "layout.preloadModules",
      async () => {
        const tsxLayouts = nestedLayouts.filter(
          (layout) => layout.kind === "tsx" && layout.componentPath,
        );

        if (!tsxLayouts.length) {
          return;
        }

        const preloadStart = performance.now();
        logger.debug("[LayoutOrchestrator] Preloading TSX layout modules", {
          count: tsxLayouts.length,
          paths: tsxLayouts.map((l) => l.componentPath),
        });

        const results = await Promise.all(
          tsxLayouts.map(async (layout) => {
            const componentPath = layout.componentPath!;

            try {
              await loadTSXComponent(
                componentPath,
                this.config.projectDir,
                this.config.layoutCache,
                this.config.adapter,
                this.config.projectId,
                this.config.contentSourceId,
              );
              return { path: componentPath, success: true };
            } catch (error) {
              // Log but don't throw - preload failures will be handled during actual application
              logger.warn(
                "[LayoutOrchestrator] Failed to preload layout (will retry during apply)",
                {
                  path: componentPath,
                  error: error instanceof Error ? error.message : String(error),
                },
              );
              return { path: componentPath, success: false };
            }
          }),
        );

        const successCount = results.filter((r) => r.success).length;

        logger.debug("[LayoutOrchestrator] Preload complete", {
          total: tsxLayouts.length,
          success: successCount,
          failed: tsxLayouts.length - successCount,
          duration: `${(performance.now() - preloadStart).toFixed(2)}ms`,
        });
      },
      { "layout.preloadCount": nestedLayouts.length },
    );
  }

  applyLayoutsAndWrappers(
    pageElement: React.ReactElement,
    pageInfo: EntityInfo,
    layoutBundle: MdxBundle | undefined,
    nestedLayouts: LayoutItem[],
    layoutDataMap?: Map<string, Record<string, unknown>>,
    requestUrl?: URL,
    frontmatter?: Record<string, unknown>,
    headings?: Array<{ id: string; text: string; level: number }>,
    projectSlug?: string,
  ): Promise<React.ReactElement> {
    return withSpan(
      "layout.applyLayoutsAndWrappers",
      async () => {
        const mergedComponents = {
          ...createDefaultMDXComponents(),
          ...this.config.componentRegistry,
        };

        const layoutApplicator = new LayoutApplicator({
          projectDir: this.config.projectDir,
          projectId: this.config.projectId,
          projectSlug: projectSlug ?? this.config.projectSlug,
          contentSourceId: this.config.contentSourceId,
          adapter: this.config.adapter,
          config: this.config.config,
          layoutCache: this.config.layoutCache,
          mergedComponents,
          mode: this.config.mode,
          moduleServerUrl: this.config.moduleServerUrl,
          requestUrl,
          frontmatter,
          headings,
        });

        const pageType = pageElement.type;
        logger.debug("[LayoutOrchestrator] Before applyLayouts", {
          pageElementType: typeof pageType === "function" ? pageType.name : typeof pageType,
        });

        const result = await layoutApplicator.applyLayouts(
          pageElement,
          pageInfo,
          layoutBundle,
          nestedLayouts,
          layoutDataMap,
        );

        const resultType = result.type;
        logger.debug("[LayoutOrchestrator] After applyLayouts", {
          resultType: typeof resultType === "function" ? resultType.name : typeof resultType,
          isSameElement: result === pageElement,
        });

        return result;
      },
      { "layout.pagePath": pageInfo.entity.path, "layout.nestedCount": nestedLayouts.length },
    );
  }
}
