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
import { awaitAbortable, rendererLogger, throwIfAborted } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import {
  type DependencyPinningSourceInput,
  resolveProjectReactVersion,
} from "#veryfront/transforms/esm/package-registry.ts";
import type { ComponentRegistry } from "../ssr/component-registry.ts";
import type {
  RenderEnvironment,
  RenderModes,
} from "#veryfront/rendering/context/render-context.ts";

const logger = rendererLogger.component("layout-orchestrator");

export interface LayoutOrchestratorConfig {
  projectDir: string;
  projectId: string;
  projectSlug: string;
  contentSourceId: string;
  adapter: RuntimeAdapter;
  config: VeryfrontConfig;
  /** Compile vocabulary. Selects minification and tree shaking. */
  mode: "development" | "production";
  /**
   * Request vocabulary. Selects preview-only instrumentation. A hosted preview
   * render is mode "production" with environment "preview".
   */
  environment: RenderEnvironment;
  moduleServerUrl?: string;
  layoutCollector: LayoutCollector;
  layoutCompiler: LayoutCompiler;
  layoutCache: LayoutComponentCache;
  componentRegistry: MDXComponents | ComponentRegistry;
  /** Server-trusted local-project identity. */
  isLocalProject?: boolean;
}

function isSnapshotAwareComponentRegistry(
  value: MDXComponents | ComponentRegistry,
): value is ComponentRegistry {
  return typeof (value as ComponentRegistry).prepareDependencySnapshot ===
    "function";
}

export interface LayoutCollectionResult {
  layoutBundle: MdxBundle | undefined;
  nestedLayouts: LayoutItem[];
}

interface LayoutPreloadResult {
  type: "tsx" | "mdx" | "importMap";
  path?: string;
  success: boolean;
  error?: string;
}

interface LayoutPreloadSummary {
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
  private reactVersionPromise: Promise<string> | null = null;

  constructor(config: LayoutOrchestratorConfig) {
    this.config = config;
  }

  private get renderModes(): RenderModes {
    return { compileMode: this.config.mode, environment: this.config.environment };
  }

