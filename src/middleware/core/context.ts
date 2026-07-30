import type { Context, ExecutionContext } from "./types.ts";
import { HTTP_REDIRECT_FOUND } from "#veryfront/utils";
import { inheritRequestPeerProvenance } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

/** Context for middleware. */
export class MiddlewareContext implements Context {
  env: Record<string, unknown>;
  executionCtx?: ExecutionContext;
  var: Record<string, unknown> = {};

  private currentRequest: Request;
  private store = new Map<string, unknown>();

  constructor(
    req: Request,
    env: Record<string, unknown> = {},
    executionCtx?: ExecutionContext,
  ) {
    this.currentRequest = this.requireRequest(req);
    this.env = env;
    this.executionCtx = executionCtx;
  }

  get req(): Request {
    return this.currentRequest;
  }

  set req(request: Request) {
    this.currentRequest = inheritRequestPeerProvenance(
      this.currentRequest,
      this.requireRequest(request),
    );
  }

  get request(): Request {
    return this.currentRequest;
  }

  set request(request: Request) {
    this.currentRequest = inheritRequestPeerProvenance(
      this.currentRequest,
      this.requireRequest(request),
    );
  }

  json(object: unknown, init?: ResponseInit): Response {
    return Response.json(object, init);
  }

  private respondWithContent(body: string, contentType: string, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", contentType);

    return new Response(body, {
      ...init,
      headers,
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

  private requireRequest(request: Request): Request {
    if (!(request instanceof Request)) {
      throw new TypeError("Middleware context request must be a Request");
    }
    return request;
  }
}
