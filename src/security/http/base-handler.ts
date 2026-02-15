import type {
  Handler,
  HandlerContext,
  HandlerMetadata,
  HandlerResult,
  RoutePattern,
} from "#veryfront/types";
import { runWithCacheBatching } from "#veryfront/cache/request-cache-batcher.ts";
import { serverLogger } from "#veryfront/utils";
import { ResponseBuilder } from "./response/index.ts";

export interface HandlerHelpers {
  createResponseBuilder: (ctx: HandlerContext, nonce?: string) => ResponseBuilder;
  respond: (response: Response, metadata?: Record<string, unknown>) => HandlerResult;
  logDebug: (message: string, extra?: Record<string, unknown>, ctx?: HandlerContext) => void;
  getErrorMessage: (error: unknown) => string;
  continue: () => HandlerResult;
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

    const routePattern = pattern.pattern;

    if (typeof routePattern === "string") {
      return pattern.prefix ? pathname.startsWith(routePattern) : pathname === routePattern;
    }

    if (routePattern instanceof RegExp) return routePattern.test(pathname);

    return false;
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
    if (!ctx?.debug && !ctx?.adapter.env.get("VERYFRONT_DEBUG")) return;
    serverLogger.debug(`[${this.metadata.name}] ${message}`, extra ?? undefined);
  }

  protected logWarn(message: string, extra?: Record<string, unknown>, _ctx?: HandlerContext): void {
    serverLogger.warn(`[${this.metadata.name}] ${message}`, extra ?? undefined);
  }

  protected logInfo(message: string, extra?: Record<string, unknown>, _ctx?: HandlerContext): void {
    serverLogger.info(`[${this.metadata.name}] ${message}`, extra ?? undefined);
  }

  protected getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  protected continue(): HandlerResult {
    return { continue: true };
  }

  protected respond(response: Response, metadata?: Record<string, unknown>): HandlerResult {
    return { response, continue: false, metadata };
  }

  protected withProxyContext<T>(
    ctx: HandlerContext,
    fn: () => Promise<T>,
    options: { requireToken?: boolean } = {},
  ): Promise<T> {
    const fsWrapper = ctx.adapter.fs as {
      setRequestToken?: (t: string) => void;
      setRequestBranch?: (b: string | null) => void;
      isMultiProjectMode?: () => boolean;
      runWithContext?: <R>(
        slug: string,
        token: string,
        fn: () => Promise<R>,
        projectId?: string,
        options?: { productionMode?: boolean; releaseId?: string | null; branch?: string | null },
      ) => Promise<R>;
    };

    if (typeof fsWrapper.setRequestBranch === "function") {
      try {
        fsWrapper.setRequestBranch(ctx.parsedDomain?.branch ?? null);
      } catch {
        // Ignore - multi-project mode uses runWithContext for branch context
      }
    }

    const requireToken = options.requireToken ?? false;
    if (!ctx.projectSlug || (requireToken && !ctx.proxyToken)) return fn();

    if (fsWrapper.isMultiProjectMode?.()) {
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

      return fsWrapper.runWithContext!(
        ctx.projectSlug,
        ctx.proxyToken ?? "",
        fn,
        ctx.projectId,
        { productionMode: isProduction, releaseId: ctx.releaseId, branch },
      );
    }

    if (typeof fsWrapper.setRequestToken === "function" && ctx.proxyToken) {
      fsWrapper.setRequestToken(ctx.proxyToken);
    }

    return runWithCacheBatching(fn);
  }
}
