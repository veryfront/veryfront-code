/**
 * API Handler Wrapper
 *
 * Main handler class that wraps API route handling for both Pages Router and App Router.
 */

import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { getApiHandler } from "./pages-api-handler.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";

type FsWrapper = {
  isMultiProjectMode?: () => boolean;
  runWithContext?: <T>(
    slug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: { productionMode?: boolean; releaseId?: string | null },
  ) => Promise<T>;
};

/**
 * API handler wrapper for Pages and App Router
 *
 * Handles:
 * - Pages Router API routes (/api/*)
 * - App Router route.ts handlers
 *
 * @example
 * ```ts
 * const handler = new ApiHandlerWrapper(projectDir, adapter);
 * const result = await handler.handle(request, context);
 * ```
 */
export class ApiHandlerWrapper extends BaseHandler {
  private projectDir: string;
  private adapter: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
  private initPromise: Promise<void> | null = null;

  metadata: HandlerMetadata = {
    name: "ApiHandlerWrapper",
    priority: PRIORITY_MEDIUM_API as HandlerPriority, // MEDIUM priority
  };

  constructor(
    projectDir: string,
    adapter: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter,
  ) {
    super();
    this.projectDir = projectDir;
    this.adapter = adapter;
  }

  /**
   * Pre-initialize the API handler to discover routes before any requests
   * Call this after construction to avoid first-request 404s
   */
  async initialize(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = (async () => {
        // Pre-warm the API handler cache
        await getApiHandler({
          projectDir: this.projectDir,
          adapter: this.adapter,
        } as HandlerContext);
      })();
    }

    await this.initPromise;
  }

  /**
   * Handles incoming requests for API routes
   *
   * @param req - The incoming request
   * @param ctx - Handler context
   * @returns Handler result (respond or continue)
   */
  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const { pathname } = new URL(req.url);

    this.logDebug(
      "[API-Wrapper] Handling request",
      {
        pathname,
        projectDir: ctx.projectDir,
        projectSlug: ctx.projectSlug,
      },
      ctx,
    );

    const fsWrapper = ctx.adapter.fs as FsWrapper;

    if (
      !ctx.projectSlug ||
      typeof fsWrapper.isMultiProjectMode !== "function" ||
      !fsWrapper.isMultiProjectMode()
    ) {
      return await this.handleWithContext(req, ctx, pathname);
    }

    const isProduction = ctx.requestContext?.mode === "production";

    this.logDebug(
      "[API-Wrapper] Using multi-project context",
      {
        projectSlug: ctx.projectSlug,
        projectId: ctx.projectId,
        hasProxyToken: !!ctx.proxyToken,
        productionMode: isProduction,
      },
      ctx,
    );

    return await fsWrapper.runWithContext!(
      ctx.projectSlug,
      ctx.proxyToken || "",
      () => this.handleWithContext(req, ctx, pathname),
      ctx.projectId,
      { productionMode: isProduction, releaseId: ctx.releaseId },
    );
  }

  /**
   * Internal handler that runs within project context
   */
  private handleWithContext(
    req: Request,
    ctx: HandlerContext,
    pathname: string,
  ): Promise<HandlerResult> {
    return withSpan(
      "api.handleWithContext",
      async () => {
        try {
          const api = await getApiHandler(ctx);
          const apiRes = await api.handle(req);

          if (!apiRes) {
            this.logDebug(
              "[API-Wrapper] API handler returned null, continuing to next handler",
              { pathname },
              ctx,
            );
            return this.continue();
          }

          this.logDebug(
            "[API-Wrapper] API handler returned response",
            { pathname, status: apiRes.status },
            ctx,
          );

          const builder = this.createResponseBuilder(ctx);
          const finalRes = builder
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined)
            .withHeaders(apiRes.headers)
            .build(apiRes.body, apiRes.status);

          return this.respond(finalRes);
        } catch (error) {
          this.logDebug(
            "[API-Wrapper] API handler error - falling through to next handler",
            {
              pathname,
              error: this.getErrorMessage(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
            ctx,
          );

          return this.continue();
        }
      },
      {
        "api.pathname": pathname,
        "api.method": req.method,
        "api.projectSlug": ctx.projectSlug || "unknown",
      },
    );
  }
}
