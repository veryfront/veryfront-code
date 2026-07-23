import type { Context, ExecutionContext } from "./types.ts";
import { HTTP_REDIRECT_FOUND } from "#veryfront/utils";

/** Request-scoped context passed to middleware. */
export class MiddlewareContext implements Context {
  /** Incoming request. */
  req: Request;
  /** Alias for the incoming request. */
  request: Request;
  /** Request-scoped environment bindings. */
  env: Record<string, unknown>;
  /** Optional platform execution hooks. */
  executionCtx?: ExecutionContext;
  /** Mutable request-scoped values for direct interoperability. */
  var: Record<string, unknown> = {};

  /** Create a middleware context for an incoming request. */
  constructor(
    req: Request,
    env: Record<string, unknown> = {},
    executionCtx?: ExecutionContext,
  ) {
    if (!(req instanceof Request)) {
      throw new TypeError("request must be a Request");
    }
    if (env === null || typeof env !== "object" || Array.isArray(env)) {
      throw new TypeError("env must be an object");
    }
    if (
      executionCtx !== undefined &&
      (executionCtx === null || typeof executionCtx !== "object" ||
        typeof executionCtx.waitUntil !== "function" ||
        typeof executionCtx.passThroughOnException !== "function")
    ) {
      throw new TypeError("executionCtx must implement the execution context hooks");
    }
    this.req = req;
    this.request = req; // Alias for compatibility
    this.env = env;
    this.executionCtx = executionCtx;
  }

  /** Create a JSON response. */
  json(object: unknown, init?: ResponseInit): Response {
    return Response.json(object, init);
  }

  /** Create a response with a default content type that callers can override. */
  private respondWithContent(body: string, contentType: string, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", contentType);
    return new Response(body, {
      ...init,
      headers,
    });
  }

  /** Create a plain-text response. */
  text(text: string, init?: ResponseInit): Response {
    return this.respondWithContent(text, "text/plain; charset=utf-8", init);
  }

  /** Create an HTML response. */
  html(html: string, init?: ResponseInit): Response {
    return this.respondWithContent(html, "text/html; charset=utf-8", init);
  }

  /** Create a redirect response. */
  redirect(location: string, status: number = HTTP_REDIRECT_FOUND): Response {
    if (!Number.isInteger(status) || status < 300 || status > 399) {
      throw new RangeError("redirect status must be an integer between 300 and 399");
    }
    return new Response(null, {
      status,
      headers: { Location: location },
    });
  }

  /** Store a request-scoped value. */
  set(key: string, value: unknown): void {
    Object.defineProperty(this.var, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  /** Read a request-scoped value. */
  get(key: string): unknown {
    return Object.hasOwn(this.var, key) ? this.var[key] : undefined;
  }
}
