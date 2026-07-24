import { BaseHandler } from "../../response/base.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "../../types.ts";
import { getApiHandler, withApiHandler } from "./pages-api-handler.ts";
import { PRIORITY_MEDIUM_API } from "#veryfront/utils/constants/index.ts";
import { withSpan } from "#veryfront/observability/tracing/otlp-setup.ts";
import { ensureProjectDiscovery } from "./project-discovery.ts";
import {
  SECURITY_POLICY_RESPONSE_HEADER_NAMES,
} from "#veryfront/security/http/response/security-handler.ts";
import { isWorkerIsolationEnabled } from "#veryfront/security/sandbox/worker-pool.ts";
import { internalServerError, serviceUnavailable } from "#veryfront/http/responses";
import { snapshotThrowableDiagnostic } from "#veryfront/errors/safe-diagnostics.ts";

const NativeResponse = Response;
const stringStartsWith = String.prototype.startsWith;
const apply = Reflect.apply;

type FsWrapper = {
  isMultiProjectMode?: () => boolean;
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

function removeProjectSecurityHeaders(headers: Headers): void {
  for (const name of SECURITY_POLICY_RESPONSE_HEADER_NAMES) headers.delete(name);
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
      {
        productionMode: isProduction,
        releaseId: ctx.releaseId,
        branch: isProduction ? null : ctx.requestContext?.branch ?? ctx.parsedDomain?.branch ??
          null,
        environmentName: ctx.environmentName,
      },
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
        const ownsApiPath = pathname === "/api" ||
          apply(stringStartsWith, pathname, ["/api/"]);
        try {
          // In-process discovery imports project modules into host registries.
          // Isolated API handling must never cross that boundary: the route
          // handler either uses worker-owned prepared capabilities or rejects
          // the unsupported project explicitly before creating a worker.
          if (!isWorkerIsolationEnabled()) {
            await ensureProjectDiscovery(ctx);
          }

          const apiRes = await withApiHandler(
            ctx,
            (api) => api.handle(req, ctx, { applyCORS: false }),
          );

          if (!apiRes) {
            this.logDebug(
              "[API-Wrapper] API handler returned null",
              { pathname, terminal: ownsApiPath },
              ctx,
            );
            if (ownsApiPath) {
              return this.respond(serviceUnavailable("API route unavailable"));
            }
            return this.continue();
          }

          const normalizedApiRes = apiRes.status === 0
            ? internalServerError("API route returned an invalid response")
            : apiRes;

          this.logDebug(
            "[API-Wrapper] API handler returned response",
            { pathname, status: normalizedApiRes.status },
            ctx,
          );

          const builder = this.createResponseBuilder(ctx)
            .withHeaders(normalizedApiRes.headers);
          removeProjectSecurityHeaders(builder.headers);
          builder.withSecurity(ctx.securityConfig ?? undefined, req);
          await builder.withCORSAsync(req);

          const finalRes = new NativeResponse(normalizedApiRes.body, {
            status: normalizedApiRes.status,
            statusText: normalizedApiRes.statusText,
            headers: builder.headers,
          });

          return this.respond(finalRes);
        } catch (error) {
          this.logDebug(
            "[API-Wrapper] API handler error",
            {
              pathname,
              terminal: ownsApiPath,
              error: snapshotThrowableDiagnostic(error),
            },
            ctx,
          );

          if (ownsApiPath) {
            return this.respond(serviceUnavailable("API route unavailable"));
          }
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
