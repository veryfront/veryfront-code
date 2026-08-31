import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { getApiHandler, withApiHandler } from "./pages-api-handler.ts";
import {
  ensurePreviewSourceSnapshotFresh,
  preparePreviewDocumentSourceSnapshot,
} from "../source-snapshot-freshness.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ensureProjectDiscovery } from "./project-discovery.ts";
import { PageResolver } from "#veryfront/rendering/page-resolution/page-resolver.ts";
import {
  createErrorResponseFromDefinition,
  PROJECT_EXECUTION_UNAVAILABLE,
} from "#veryfront/errors";
import { requiresIsolatedProjectRuntime } from "#veryfront/security/project-locality.ts";
import { isPreflightRequest } from "#veryfront/security/http/cors/preflight.ts";

type FsWrapper = {
  isMultiProjectMode?: () => boolean;
  isContextualMode?: () => boolean;
  runWithContext?: <T>(
    slug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ) => Promise<T>;
};

export class ApiHandlerWrapper extends BaseHandler {
  private projectDir: string;
  private adapter: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter;
  private initPromise: Promise<void> | null = null;

  metadata: HandlerMetadata = {
    name: "ApiHandlerWrapper",
    priority: PRIORITY_MEDIUM_API as HandlerPriority,
  };

  constructor(
    projectDir: string,
    adapter: import("#veryfront/platform/adapters/base.ts").RuntimeAdapter,
  ) {
    super();
    this.projectDir = projectDir;
    this.adapter = adapter;
  }

  async initialize(): Promise<void> {
    this.initPromise ??= (async () => {
      await getApiHandler({
        projectDir: this.projectDir,
        adapter: this.adapter,
      } as HandlerContext);
    })();

    await this.initPromise;
  }

  async isFrameworkOwnedPreflight(req: Request, ctx: HandlerContext): Promise<boolean> {
    if (!isPreflightRequest(req)) return false;

    const fsWrapper = ctx.adapter.fs as FsWrapper;
    const isMultiProject = !!ctx.projectSlug &&
      typeof fsWrapper.isMultiProjectMode === "function" &&
      fsWrapper.isMultiProjectMode();
    const inspect = async (): Promise<boolean> => {
      await ensurePreviewSourceSnapshotFresh(ctx);
      return await withApiHandler(
        ctx,
        (api) => api.isFrameworkOwnedPreflight(req, ctx),
        { sourceSnapshotReady: true },
      );
    };

    try {
      if (!isMultiProject) {
        if (fsWrapper.isContextualMode?.() === true) return false;
        return await inspect();
      }

      return await fsWrapper.runWithContext!(
        ctx.projectSlug!,
        ctx.proxyToken ?? "",
        inspect,
        ctx.projectId,
        {
          productionMode: ctx.requestContext?.mode === "production",
          releaseId: ctx.releaseId,
          branch: ctx.requestContext?.mode === "production"
            ? null
            : ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ?? null,
          environmentName: ctx.environmentName,
        },
      );
    } catch {
      // Classification is an optimization. If route inspection cannot be
      // completed, retain middleware and route execution for correctness.
      return false;
    }
  }

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

    const isMultiProject = !!ctx.projectSlug &&
      typeof fsWrapper.isMultiProjectMode === "function" &&
      fsWrapper.isMultiProjectMode();

    const mustDenyProjectExecution = requiresIsolatedProjectRuntime(ctx);

    if (!isMultiProject) {
      // Request-global token and branch mutators cannot keep classification
      // and the later render on one context when requests overlap. Only an
      // atomic runWithContext adapter may serve contextual project source.
      if (fsWrapper.isContextualMode?.() === true) {
        return this.projectExecutionUnavailable(
          req,
          ctx,
          pathname,
          "Contextual project filesystem access requires atomic request-scoped execution",
        );
      }
      return this.handleWithContext(req, ctx, pathname, mustDenyProjectExecution);
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

    return fsWrapper.runWithContext!(
      ctx.projectSlug!,
      ctx.proxyToken ?? "",
      // Multi-project mode implies a shared runtime, but not that execution is
      // denied: a host-owned entrypoint can still have granted the capability.
      () => this.handleWithContext(req, ctx, pathname, mustDenyProjectExecution),
      ctx.projectId,
      {
        productionMode: isProduction,
        releaseId: ctx.releaseId,
        branch: isProduction ? null : ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ??
          null,
        environmentName: ctx.environmentName,
      },
    );
  }

