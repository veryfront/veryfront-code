import type { Context, ExecutionContext } from "./types.ts";
import { HTTP_REDIRECT_FOUND } from "#veryfront/utils";

export class MiddlewareContext implements Context {
  req: Request;
  request: Request;
  env: Record<string, unknown>;
  executionCtx?: ExecutionContext;
  var: Record<string, unknown> = {};

  private store = new Map<string, unknown>();

  constructor(
    req: Request,
    env: Record<string, unknown> = {},
    executionCtx?: ExecutionContext,
  ) {
    this.req = req;
    this.request = req; // Alias for compatibility
    this.env = env;
    this.executionCtx = executionCtx;
  }

  json(object: unknown, init?: ResponseInit): Response {
    return Response.json(object, init);
  }

  text(text: string, init?: ResponseInit): Response {
    return new Response(text, {
      ...init,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        ...(init?.headers ?? {}),
      },
    });
  }

  html(html: string, init?: ResponseInit): Response {
    return new Response(html, {
      ...init,
      headers: {
        "content-type": "text/html; charset=utf-8",
        ...(init?.headers ?? {}),
      },
    });
  }

  redirect(location: string, status: number = HTTP_REDIRECT_FOUND): Response {
    return new Response(null, {
      status,
      headers: { Location: location },
    });
  }

  set(key: string, value: unknown): void {
    this.store.set(key, value);
  }

  get(key: string): unknown {
    return this.store.get(key);
  }
}
