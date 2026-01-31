export type Next = () => Promise<Response | undefined> | Response;

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

export type OriginValidator = (origin: string) => boolean | Promise<boolean>;

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
