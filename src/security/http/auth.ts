import { BaseHandler } from "./base-handler.ts";
import { createError, toError } from "#veryfront/errors";
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
    } catch (_) {
      /* expected: non-Latin1 string — fall back to TextEncoder */
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

function sanitizeRealm(realm: unknown): string {
  // deno-lint-ignore no-control-regex -- intentional: strips control chars and special chars from HTTP realm header
  return String(realm).replace(/[\x00-\x1f\x7f"\\]/g, "");
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

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    this.loadAuthConfig(ctx);

    if (req.method.toUpperCase() === "OPTIONS") return this.continue();

    if (!this.shouldUseBasic() && !this.shouldUseBearer()) {
      return this.continue();
    }

    const authorization = req.headers.get("authorization") ?? "";
    const separator = authorization.indexOf(" ");
    const scheme = separator === -1 ? "" : authorization.slice(0, separator).toLowerCase();
    const credentials = separator === -1 ? "" : authorization.slice(separator + 1);

    if (scheme === "basic" && this.isValidBasicCredentials(credentials)) {
      return this.continue();
    }
    if (scheme === "bearer" && this.isValidBearerCredentials(credentials)) {
      return this.continue();
    }

    return this.unauthorized();
  }

  private loadAuthConfig(ctx: HandlerContext): void {
    // Reset per-request auth state to avoid leaking config across requests.
    this.basicUser = null;
    this.basicPass = null;
    this.basicRealm = "Secure Area";
    this.bearerToken = null;

    const authConfig = ctx.securityConfig?.auth as AuthConfig | undefined;

    if (authConfig?.basic) {
      if (!authConfig.basic.username || !authConfig.basic.password) {
        throw new TypeError("Basic authentication username and password must be non-empty");
      }
      this.basicUser = authConfig.basic.username;
      this.basicPass = authConfig.basic.password;
      this.basicRealm = sanitizeRealm(authConfig.basic.realm || "Secure Area");
    }

    if (authConfig?.bearer) {
      if (!authConfig.bearer.token) {
        throw new TypeError("Bearer authentication token must be non-empty");
      }
      this.bearerToken = authConfig.bearer.token;
    }

    if (authConfig?.basic || authConfig?.bearer) return;

    const basicUser = ctx.adapter.env.get("VERYFRONT_BASIC_USER");
    const basicPass = ctx.adapter.env.get("VERYFRONT_BASIC_PASS");
    if (basicUser !== undefined || basicPass !== undefined) {
      if (!basicUser || !basicPass) {
        throw new TypeError(
          "Basic authentication environment username and password must be non-empty",
        );
      }
      this.basicUser = basicUser;
      this.basicPass = basicPass;
    }

    const bearerToken = ctx.adapter.env.get("VERYFRONT_BEARER_TOKEN");
    if (bearerToken !== undefined) {
      if (!bearerToken) {
        throw new TypeError("Bearer authentication environment token must be non-empty");
      }
      this.bearerToken = bearerToken;
    }
  }

  private shouldUseBasic(): boolean {
    return Boolean(this.basicUser && this.basicPass);
  }

  private shouldUseBearer(): boolean {
    return Boolean(this.bearerToken);
  }

  private isValidBasicCredentials(credentials: string): boolean {
    if (!this.shouldUseBasic()) return false;
    const expected = encodeBase64(`${this.basicUser}:${this.basicPass}`);
    return constantTimeEqual(credentials, expected);
  }

  private isValidBearerCredentials(credentials: string): boolean {
    return this.shouldUseBearer() && constantTimeEqual(credentials, this.bearerToken ?? "");
  }

  private unauthorized(): HandlerResult {
    const headers = new Headers();
    if (this.shouldUseBasic()) {
      headers.set("WWW-Authenticate", `Basic realm="${this.basicRealm}"`);
    }
    if (this.shouldUseBearer()) headers.append("WWW-Authenticate", "Bearer");
    return this.respond(new Response("Unauthorized", { status: 401, headers }));
  }
}
