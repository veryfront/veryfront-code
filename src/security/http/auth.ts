import { BaseHandler } from "./base-handler.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "#veryfront/types";
import type { AuthConfig } from "./middleware/types.ts";
import { Buffer } from "node:buffer";
import { constantTimeEqual } from "../utils/constant-time.ts";

function encodeBase64(value: string): string {
  if (typeof globalThis.btoa === "function") {
    try {
      return globalThis.btoa(value);
    } catch {
      // Fallback for non-Latin1 strings
      const bytes = new TextEncoder().encode(value);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return globalThis.btoa(binary);
    }
  }

  const bufferCtor = (globalThis as { Buffer?: typeof Buffer }).Buffer;
  if (bufferCtor) return bufferCtor.from(value, "utf8").toString("base64");

  throw toError(
    createError({
      type: "not_supported",
      message: "Base64 encoding is not supported in this runtime",
      feature: "Base64 encoding",
    }),
  );
}

function sanitizeRealm(realm: string): string {
  return realm.replace(/[\x00-\x1f\x7f"\\]/g, "");
}

export class AuthHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "AuthHandler",
    priority: 0 as HandlerPriority, // CRITICAL priority - runs first
    patterns: [], // Checks all requests
  };

  private basicUser: string | null = null;
  private basicPass: string | null = null;
  private basicRealm = "Secure Area";
  private bearerToken: string | null = null;

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    this.loadAuthConfig(ctx);

    if (req.method.toUpperCase() === "OPTIONS") return Promise.resolve(this.continue());

    const basicResult = this.shouldUseBasic() ? this.checkBasicAuth(req) : null;
    if (basicResult) return Promise.resolve(basicResult);

    const bearerResult = this.shouldUseBearer() ? this.checkBearerAuth(req) : null;
    if (bearerResult) return Promise.resolve(bearerResult);

    return Promise.resolve(this.continue());
  }

  private loadAuthConfig(ctx: HandlerContext): void {
    // Reset per-request auth state to avoid leaking config across requests.
    this.basicUser = null;
    this.basicPass = null;
    this.basicRealm = "Secure Area";
    this.bearerToken = null;

    const authConfig = ctx.securityConfig?.auth as AuthConfig | undefined;

    if (authConfig?.basic) {
      this.basicUser = authConfig.basic.username;
      this.basicPass = authConfig.basic.password;
      this.basicRealm = sanitizeRealm(authConfig.basic.realm || "Secure Area");
      return;
    }

    if (authConfig?.bearer) {
      this.bearerToken = authConfig.bearer.token;
      return;
    }

    if ((globalThis as Record<string, unknown>).__vfTestEnv === true) return;

    this.basicUser = ctx.adapter.env.get("VERYFRONT_BASIC_USER") ?? "";
    this.basicPass = ctx.adapter.env.get("VERYFRONT_BASIC_PASS") ?? "";
    this.bearerToken = ctx.adapter.env.get("VERYFRONT_BEARER_TOKEN") ?? "";
  }

  private shouldUseBasic(): boolean {
    return Boolean(this.basicUser && this.basicPass);
  }

  private shouldUseBearer(): boolean {
    return Boolean(this.bearerToken);
  }

  private checkBasicAuth(req: Request): HandlerResult | null {
    const expected = `Basic ${encodeBase64(`${this.basicUser}:${this.basicPass}`)}`;
    const auth = req.headers.get("authorization") ?? "";

    if (constantTimeEqual(auth, expected)) return null;

    return this.respond(
      new Response("Unauthorized", {
        status: 401,
        headers: { "WWW-Authenticate": `Basic realm="${this.basicRealm}"` },
      }),
    );
  }

  private checkBearerAuth(req: Request): HandlerResult | null {
    const auth = req.headers.get("authorization") ?? "";

    if (auth.startsWith("Bearer ") && constantTimeEqual(auth.slice(7), this.bearerToken ?? "")) {
      return null;
    }

    return this.respond(new Response("Unauthorized", { status: 401 }));
  }
}
