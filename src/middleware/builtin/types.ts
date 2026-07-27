import type { Next } from "../core/types.ts";
export type { Next };

export interface MiddlewareContext {
  request: Request;
}

export type Middleware = (
  ctx: MiddlewareContext,
  next: Next,
) => Promise<Response | undefined> | Response | undefined;

export type AnyMiddlewareContext =
  | MiddlewareContext
  | { req: Request }
  | { request: Request };

export function getRequest(ctx: AnyMiddlewareContext): Request {
  if ("req" in ctx) return ctx.req;
  return ctx.request;
}

/**
 * Legacy middleware origin-validator contract.
 *
 * The canonical CORS implementation also accepts validators that return an
 * explicit allowed-origin string. Import `OriginValidator` from
 * `veryfront/security` when that broader contract is required.
 */
export type OriginValidator = (origin: string) => boolean | Promise<boolean>;

/**
 * Legacy-compatible CORS option subset retained for middleware consumers.
 *
 * `cors()` also accepts `boolean` and the broader `CORSConfig` exported by
 * `veryfront/security`.
 */
export interface CorsOptions {
  origin?: string | string[] | OriginValidator;
  methods?: string[];
  allowedHeaders?: string[];
  exposedHeaders?: string[];
  credentials?: boolean;
  maxAge?: number;
}

export interface CorsValidationResult {
  allowedOrigin: string | null;
  allowCredentials: boolean;
  error?: string;
}
