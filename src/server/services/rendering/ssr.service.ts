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
import { isDataControlResult } from "#veryfront/data/helpers.ts";
import type { DataResult } from "#veryfront/data/types.ts";
import { getColorSchemeFromRequest } from "#veryfront/security/http/client-hints.ts";
import {
  endRenderSession,
  hasRenderSession,
  runInRenderSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { getErrorCollector, profilePhase } from "#veryfront/observability";
import { captureApplicationError } from "#veryfront/observability/application-errors.ts";
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
import type { DependencyPinningSourceInput } from "#veryfront/transforms/esm/package-registry.ts";

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
  errorType?:
    | "not-found"
    | "undeployed"
    | "redirect"
    | "server-error"
    | "runtime"
    | "app-router-error-boundary";
  showDevOverlay?: boolean;
  redirectLocation?: string;
  slug: string;
  /** Dependency snapshot identity rendered into this document. */
  dependencyPinningCacheKey?: string;
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
  /** Immutable dependency snapshot selected at the HTTP request boundary. */
  dependencyPinningCacheKey?: string;
  /** Immutable package map paired with dependencyPinningCacheKey. */
  dependencyPinningDependencies?: Readonly<Record<string, string>>;
  /** Exact package source namespace paired with the immutable snapshot. */
  dependencyPinningSource?: DependencyPinningSourceInput;
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

/**
 * Find a thrown `notFound()` / `redirect()` control result anywhere in the
 * error's `cause` chain or an `AggregateError`'s `errors`.
 *
 * `throw notFound()` is documented to work like `return notFound()`. The data
 * loaders already recognise a thrown branded result (server-data-fetcher.ts),
 * but a control result thrown from a page COMPONENT render surfaces here in the
 * SSR error handler instead, where, unrecognised, it became a 500. Matching the
 * brand lets it behave like the returned/loader form: a 404 (custom
 * `not-found.tsx`) or a redirect. The check is on the brand, never the shape.
 *
 * React can surface concurrent boundary failures wrapped in an `AggregateError`,
 * so the walk descends both `cause` and `errors`. A `seen` set keeps a
 * self-referential chain from looping.
 */
function findThrownControlResult(error: unknown): DataResult | null {
  const seen = new Set<unknown>();
  const stack: unknown[] = [error];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    if (isDataControlResult(current)) return current as DataResult;
    seen.add(current);
    stack.push((current as { cause?: unknown }).cause);
    const aggregated = (current as { errors?: unknown }).errors;
    if (Array.isArray(aggregated)) stack.push(...aggregated);
  }
  return null;
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

/**
 * Build the redirect result shared by the thrown-control-result and
 * `render-error` paths, so a change to redirect handling lands in one place.
 */
function buildRedirectResult(
  redirect: { destination: string; permanent?: boolean },
  errorObj: Error,
  slug: string,
): SSRRenderResult {
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

/**
 * Build the 404 result shared by the thrown-control-result and file-not-found
 * paths. `slug` is escaped by `ErrorPages.notFound`.
 */
function buildNotFoundResult(slug: string): SSRRenderResult {
  return {
    status: HTTP_NOT_FOUND,
    html: ErrorPages.notFound(slug || "/"),
    isStreaming: false,
    cacheStrategy: "no-cache",
    errorType: "not-found",
    slug,
  };
}

function getAllReady(stream: ReadableStream | null | undefined): Promise<unknown> | null {
  const allReady = (stream as { allReady?: unknown } | null | undefined)?.allReady;
  if (!allReady || typeof (allReady as { then?: unknown }).then !== "function") return null;
  return allReady as Promise<unknown>;
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
                dependencyPinningCacheKey: options.dependencyPinningCacheKey,
                dependencyPinningDependencies: options.dependencyPinningDependencies,
                dependencyPinningSource: options.dependencyPinningSource,
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

      if (isStreaming) {
        const allReady = getAllReady(result.stream);
        if (allReady) {
          try {
            await allReady;
          } catch (error) {
            if (findThrownControlResult(error)) {
              return this.handleRenderError(error, ctx, slug, request, nonce);
            }
          }
        }
      }

      return {
        status: HTTP_OK,
        html: result.html,
        stream: result.stream ?? undefined,
        isStreaming,
        etag,
        cacheStrategy,
        slug,
        dependencyPinningCacheKey: options.dependencyPinningCacheKey,
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

    // The page threw and its app-router error.tsx already rendered a full,
    // hydrating document (the boundary UI). Serve it as a 500 without caching.
    const errorBoundaryHtml = (error as { errorBoundaryHtml?: string })?.errorBoundaryHtml;
    if (typeof errorBoundaryHtml === "string") {
      captureApplicationError(errorObj, {
        boundary: "ssr.app-router-error-boundary",
        method: request.method,
      });
      return {
        status: HTTP_INTERNAL_SERVER_ERROR,
        html: errorBoundaryHtml,
        isStreaming: false,
        cacheStrategy: "no-cache",
        errorType: "app-router-error-boundary",
        slug,
      };
    }

    // Dev-only overlay (full stack, absolute paths, line numbers) must never
    // be exposed outside a local project, including remote preview, which is
    // internet-reachable. See VULN-SRV-1 / VULN-SRV-2.
    const isDev = Boolean(ctx.isLocalProject);

    // `throw notFound()` / `throw redirect()` from a page component surfaces here
    // as a thrown control result. Recognise the brand and behave like the loader
    // form: notFound to 404 (routed to the segment's custom not-found.tsx by the
    // handler), redirect to 301/302. Otherwise it falls through to a 500.
    const control = findThrownControlResult(error);
    if (control?.redirect) {
      logger.debug("SSR control-result redirect (thrown from component)", {
        slug,
        destination: control.redirect.destination,
        permanent: control.redirect.permanent,
        projectSlug: ctx.projectSlug,
      });
      return buildRedirectResult(control.redirect, errorObj, slug);
    }
    if (control?.notFound) {
      logger.debug("SSR control-result notFound (thrown from component)", { slug });
      return buildNotFoundResult(slug);
    }

    if (error instanceof VeryfrontError && error.slug === "file-not-found") {
      logger.debug("Page not found", { slug, error: errorObj.message });
      return buildNotFoundResult(slug);
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
        return buildRedirectResult(redirect, errorObj, slug);
      }
    }

    if (
      error instanceof VeryfrontError && error.slug === "service-overloaded"
    ) {
      return {
        status: error.status ?? HTTP_UNAVAILABLE,
        html: ErrorPages.memoryPressure(),
        isStreaming: false,
        cacheStrategy: "no-cache",
        error: errorObj,
        errorType: "server-error",
        slug,
      };
    }

    captureApplicationError(errorObj, {
      boundary: "ssr.render",
      method: request.method,
    });

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
