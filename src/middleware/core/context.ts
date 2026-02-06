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

  private respondWithContent(body: string, contentType: string, init?: ResponseInit): Response {
    return new Response(body, {
      ...init,
      headers: {
        "content-type": contentType,
        ...init?.headers,
      },
    });
  }

  text(text: string, init?: ResponseInit): Response {
    return this.respondWithContent(text, "text/plain; charset=utf-8", init);
  }

  html(html: string, init?: ResponseInit): Response {
    return this.respondWithContent(html, "text/html; charset=utf-8", init);
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