  private async handleWithContext(
    req: Request,
    ctx: HandlerContext,
    pathname: string,
    mustDenyProjectExecution: boolean,
  ): Promise<HandlerResult> {
    return withSpan(
      "api.handleWithContext",
      async () => {
        if (req.signal.aborted) throw req.signal.reason;

        if (mustDenyProjectExecution) {
          // A shared runtime without an explicit execution grant cannot serve
          // any project-owned route. Reject before refreshing or classifying
          // tenant source that no downstream handler is allowed to execute.
          return this.projectExecutionUnavailable(req, ctx, pathname);
        }

        const canResolveAsPage = pathname !== "/api" &&
          !pathname.startsWith("/api/") &&
          (req.method === "GET" || req.method === "HEAD");

        // A document path can change ownership between App Router page and
        // route.ts without changing the branch identity. Establish strict
        // freshness before classifying it, then let SSR reuse that snapshot.
        // This must stay outside the API-discovery catch: downstream document
        // handlers must never serve an older snapshot after freshness fails.
        if (canResolveAsPage) {
          await preparePreviewDocumentSourceSnapshot(
            ctx,
            () => this.handleWithContext(req, ctx, pathname, mustDenyProjectExecution),
          );
        } else {
          await ensurePreviewSourceSnapshotFresh(ctx);
        }

        try {
          let isPageRequest = false;
          if (canResolveAsPage) {
            isPageRequest = await this.isPageRequest(pathname, ctx, req.signal);
          }

          if (isPageRequest) {
            return this.continue();
          }

          // OPTIONS is authenticated by APIRouteHandler before discovery. The
          // callback runs after a matched route's auth decision but before the
          // route module is loaded or executed.
          const isOptionsRequest = req.method.toUpperCase() === "OPTIONS";
          if (!isOptionsRequest) {
            // Lazy per-project primitive discovery (agents, tools) on first
            // access. Must run within runWithContext so VFS and registry scope
            // are correct.
            await ensureProjectDiscovery(ctx);
          }

          const apiRes = await withApiHandler(
            ctx,
            (api) =>
              api.handle(
                req,
                ctx,
                isOptionsRequest
                  ? {
                    beforeOptionsDispatch: async () => {
                      await ensureProjectDiscovery(ctx);
                    },
                  }
                  : undefined,
              ),
            { sourceSnapshotReady: true },
          );

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
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .withHeaders(apiRes.headers)
            .build(apiRes.body, apiRes.status);

          return this.respond(finalRes);
        } catch (error) {
          if (req.signal.aborted) throw error;
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
        "api.projectSlug": ctx.projectSlug ?? "unknown",
      },
    );
  }

  private projectExecutionUnavailable(
    req: Request,
    ctx: HandlerContext,
    pathname: string,
    detail =
      "Shared runtimes do not execute tenant API modules in the host process or same-process Workers",
  ): HandlerResult {
    const problem = createErrorResponseFromDefinition(
      PROJECT_EXECUTION_UNAVAILABLE,
      {
        detail,
        instance: pathname,
      },
    );
    const response = this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withCache("no-store")
      .withHeaders(problem.headers)
      .build(req.method === "HEAD" ? null : problem.body, problem.status);
    return this.respond(response, { executionTopology: "dedicated-runtime-required" });
  }

  private async isPageRequest(
    pathname: string,
    ctx: HandlerContext,
    signal?: AbortSignal,
  ): Promise<boolean> {
    const slug = pathname === "/" ? "" : pathname.replace(/^\/+|\/+$/g, "");
    const pageResolver = new PageResolver({
      projectDir: ctx.projectDir,
      projectId: ctx.projectId,
      config: ctx.config ?? {},
      adapter: ctx.adapter,
    });

    try {
      return await pageResolver.pageExists(slug, { signal });
    } catch (error) {
      if (signal?.aborted) throw error;
      this.logDebug(
        "[API-Wrapper] Page ownership is indeterminate; preserving API discovery",
        {
          pathname,
          error: this.getErrorMessage(error),
        },
        ctx,
      );
      return false;
    }
  }
}
