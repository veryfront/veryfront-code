/**
 * Base handler abstract class
 * Provides common functionality for all handlers
 */

import type {
  Handler,
  HandlerContext,
  HandlerMetadata,
  HandlerResult,
  RoutePattern,
} from "@veryfront/types";
import { ResponseBuilder } from "./response/index.ts";
import { serverLogger } from "@veryfront/utils";

/**
 * Pre-bound handler helper methods.
 * Created once per handler instance to avoid repeated binding on each request.
 */
export interface HandlerHelpers {
  createResponseBuilder: (ctx: HandlerContext, nonce?: string) => ResponseBuilder;
  respond: (response: Response, metadata?: Record<string, unknown>) => HandlerResult;
  logDebug: (message: string, extra?: Record<string, unknown>, ctx?: HandlerContext) => void;
  getErrorMessage: (error: unknown) => string;
  continue: () => HandlerResult;
}

export abstract class BaseHandler implements Handler {
  abstract metadata: HandlerMetadata;

  /**
   * Pre-bound helper methods for passing to handler functions.
   * Bind methods once in constructor to avoid creating new functions on each request.
   */
  protected readonly helpers: HandlerHelpers;

  constructor() {
    this.helpers = {
      createResponseBuilder: this.createResponseBuilder.bind(this),
      respond: this.respond.bind(this),
      logDebug: this.logDebug.bind(this),
      getErrorMessage: this.getErrorMessage.bind(this),
      continue: this.continue.bind(this),
    };
  }

  /**
   * Main handler method to be implemented by subclasses
   */
  abstract handle(req: Request, ctx: HandlerContext): Promise<HandlerResult>;

  /**
   * Check if this handler should process the request
   */
  protected shouldHandle(req: Request, ctx: HandlerContext): boolean {
    // Check if handler is enabled
    if (this.metadata.enabled && !this.metadata.enabled(ctx)) {
      return false;
    }

    // If no patterns specified, handler decides internally
    if (!this.metadata.patterns || this.metadata.patterns.length === 0) {
      return true;
    }

    const url = new URL(req.url);
    const pathname = url.pathname;
    const method = req.method.toUpperCase();

    // Check each pattern
    for (const pattern of this.metadata.patterns) {
      if (this.matchesPattern(pathname, method, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if request matches a pattern
   */
  private matchesPattern(pathname: string, method: string, pattern: RoutePattern): boolean {
    // Check method if specified
    if (pattern.method) {
      const methods = Array.isArray(pattern.method) ? pattern.method : [pattern.method];
      if (!methods.map((m) => m.toUpperCase()).includes(method)) {
        return false;
      }
    }

    // Check path pattern
    if (typeof pattern.pattern === "string") {
      if (pattern.exact) {
        return pathname === pattern.pattern;
      } else if (pattern.prefix) {
        return pathname.startsWith(pattern.pattern);
      } else {
        // Default to exact match for strings
        return pathname === pattern.pattern;
      }
    } else if (pattern.pattern instanceof RegExp) {
      return pattern.pattern.test(pathname);
    }

    return false;
  }

  /**
   * Create a response builder with context
   * @param ctx - Handler context
   * @param nonce - Optional pre-generated nonce for CSP consistency
   * @param options - Additional options for the builder
   */
  protected createResponseBuilder(
    ctx: HandlerContext,
    nonce?: string,
    options?: { studioEmbed?: boolean },
  ): ResponseBuilder {
    return new ResponseBuilder({
      securityConfig: ctx.securityConfig ?? undefined,
      isDev: ctx.mode === "development",
      cspUserHeader: ctx.cspUserHeader,
      adapter: ctx.adapter,
      nonce, // Pass through the nonce if provided
      studioEmbed: options?.studioEmbed,
    });
  }

  /**
   * Log debug message if debug mode is enabled
   */
  protected logDebug(message: string, extra?: Record<string, unknown>, ctx?: HandlerContext): void {
    if (ctx?.debug || ctx?.adapter.env.get("VERYFRONT_DEBUG")) {
      serverLogger.debug(`[${this.metadata.name}] ${message}`, extra || undefined);
    }
  }

  /**
   * Helper to extract error message safely
   */
  protected getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
  }

  /**
   * Continue to next handler
   */
  protected continue(): HandlerResult {
    return { continue: true };
  }

  /**
   * Return a response and stop the chain
   */
  protected respond(response: Response, metadata?: Record<string, unknown>): HandlerResult {
    return { response, continue: false, metadata };
  }
}
