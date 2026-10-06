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
import { getApplicationPreflightHeaders } from "#veryfront/security/http/application-request.ts";
import { DEFAULT_CORS_METHODS, handleCORSPreflight } from "#veryfront/security";
import {
  type ApplicationInferenceAdmitter,
  createHostApplicationInferenceAdmission,
} from "./application-inference-admission.ts";
import { runWithApplicationInferenceAdmission } from "#veryfront/agent/runtime/application-inference-admission.ts";

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

  async prepareFrameworkOwnedPreflight(req: Request, ctx: HandlerContext): Promise<boolean> {
    if (req.method.toUpperCase() !== "OPTIONS") return false;
    const isBrowserPreflight = isPreflightRequest(req);
    if (requiresIsolatedProjectRuntime(ctx)) {
      if (isBrowserPreflight) ctx.frameworkOwnedPreflight = true;
      return isBrowserPreflight;
    }

    const fsWrapper = ctx.adapter.fs as FsWrapper;
    const isMultiProject = !!ctx.projectSlug &&
      typeof fsWrapper.isMultiProjectMode === "function" &&
      fsWrapper.isMultiProjectMode();
    const inspect = async (): Promise<boolean> => {
      await preparePreviewDocumentSourceSnapshot(ctx);
      const result = await withApiHandler(
        ctx,
        (api) => api.prepareFrameworkOwnedPreflight(req, ctx),
        { sourceSnapshotReady: true },
      );
      ctx.frameworkOwnedPreflight = result.frameworkOwned;
      if (result.response) ctx.frameworkPreflightResponse = result.response;
      return result.frameworkOwned;
    };

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
          return await this.handleDeniedProjectExecution(req, ctx, pathname);
        }

        const preparedResponse = this.handlePreparedFrameworkPreflight(req, ctx);
        if (preparedResponse) return preparedResponse;

        const admitInference = createHostApplicationInferenceAdmission(req, ctx);
        const canResolveAsPage = this.canResolveAsPage(req, pathname);

        // A document path can change ownership between App Router page and
        // route.ts without changing the branch identity. Establish strict
        // freshness before classifying it, then let SSR reuse that snapshot.
        // This must stay outside the API-discovery catch: downstream document
        // handlers must never serve an older snapshot after freshness fails.
        await this.prepareApiSourceSnapshot(
          req,
          ctx,
          pathname,
          mustDenyProjectExecution,
          canResolveAsPage,
        );

        try {
          return await this.handleDiscoveredApiRequest(
            req,
            ctx,
            pathname,
            canResolveAsPage,
            admitInference,
          );
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

  private canResolveAsPage(req: Request, pathname: string): boolean {
    return pathname !== "/api" &&
      !pathname.startsWith("/api/") &&
      (req.method === "GET" || req.method === "HEAD");
  }

  private async prepareApiSourceSnapshot(
    req: Request,
    ctx: HandlerContext,
    pathname: string,
    mustDenyProjectExecution: boolean,
    canResolveAsPage: boolean,
  ): Promise<void> {
    if (!canResolveAsPage) {
      await ensurePreviewSourceSnapshotFresh(ctx);
      return;
    }

    await preparePreviewDocumentSourceSnapshot(
      ctx,
      () => this.handleWithContext(req, ctx, pathname, mustDenyProjectExecution),
    );
  }

  private async handleDiscoveredApiRequest(
    req: Request,
    ctx: HandlerContext,
    pathname: string,
    canResolveAsPage: boolean,
    admitInference: ApplicationInferenceAdmitter | undefined,
  ): Promise<HandlerResult> {
    if (canResolveAsPage && await this.isPageRequest(pathname, ctx, req.signal)) {
      return this.continue();
    }

    const apiRes = await this.executeApiRoute(req, ctx, admitInference);
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

    return this.respond(this.finalizeApiResponse(req, ctx, apiRes));
  }

  private async executeApiRoute(
    req: Request,
    ctx: HandlerContext,
    admitInference: ApplicationInferenceAdmitter | undefined,
  ): Promise<Response | null> {
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

    const executeRoute = () =>
      withApiHandler(
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

    if (admitInference) {
      return await runWithApplicationInferenceAdmission(admitInference, executeRoute, req.signal);
    }
    return await executeRoute();
  }

  private async handleDeniedProjectExecution(
    req: Request,
    ctx: HandlerContext,
    pathname: string,
  ): Promise<HandlerResult> {
    if (isPreflightRequest(req)) {
      const response = await handleCORSPreflight({
        request: req,
        config: ctx.securityConfig?.cors,
        allowMethods: DEFAULT_CORS_METHODS.join(", "),
        allowHeaders: getApplicationPreflightHeaders(req, {
          denyHeaders: ctx.applicationIdentityHeaderNames ?? [],
        }),
      });
      response.headers.set("Allow", DEFAULT_CORS_METHODS.join(", "));
      return this.respond(this.finalizePreflightResponse(req, ctx, response));
    }
    // A shared runtime without an explicit execution grant cannot serve any
    // project-owned route. Reject before refreshing or classifying tenant
    // source that no downstream handler is allowed to execute.
    return this.projectExecutionUnavailable(req, ctx, pathname);
  }

  private handlePreparedFrameworkPreflight(
    req: Request,
    ctx: HandlerContext,
  ): HandlerResult | null {
    if (req.method.toUpperCase() !== "OPTIONS" || !ctx.frameworkPreflightResponse) return null;
    return this.respond(this.finalizePreflightResponse(req, ctx, ctx.frameworkPreflightResponse));
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

  private finalizePreflightResponse(
    req: Request,
    ctx: HandlerContext,
    response: Response,
  ): Response {
    // The prepared response already carries the validated CORS policy headers;
    // only security and response headers are added here.
    return this.createResponseBuilder(ctx)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withHeaders(response.headers)
      .build(response.body, response.status);
  }

  private finalizeApiResponse(req: Request, ctx: HandlerContext, response: Response): Response {
    return this.createResponseBuilder(ctx)
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .withHeaders(response.headers)
      .build(response.body, response.status);
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
