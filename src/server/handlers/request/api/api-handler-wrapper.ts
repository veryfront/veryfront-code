import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { getApiHandler, withApiHandler } from "./pages-api-handler.ts";
import { HTTP_SERVER_ERROR, PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ensureProjectDiscovery } from "./project-discovery.ts";
import { resolveApiProjectExecution } from "./api-project-context.ts";

let injectedEnsureProjectDiscovery: typeof ensureProjectDiscovery | undefined;

/** @internal Test seam for proving remote requests do not run host discovery. */
export function __injectProjectDiscoveryForTests(
  dependency: typeof ensureProjectDiscovery | undefined,
): void {
  injectedEnsureProjectDiscovery = dependency;
}

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

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    this.logDebug("[API-Wrapper] Handling request", { method: req.method }, ctx);

    const execution = resolveApiProjectExecution(ctx);
    if (execution.kind === "single") {
      return this.handleWithContext(req, ctx);
    }
    if (execution.kind === "invalid") {
      this.logDebug("[API-Wrapper] Missing authenticated multi-project context", undefined, ctx);
      return this.apiFailure(req, ctx);
    }

    this.logDebug(
      "[API-Wrapper] Using multi-project context",
      {
        productionMode: execution.productionMode,
      },
      ctx,
    );

    try {
      return await execution.execute(() => this.handleWithContext(req, ctx));
    } catch (error) {
      this.logDebug("[API-Wrapper] Multi-project context failed", {
        errorType: error instanceof Error ? error.name : typeof error,
      }, ctx);
      return this.apiFailure(req, ctx);
    }
  }

  private handleWithContext(
    req: Request,
    ctx: HandlerContext,
  ): Promise<HandlerResult> {
    return withSpan(
      "api.handleWithContext",
      async () => {
        try {
          // Lazy per-project primitive discovery (agents, tools) on first access.
          // Must run within runWithContext so VFS and registry scope are correct.
          if (ctx.isLocalProject !== false) {
            await (injectedEnsureProjectDiscovery ?? ensureProjectDiscovery)(ctx);
          }

          const apiRes = await withApiHandler(ctx, (api) => api.handle(req, ctx));

          if (!apiRes) {
            this.logDebug(
              "[API-Wrapper] API handler returned null, continuing to next handler",
              undefined,
              ctx,
            );
            return this.continue();
          }

          this.logDebug(
            "[API-Wrapper] API handler returned response",
            { status: apiRes.status },
            ctx,
          );

          const builder = this.createResponseBuilder(ctx);
          const finalRes = builder
            .withHeaders(apiRes.headers)
            .withCORS(req, ctx.securityConfig?.cors)
            .withSecurity(ctx.securityConfig ?? undefined, req)
            .build(apiRes.body, apiRes.status);

          return this.respond(finalRes);
        } catch (error) {
          this.logDebug(
            "[API-Wrapper] API request failed",
            {
              errorType: error instanceof Error ? error.name : typeof error,
            },
            ctx,
          );

          return this.apiFailure(req, ctx);
        }
      },
      {
        "api.method": req.method,
      },
    );
  }

  private apiFailure(req: Request, ctx: HandlerContext): HandlerResult {
    const response = this.createResponseBuilder(ctx)
      .withCache("no-cache")
      .withCORS(req, ctx.securityConfig?.cors)
      .withSecurity(ctx.securityConfig ?? undefined, req)
      .json({ error: "API request failed" }, HTTP_SERVER_ERROR);

    return this.respond(response);
  }
}
