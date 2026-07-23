import type { RuntimeResponse } from "#veryfront/platform/adapters/base.ts";

/** Platform execution hooks available to request middleware. */
export interface ExecutionContext {
  /** Keep background work alive after the response is returned. */
  waitUntil(promise: Promise<unknown>): void;
  /** Let the runtime handle an exception after middleware propagation. */
  passThroughOnException(): void;
}

/** Environment access required for middleware error handling. */
export interface MiddlewareExecutionAdapter {
  /** Read runtime environment values without exposing the full platform adapter. */
  readonly env: {
    get(key: string): string | undefined;
  };
}

/** Request state and response helpers available to middleware. */
export interface Context {
  /** Incoming request. */
  req: Request;
  /** Alias for the incoming request. */
  request: Request;
  /** Request-scoped environment bindings. */
  env: Record<string, unknown>;
  /** Optional platform execution hooks. */
  executionCtx?: ExecutionContext;
  /** Mutable request-scoped values for direct interoperability. */
  var: Record<string, unknown>;
  /** Create a JSON response. */
  json(object: unknown, init?: ResponseInit): Response;
  /** Create a plain-text response. */
  text(text: string, init?: ResponseInit): Response;
  /** Create an HTML response. */
  html(html: string, init?: ResponseInit): Response;
  /** Create a redirect response. */
  redirect(location: string, status?: number): Response;
  /** Store a request-scoped value. */
  set(key: string, value: unknown): void;
  /** Read a request-scoped value. */
  get(key: string): unknown;
}

/** Continue to the next middleware or terminal request handler. */
export type Next = () => Promise<Response | undefined> | Response;

/** Handler for middleware. */
export type MiddlewareHandler = (
  c: Context,
  next: Next,
) => Promise<Response | undefined> | Response | undefined;

/** Internal middleware continuation that can carry a runtime upgrade signal. */
export type RuntimeNext = () => Promise<RuntimeResponse | undefined> | RuntimeResponse;

/** Internal middleware handler that can carry a runtime upgrade signal. */
export type RuntimeMiddlewareHandler = (
  c: Context,
  next: RuntimeNext,
) => Promise<RuntimeResponse | undefined> | RuntimeResponse | undefined;

/** Create middleware from optional configuration. */
export type MiddlewareFactory<T = unknown> = (options?: T) => MiddlewareHandler;
