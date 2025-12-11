
import { BaseHandler } from "./base-handler.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "@veryfront/types";

function encodeBase64(value: string): string {
  if (typeof globalThis.btoa === "function") {
    try {
      return globalThis.btoa(value);
    } catch {
      const bytes = new TextEncoder().encode(value);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return globalThis.btoa(binary);
    }
  }

  const bufferCtor = (globalThis as {
    Buffer?: { from(input: string, encoding: string): { toString(encoding: string): string } };
  }).Buffer;
  if (bufferCtor) {
    return bufferCtor.from(value, "utf8").toString("base64");
  }

  throw toError(createError({
    type: "not_supported",
    message: "Base64 encoding is not supported in this runtime",
    feature: "Base64 encoding",
  }));
}

export class AuthHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AuthHandler",
    priority: 0 as HandlerPriority,
    patterns: [],
  };

  private basicUser: string | null = null;
  private basicPass: string | null = null;
  private bearerToken: string | null = null;

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    this.loadAuthConfig(ctx);

    if (req.method.toUpperCase() === "OPTIONS") {
      return Promise.resolve(this.continue());
    }

    if (this.shouldUseBasic()) {
      const result = this.checkBasicAuth(req);
      if (result) return Promise.resolve(result);
    }

    if (this.shouldUseBearer()) {
      const result = this.checkBearerAuth(req);
      if (result) return Promise.resolve(result);
    }

    return Promise.resolve(this.continue());
  }

  private loadAuthConfig(ctx: HandlerContext): void {
    this.basicUser = ctx.adapter.env.get("VERYFRONT_BASIC_USER") || "";
    this.basicPass = ctx.adapter.env.get("VERYFRONT_BASIC_PASS") || "";
    this.bearerToken = ctx.adapter.env.get("VERYFRONT_BEARER_TOKEN") || "";
  }

  private shouldUseBasic(): boolean {
    return !!(this.basicUser && this.basicPass);
  }

  private shouldUseBearer(): boolean {
    return !!this.bearerToken;
  }

  private checkBasicAuth(req: Request): HandlerResult | null {
    const expected = `Basic ${encodeBase64(`${this.basicUser}:${this.basicPass}`)}`;
    const auth = req.headers.get("authorization") || "";

    if (auth !== expected) {
      const response = new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="Secure Area"' },
      });
      return this.respond(response);
    }

    return null;
  }

  private checkBearerAuth(req: Request): HandlerResult | null {
    const auth = req.headers.get("authorization") || "";

    if (!auth.startsWith("Bearer ") || auth.slice(7) !== this.bearerToken) {
      const response = new Response("Unauthorized", { status: 401 });
      return this.respond(response);
    }

    return null;
  }
}
