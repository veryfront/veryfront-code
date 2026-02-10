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
import { serverLogger } from "#veryfront/utils";

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

/** Tracks which projects have had AI discovery run (agents, tools, etc.). */
const discoveredProjects = new Set<string>();

/**
 * Run AI discovery (agents, tools) for a project if not already done.
 * Must be called within a runWithContext scope so the VFS can resolve
 * the correct remote project files and the agent registry uses the
 * correct project scope.
 */
async function ensureProjectDiscovery(ctx: HandlerContext): Promise<void> {
  const key = ctx.projectSlug ?? ctx.projectDir;
  if (discoveredProjects.has(key)) return;

  discoveredProjects.add(key);

  try {
    const { discoverAll } = await import("#veryfront/discovery");
    const result = await discoverAll({
      baseDir: ctx.projectDir,
      fsAdapter: ctx.adapter.fs,
      verbose: false,
    });

    serverLogger.debug("[API-Wrapper] Lazy AI discovery completed", {
      projectSlug: ctx.projectSlug,
      agents: result.agents.size,
      tools: result.tools.size,
    });
  } catch (error) {
    serverLogger.debug("[API-Wrapper] AI discovery skipped", {
      projectSlug: ctx.projectSlug,
      error: error instanceof Error ? error.message : String(error),
    });
  }
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

    if (!isMultiProject) {
      return this.handleWithContext(req, ctx, pathname);
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
      () => this.handleWithContext(req, ctx, pathname),
      ctx.projectId,
      { productionMode: isProduction, releaseId: ctx.releaseId },
    );
  }

  private handleWithContext(
    req: Request,
    ctx: HandlerContext,
    pathname: string,
  ): Promise<HandlerResult> {
    return withSpan(
      "api.handleWithContext",
      async () => {
        try {
          // Lazy per-project AI discovery (agents, tools) on first access.
          // Must run within runWithContext so VFS and registry scope are correct.
          await ensureProjectDiscovery(ctx);

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
        "api.projectSlug": ctx.projectSlug ?? "unknown",
      },
    );
  }
}
