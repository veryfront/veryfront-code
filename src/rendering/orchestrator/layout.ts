import * as React from "react";
import type { EntityInfo, LayoutItem, MdxBundle, MDXComponents } from "#veryfront/types";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import { LayoutApplicator } from "../layouts/index.ts";
import { createDefaultMDXComponents } from "../utils/index.ts";
import type { LayoutCollector, LayoutCompiler } from "../layouts/index.ts";
import type { LayoutComponentCache } from "../layouts/utils/component-loader.ts";
import { loadMDXLayout, loadTSXComponent } from "../layouts/utils/component-loader.ts";
import {
  assertImportMapIdentity,
  clearImportMapCache,
  createImportMapIdentity,
  type ImportMapIdentity,
  preloadImportMap,
} from "#veryfront/modules/import-map/index.ts";
import { clearSSRModuleCacheForProject } from "#veryfront/modules/react-loader/index.ts";
import { rendererLogger } from "#veryfront/utils";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { resolveProjectReactVersion } from "#veryfront/transforms/esm/package-registry.ts";

const logger = rendererLogger.component("layout-orchestrator");
const ObjectFreeze = Object.freeze;

type AsyncOutcome<T> =
  | { readonly success: true; readonly value: T }
  | { readonly success: false; readonly error: unknown };

async function captureAsyncOutcome<T>(
  operation: () => Promise<T>,
): Promise<AsyncOutcome<T>> {
  try {
    return { success: true, value: await operation() };
  } catch (error) {
    return { success: false, error };
  }
}

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

export interface LayoutRequestOverrides {
  projectId?: string;
  projectSlug?: string;
  contentSourceId?: string;
}

export interface LayoutRequestIdentity {
  readonly projectId: string;
  readonly projectSlug: string;
  readonly contentSourceId: string;
  readonly importMapIdentity: ImportMapIdentity;
}

interface LayoutPreloadResult {
  type: "tsx" | "mdx";
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
  requestIdentity: LayoutRequestIdentity;
}

export class LayoutOrchestrator {
  private config: LayoutOrchestratorConfig;
  private reactVersionPromise: Promise<string> | null = null;

  constructor(config: LayoutOrchestratorConfig) {
    this.config = config;
  }

  private getReactVersion(): Promise<string> {
    this.reactVersionPromise ??= resolveProjectReactVersion({
      projectDir: this.config.projectDir,
      config: this.config.config,
    });
    return this.reactVersionPromise;
  }

