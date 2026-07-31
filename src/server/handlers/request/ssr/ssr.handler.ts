/**
 * Server-Side Rendering Handler
 *
 * Thin orchestration layer for SSR pages and dynamic routes.
 * Delegates business logic to SSRService, handles HTTP concerns.
 *
 * @module server/handlers/request/ssr/ssr-handler
 */

import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { PRIORITY_LOW } from "#veryfront/utils/constants/index.ts";
import { generateNonce } from "#veryfront/security/http/response/security-handler.ts";
import { isExtendedFSAdapter, NotSupportedError } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import { runWithRequestTiming } from "#veryfront/utils/perf-timer.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { tryErrorPageFallback } from "./error-page-fallback.ts";
import {
  type SSRRenderResult,
  SSRService,
  type SSRServiceLike,
} from "../../../services/rendering/ssr.service.ts";
import { ErrorPages } from "../../../utils/error-html.ts";
import { isSSRBuildFailure } from "#veryfront/rendering/ssr-outcome.ts";
import { buildSSRResponse } from "./ssr-response-builder.ts";
import { getRequestTokenProvenance } from "../../../context/request-context.ts";
import { type DependencyPinningSnapshot } from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import {
  applySnapshotResponseHeaders,
  readSnapshotHeader,
  resolveSnapshotForRequest,
  snapshotConflictResponse,
  stripSnapshotHeader,
} from "#veryfront/server/handlers/utils/dependency-snapshot-protocol.ts";
import { captureApplicationError } from "#veryfront/observability/application-errors.ts";

const logger = serverLogger.component("ssr");

/**
 * Determine if request should serve production (released) content.
 * Uses resolvedEnvironment (from domain lookup) with fallback to requestContext.mode.
 * Config override (PRODUCTION_MODE) takes precedence.
 */
export function isProductionMode(ctx: HandlerContext, _url?: URL): boolean {
  if (ctx.config?.fs?.veryfront?.productionMode === true) return true;

  const environment = ctx.resolvedEnvironment ?? ctx.requestContext?.mode;
  return environment === "production";
}

/**
 * SSR Handler - Thin orchestration layer
 *
 * Responsibilities:
 * - Route matching and quick rejections
 * - Multi-project context setup
 * - Response building with headers
 * - Custom fallback handling (not-found, error pages)
 *
 * Business logic is delegated to SSRService.
 */

