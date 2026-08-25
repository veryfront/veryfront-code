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
import { isExtendedFSAdapter } from "#veryfront/platform/adapters/fs/wrapper.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import { shouldUseNoCacheHeadersFromHandler } from "../../../context/enriched-context.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import { endRequest, startRequest } from "#veryfront/utils";
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
import { type DependencyPinningSnapshot } from "#veryfront/transforms/esm/package-registry.ts";
import { createApplicationRequestHeaders } from "#veryfront/security/http/application-request.ts";
import { createHandlerDependencyPinningSource } from "#veryfront/server/handlers/utils/dependency-pinning-source.ts";
import {
  applySnapshotResponseHeaders,
  readSnapshotHeader,
  resolveSnapshotForRequest,
  snapshotConflictResponse,
  stripSnapshotHeader,
} from "#veryfront/server/handlers/utils/dependency-snapshot-protocol.ts";
import { isProductionMode, shouldHideRouteInProduction } from "../route-visibility-policy.ts";
import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";
import { appendDataResponseMetadata } from "#veryfront/data/response-metadata.ts";
import { ensurePreviewDocumentSourceSnapshot } from "../source-snapshot-freshness.ts";
import { enterContextualAdapterRequestContext } from "../contextual-adapter-context.ts";
import { ssrOwnsDocumentPathname } from "./document-ownership.ts";

