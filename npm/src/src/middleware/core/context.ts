import * as dntShim from "../../../_dnt.shims.js";
import type { Context, ExecutionContext } from "./types.js";
import { HTTP_REDIRECT_FOUND } from "../../utils/index.js";

export class MiddlewareContext implements Context {
  req: dntShim.Request;
  request: dntShim.Request;
  env: Record<string, unknown>;
  executionCtx?: ExecutionContext;
  var: Record<string, unknown> = {};

  private store = new Map<string, unknown>();

  constructor(
    req: dntShim.Request,
    env: Record<string, unknown> = {},
    executionCtx?: ExecutionContext,
  ) {
    this.req = req;
    this.request = req; // Alias for compatibility
    this.env = env;
    this.executionCtx = executionCtx;
  }

  json(object: unknown, init?: dntShim.ResponseInit): dntShim.Response {
    return dntShim.Response.json(object, init);
  }

  text(text: string, init?: dntShim.ResponseInit): dntShim.Response {
    return new dntShim.Response(text, {
      ...init,
      headers: {
        "content-type": "text/plain; charset=utf-8",
        ...(init?.headers ?? {}),
      },
    });
  }

  html(html: string, init?: dntShim.ResponseInit): dntShim.Response {
    return new dntShim.Response(html, {
      ...init,
      headers: {
        "content-type": "text/html; charset=utf-8",
        ...(init?.headers ?? {}),
      },
    });
  }

  redirect(location: string, status: number = HTTP_REDIRECT_FOUND): dntShim.Response {
    return new dntShim.Response(null, {
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
