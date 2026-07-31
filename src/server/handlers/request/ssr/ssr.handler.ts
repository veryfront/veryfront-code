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
import type { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
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
import { VeryfrontError } from "#veryfront/errors";
import { buildSSRResponse } from "./ssr-response-builder.ts";
import { getRequestTokenProvenance } from "../../../context/request-context.ts";
import {
  type DependencyPinningSnapshot,
  resolveRequestedDependencyPinningSnapshot,
} from "#veryfront/transforms/esm/package-registry.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";

const logger = serverLogger.component("ssr");
const DEPENDENCY_PINNING_RESPONSE_HEADER = "x-veryfront-dependency-pins";

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

/**
 * True for errors raised while compiling or resolving project source, as
 * opposed to errors thrown by the running application.
 *
 * Module-load failures arrive wrapped in a RUNTIME-category `render-error`,
 * which loses the original category, so they carry a `buildFailure` flag that
 * the module loader sets at the point of failure. Failing to load is not
 * evidence on its own: a module that compiled fine and threw at module scope
 * also fails to load, and that is an application error the project's own error
 * page should present.
 */
function isBuildError(error: unknown): boolean {
  if (!(error instanceof VeryfrontError)) return false;
  if (error.category === "BUILD" || error.category === "MODULE") return true;

  const context = error.context as { buildFailure?: unknown } | undefined;
  return context?.buildFailure === true;
}

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

        // setProductionMode is more important than the token/branch hints: if it
        // silently no-ops the request could run in the wrong environment. Adapters
        // that don't implement it may still throw, so keep it non-fatal but surface
        // the failure at warn (rather than swallowing it) so a genuinely broken
        // production-mode setup is visible instead of silently serving draft content.
        try {
          const prodMode = isProductionMode(ctx, url);
          fsAdapter.setProductionMode(prodMode, ctx.releaseId);
        } catch (e) {
          logger.warn("Adapter setProductionMode failed", {
            error: e instanceof Error ? e.message : String(e),
            projectSlug: ctx.projectSlug,
          });
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
        const requestedPinKey = req.headers.get(DEPENDENCY_PINNING_RESPONSE_HEADER);
        const dependencySource = createHandlerDependencyPinningSource(ctx);
        const dependencySnapshot = requestedPinKey !== null &&
            !requestedPinKey.startsWith("on:")
          ? undefined
          : await resolveRequestedDependencyPinningSnapshot(
            dependencySource,
            requestedPinKey,
          );
        if (!dependencySnapshot) {
          return this.handleDependencySnapshotConflict(req, ctx);
        }

        const applicationUrl = new URL(url);
        const applicationHeaders = new Headers(req.headers);
        applicationHeaders.delete(DEPENDENCY_PINNING_RESPONSE_HEADER);
        const applicationRequest = new Request(applicationUrl, {
          method: req.method,
          headers: applicationHeaders,
          signal: req.signal,
        });

        const memoryStatus = this.ssrService.checkMemoryPressure();
        if (memoryStatus.shouldReject) {
          this.logDebug("Rejecting due to memory pressure", { slug }, ctx);
          const result = this.ssrService.createMemoryPressureResult(slug);
          result.dependencyPinningCacheKey = dependencySnapshot.cacheKey;
          return this.buildResponse(req, ctx, result, generateNonce());
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
        result.dependencyPinningCacheKey = dependencySnapshot.cacheKey;

        if (result.errorType === "redirect" && result.redirectLocation) {
          return this.handleRedirect(req, ctx, result, nonce);
        }

        if (result.errorType === "not-found") {
          return this.handleNotFound(
            applicationRequest,
            ctx,
            slug,
            nonce,
            dependencySnapshot,
          );
        }

        const isServerError = result.errorType === "server-error" ||
          result.errorType === "runtime";
        // Project error pages should beat the dev overlay for runtime errors.
        // Build/import errors stay visible because their overlay is actionable.
        if (isServerError && !(result.showDevOverlay && isBuildError(result.error))) {
          const customResponse = await this.tryCustomErrorFallback(
            applicationRequest,
            ctx,
            result,
            nonce,
            dependencySnapshot,
          );
          if (customResponse) return customResponse;
        }

        return this.buildResponse(req, ctx, result, nonce);
      },
      { "ssr.slug": slug, "ssr.projectSlug": ctx.projectSlug || "unknown" },
    );
  }

  private handleRedirect(
    req: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
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
      .withHeaders({ Location: result.redirectLocation ?? "/" })
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
      errorType: "not-found",
      slug,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
    };

    return this.buildResponse(req, ctx, result, nonce);
  }

  private async tryCustomErrorFallback(
    req: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
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
      error: result.error,
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
    const response = this.createResponseBuilder(ctx, generateNonce())
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-store");
    withDependencyPinningVary(response);
    const conflict = response.text("Unknown dependency snapshot", 409);
    return this.respond(conflict);
  }

  private createSnapshotResponseBuilder(
    ctx: HandlerContext,
    nonce: string,
    dependencyPinningCacheKey?: string,
  ) {
    const builder = this.createResponseBuilder(ctx, nonce);
    withDependencyPinningVary(builder);
    if (dependencyPinningCacheKey?.startsWith("on:")) {
      builder.withHeaders({
        [DEPENDENCY_PINNING_RESPONSE_HEADER]: dependencyPinningCacheKey,
      });
    }
    return builder;
  }
}

function withDependencyPinningVary(
  builder: ResponseBuilder,
): void {
  const existing = builder.headers.get("vary");
  const values = existing?.split(",").map((value) => value.trim().toLowerCase()) ?? [];
  if (values.includes(DEPENDENCY_PINNING_RESPONSE_HEADER)) return;
  builder.withHeaders({
    vary: existing
      ? `${existing}, ${DEPENDENCY_PINNING_RESPONSE_HEADER}`
      : DEPENDENCY_PINNING_RESPONSE_HEADER,
  });
}
