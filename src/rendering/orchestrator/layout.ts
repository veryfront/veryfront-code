import * as React from "react";
import type { EntityInfo, LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { ImportMapConfig } from "#veryfront/modules/import-map/types.ts";
import { LayoutApplicator } from "../layouts/index.ts";
import { createDefaultMDXComponents } from "../utils/index.ts";
import type { LayoutCollector, LayoutCompiler } from "../layouts/index.ts";
import type { LayoutComponentCache } from "../layouts/utils/component-loader.ts";
import { loadTSXComponent, preloadMDXLayoutModule } from "../layouts/utils/component-loader.ts";
import { clearImportMapCache, preloadImportMap } from "#veryfront/modules/import-map/index.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/index.ts";
import { rendererLogger as logger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

const log = logger.component("layout-orchestrator");

export interface LayoutOrchestratorConfig {
  projectDir: string;
  projectId: string;
  projectSlug: string;
  contentSourceId: string;
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

export interface LayoutPreloadResult {
  type: "tsx" | "mdx" | "importMap";
  path?: string;
  success: boolean;
  error?: string;
}

export interface LayoutPreloadSummary {
  tsxTotal: number;
  tsxSuccess: number;
  tsxFailures: Array<{ path: string; error: string }>;
  mdxTotal: number;
  mdxSuccess: number;
  mdxFailures: Array<{ path: string; error: string }>;
  importMapSuccess: boolean;
  importMapError?: string;
  durationMs: number;
  allSuccess: boolean;
}

export class LayoutOrchestrator {
  private config: LayoutOrchestratorConfig;
  private _preloadedImportMap: ImportMapConfig | null = null;

  constructor(config: LayoutOrchestratorConfig) {
    this.config = config;
  }

  getPreloadedImportMap(): ImportMapConfig | null {
    return this._preloadedImportMap;
  }

  clearCache(): void {
    if (this.config.layoutCache.clearForProject) {
      this.config.layoutCache.clearForProject(this.config.projectId);
    } else {
      this.config.layoutCache.clear();
    }
    clearSSRModuleCacheForProject(this.config.projectId);
    clearImportMapCache(this.config.projectDir);
    this._preloadedImportMap = null;
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

  preloadLayoutModules(nestedLayouts: LayoutItem[]): Promise<LayoutPreloadSummary> {
    return withSpan(
      "layout.preloadModules",
      async () => {
        const tsxLayouts = nestedLayouts.filter(
          (layout) => layout.kind === "tsx" && layout.componentPath,
        );
        const mdxLayouts = nestedLayouts.filter((layout) => layout.kind === "mdx" && layout.bundle);

        const preloadStart = performance.now();

        if (tsxLayouts.length === 0 && mdxLayouts.length === 0) {
          return {
            tsxTotal: 0,
            tsxSuccess: 0,
            tsxFailures: [],
            mdxTotal: 0,
            mdxSuccess: 0,
            mdxFailures: [],
            importMapSuccess: true,
            durationMs: 0,
            allSuccess: true,
          };
        }

        log.debug("Preloading layout modules", {
          tsxCount: tsxLayouts.length,
          mdxCount: mdxLayouts.length,
          tsxPaths: tsxLayouts.map((l) => l.componentPath),
        });

        const preloadPromises: Array<Promise<LayoutPreloadResult>> = [];

        if (mdxLayouts.length > 0) {
          preloadPromises.push(
            preloadImportMap(this.config.projectDir, this.config.adapter)
              .then((importMap) => {
                this._preloadedImportMap = importMap;
                return { type: "importMap" as const, success: true };
              })
              .catch((error) => {
                const errorMsg = error instanceof Error ? error.message : String(error);
                log.error("Failed to preload import map", {
                  error: errorMsg,
                  projectDir: this.config.projectDir,
                });
                this._preloadedImportMap = null;
                return { type: "importMap" as const, success: false, error: errorMsg };
              }),
          );
        }

        for (const layout of tsxLayouts) {
          const componentPath = layout.componentPath!;
          preloadPromises.push(
            loadTSXComponent(
              componentPath,
              this.config.projectDir,
              this.config.layoutCache,
              this.config.adapter,
              this.config.projectId,
              this.config.projectSlug,
              this.config.contentSourceId,
            )
              .then(() => ({ type: "tsx" as const, path: componentPath, success: true }))
              .catch((error) => {
                const errorMsg = error instanceof Error ? error.message : String(error);
                log.error("Failed to preload TSX layout", {
                  path: componentPath,
                  error: errorMsg,
                  hint: "Layout will be retried during apply phase",
                });
                return {
                  type: "tsx" as const,
                  path: componentPath,
                  success: false,
                  error: errorMsg,
                };
              }),
          );
        }

        for (const layout of mdxLayouts) {
          preloadPromises.push(
            preloadMDXLayoutModule(
              layout.bundle!,
              this.config.projectDir,
              this.config.adapter,
              this.config.projectId,
              this.config.projectSlug,
              this.config.contentSourceId,
            )
              .then(() => ({ type: "mdx" as const, path: layout.path, success: true }))
              .catch((error) => {
                const errorMsg = error instanceof Error ? error.message : String(error);
                log.error("Failed to preload MDX layout", {
                  path: layout.path,
                  error: errorMsg,
                  hint: "Layout will be retried during apply phase",
                });
                return { type: "mdx" as const, path: layout.path, success: false, error: errorMsg };
              }),
          );
        }

        const results = await Promise.all(preloadPromises);

        const tsxResults = results.filter(
          (r): r is LayoutPreloadResult & { type: "tsx" } => r.type === "tsx",
        );
        const mdxResults = results.filter(
          (r): r is LayoutPreloadResult & { type: "mdx" } => r.type === "mdx",
        );
        const importMapResult = results.find(
          (r): r is LayoutPreloadResult & { type: "importMap" } => r.type === "importMap",
        );

        const tsxFailures = tsxResults
          .filter((r) => !r.success && r.path && r.error)
          .map((r) => ({ path: r.path!, error: r.error! }));

        const mdxFailures = mdxResults
          .filter((r) => !r.success && r.path && r.error)
          .map((r) => ({ path: r.path!, error: r.error! }));

        const importMapSuccess = importMapResult?.success ?? true;

        const summary: LayoutPreloadSummary = {
          tsxTotal: tsxResults.length,
          tsxSuccess: tsxResults.filter((r) => r.success).length,
          tsxFailures,
          mdxTotal: mdxResults.length,
          mdxSuccess: mdxResults.filter((r) => r.success).length,
          mdxFailures,
          importMapSuccess,
          importMapError: importMapResult?.error,
          durationMs: Math.round(performance.now() - preloadStart),
          allSuccess: tsxFailures.length === 0 && mdxFailures.length === 0 && importMapSuccess,
        };

        log.debug("Preload complete", {
          ...summary,
          duration: `${summary.durationMs}ms`,
        });

        return summary;
      },
      {
        "layout.preloadCount": nestedLayouts.length,
        "layout.tsxCount": nestedLayouts.filter((l) => l.kind === "tsx").length,
        "layout.mdxCount": nestedLayouts.filter((l) => l.kind === "mdx").length,
      },
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
          preloadedImportMap: this._preloadedImportMap,
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
        log.debug("Before applyLayouts", {
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
        log.debug("After applyLayouts", {
          resultType: typeof resultType === "function" ? resultType.name : typeof resultType,
          isSameElement: result === pageElement,
        });

        return result;
      },
      { "layout.pagePath": pageInfo.entity.path, "layout.nestedCount": nestedLayouts.length },
    );
  }
}