const logger = serverLogger.component("ssr");

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

    // The chain's route pattern already excludes /_ paths; the shared
    // predicate keeps direct calls and the API/page classifier's
    // pressure-deferral decision aligned with what this handler renders.
    if (!ssrOwnsDocumentPathname(pathname)) {
      return Promise.resolve(this.continue());
    }

    const slug = pathname === "/" ? "" : pathname.replace(/^\//, "").replace(/\/$/, "");
    const requestId = `${slug || "index"}-${Date.now()}`;

    if (shouldHideRouteInProduction(ctx, slug)) {
      this.logDebug("Dot path blocked in production", { slug }, ctx);
      return Promise.resolve(this.continue());
    }

    if (requiresIsolatedProjectRuntime(ctx)) {
      const problem = createErrorResponseFromDefinition(
        PROJECT_EXECUTION_UNAVAILABLE,
        {
          detail:
            "Shared runtimes require a dedicated isolated project runtime for server rendering",
          instance: pathname,
        },
      );
      const body = req.method === "HEAD" ? null : problem.body;
      const response = this.createResponseBuilder(ctx, generateNonce())
        .withSecurity(ctx.securityConfig ?? undefined, req)
        .withCache("no-store")
        .withHeaders(problem.headers)
        .build(body, problem.status);
      return Promise.resolve(this.respond(response));
    }

    this.logDebug("SSR attempt", { pathname, slug }, ctx);

    // Allocated only once the request is certain to be rendered. `startRequest`
    // registers a timings entry that `endRequest` removes, but `endRequest`
    // returns early when no timer ever ran, so an entry allocated before the
    // guards above would survive on every hidden-route or fail-closed request.
    startRequest(requestId);

    return this.setupContextAndRender(req, ctx, slug, requestId, url);
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
        const prodMode = isProductionMode(ctx);
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
          },
        );
      }

      // Enter this request's adapter context (token, branch, production mode)
      // through the same helper the API/page classifier uses, so the snapshot
      // it prepared describes the context this render reads from.
      enterContextualAdapterRequestContext(ctx);

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
    requestId: string,
    url: URL,
  ): Promise<HandlerResult> {
    return withSpan(
      "ssr.handleWithContext",
      async () => {
        const memoryStatus = this.ssrService.checkMemoryPressure();
        const dependencySource = createHandlerDependencyPinningSource(ctx);
        if (memoryStatus.shouldReject) {
          // The shed response still carries the snapshot key that its dependent
          // requests must use, but it must not spend memory refreshing source
          // that it will not render.
          const resolution = await resolveSnapshotForRequest(
            dependencySource,
            readSnapshotHeader(req.headers),
            { unpinnedRequest: "adopt" },
          );
          if (resolution.kind === "conflict") {
            endRequest(requestId);
            return this.handleDependencySnapshotConflict(req, ctx);
          }
          this.logDebug("Rejecting due to memory pressure", { slug }, ctx);
          // The abandoned request must release its timing state: leaving it
          // current keeps later timers attached to it for as long as the
          // overload lasts.
          endRequest(requestId);
          const result = this.ssrService.createMemoryPressureResult(slug);
          return this.buildResponse(
            req,
            ctx,
            { ...result, dependencyPinningCacheKey: resolution.snapshot.cacheKey },
            generateNonce(),
          );
        }

        // Establish one current draft generation before route resolution and
        // rendering. If freshness cannot be established, fail the request
        // rather than serving an older SSR snapshot that hydration replaces.
        // maxAgeMs: 0 is what narrows the stale window: a draft edit does not
        // change the snapshot identity, so any reusable lease here would render
        // the pre-edit source. Joining an already in-flight refresh still leaves
        // one source round trip of exposure, but not the whole 30s lease.
        // Sub-resource requests within this page load keep the default lease,
        // so the strict listing happens once per document.
        try {
          await ensurePreviewDocumentSourceSnapshot(ctx);
        } catch (error) {
          endRequest(requestId);
          throw error;
        }

        const postRefreshMemoryStatus = this.ssrService.checkMemoryPressure();
        if (postRefreshMemoryStatus.shouldReject) {
          const refreshedResolution = await resolveSnapshotForRequest(
            dependencySource,
            readSnapshotHeader(req.headers),
            { unpinnedRequest: "adopt" },
          );
          if (refreshedResolution.kind === "conflict") {
            endRequest(requestId);
            return this.handleDependencySnapshotConflict(req, ctx);
          }
          this.logDebug("Rejecting after source refresh due to memory pressure", { slug }, ctx);
          // As above: the shed request is finished, so close out its timing
          // state before returning the 503.
          endRequest(requestId);
          const result = this.ssrService.createMemoryPressureResult(slug);
          return this.buildResponse(
            req,
            ctx,
            {
              ...result,
              dependencyPinningCacheKey: refreshedResolution.snapshot.cacheKey,
            },
            generateNonce(),
          );
        }

        // The document request is where the client learns the current snapshot
        // key, so an unpinned request adopts it instead of conflicting.
        const resolution = await resolveSnapshotForRequest(
          dependencySource,
          readSnapshotHeader(req.headers),
          { unpinnedRequest: "adopt" },
        );
        if (resolution.kind === "conflict") {
          endRequest(requestId);
          return this.handleDependencySnapshotConflict(req, ctx);
        }
        const dependencySnapshot = resolution.snapshot;

        const applicationUrl = new URL(url);
        const applicationHeaders = createApplicationRequestHeaders(
          stripSnapshotHeader(req.headers),
        );
        const applicationRequest = new Request(applicationUrl, {
          method: req.method,
          headers: applicationHeaders,
          signal: req.signal,
        });

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

        endRequest(requestId);

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
              rendered,
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
    const builder = this.createSnapshotResponseBuilder(
      ctx,
      nonce,
      result.dependencyPinningCacheKey,
    )
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache(result.cacheStrategy)
      .withHeaders({ Location: location });
    appendDataResponseMetadata(builder.headers, result);
    const response = builder.build(null, result.status);

    return this.respond(response);
  }

  private async handleNotFound(
    req: Request,
    ctx: HandlerContext,
    slug: string,
    nonce: string,
    dependencySnapshot: DependencyPinningSnapshot,
    result: SSRRenderResult,
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
    if (notFoundResponse) {
      appendDataResponseMetadata(notFoundResponse.headers, result);
      return this.respond(notFoundResponse);
    }

    const customResponse = await tryErrorPageFallback(req, ctx, builder, {
      statusCode: 404,
      pathname: slug || "/",
    }, dependencySnapshot);
    if (customResponse) {
      appendDataResponseMetadata(customResponse.headers, result);
      return this.respond(customResponse);
    }

    const fallbackResult: SSRRenderResult = {
      status: 404,
      html: ErrorPages.notFound(slug || "/"),
      htmlProvenance: "framework",
      isStreaming: false,
      cacheStrategy: "no-cache",
      failure: { kind: "not-found" },
      slug,
      dependencyPinningCacheKey: dependencySnapshot.cacheKey,
      ...(result.headers ? { headers: result.headers } : {}),
      ...(result.cookies ? { cookies: result.cookies } : {}),
    };

    const response = await buildSSRResponse(req, ctx, fallbackResult, builder);
    return this.respond(response);
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

    if (!customResponse) return null;
    appendDataResponseMetadata(customResponse.headers, result);
    return this.respond(customResponse);
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
