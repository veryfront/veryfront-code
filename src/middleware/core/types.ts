/** Context for execution. */
export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

/** Context for context. */
export interface Context {
  req: Request;
  request: Request;
  env: Record<string, unknown>;
  executionCtx?: ExecutionContext;
  var: Record<string, unknown>;
  json(object: unknown, init?: ResponseInit): Response;
  text(text: string, init?: ResponseInit): Response;
  html(html: string, init?: ResponseInit): Response;
  redirect(location: string, status?: number): Response;
  set(key: string, value: unknown): void;
  get(key: string): unknown;
}

/** Public API contract for next. */
export type Next = () => Promise<Response | undefined> | Response;

/** Handler for middleware. */
export type MiddlewareHandler = (
  c: Context,
  next: Next,
) => Promise<Response | undefined> | Response | undefined;

/** Public API contract for middleware factory. */
export type MiddlewareFactory<T = unknown> = (options?: T) => MiddlewareHandler;
