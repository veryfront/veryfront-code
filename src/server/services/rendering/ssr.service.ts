import type { HandlerContext } from "../../handlers/types.ts";
import {
  getRendererForProject,
  type RendererAdapter,
  shouldRejectDueToMemory,
} from "../../shared/renderer-factory.ts";
import { getHeapStats } from "#veryfront/utils/memory/index.ts";
import { serverLogger, timeAsync } from "#veryfront/utils";
import { computeSSRETag } from "../../handlers/request/ssr/etag-handler.ts";
import type { SSRFailureOutcome } from "#veryfront/rendering/ssr-outcome.ts";
import {
  findSSRControlOutcome,
  isMissingProjectSourceError,
  resolveSSRFailure,
} from "#veryfront/rendering/ssr-outcome.ts";
import { REDIRECT_DESTINATION_NOT_ALLOWED } from "#veryfront/errors/index.ts";
import {
  isRedirectDestinationAllowed,
  type RedirectPolicy,
} from "#veryfront/utils/redirect-policy.ts";
import { getColorSchemeFromRequest } from "#veryfront/security/http/client-hints.ts";
import {
  endRenderSession,
  hasRenderSession,
  runInRenderSession,
  startRenderSession,
} from "#veryfront/transforms/mdx/esm-module-loader/module-fetcher/index.ts";
import { getErrorCollector, profilePhase } from "#veryfront/observability";
// Not on the `#veryfront/observability` barrel: that surface is frozen by an
// export-snapshot test, and the sibling in-process recorders sit here too.
import { recordSSRSourceUnavailable } from "#veryfront/observability/simple-metrics/index.ts";
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
import { isHostProjectCodeExecutionAllowed } from "#veryfront/security/project-locality.ts";
import type { DataResponseMetadata, ResponseCookie } from "#veryfront/data/types.ts";
import {
  getAttachedDataResponseMetadata,
  mergeDataResponseMetadata,
  unwrapDataResponseMetadataError,
} from "#veryfront/data/response-metadata.ts";

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
  /**
   * Marks a complete HTML document produced solely by framework-owned error
   * templates. Application render output must leave this unset.
   */
  htmlProvenance?: "framework";
  stream?: ReadableStream<Uint8Array>;
  isStreaming: boolean;
  etag?: string;
  cacheStrategy: "no-cache" | "short";
  /**
   * How the render ended, when it did not end in a page.
   *
   * Absent on success. Carried whole rather than flattened into status-plus-
   * flags so callers discriminate on `kind` instead of reconstructing the
   * decision the SSR Outcome module already made.
   */
  failure?: SSRFailureOutcome;
  slug: string;
  /** Dependency snapshot identity rendered into this document. */
  dependencyPinningCacheKey?: string;
  /** Validated application headers appended after framework-owned headers. */
  headers?: Record<string, string>;
  /** Distinct cookies emitted as separate Set-Cookie response fields. */
  cookies?: ResponseCookie[];
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

/**
 * Build the redirect result shared by the thrown-control-result and
 * `render-error` paths, so a change to redirect handling lands in one place.
 */
function buildRedirectResult(
  redirect: Extract<SSRFailureOutcome, { kind: "redirect" }>,
  slug: string,
  requestUrl: string | null,
  policy: RedirectPolicy | null | undefined,
): SSRRenderResult {
  if (!isRedirectDestinationAllowed(redirect.location, requestUrl, policy)) {
    throw REDIRECT_DESTINATION_NOT_ALLOWED.create({
      detail: "The redirect destination is not allowed by the project redirect policy",
    });
  }

  return {
    status: redirect.permanent ? 301 : HTTP_REDIRECT_FOUND,
    isStreaming: false,
    cacheStrategy: "no-cache",
    failure: redirect,
    slug,
    ...(redirect.headers ? { headers: redirect.headers } : {}),
    ...(redirect.cookies ? { cookies: redirect.cookies } : {}),
  };
}

/**
 * Build the 404 result shared by the thrown-control-result and file-not-found
 * paths. `slug` is escaped by `ErrorPages.notFound`.
 */