  clearCache(): void {
    if (this.config.layoutCache.clearForProject) {
      this.config.layoutCache.clearForProject(this.config.projectId);
    } else {
      this.config.layoutCache.clear();
    }
    clearSSRModuleCacheForProject(this.config.projectId);
    clearImportMapCache(this.config.projectId);
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
    overrides: LayoutRequestOverrides = {},
  ): Promise<LayoutPreloadSummary> {
    return withSpan(
      "layout.preloadModules",
      async () => {
        const tsxLayouts = nestedLayouts.filter(
          (layout) => layout.kind === "tsx" && layout.componentPath,
        );
        const mdxLayouts = nestedLayouts.filter((layout) => layout.kind === "mdx" && layout.bundle);

        const preloadStart = performance.now();
        const projectId = overrides.projectId ?? this.config.projectId;
        const projectSlug = overrides.projectSlug ?? this.config.projectSlug;
        const contentSourceId = overrides.contentSourceId ?? this.config.contentSourceId;

        // Start both prerequisites before awaiting either. Capturing each outcome
        // immediately keeps a fast rejection observed while its sibling settles.
        const reactVersionOutcomePromise = captureAsyncOutcome(() => this.getReactVersion());
        const importMapIdentityOutcomePromise = captureAsyncOutcome(async () => {
          const importMap = await preloadImportMap(
            this.config.projectDir,
            this.config.adapter,
            projectId,
            {
              contentSourceId,
              config: this.config.config,
            },
          );
          const importMapIdentity = await createImportMapIdentity(importMap);
          return importMapIdentity;
        });
        const reactVersionOutcome = await reactVersionOutcomePromise;
        const importMapIdentityOutcome = await importMapIdentityOutcomePromise;
        if (!reactVersionOutcome.success) throw reactVersionOutcome.error;
        if (!importMapIdentityOutcome.success) throw importMapIdentityOutcome.error;

        const reactVersion = reactVersionOutcome.value;
        const importMapIdentity = importMapIdentityOutcome.value;
        const requestIdentity: LayoutRequestIdentity = ObjectFreeze({
          projectId,
          projectSlug,
          contentSourceId,
          importMapIdentity,
        });

        logger.debug("Preloading layout modules", {
          tsxCount: tsxLayouts.length,
          mdxCount: mdxLayouts.length,
          tsxPaths: tsxLayouts.map((l) => l.componentPath),
        });

        const preloadPromises: Array<Promise<LayoutPreloadResult>> = [];

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
                  projectId,
                  projectSlug,
                  contentSourceId,
                  reactVersion,
                  importMapIdentity.importMap,
                );
                return { type: "tsx" as const, path: componentPath, success: true };
              } catch (error) {
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
                await loadMDXLayout(
                  layout.bundle!,
                  this.config.projectDir,
                  this.config.adapter,
                  projectId,
                  projectSlug,
                  contentSourceId,
                  importMapIdentity.importMap,
                  reactVersion,
                );
                return { type: "mdx" as const, path: layout.path, success: true };
              } catch (error) {
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

        const results: LayoutPreloadResult[] = [];
        for (const preloadPromise of preloadPromises) {
          results.push(await preloadPromise);
        }

        const tsxResults = results.filter(
          (r): r is LayoutPreloadResult & { type: "tsx" } => r.type === "tsx",
        );
        const mdxResults = results.filter(
          (r): r is LayoutPreloadResult & { type: "mdx" } => r.type === "mdx",
        );
        const tsxFailures = tsxResults
          .filter((r) => !r.success && r.path && r.error)
          .map((r) => ({ path: r.path!, error: r.error! }));

        const mdxFailures = mdxResults
          .filter((r) => !r.success && r.path && r.error)
          .map((r) => ({ path: r.path!, error: r.error! }));

        const summary: LayoutPreloadSummary = {
          tsxTotal: tsxResults.length,
          tsxSuccess: tsxResults.filter((r) => r.success).length,
          tsxFailures,
          mdxTotal: mdxResults.length,
          mdxSuccess: mdxResults.filter((r) => r.success).length,
          mdxFailures,
          importMapSuccess: true,
          durationMs: Math.round(performance.now() - preloadStart),
          allSuccess: tsxFailures.length === 0 && mdxFailures.length === 0,
          requestIdentity,
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
    requestIdentity: LayoutRequestIdentity,
    layoutDataMap?: Map<string, Record<string, unknown>>,
    requestUrl?: URL,
    params?: Record<string, string | string[]>,
    frontmatter?: Record<string, unknown>,
    headings?: Array<{ id: string; text: string; level: number }>,
    clientPageIsland?: { clientLayoutPaths: readonly string[] },
    pageProps?: Record<string, unknown>,
  ): Promise<React.ReactElement> {
    return withSpan(
      "layout.applyLayoutsAndWrappers",
      async () => {
        assertImportMapIdentity(requestIdentity.importMapIdentity);
        const reactVersion = await this.getReactVersion();
        const mergedComponents = {
          ...createDefaultMDXComponents(),
          ...this.config.componentRegistry,
        };

        const layoutApplicator = new LayoutApplicator({
          projectDir: this.config.projectDir,
          projectId: requestIdentity.projectId,
          projectSlug: requestIdentity.projectSlug,
          contentSourceId: requestIdentity.contentSourceId,
          preloadedImportMap: requestIdentity.importMapIdentity.importMap,
          adapter: this.config.adapter,
          config: this.config.config,
          layoutCache: this.config.layoutCache,
          mergedComponents,
          mode: this.config.mode,
          moduleServerUrl: this.config.moduleServerUrl,
          requestUrl,
          params,
          frontmatter,
          pageProps,
          headings,
          reactVersion,
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
