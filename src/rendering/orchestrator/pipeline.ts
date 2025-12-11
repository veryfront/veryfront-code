import { rendererLogger as logger } from "@veryfront/utils";
import { ErrorCode, VeryfrontError } from "@veryfront/errors/index.ts";
import type { MdxBundle } from "@veryfront/types";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { CacheCoordinator } from "../cache/cache-coordinator.ts";
import type { PageRenderer } from "../page-renderer.ts";
import type { PageResolver } from "../page-resolution/index.ts";
import type { LayoutOrchestrator } from "./layout.ts";
import type { SSROrchestrator } from "./ssr-orchestrator.ts";
import type { RenderOptions, RenderResult } from "./types.ts";
import { DataFetcher } from "@veryfront/data/index.ts";
import type { DataContext } from "@veryfront/data/types.ts";
import { SSRModuleLoader } from "@veryfront/modules/react-loader/ssr-module-loader.ts";

export interface RenderPipelineConfig {
  pageResolver: PageResolver;
  cacheCoordinator: CacheCoordinator;
  pageRenderer: PageRenderer;
  layoutOrchestrator: LayoutOrchestrator;
  ssrOrchestrator: SSROrchestrator;
  adapter: RuntimeAdapter;
  mode: "development" | "production";
  projectDir: string;
}

export class RenderPipeline {
  private config: RenderPipelineConfig;
  private dataFetcher: DataFetcher;
  private ssrModuleLoader: SSRModuleLoader;

  constructor(config: RenderPipelineConfig) {
    this.config = config;
    this.dataFetcher = new DataFetcher(config.adapter);
    this.ssrModuleLoader = new SSRModuleLoader({
      projectDir: config.projectDir,
      projectId: config.projectDir,
      adapter: config.adapter,
      dev: config.mode === "development",
    });
  }

  private async loadModule(filePath: string): Promise<any> {
    return this.ssrModuleLoader.loadFullModule(filePath);
  }

  async renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    const pageInfo = await this.config.pageResolver.resolvePage(slug);

    const layoutResult = await this.config.layoutOrchestrator.collectLayouts(pageInfo);
    const providerResult = await this.config.layoutOrchestrator.collectProviders();

    let dataFetchingProps: Record<string, unknown> | undefined;
    const layoutDataMap = new Map<string, Record<string, unknown>>();

    const fileExtension = pageInfo.entity.id.split(".").pop()?.toLowerCase() || "";
    const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
    const isInPagesDir = pageInfo.entity.id.includes("/pages/");