export class SSRHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "SSRHandler",
    priority: PRIORITY_LOW as HandlerPriority,
    patterns: [{ pattern: /^(?!\/_).*/, method: ["GET", "HEAD"] }],
  };

  private ssrService: SSRServiceLike;

  constructor(ssrService?: SSRServiceLike) {
    super();
    this.ssrService = ssrService ?? new SSRService();
  }

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname.startsWith("/_veryfront/")) {
      return Promise.resolve(this.continue());
    }

    const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pathname) &&
      !pathname.includes("/.veryfront/") &&
      !pathname.startsWith("/.veryfront");
    if (hasFileExtension) {
      return Promise.resolve(this.continue());
    }

    const slug = pathname === "/" ? "" : pathname.replace(/^\//, "").replace(/\/$/, "");
    const hasDotSegment = slug.split("/").some((segment) => segment.startsWith("."));
    if (hasDotSegment && isProductionMode(ctx, url)) {
      this.logDebug("Dot path blocked in production", { slug }, ctx);
      return Promise.resolve(this.continue());
    }

    this.logDebug("SSR attempt", { pathname, slug }, ctx);

    const requestId = `${slug || "index"}-${Date.now()}`;
    return runWithRequestTiming(
      requestId,
      () => this.setupContextAndRender(req, ctx, slug, requestId, url),
    );
  }

  private setupContextAndRender(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    requestId: string,
    url: URL,
  ): Promise<HandlerResult> {
    try {
      const fsAdapter = ctx.adapter.fs;
      const isExtended = isExtendedFSAdapter(fsAdapter);

      if (ctx.projectSlug && isExtended && fsAdapter.isMultiProjectMode()) {
        const prodMode = isProductionMode(ctx, url);
        const branch = ctx.parsedDomain?.branch ?? null;
        // Framework-owned token: bypass project env overlay so proxy mode works
        // when a remote project overlay is active.
        const effectiveToken = ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "";

        logger.debug("Using multi-project context", {
          projectSlug: ctx.projectSlug,
          productionMode: prodMode,
          slug,
        });

        return fsAdapter.runWithContext(
          ctx.projectSlug,
          effectiveToken,
          () => this.handleWithContext(req, ctx, slug, requestId, url),
          ctx.projectId,
          {
            productionMode: prodMode,
            releaseId: ctx.releaseId,
            branch,
            environmentName: ctx.environmentName,
            tokenProvenance: getRequestTokenProvenance(ctx.requestContext, effectiveToken),
          },
        );
      }

      if (isExtended && fsAdapter.isContextualMode()) {
        // setRequestToken and setRequestBranch are optional per-request context hints;
        // some adapters may not support them. Swallow those errors gracefully.
        try {
          if (ctx.proxyToken) fsAdapter.setRequestToken(ctx.proxyToken);
          fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);
        } catch (e) {
          logger.warn("Non-critical adapter context setup failed (token/branch)", {
            error: e instanceof Error ? e.message : String(e),
            projectSlug: ctx.projectSlug,
          });
        }

        // Production-mode selection is part of request isolation. Rendering after
        // this operation fails could serve draft content for a production request.
        try {
          const prodMode = isProductionMode(ctx, url);
          fsAdapter.setProductionMode(prodMode, ctx.releaseId);
        } catch (e) {
          // Contextual wrappers cover several independent capabilities. Legacy
          // adapters may support request tokens without supporting explicit
          // production-mode selection at all; absence is not an attempted
          // transition failure. Once an adapter implements the operation,
          // however, every implementation error remains fail-closed.
          if (e instanceof NotSupportedError) {
            logger.debug("Adapter does not support production mode selection", {
              projectSlug: ctx.projectSlug,
            });
          } else {
            return this.handleProductionModeSetupFailure(req, ctx, slug, e);
          }
        }
      }

      return this.handleWithContext(req, ctx, slug, requestId, url);
    } catch (error) {
      logger.error("Context setup failed — request will fall through to 404", {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        releaseId: ctx.releaseId,
        hasToken: !!ctx.proxyToken,
        isLocalProject: ctx.isLocalProject,
        slug,
      });
      return Promise.resolve(this.continue());
    }
  }

  private handleProductionModeSetupFailure(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    error: unknown,
  ): Promise<HandlerResult> {
    captureApplicationError(error, {
      boundary: "ssr.context-setup",
      method: req.method,
    });
    logger.error("Adapter production mode setup failed", {
      error,
      projectSlug: ctx.projectSlug,
      projectId: ctx.projectId,
      releaseId: ctx.releaseId,
    });

    const internalError = error instanceof Error
      ? error
      : new Error("Adapter production mode setup failed", { cause: error });
    return this.buildResponse(
      req,
      ctx,
      {
        status: 500,
        html: ErrorPages.serverError(),
        isStreaming: false,
        cacheStrategy: "no-cache",
        failure: {
          kind: "server-error",
          exposure: "generic",
          error: internalError,
        },
        slug,
      },
      generateNonce(),
    );
  }

  private handleWithContext(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    _requestId: string,
    url: URL,
  ): Promise<HandlerResult> {
    return withSpan(
      "ssr.handleWithContext",
      async () => {
        const dependencySource = createHandlerDependencyPinningSource(ctx);
        // The document request is where the client learns the current snapshot
        // key, so an unpinned request adopts it instead of conflicting.
        const resolution = await resolveSnapshotForRequest(
          dependencySource,
          readSnapshotHeader(req.headers),
          { unpinnedRequest: "adopt" },
        );
        if (resolution.kind === "conflict") {
          return this.handleDependencySnapshotConflict(req, ctx);
        }
        const dependencySnapshot = resolution.snapshot;

        const applicationUrl = new URL(url);
        const applicationHeaders = stripSnapshotHeader(req.headers);
        const applicationRequest = new Request(applicationUrl, {
          method: req.method,
          headers: applicationHeaders,
          signal: req.signal,
        });

        const memoryStatus = this.ssrService.checkMemoryPressure();
        if (memoryStatus.shouldReject) {
          this.logDebug("Rejecting due to memory pressure", { slug }, ctx);
          const result = this.ssrService.createMemoryPressureResult(slug);
          return this.buildResponse(
            req,
            ctx,
            { ...result, dependencyPinningCacheKey: dependencySnapshot.cacheKey },
            generateNonce(),
          );
        }

        const nonce = generateNonce();
        const studioEmbed = applicationUrl.searchParams.get("studio_embed") === "true";
        const projectId = ctx.projectId || applicationUrl.searchParams.get("project_id") ||
          ctx.projectSlug || undefined;
        const pageId = applicationUrl.searchParams.get("page_id") || undefined;
        const noHmr = applicationUrl.searchParams.get("noHmr") === "1" ||
          applicationUrl.searchParams.get("no_hmr") === "1";
        const forceProductionScripts =
          applicationUrl.searchParams.get("forceProductionScripts") === "1" ||
          applicationUrl.searchParams.get("force_production_scripts") === "1";
        const useNoCache = shouldUseNoCacheHeadersFromHandler(ctx);

        const result = await this.ssrService.renderPage(ctx, {
          request: applicationRequest,
          url: applicationUrl,
          slug,
          nonce,
          studioEmbed,
          projectId,
          pageId,
          noHmr,
          forceProductionScripts,
          useNoCache,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
          dependencyPinningDependencies: dependencySnapshot.dependencies,
          dependencyPinningSource: dependencySource,
        });
        const rendered: SSRRenderResult = {
          ...result,
          dependencyPinningCacheKey: dependencySnapshot.cacheKey,
        };

        const failure = rendered.failure;
        switch (failure?.kind) {
          case "redirect":
            return this.handleRedirect(req, ctx, rendered, failure.location, nonce);
          case "not-found":
            return this.handleNotFound(
              applicationRequest,
              ctx,
              slug,
              nonce,
              dependencySnapshot,
            );
          case "overloaded":
          case "runtime":
          case "server-error": {
            // Project error pages should beat the dev overlay for runtime
            // errors. Build/import errors stay visible because their overlay is
            // actionable, and only a runtime failure raises one.
            const overlayWins = failure.kind === "runtime" && isSSRBuildFailure(failure.error);
            if (!overlayWins) {
              const customResponse = await this.tryCustomErrorFallback(
                applicationRequest,
                ctx,
                rendered,
                failure.error,
                nonce,
                dependencySnapshot,
              );
              if (customResponse) return customResponse;
            }
            break;
          }
        }

        return this.buildResponse(req, ctx, rendered, nonce);
      },
      { "ssr.slug": slug, "ssr.projectSlug": ctx.projectSlug || "unknown" },
    );
  }

  private handleRedirect(
    req: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    location: string,
    nonce: string,
  ): HandlerResult {
    const response = this.createSnapshotResponseBuilder(
      ctx,
      nonce,
      result.dependencyPinningCacheKey,
    )
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache(result.cacheStrategy)
      .withHeaders({ Location: location })
      .build(null, result.status);

    return this.respond(response);
  }

  private async handleNotFound(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    nonce: string,
    dependencySnapshot: DependencyPinningSnapshot,
  ): Promise<HandlerResult> {
    const builder = this.createSnapshotResponseBuilder(
      ctx,
      nonce,
      dependencySnapshot.cacheKey,
    );

    const notFoundResponse = await tryNotFoundFallback(
      req,
      slug,
      ctx,
      builder,
      dependencySnapshot,
    );
    if (notFoundResponse) return this.respond(notFoundResponse);

    const customResponse = await tryErrorPageFallback(req, ctx, builder, {
      statusCode: 404,
      pathname: slug || "/",
    }, dependencySnapshot);
    if (customResponse) return this.respond(customResponse);

    const result: SSRRenderResult = {
      status: 404,
      html: ErrorPages.notFound(slug || "/"),
      isStreaming: false,
      cacheStrategy: "no-cache",
      failure: { kind: "not-found" },
      slug,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    };

    return this.buildResponse(req, ctx, result, nonce);
  }

  private async tryCustomErrorFallback(
    req: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    error: Error,
    nonce: string,
    dependencySnapshot: DependencyPinningSnapshot,
  ): Promise<HandlerResult | null> {
    const builder = this.createSnapshotResponseBuilder(
      ctx,
      nonce,
      result.dependencyPinningCacheKey,
    );
    const customResponse = await tryErrorPageFallback(req, ctx, builder, {
      statusCode: result.status,
      error,
      pathname: result.slug || "/",
    }, dependencySnapshot);

    return customResponse ? this.respond(customResponse) : null;
  }

  private async buildResponse(
    req: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    nonce: string,
  ): Promise<HandlerResult> {
    const builder = this.createSnapshotResponseBuilder(
      ctx,
      nonce,
      result.dependencyPinningCacheKey,
    );
    const response = await buildSSRResponse(req, ctx, result, builder);
    return this.respond(response);
  }

  private handleDependencySnapshotConflict(
    req: Request,
    ctx: HandlerContext,
  ): HandlerResult {
    return this.respond(
      snapshotConflictResponse(
        this.createResponseBuilder(ctx, generateNonce()),
        req,
        ctx.securityConfig,
      ),
    );
  }

  private createSnapshotResponseBuilder(
    ctx: HandlerContext,
    nonce: string,
    dependencyPinningCacheKey?: string,
  ) {
    const builder = this.createResponseBuilder(ctx, nonce);
    applySnapshotResponseHeaders(builder.headers, dependencyPinningCacheKey);
    return builder;
  }
}