  private getReactVersion(
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
  ): Promise<string> {
    if (
      dependencyPinningDependencies !== undefined ||
      dependencyPinningCacheKey?.startsWith("on:")
    ) {
      return resolveProjectReactVersion({
        projectDir: this.config.projectDir,
        config: this.config.config,
        dependencyPinningCacheKey,
        dependencyPinningDependencies,
      });
    }

    this.reactVersionPromise ??= resolveProjectReactVersion({
      projectDir: this.config.projectDir,
      config: this.config.config,
    });
    return this.reactVersionPromise;
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
    clearImportMapCache(this.config.projectId);
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

  preloadLayoutModules(
    nestedLayouts: LayoutItem[],
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
    dependencyPinningSource?: DependencyPinningSourceInput,
    moduleServerOrigin?: string,
    signal?: AbortSignal,
    environment: RenderEnvironment = this.config.environment,
  ): Promise<LayoutPreloadSummary> {
    return withSpan(
      "layout.preloadModules",
      async () => {
        throwIfAborted(signal);
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

        const reactVersion = await this.getReactVersion(
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
        );

        logger.debug("Preloading layout modules", {
          tsxCount: tsxLayouts.length,
          mdxCount: mdxLayouts.length,
          tsxPaths: tsxLayouts.map((l) => l.componentPath),
        });

        const preloadPromises: Array<Promise<LayoutPreloadResult>> = [];

        if (mdxLayouts.length > 0) {
          preloadPromises.push(
            (async (): Promise<LayoutPreloadResult> => {
              try {
                const importMap = await awaitAbortable(
                  preloadImportMap(
                    this.config.projectDir,
                    this.config.adapter,
                    this.config.projectId,
                    {
                      projectDir: this.config.projectDir,
                      contentSourceId: this.config.contentSourceId,
                      config: this.config.config,
                    },
                  ),
                  signal,
                );
                this._preloadedImportMap = importMap;
                return { type: "importMap" as const, success: true };
              } catch (error) {
                throwIfAborted(signal);
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error("Failed to preload import map", {
                  error: errorMsg,
                  projectDir: this.config.projectDir,
                });
                this._preloadedImportMap = null;
                return { type: "importMap" as const, success: false, error: errorMsg };
              }
            })(),
          );
        }

        for (const layout of tsxLayouts) {
          const componentPath = layout.componentPath!;
          preloadPromises.push(
            (async (): Promise<LayoutPreloadResult> => {
              try {
                await loadTSXComponent(
                  componentPath,
                  this.config.projectDir,
                  this.config.layoutCache,
                  this.config.adapter,
                  this.config.projectId,
                  this.config.projectSlug,
                  this.config.contentSourceId,
                  { ...this.renderModes, environment },
                  reactVersion,
                  undefined,
                  dependencyPinningCacheKey,
                  dependencyPinningDependencies,
                  dependencyPinningSource,
                  moduleServerOrigin,
                  this.config.config.build?.serverExternalPackages,
                  signal,
                );
                return { type: "tsx" as const, path: componentPath, success: true };
              } catch (error) {
                throwIfAborted(signal);
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error("Failed to preload TSX layout", {
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
              }
            })(),
          );
        }

        for (const layout of mdxLayouts) {
          preloadPromises.push(
            (async (): Promise<LayoutPreloadResult> => {
              try {
                await preloadMDXLayoutModule({
                  bundle: layout.bundle!,
                  sourcePath: layout.path,
                  projectDir: this.config.projectDir,
                  adapter: this.config.adapter,
                  projectId: this.config.projectId,
                  projectSlug: this.config.projectSlug,
                  contentSourceId: this.config.contentSourceId,
                  modes: { ...this.renderModes, environment },
                  reactVersion,
                  dependencyPinningCacheKey,
                  dependencyPinningDependencies,
                  dependencyPinningSource,
                  moduleServerOrigin,
                  config: this.config.config,
                  isLocalProject: this.config.isLocalProject === true,
                  signal,
                });
                return { type: "mdx" as const, path: layout.path, success: true };
              } catch (error) {
                throwIfAborted(signal);
                const errorMsg = error instanceof Error ? error.message : String(error);
                logger.error("Failed to preload MDX layout", {
                  path: layout.path,
                  error: errorMsg,
                  hint: "Layout will be retried during apply phase",
                });
                return { type: "mdx" as const, path: layout.path, success: false, error: errorMsg };
              }
            })(),
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

        logger.debug("Preload complete", {
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
    params?: Record<string, string | string[]>,
    frontmatter?: Record<string, unknown>,
    headings?: Array<{ id: string; text: string; level: number }>,
    projectSlug?: string,
    clientPageIsland?: { clientLayoutPaths: readonly string[] },
    pageProps?: Record<string, unknown>,
    dependencyPinningCacheKey?: string,
    dependencyPinningDependencies?: Readonly<Record<string, string>>,
    dependencyPinningSource?: DependencyPinningSourceInput,
    signal?: AbortSignal,
    /**
     * Request environment for this render. Takes precedence over the
     * orchestrator's own, so a reused orchestrator never carries one render's
     * instrumentation into the next.
     */
    environment?: RenderEnvironment,
  ): Promise<React.ReactElement> {
    return withSpan(
      "layout.applyLayoutsAndWrappers",
      async () => {
        throwIfAborted(signal);
        const renderEnvironment = environment ?? this.config.environment;
        const reactVersion = await this.getReactVersion(
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
        );
        const registryComponents = isSnapshotAwareComponentRegistry(
            this.config.componentRegistry,
          )
          ? this.config.componentRegistry.getAllAsComponents(
            await this.config.componentRegistry.prepareDependencySnapshot(
              dependencyPinningCacheKey,
              dependencyPinningDependencies,
              dependencyPinningSource,
              requestUrl?.origin,
              this.config.config.build?.serverExternalPackages,
              renderEnvironment,
            ),
          )
          : this.config.componentRegistry;
        const mergedComponents = {
          ...createDefaultMDXComponents(),
          ...registryComponents,
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
          environment: renderEnvironment,
          moduleServerUrl: this.config.moduleServerUrl,
          requestUrl,
          params,
          frontmatter,
          pageProps,
          headings,
          reactVersion,
          dependencyPinningCacheKey,
          dependencyPinningDependencies,
          dependencyPinningSource,
          isLocalProject: this.config.isLocalProject === true,
          signal,
        });

        const pageType = pageElement.type;
        logger.debug("Before applyLayouts", {
          pageElementType: typeof pageType === "function" ? pageType.name : typeof pageType,
        });

        const result = await layoutApplicator.applyLayouts(
          pageElement,
          pageInfo,
          layoutBundle,
          nestedLayouts,
          layoutDataMap,
          clientPageIsland,
        );

        const resultType = result.type;
        logger.debug("After applyLayouts", {
          resultType: typeof resultType === "function" ? resultType.name : typeof resultType,
          isSameElement: result === pageElement,
        });

        return result;
      },
      { "layout.pagePath": pageInfo.entity.path, "layout.nestedCount": nestedLayouts.length },
    );
  }
}