    if (options?.request && options?.url) {
      try {
        if (!options.params || Object.keys(options.params).length === 0) {
          logger.info("[renderPage] Attempting to extract Pages Router params", {
            slug,
            pageId: pageInfo.entity.id,
          });

          try {
            const params: Record<string, string | string[]> = {};
            const pagesIndex = pageInfo.entity.id.indexOf("/pages/");
            if (pagesIndex !== -1) {
              const relativePath = pageInfo.entity.id.substring(pagesIndex + 7);
              const pathSegments = relativePath.split("/").map((s) =>
                s.replace(/\.(tsx|jsx|ts|js|mdx)$/, "")
              );
              const slugSegments = slug.split("/").filter(Boolean);

              for (let i = 0; i < pathSegments.length && i < slugSegments.length; i++) {
                const pathSeg = pathSegments[i];
                const slugSeg = slugSegments[i];

                if (pathSeg && pathSeg.startsWith("[") && pathSeg.endsWith("]")) {
                  const isCatchAll = pathSeg.startsWith("[...");
                  const paramName = pathSeg.replace(/\[\.\.\.|\[|\]/g, "");

                  if (isCatchAll) {
                    params[paramName] = slugSegments.slice(i);
                    break;
                  } else {
                    if (slugSeg !== undefined) {
                      params[paramName] = slugSeg;
                    }
                  }
                }
              }
            }

            logger.info("[renderPage] Extraction result", {
              slug,
              params,
              hasParams: Object.keys(params).length > 0,
            });

            if (Object.keys(params).length > 0) {
              options.params = params;
              logger.info("[renderPage] Extracted Pages Router params", {
                slug,
                params,
              });
            }
          } catch (paramError) {
            logger.error("[renderPage] Failed to extract Pages Router params", {
              slug,
              error: paramError instanceof Error ? paramError.message : String(paramError),
              stack: paramError instanceof Error ? paramError.stack : undefined,
            });
          }
        }

        const jobs: Array<{ type: "page" | "layout"; id: string; run: () => Promise<any> }> = [];

        const dataContext: DataContext = {
          params: options.params || {},
          query: options.url.searchParams,
          request: options.request,
          url: options.url,
        };

        if (isComponentPage && isInPagesDir) {
          jobs.push({
            type: "page",
            id: pageInfo.entity.id,
            run: async () => {
              const mod = await this.loadModule(pageInfo.entity.id);
              if (mod && (mod.getServerData || mod.getStaticData)) {
                return this.dataFetcher.fetchData(mod, dataContext, this.config.mode);
              }
              return null;
            },
          });
        }

        for (const layout of layoutResult.nestedLayouts) {
          if (layout.kind === "tsx" && layout.componentPath) {
            jobs.push({
              type: "layout",
              id: layout.componentPath,
              run: async () => {
                const mod = await this.loadModule(layout.componentPath!);
                if (mod && (mod.getServerData || mod.getStaticData)) {
                  return this.dataFetcher.fetchData(mod, dataContext, this.config.mode);
                }
                return null;
              },
            });
          }
        }

        logger.info("[renderPage] Executing parallel data fetching jobs", { count: jobs.length });
        const results = await Promise.all(jobs.map((j) => j.run()));

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          if (!job) continue;
          const result = results[i];
          if (result) {
            if (result.notFound) {
              throw new VeryfrontError(
                "Page/Layout returned notFound",
                ErrorCode.FILE_NOT_FOUND,
                { slug, component: job.id },
              );
            }

            if (result.redirect) {
              throw new VeryfrontError(
                `Redirect to ${result.redirect.destination}`,
                ErrorCode.RENDER_ERROR,
                {
                  slug,
                  redirect: result.redirect,
                },
              );
            }

            if (result.props) {
              if (job.type === "page") {
                dataFetchingProps = result.props as Record<string, unknown>;
              } else {
                layoutDataMap.set(job.id, result.props as Record<string, unknown>);
              }
            }
          }
        }
      } catch (error) {
        if (error instanceof VeryfrontError) {
          throw error;
        }

        logger.error("[renderPage] Data fetching error", {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const cacheResult = await this.config.cacheCoordinator.checkCache(
      slug,
      pageInfo,
      layoutResult.layoutBundle,
      layoutResult.nestedLayouts,
      providerResult.providerInfos,
    );

    if (cacheResult?.cachedResult) {
      return cacheResult.cachedResult;
    }

    const mergedOptions = dataFetchingProps
      ? { ...options, props: { ...options?.props, ...dataFetchingProps } }
      : options;

    const pageBundleResult = await this.config.pageRenderer.preparePageBundles(
      pageInfo,
      slug,
      cacheResult?.cachedModule,
      mergedOptions,
    );

    if (pageBundleResult.scriptResult) {
      return pageBundleResult.scriptResult;
    }

    if (!pageBundleResult.pageElement || !pageBundleResult.pageBundle) {
      throw new VeryfrontError("Failed to prepare page bundle", ErrorCode.RENDER_ERROR, { slug });
    }

    const wrappedElement = await this.config.layoutOrchestrator.applyLayoutsAndWrappers(
      pageBundleResult.pageElement,
      pageInfo,
      layoutResult.layoutBundle,
      layoutResult.nestedLayouts,
      providerResult.providerItems,
      layoutDataMap,
    );

    const ssrResult = await this.config.ssrOrchestrator.performSSRRendering(
      wrappedElement,
      {
        pageInfo,
        pageBundle: pageBundleResult.pageBundle,
        layoutBundle: layoutResult.layoutBundle,
        nestedLayouts: layoutResult.nestedLayouts,
        providerInfos: providerResult.providerInfos,
        collectedMetadata: pageBundleResult.collectedMetadata,
        slug,
      },
      mergedOptions,
    );

    const pageModule = pageBundleResult.clientModuleCode && pageBundleResult.pageModuleType
      ? {
        slug,
        code: pageBundleResult.clientModuleCode,
        type: pageBundleResult.pageModuleType,
      }
      : undefined;

    const result: RenderResult = {
      html: ssrResult.fullHtml,
      frontmatter: (pageBundleResult.pageBundle as MdxBundle).frontmatter || {},
      headings: pageBundleResult.pageBundle.headings || [],
      nodeMap: pageBundleResult.pageBundle.nodeMap,
      stream: ssrResult.finalStream,
      ssrHash: ssrResult.ssrHash,
      ...(pageModule ? { pageModule } : {}),
    };

    logger.info("Page bundle frontmatter:", (pageBundleResult.pageBundle as MdxBundle).frontmatter);

    if (cacheResult) {
      await this.config.cacheCoordinator.persistResult(
        result,
        slug,
        cacheResult.depAwareSlug,
        cacheResult.moduleCacheKey,
        pageInfo,
        pageBundleResult.clientModuleCode,
        pageBundleResult.pageModuleType,
        cacheResult.cachedModule,
      );
    }

    logger.info("[renderPage] Returning result", {
      hasHtml: !!result.html,
      hasStream: !!result.stream,
      htmlLength: result.html?.length || 0,
      htmlPreview: result.html?.substring(0, 500) || "empty",
    });

    return result;
  }
}