function buildNotFoundResult(
  notFound: Extract<SSRFailureOutcome, { kind: "not-found" }>,
  slug: string,
): SSRRenderResult {
  return {
    status: HTTP_NOT_FOUND,
    html: ErrorPages.notFound(slug || "/"),
    htmlProvenance: "framework",
    isStreaming: false,
    cacheStrategy: "no-cache",
    failure: notFound,
    slug,
    ...(notFound.headers ? { headers: notFound.headers } : {}),
    ...(notFound.cookies ? { cookies: notFound.cookies } : {}),
  };
}

function getAllReady(stream: ReadableStream | null | undefined): Promise<unknown> | null {
  const allReady = (stream as { allReady?: unknown } | null | undefined)?.allReady;
  if (!allReady || typeof (allReady as { then?: unknown }).then !== "function") return null;
  return allReady as Promise<unknown>;
}

function getApiUrlForLogging(error: Error): string | undefined {
  if (!("context" in error)) return undefined;

  const context = error.context;
  if (!context || typeof context !== "object" || !("details" in context)) return undefined;

  const details = context.details;
  if (!details || typeof details !== "object" || !("url" in details)) return undefined;

  const url = details.url;
  return typeof url === "string" ? url : undefined;
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
    if (!isHostProjectCodeExecutionAllowed(ctx)) {
      throw new Error(
        "Project renderers without host execution capability require generation-owned isolated renderer admission",
      );
    }
    return this.rendererProvider.getRenderer(ctx);
  }

  async renderPage(ctx: HandlerContext, options: SSRRenderOptions): Promise<SSRRenderResult> {
    const { request, url, slug, nonce, studioEmbed, projectId, pageId, noHmr, useNoCache } =
      options;
    const requestHasSensitiveState = request.headers.has("cookie") ||
      request.headers.has("authorization");
    const mustNotCache = useNoCache || requestHasSensitiveState;

    // Project source without an explicit host capability is not trusted to
    // execute in the server process. Dedicated single-project runtimes may
    // grant the capability; all other projects require isolated admission.
    if (!isHostProjectCodeExecutionAllowed(ctx)) {
      return {
        status: HTTP_UNAVAILABLE,
        html: ErrorPages.serverError("Isolated rendering is temporarily unavailable."),
        htmlProvenance: "framework",
        isStreaming: false,
        cacheStrategy: "no-cache",
        slug,
      };
    }

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
      const delivery = mustNotCache ? "stream" : "string";
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
      const responseMetadata: DataResponseMetadata = {
        ...(result.headers ? { headers: result.headers } : {}),
        ...(result.cookies ? { cookies: result.cookies } : {}),
      };
      const setsCookies = (responseMetadata.cookies?.length ?? 0) > 0;
      const setsCustomHeaders = Object.keys(responseMetadata.headers ?? {}).length > 0;
      const responseMustNotCache = mustNotCache || setsCookies || setsCustomHeaders;
      const cacheStrategy = responseMustNotCache ? "no-cache" : "short";
      const etag = isStreaming || responseMustNotCache
        ? undefined
        : computeSSRETag(result.ssrHash, result.html);

      if (isStreaming) {
        const allReady = getAllReady(result.stream);
        if (allReady) {
          try {
            await allReady;
          } catch (error) {
            if (findSSRControlOutcome(error)) {
              return this.handleRenderError(
                error,
                ctx,
                slug,
                request,
                nonce,
                responseMetadata,
              );
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
        ...responseMetadata,
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
    inheritedResponseMetadata: DataResponseMetadata = {},
  ): SSRRenderResult {
    const attachedResponseMetadata = error instanceof Error
      ? getAttachedDataResponseMetadata(error)
      : {};
    const responseMetadata = mergeDataResponseMetadata([
      inheritedResponseMetadata,
      attachedResponseMetadata,
    ]);
    const classifiedError = error instanceof Error ? unwrapDataResponseMetadataError(error) : error;
    const outcome = resolveSSRFailure(classifiedError, {
      isLocalProject: Boolean(ctx.isLocalProject),
    });
    const requestLocalMetadata = classifiedError === error ? {} : attachedResponseMetadata;

    switch (outcome.kind) {
      case "app-router-error-boundary":
        captureApplicationError(outcome.error, {
          boundary: "ssr.app-router-error-boundary",
          method: request.method,
        });
        return {
          status: HTTP_INTERNAL_SERVER_ERROR,
          html: outcome.html,
          isStreaming: false,
          cacheStrategy: "no-cache",
          failure: outcome,
          slug,
          ...responseMetadata,
        };
      case "redirect":
        try {
          const result = buildRedirectResult(
            {
              ...outcome,
              ...mergeDataResponseMetadata([
                inheritedResponseMetadata,
                requestLocalMetadata,
                outcome,
              ]),
            },
            slug,
            ctx.requestOrigin === undefined ? request.url : ctx.requestOrigin,
            ctx.securityConfig?.redirects,
          );
          logger.debug("SSR redirect", {
            slug,
            permanent: outcome.permanent,
            projectSlug: ctx.projectSlug,
          });
          return result;
        } catch (error) {
          return this.handleRenderError(
            error,
            ctx,
            slug,
            request,
            nonce,
          );
        }
      case "not-found":
        if (isMissingProjectSourceError(error)) {
          // This 404 used to be a 500, and the error report it raised was the
          // only thing that made an unreadable release visible. Reclassifying it
          // must not make it silent, so count it and say so once per request at
          // a level Loki can alert on -- a routine deletion moves this a bounded
          // number of times, an API-side regression moves it continuously.
          recordSSRSourceUnavailable();
          logger.warn("Project source unavailable; served 404", {
            slug,
            projectSlug: ctx.projectSlug,
          });
        } else {
          logger.debug("SSR notFound", { slug });
        }
        return buildNotFoundResult({
          ...outcome,
          ...mergeDataResponseMetadata([
            inheritedResponseMetadata,
            requestLocalMetadata,
            outcome,
          ]),
        }, slug);
      case "undeployed":
        logger.debug("Project not deployed", {
          projectSlug: ctx.projectSlug,
          apiUrl: getApiUrlForLogging(outcome.error),
        });
        return {
          status: HTTP_NOT_FOUND,
          html: ErrorPages.undeployed(),
          htmlProvenance: "framework",
          isStreaming: false,
          cacheStrategy: "no-cache",
          failure: outcome,
          slug,
          ...responseMetadata,
        };
      case "overloaded":
        return {
          status: outcome.status,
          html: ErrorPages.memoryPressure(),
          htmlProvenance: "framework",
          isStreaming: false,
          cacheStrategy: "no-cache",
          failure: outcome,
          slug,
          ...responseMetadata,
        };
      case "runtime":
        captureApplicationError(outcome.error, {
          boundary: "ssr.render",
          method: request.method,
        });

        logger.error("Render failed", {
          slug,
          error: outcome.error.message,
          stack: outcome.error.stack,
          projectSlug: ctx.projectSlug,
        });

        // Dev-only overlay content includes stack details and must stay local-only.
        getErrorCollector().addRuntimeError(outcome.error.message, outcome.error.stack, {
          source: "ssr-service",
          url: request.url,
          slug,
        });

        {
          const sourceFile = (outcome.error as Error & { sourceFile?: string }).sourceFile;
          const location = sourceFile ? parseErrorLocation(outcome.error, sourceFile) : {};
          return {
            status: HTTP_INTERNAL_SERVER_ERROR,
            html: ErrorOverlay.createHTML(
              {
                error: outcome.error,
                type: "runtime",
                ...(sourceFile ? { file: sourceFile } : {}),
                ...location,
              },
              ctx.projectSlug,
              nonce,
            ),
            isStreaming: false,
            cacheStrategy: "no-cache",
            failure: outcome,
            slug,
            ...responseMetadata,
          };
        }
      case "server-error":
        captureApplicationError(outcome.error, {
          boundary: "ssr.render",
          method: request.method,
        });

        logger.error("Render failed", {
          slug,
          error: outcome.error.message,
          stack: outcome.error.stack,
          projectSlug: ctx.projectSlug,
        });

        return {
          status: HTTP_INTERNAL_SERVER_ERROR,
          html: ErrorPages.serverError(),
          htmlProvenance: "framework",
          isStreaming: false,
          cacheStrategy: "no-cache",
          failure: outcome,
          slug,
          ...responseMetadata,
        };
    }
  }

  createMemoryPressureResult(slug: string): SSRRenderResult {
    return {
      status: HTTP_UNAVAILABLE,
      html: ErrorPages.memoryPressure(),
      htmlProvenance: "framework",
      isStreaming: false,
      cacheStrategy: "no-cache",
      slug,
    };
  }
}
