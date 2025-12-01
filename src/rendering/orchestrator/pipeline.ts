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
import type { DataContext, PageWithData } from "@veryfront/data/types.ts";

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

  constructor(config: RenderPipelineConfig) {
    this.config = config;
    this.dataFetcher = new DataFetcher(config.adapter);
  }

  private async generateHash(str: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(str);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  }

  async renderPage(slug: string, options?: RenderOptions): Promise<RenderResult> {
    const pageInfo = await this.config.pageResolver.resolvePage(slug);

    let dataFetchingProps: Record<string, unknown> | undefined;
    let loadedPageModule: PageWithData | undefined;

    const fileExtension = pageInfo.entity.id.split(".").pop()?.toLowerCase() || "";
    const isComponentPage = ["tsx", "jsx", "ts", "js"].includes(fileExtension);
    const isInPagesDir = pageInfo.entity.id.includes("/pages/");

    logger.info("[renderPage] Data fetching check", {
      slug,
      fileExtension,
      isComponentPage,
      isInPagesDir,
      hasRequest: !!options?.request,
      hasUrl: !!options?.url,
      pageId: pageInfo.entity.id,
    });

    if (isComponentPage && isInPagesDir && options?.request && options?.url) {
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
              const relativePath = pageInfo.entity.id.substring(pagesIndex + 7); // Skip "/pages/"
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

        logger.info("[renderPage] Loading page module for data fetching", {
          pageId: pageInfo.entity.id,
        });

        const fileContent = await this.config.adapter.fs.readFile(pageInfo.entity.id);

        // Transform to ESM and write to temp file for dynamic import
        const { transformToESM } = await import("@veryfront/transforms/esm-transform.ts");
        const { getGlobalTmpDir } = await import(
          "@veryfront/modules/react-loader/index.ts"
        );

        const transformedCode = await transformToESM(
          fileContent,
          pageInfo.entity.id,
          this.config.projectDir,
          this.config.adapter,
          {
            projectId: this.config.projectDir,
            dev: this.config.mode === "development",
          },
        );

        const tmpDir = await getGlobalTmpDir();
        const hash = await this.generateHash(pageInfo.entity.id);
        const tempFilePath = `${tmpDir}/page-${hash}.js`;
        await this.config.adapter.fs.writeFile(tempFilePath, transformedCode);

        const moduleUrl = `file://${tempFilePath}?t=${Date.now()}`;
        loadedPageModule = await import(moduleUrl) as PageWithData;

        logger.info("[renderPage] Page module loaded", {
          hasModule: !!loadedPageModule,
          hasGetServerData: !!(loadedPageModule?.getServerData),
          hasGetStaticData: !!(loadedPageModule?.getStaticData),
        });

        if (
          loadedPageModule && (loadedPageModule.getServerData || loadedPageModule.getStaticData)
        ) {
          const dataContext: DataContext = {
            params: options.params || {},
            query: options.url.searchParams,
            request: options.request,
            url: options.url,
          };

          logger.info("[renderPage] Calling data fetching with context", {
            slug,
            params: dataContext.params,
            queryString: dataContext.url.search,
          });

          const dataResult = await this.dataFetcher.fetchData(
            loadedPageModule,
            dataContext,
            this.config.mode,
          );

          logger.info("[renderPage] Data result", {
            slug,
            hasNotFound: !!dataResult.notFound,
            hasRedirect: !!dataResult.redirect,
            hasProps: !!dataResult.props,
          });

          // Handle notFound
          if (dataResult.notFound) {
            throw new VeryfrontError(
              "Page returned notFound",
              ErrorCode.FILE_NOT_FOUND,
              { slug },
            );
          }

          // Handle redirect
          if (dataResult.redirect) {
            // For now, throw an error that the handler can catch
            // In the future, this could return a special redirect result
            throw new VeryfrontError(
              `Redirect to ${dataResult.redirect.destination}`,
              ErrorCode.RENDER_ERROR,
              {
                slug,
                redirect: dataResult.redirect,
              },
            );
          }

          dataFetchingProps = dataResult.props as Record<string, unknown> | undefined;
          logger.info("[renderPage] Data fetching succeeded", {
            slug,
            hasProps: !!dataFetchingProps,
            propKeys: dataFetchingProps ? Object.keys(dataFetchingProps) : [],
          });
        }
      } catch (error) {
        if (error instanceof VeryfrontError && error.code === ErrorCode.FILE_NOT_FOUND) {
          throw error;
        }

        logger.error("[renderPage] Data fetching error", {
          slug,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    }

    const layoutResult = await this.config.layoutOrchestrator.collectLayouts(pageInfo);
    const providerResult = await this.config.layoutOrchestrator.collectProviders();

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
    });

    return result;
  }
}
