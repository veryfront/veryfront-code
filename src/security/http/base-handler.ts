
import type {
  Handler,
  HandlerContext,
  HandlerMetadata,
  HandlerResult,
  RoutePattern,
} from "@veryfront/types";
import { ResponseBuilder } from "./response/index.ts";
import { serverLogger } from "@veryfront/utils";

export abstract class BaseHandler implements Handler {
  abstract metadata: HandlerMetadata;

  abstract handle(req: Request, ctx: HandlerContext): Promise<HandlerResult>;

  protected shouldHandle(req: Request, ctx: HandlerContext): boolean {
    if (this.metadata.enabled && !this.metadata.enabled(ctx)) {
      return false;
    }

    if (!this.metadata.patterns || this.metadata.patterns.length === 0) {
      return true;
    }

    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    for (const pattern of this.metadata.patterns) {
      if (this.matchesPattern(pathname, method, pattern)) {
        return true;
      }
    }

    return false;
  }

  private matchesPattern(pathname: string, method: string, pattern: RoutePattern): boolean {
    if (pattern.method) {
      const methods = Array.isArray(pattern.method) ? pattern.method : [pattern.method];
      if (!methods.map((m) => m.toUpperCase()).includes(method)) {
        return false;
      }
    }

    if (typeof pattern.pattern === "string") {
      if (pattern.exact) {
        return pathname === pattern.pattern;
      } else if (pattern.prefix) {
        return pathname.startsWith(pattern.pattern);
      } else {
        return pathname === pattern.pattern;
      }
    } else if (pattern.pattern instanceof RegExp) {
      return pattern.pattern.test(pathname);
    }

    return false;
  }

  protected createResponseBuilder(ctx: HandlerContext, nonce?: string): ResponseBuilder {
    return new ResponseBuilder({
      securityConfig: ctx.securityConfig ?? undefined,
      isDev: ctx.mode === "development",
      cspUserHeader: ctx.cspUserHeader,
      adapter: ctx.adapter,
      nonce,
    });
  }

  protected logDebug(message: string, extra?: Record<string, unknown>, ctx?: HandlerContext): void {
    if (ctx?.debug || ctx?.adapter.env.get("VERYFRONT_DEBUG")) {
      serverLogger.debug(`[${this.metadata.name}] ${message}`, extra || undefined);
    }
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
}
