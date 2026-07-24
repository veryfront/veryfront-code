import type {
  Handler,
  HandlerContext,
  HandlerMetadata,
  HandlerResult,
  RoutePattern,
} from "#veryfront/types";
import { runWithCacheBatching } from "#veryfront/cache/request-cache-batcher.ts";
import { runWithVerifiedCacheApiCredential } from "#veryfront/cache/verified-api-credential-context.ts";
import type { VerifiedControlPlaneRequestClaims } from "#veryfront/internal-agents/control-plane-auth.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import type { WebSocketUpgradeResponse } from "#veryfront/platform/adapters/base.ts";
import { getErrorMessage as formatErrorMessage } from "#veryfront/errors/veryfront-error.ts";
import { serverLogger } from "#veryfront/utils";
import { ResponseBuilder } from "./response/index.ts";

export interface HandlerHelpers {
  createResponseBuilder: (ctx: HandlerContext, nonce?: string) => ResponseBuilder;
  respond: (
    response: Response | WebSocketUpgradeResponse,
    metadata?: Record<string, unknown>,
  ) => HandlerResult;
  logDebug: (message: string, extra?: Record<string, unknown>, ctx?: HandlerContext) => void;
  getErrorMessage: (error: unknown) => string;
  continue: () => HandlerResult;
}

/** Match a request pathname against one runtime route pattern. */
export function matchesRoutePathname(pathname: string, routePattern: RoutePattern): boolean {
  const pattern = routePattern.pattern;

  if (typeof pattern === "string") {
    const isPrefixMatch = routePattern.prefix ?? routePattern.exact === false;
    return isPrefixMatch ? pathname.startsWith(pattern) : pathname === pattern;
  }

  if (!pattern.global && !pattern.sticky) return pattern.test(pathname);

  const statelessMatcher = new RegExp(pattern.source, pattern.flags);
  return statelessMatcher.test(pathname);
}

export abstract class BaseHandler implements Handler {
  abstract metadata: HandlerMetadata;

  protected readonly helpers: HandlerHelpers = {
    createResponseBuilder: (ctx, nonce) => this.createResponseBuilder(ctx, nonce),
    respond: (response, metadata) => this.respond(response, metadata),
    logDebug: (message, extra, ctx) => this.logDebug(message, extra, ctx),
    getErrorMessage: (error) => this.getErrorMessage(error),
    continue: () => this.continue(),
  };

  abstract handle(req: Request, ctx: HandlerContext): Promise<HandlerResult>;

  protected shouldHandle(req: Request, ctx: HandlerContext): boolean {
    if (this.metadata.enabled && !this.metadata.enabled(ctx)) return false;

    const patterns = this.metadata.patterns;
    if (!patterns?.length) return true;

    const { pathname } = new URL(req.url);
    const method = req.method.toUpperCase();

    return patterns.some((pattern) => this.matchesPattern(pathname, method, pattern));
  }

  private matchesPattern(pathname: string, method: string, pattern: RoutePattern): boolean {
    if (pattern.method) {
      const methods = (Array.isArray(pattern.method) ? pattern.method : [pattern.method]).map((m) =>
        m.toUpperCase()
      );
      if (!methods.includes(method)) return false;
    }

    return matchesRoutePathname(pathname, pattern);
  }

  protected createResponseBuilder(
    ctx: HandlerContext,
    nonce?: string,
    _options?: Record<string, unknown>,
  ): ResponseBuilder {
    return new ResponseBuilder({
      securityConfig: ctx.securityConfig ?? undefined,
      isDev: !!ctx.isLocalProject,
      cspUserHeader: ctx.cspUserHeader,
      adapter: ctx.adapter,
      nonce,
      isVeryfrontDomain: ctx.parsedDomain?.allowIframeEmbed ?? false,
    });
  }

  protected logDebug(message: string, extra?: Record<string, unknown>, ctx?: HandlerContext): void {
    if (!ctx?.debug && !getHostEnv("VERYFRONT_DEBUG")) return;
    serverLogger.debug(`[${this.metadata.name}] ${message}`, extra ?? undefined);
  }

