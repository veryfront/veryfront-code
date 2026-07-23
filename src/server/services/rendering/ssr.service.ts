import type { HandlerContext } from "../../handlers/types.ts";
import {
  getRendererForProject,
  type RendererAdapter,
  shouldRejectDueToMemory,
} from "../../shared/renderer-factory.ts";
import { getHeapStats } from "#veryfront/utils/memory/index.ts";
import { serverLogger, timeAsync } from "#veryfront/utils";
import { computeSSRETag } from "../../handlers/request/ssr/etag-handler.ts";
import { VeryfrontError } from "#veryfront/errors";
import { getColorSchemeFromRequest } from "#veryfront/security/http/client-hints.ts";
import {
  endRenderSession,
  hasRenderSession,
  runInRenderSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { getErrorCollector, profilePhase } from "#veryfront/observability";
import { ErrorOverlay, parseErrorLocation } from "../../dev-server/error-overlay/index.ts";
import { ErrorPages } from "../../utils/error-html.ts";
import {
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
  HTTP_OK,
  HTTP_REDIRECT_FOUND,
  HTTP_UNAVAILABLE,
} from "#veryfront/utils/constants/index.ts";
import type { CacheRepository } from "#veryfront/repositories/types.ts";
import { buildQueryAwareCacheKey, type QueryParamCacheOptions } from "#veryfront/cache/keys.ts";
import { requestHasCacheSensitiveState } from "#veryfront/cache/request-cacheability.ts";
import { computeHash } from "#veryfront/utils/hash-utils.ts";

const logger = serverLogger.component("ssr-service");

/**
 * Provides a renderer for a given handler context.
 * Extracted to allow dependency injection in tests.
 */
export interface RendererProvider {
  getRenderer(ctx: HandlerContext): Promise<RendererAdapter>;
}

/**
 * Minimal interface for SSRService consumers (e.g., SSRHandler).
 * Allows dependency injection and mocking in tests.
 */
export interface SSRServiceLike {
  checkMemoryPressure(): MemoryStatus;
  renderPage(ctx: HandlerContext, options: SSRRenderOptions): Promise<SSRRenderResult>;
  createMemoryPressureResult(slug: string): SSRRenderResult;
}

/**
 * Default RendererProvider that delegates to the real getRendererForProject.
 */
const defaultRendererProvider: RendererProvider = {
  getRenderer: (ctx: HandlerContext) =>
    timeAsync("renderer-init", () => getRendererForProject(ctx)),
};

export interface SSRRenderResult {
  status: number;
  html?: string;
  stream?: ReadableStream<Uint8Array>;
  isStreaming: boolean;
  etag?: string;
  cacheStrategy: "no-cache" | "short";
  error?: Error;
  errorType?: "not-found" | "undeployed" | "redirect" | "server-error" | "runtime";
  showDevOverlay?: boolean;
  redirectLocation?: string;
  slug: string;
}

export interface SSRRenderOptions {
  request: Request;
  url: URL;
  slug: string;
  nonce: string;
  studioEmbed: boolean;
  projectId?: string;
  pageId?: string;
  noHmr: boolean;
  forceProductionScripts?: boolean;
  useNoCache: boolean;
}

export interface MemoryStatus {
  shouldReject: boolean;
  heapUsedMB: number;
  heapLimitMB: number;
  heapUsedPercent: number;
}

interface RedirectResultContext {
  redirect?: {
    destination?: unknown;
    permanent?: unknown;
  };
}

async function buildPublicRenderCacheKey(
  ctx: HandlerContext,
  options: SSRRenderOptions,
): Promise<string | undefined> {
  const policy = ctx.config?.cache?.render?.public;
  if (policy?.enabled !== true) return undefined;
  if ((ctx.resolvedEnvironment ?? ctx.requestContext?.mode) !== "production") return undefined;
  if (
    options.useNoCache || options.studioEmbed || options.pageId !== undefined || options.noHmr ||
    options.forceProductionScripts
  ) return undefined;

  const method = options.request.method.toUpperCase();
  if (method !== "GET" && method !== "HEAD") return undefined;
  if (requestHasCacheSensitiveState(options.request)) return undefined;

  const varyHeaders = [...new Set((policy.varyHeaders ?? []).map((name) => name.toLowerCase()))]
    .sort();
  const queryIdentity = buildQueryAwareCacheKey(
    options.slug,
    options.url,
    ctx.config?.cache?.queryParams as QueryParamCacheOptions | undefined,
  );
  const identity = {
    version: 1,
    projectId: ctx.projectId ?? ctx.projectSlug ?? null,
    method,
    origin: options.url.origin,
    route: queryIdentity,
    vary: varyHeaders.map((name) => [name, options.request.headers.get(name) ?? null]),
  };

  return `public-${await computeHash(JSON.stringify(identity))}`;
}

function extractRedirectLocation(
  error: VeryfrontError,
): { destination: string; permanent: boolean } | null {
  const redirect = (error.context as RedirectResultContext | undefined)?.redirect;
  if (!redirect || typeof redirect.destination !== "string") return null;

  return {
    destination: redirect.destination,
    permanent: redirect.permanent === true,
  };
}

export class SSRService implements SSRServiceLike {
  private readonly cacheRepo?: CacheRepository<string>;
  private readonly rendererProvider: RendererProvider;

  constructor(options?: {
    cacheRepo?: CacheRepository<string>;
    rendererProvider?: RendererProvider;
  }) {
    this.cacheRepo = options?.cacheRepo;
    this.rendererProvider = options?.rendererProvider ?? defaultRendererProvider;
  }

  checkMemoryPressure(): MemoryStatus {
    const stats = getHeapStats();

    return {
      shouldReject: shouldRejectDueToMemory(),
      heapUsedMB: stats.usedHeapSizeMB,
      heapLimitMB: stats.heapSizeLimitMB,
      heapUsedPercent: stats.heapUsedPercent,
    };
  }

  async getRenderer(ctx: HandlerContext): Promise<RendererAdapter> {
    return this.rendererProvider.getRenderer(ctx);
  }

  async renderPage(ctx: HandlerContext, options: SSRRenderOptions): Promise<SSRRenderResult> {
    const { request, url, slug, nonce, studioEmbed, projectId, pageId, noHmr, useNoCache } =
      options;

    const renderSessionId = `${ctx.projectSlug || "default"}-${slug || "index"}-${Date.now()}`;
    const preRenderHeap = getHeapStats();

    if (preRenderHeap.heapUsedPercent > 30) {
      logger.debug("Pre-render memory", {
        projectSlug: ctx.projectSlug,
        slug,
        heapUsedMB: preRenderHeap.usedHeapSizeMB,
        heapLimitMB: preRenderHeap.heapSizeLimitMB,
        heapUsedPercent: preRenderHeap.heapUsedPercent,
      });
    }

    try {
      startRenderSession(renderSessionId, ctx.projectSlug, slug);

      const renderer = await this.getRenderer(ctx);
      const {
        scheme: colorScheme,
        fromParam: colorSchemeFromParam,
        fromHeader: colorSchemeFromHeader,
      } = getColorSchemeFromRequest(
        request,
        url,
      );

      logger.debug("renderPage START", {
        projectSlug: ctx.projectSlug,
        projectId,
        slug,
      });

      const renderStartTime = performance.now();
      // Bind the render session to this async context so modules fetched
      // during the render are attributed to THIS render, not whichever
      // concurrent session started first.
      const delivery = useNoCache ? "stream" : "string";
      const cacheKey = await buildPublicRenderCacheKey(ctx, options);
      const result = await runInRenderSession(renderSessionId, () =>
        profilePhase(
          "ssr.render_page",
          () =>
            timeAsync("render-page", () =>
              renderer.renderPage(slug, {
                delivery,
                request,
                url,
                nonce,
                studioEmbed,
                projectId,
                pageId,
                colorScheme,
                colorSchemeFromParam,
                colorSchemeFromHeader,
                environment: ctx.requestContext?.mode,
                projectSlug: ctx.projectSlug,
                noHmr,
                forceProductionScripts: options.forceProductionScripts,
                renderSessionId,
                cacheKey,
              })),
        ));

      logger.debug("renderPage DONE", {
        projectSlug: ctx.projectSlug,
        slug,
        duration: `${(performance.now() - renderStartTime).toFixed(2)}ms`,
        hasHtml: !!result.html,
        hasStream: !!result.stream,
      });

      if (hasRenderSession(renderSessionId)) {
        endRenderSession(renderSessionId);
      }

      const postRenderHeap = getHeapStats();
      const heapGrowthMB = postRenderHeap.usedHeapSizeMB - preRenderHeap.usedHeapSizeMB;

      if (heapGrowthMB > 50 || postRenderHeap.heapUsedPercent > 50) {
        logger.debug("Post-render memory", {
          projectSlug: ctx.projectSlug,
          slug,
          heapUsedMB: postRenderHeap.usedHeapSizeMB,
          heapLimitMB: postRenderHeap.heapSizeLimitMB,
          heapUsedPercent: postRenderHeap.heapUsedPercent,
          heapGrowthMB: Math.round(heapGrowthMB * 100) / 100,
        });
      }

      const isStreaming = !!result.stream && !result.html;
      const cacheStrategy = useNoCache ? "no-cache" : "short";
      const etag = isStreaming ? undefined : computeSSRETag(result.ssrHash, result.html);

      return {
        status: HTTP_OK,
        html: result.html,
        stream: result.stream ?? undefined,
        isStreaming,
        etag,
        cacheStrategy,
        slug,
      };
    } catch (error) {
      if (hasRenderSession(renderSessionId)) {
        endRenderSession(renderSessionId);
      }
      return this.handleRenderError(error, ctx, slug, request, nonce);
    }
  }

  private handleRenderError(
    error: unknown,
    ctx: HandlerContext,
    slug: string,
    request: Request,
    nonce?: string,
  ): SSRRenderResult {
    const errorObj = error instanceof Error ? error : new Error(String(error));
    // Dev-only overlay (full stack, absolute paths, line numbers) must never
    // be exposed outside a local project — including remote preview, which is
    // internet-reachable. See VULN-SRV-1 / VULN-SRV-2.
    const isDev = Boolean(ctx.isLocalProject);

    if (error instanceof VeryfrontError && error.slug === "file-not-found") {
      logger.debug("Page not found", { slug, error: errorObj.message });
      return {
        status: HTTP_NOT_FOUND,
        html: ErrorPages.notFound(slug || "/"),
        isStreaming: false,
        cacheStrategy: "no-cache",
        errorType: "not-found",
        slug,
      };
    }

    if (
      error instanceof VeryfrontError && error.slug === "api-client-error" && error.status === 404
    ) {
      const apiUrl =
        (((error.context as { details?: { url?: string } } | undefined)?.details?.url) ?? "")
          .toString();

      const isFileListRequest = apiUrl.includes("/files") &&
        !apiUrl.includes("/files/") &&
        (apiUrl.includes("/environments/") || apiUrl.includes("/branches/"));

      if (isFileListRequest) {
        logger.debug("Project not deployed", {
          projectSlug: ctx.projectSlug,
          apiUrl,
        });
        return {
          status: HTTP_NOT_FOUND,
          html: ErrorPages.undeployed(),
          isStreaming: false,
          cacheStrategy: "no-cache",
          errorType: "undeployed",
          slug,
        };
      }
    }

    if (error instanceof VeryfrontError && error.slug === "render-error") {
      const redirect = extractRedirectLocation(error);
      if (redirect) {
        logger.debug("SSR redirect", {
          slug,
          destination: redirect.destination,
          permanent: redirect.permanent,
          projectSlug: ctx.projectSlug,
        });
        return {
          status: redirect.permanent ? 301 : HTTP_REDIRECT_FOUND,
          isStreaming: false,
          cacheStrategy: "no-cache",
          error: errorObj,
          errorType: "redirect",
          redirectLocation: redirect.destination,
          slug,
        };
      }
    }

    logger.error("Render failed", {
      slug,
      error: errorObj.message,
      stack: errorObj.stack,
      projectSlug: ctx.projectSlug,
    });

    if (isDev) {
      getErrorCollector().addRuntimeError(errorObj.message, errorObj.stack, {
        source: "ssr-service",
        url: request.url,
        slug,
      });

      const sourceFile = (errorObj as Error & { sourceFile?: string }).sourceFile;
      const location = sourceFile ? parseErrorLocation(errorObj, sourceFile) : {};
      return {
        status: HTTP_INTERNAL_SERVER_ERROR,
        html: ErrorOverlay.createHTML(
          {
            error: errorObj,
            type: "runtime",
            ...(sourceFile ? { file: sourceFile } : {}),
            ...location,
          },
          ctx.projectSlug,
          nonce,
        ),
        isStreaming: false,
        cacheStrategy: "no-cache",
        error: errorObj,
        errorType: "runtime",
        showDevOverlay: true,
        slug,
      };
    }

    return {
      status: HTTP_INTERNAL_SERVER_ERROR,
      html: ErrorPages.serverError(),
      isStreaming: false,
      cacheStrategy: "no-cache",
      error: errorObj,
      errorType: "server-error",
      slug,
    };
  }

  createMemoryPressureResult(slug: string): SSRRenderResult {
    return {
      status: HTTP_UNAVAILABLE,
      html: ErrorPages.memoryPressure(),
      isStreaming: false,
      cacheStrategy: "no-cache",
      slug,
    };
  }
}
