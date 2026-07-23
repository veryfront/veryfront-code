import type { HandlerHelpers } from "#veryfront/security";
import { generateNonce } from "#veryfront/security/http/response/security-handler.ts";
import {
  type ExtendedFileSystemAdapter,
  isExtendedFSAdapter,
} from "#veryfront/platform/adapters/fs/wrapper.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { serverLogger } from "#veryfront/utils";
import type { HandlerContext, HandlerResult } from "../../types.ts";
import {
  type SSRRenderResult,
  type SSRServiceLike,
} from "../../../services/rendering/ssr.service.ts";
import { ErrorPages } from "../../../utils/error-html.ts";
import { tryNotFoundFallback } from "./not-found-fallback.ts";
import { tryErrorPageFallback } from "./error-page-fallback.ts";
import { buildSSRResponse } from "./ssr-response-builder.ts";
import { buildSSRRenderOptions, isProductionMode } from "./ssr-request-policy.ts";

const logger = serverLogger.component("ssr");

/** Own the project context, rendering, fallback, and response lifecycle for SSR requests. */
export class SSRRequestCoordinator {
  constructor(
    readonly ssrService: SSRServiceLike,
    readonly helpers: HandlerHelpers,
  ) {}

  async handle(
    request: Request,
    ctx: HandlerContext,
    slug: string,
    url: URL,
  ): Promise<HandlerResult> {
    try {
      return await this.#runInProjectContext(request, ctx, slug, url);
    } catch (error) {
      logger.error("SSR request failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      return await this.#buildResponse(request, ctx, {
        status: 500,
        html: ErrorPages.serverError(),
        isStreaming: false,
        cacheStrategy: "no-cache",
        errorType: "server-error",
        slug,
      }, generateNonce());
    }
  }

  async #runInProjectContext(
    request: Request,
    ctx: HandlerContext,
    slug: string,
    url: URL,
  ): Promise<HandlerResult> {
    const fsAdapter = ctx.adapter.fs;
    const isExtended = isExtendedFSAdapter(fsAdapter);

    if (ctx.projectSlug && isExtended && fsAdapter.isMultiProjectMode()) {
      if (!ctx.proxyToken) {
        throw new Error("Multi-project SSR requires authenticated request context");
      }
      const productionMode = isProductionMode(ctx);
      const branch = ctx.parsedDomain?.branch ?? null;
      logger.debug("Using multi-project context", {
        productionMode,
        hasBranch: branch !== null,
      });

      return await fsAdapter.runWithContext(
        ctx.projectSlug,
        ctx.proxyToken,
        () => this.#render(request, ctx, slug, url),
        ctx.projectId,
        {
          productionMode,
          releaseId: ctx.releaseId,
          branch,
          environmentName: ctx.environmentName,
        },
      );
    }

    if (isExtended && fsAdapter.isContextualMode()) {
      this.#applyContextualAdapterState(fsAdapter, ctx);
    }

    return await this.#render(request, ctx, slug, url);
  }

  #applyContextualAdapterState(
    fsAdapter: ExtendedFileSystemAdapter,
    ctx: HandlerContext,
  ): void {
    try {
      if (ctx.proxyToken) fsAdapter.setRequestToken(ctx.proxyToken);
      fsAdapter.setRequestBranch(ctx.parsedDomain?.branch ?? null);
    } catch (error) {
      logger.warn("Non-critical adapter context setup failed (token/branch)", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }

    try {
      fsAdapter.setProductionMode(isProductionMode(ctx), ctx.releaseId);
    } catch (error) {
      logger.error("Failed to apply the SSR production mode", {
        errorType: error instanceof Error ? error.name : typeof error,
      });
      throw error;
    }
  }

  #render(
    request: Request,
    ctx: HandlerContext,
    slug: string,
    url: URL,
  ): Promise<HandlerResult> {
    return withSpan("ssr.handleWithContext", async () => {
      const memoryStatus = this.ssrService.checkMemoryPressure();
      if (memoryStatus.shouldReject) {
        this.helpers.logDebug("Rejecting due to memory pressure", undefined, ctx);
        return await this.#buildResponse(
          request,
          ctx,
          this.ssrService.createMemoryPressureResult(slug),
          generateNonce(),
        );
      }

      const nonce = generateNonce();
      const result = await this.ssrService.renderPage(
        ctx,
        buildSSRRenderOptions(request, ctx, url, slug, nonce),
      );

      if (result.errorType === "redirect" && result.redirectLocation) {
        return this.#handleRedirect(request, ctx, result, nonce);
      }
      if (result.errorType === "not-found") {
        return await this.#handleNotFound(request, ctx, slug, nonce);
      }
      if (result.errorType === "server-error" && !result.showDevOverlay) {
        const customResponse = await this.#tryCustomErrorFallback(request, ctx, result, nonce);
        if (customResponse) return customResponse;
      }
      return await this.#buildResponse(request, ctx, result, nonce);
    });
  }

  #handleRedirect(
    request: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    nonce: string,
  ): HandlerResult {
    const response = this.helpers.createResponseBuilder(ctx, nonce)
      .withCORS(request, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, request)
      .withCache(result.cacheStrategy)
      .withHeaders({ Location: result.redirectLocation ?? "/" })
      .build(null, result.status);
    return this.helpers.respond(response);
  }

  async #handleNotFound(
    request: Request,
    ctx: HandlerContext,
    slug: string,
    nonce: string,
  ): Promise<HandlerResult> {
    const builder = this.helpers.createResponseBuilder(ctx, nonce);
    const notFoundResponse = await tryNotFoundFallback(request, slug, ctx, builder);
    if (notFoundResponse) return this.helpers.respond(notFoundResponse);

    const customResponse = await tryErrorPageFallback(request, ctx, builder, {
      statusCode: 404,
      pathname: slug || "/",
    });
    if (customResponse) return this.helpers.respond(customResponse);

    return await this.#buildResponse(request, ctx, {
      status: 404,
      html: ErrorPages.notFound(slug || "/"),
      isStreaming: false,
      cacheStrategy: "no-cache",
      errorType: "not-found",
      slug,
    }, nonce);
  }

  async #tryCustomErrorFallback(
    request: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    nonce: string,
  ): Promise<HandlerResult | null> {
    const response = await tryErrorPageFallback(
      request,
      ctx,
      this.helpers.createResponseBuilder(ctx, nonce),
      {
        statusCode: result.status,
        error: result.error,
        pathname: result.slug || "/",
      },
    );
    return response ? this.helpers.respond(response) : null;
  }

  async #buildResponse(
    request: Request,
    ctx: HandlerContext,
    result: SSRRenderResult,
    nonce: string,
  ): Promise<HandlerResult> {
    const builder = this.helpers.createResponseBuilder(ctx, nonce);
    return this.helpers.respond(await buildSSRResponse(request, ctx, result, builder));
  }
}