  protected logWarn(message: string, extra?: Record<string, unknown>, _ctx?: HandlerContext): void {
    serverLogger.warn(`[${this.metadata.name}] ${message}`, extra ?? undefined);
  }

  protected logInfo(message: string, extra?: Record<string, unknown>, _ctx?: HandlerContext): void {
    serverLogger.info(`[${this.metadata.name}] ${message}`, extra ?? undefined);
  }

  protected getErrorMessage(error: unknown): string {
    return formatErrorMessage(error);
  }

  protected continue(): HandlerResult {
    return { continue: true };
  }

  protected respond(
    response: Response | WebSocketUpgradeResponse,
    metadata?: Record<string, unknown>,
  ): HandlerResult {
    // HandlerResult deliberately remains HTTP-only. Runtime dispatch recognizes
    // the explicit non-DOM WebSocket signal before using normal Response APIs.
    return { response: response as Response, continue: false, metadata };
  }

  protected withProxyContext<T>(
    ctx: HandlerContext,
    fn: () => Promise<T>,
    options: {
      requireToken?: boolean;
      verifiedControlPlaneClaims?: VerifiedControlPlaneRequestClaims;
    } = {},
  ): Promise<T> {
    if (options.verifiedControlPlaneClaims) {
      return runWithVerifiedCacheApiCredential(
        options.verifiedControlPlaneClaims,
        () =>
          this.withProxyContext(ctx, fn, {
            requireToken: options.requireToken,
          }),
      );
    }

    // Framework-owned token: bypass project env overlay so proxy mode works
    // when a remote project overlay is active.
    const effectiveToken = ctx.proxyToken || getHostEnv("VERYFRONT_API_TOKEN") || "";
    const fsWrapper = ctx.adapter.fs as {
      setRequestToken?: (t: string) => void;
      setRequestBranch?: (b: string | null) => void;
      isMultiProjectMode?: () => boolean;
      runWithContext?: <R>(
        slug: string,
        token: string,
        fn: () => Promise<R>,
        projectId?: string,
        options?: {
          productionMode?: boolean;
          releaseId?: string | null;
          branch?: string | null;
          environmentName?: string | null;
        },
      ) => Promise<R>;
    };

    if (typeof fsWrapper.setRequestBranch === "function") {
      try {
        fsWrapper.setRequestBranch(ctx.parsedDomain?.branch ?? null);
      } catch (_) {
        /* expected: multi-project mode uses runWithContext for branch context */
      }
    }

    const requireToken = options.requireToken ?? false;

    // No project slug → local dev mode, no proxy context needed.
    if (!ctx.projectSlug) return fn();

    // Token required but missing in proxy mode → run fn() without
    // project-scoped credentials. This allows embedded framework modules
    // (e.g. /_vf_modules/_veryfront/...) to be served from the binary
    // while project-specific content will fail at the filesystem level
    // (no token = no access to remote project files).
    if (requireToken && !effectiveToken) {
      serverLogger.warn(
        `[${this.metadata.name}] No API token for proxy context — project content will be unavailable`,
        { projectSlug: ctx.projectSlug },
      );
      return fn();
    }

    if (fsWrapper.isMultiProjectMode?.()) {
      if (typeof fsWrapper.runWithContext !== "function") {
        return Promise.reject(
          new TypeError(
            "Multi-project filesystem mode requires a runWithContext adapter method",
          ),
        );
      }

      const isProduction = (ctx.resolvedEnvironment ?? ctx.requestContext?.mode) === "production";
      const branch = ctx.parsedDomain?.branch ?? null;

      this.logDebug(
        "[withProxyContext] Setting up multi-project context",
        {
          projectSlug: ctx.projectSlug,
          productionMode: isProduction,
          releaseId: ctx.releaseId,
          branch,
        },
        ctx,
      );

      return fsWrapper.runWithContext(
        ctx.projectSlug,
        effectiveToken,
        fn,
        ctx.projectId,
        {
          productionMode: isProduction,
          releaseId: ctx.releaseId,
          branch,
          environmentName: ctx.environmentName,
        },
      );
    }

    if (typeof fsWrapper.setRequestToken === "function" && effectiveToken) {
      fsWrapper.setRequestToken(effectiveToken);
    }

    return runWithCacheBatching(fn);
  }
}
