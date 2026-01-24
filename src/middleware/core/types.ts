export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

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

export type Next = () => Promise<Response | undefined> | Response;

export type MiddlewareHandler = (
  c: Context,
  next: Next,
) => Promise<Response | undefined> | Response | undefined;

export type MiddlewareFactory<T = unknown> = (options?: T) => MiddlewareHandler;
