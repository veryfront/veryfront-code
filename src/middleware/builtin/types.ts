import type { Next } from "../core/types.ts";
export type { Next };

/** Minimal context accepted by legacy built-in middleware. */
export interface LegacyMiddlewareContext {
  /** Incoming request. */
  request: Request;
}

/** Middleware signature used by built-in middleware factories. */
export type Middleware = (
  ctx: LegacyMiddlewareContext,
  next: Next,
) => Promise<Response | undefined> | Response | undefined;

/** Context shapes accepted by built-in request extraction. */
export type AnyMiddlewareContext =
  | LegacyMiddlewareContext
  | { req: Request }
  | { request: Request };

/** Read the incoming request from a supported middleware context. */
export function getRequest(ctx: AnyMiddlewareContext): Request {
  if ("req" in ctx) return ctx.req;
  return ctx.request;
}

export interface CorsValidationResult {
  allowedOrigin: string | null;
  allowCredentials: boolean;
  error?: string;
}
