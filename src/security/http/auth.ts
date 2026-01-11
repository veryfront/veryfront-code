/**
 * Authentication Handler
 * Handles Basic and Bearer authentication
 *
 * Auth can be configured via:
 * 1. veryfront.config.js security.auth (preferred, allows test isolation)
 * 2. Environment variables (legacy, causes issues in parallel tests)
 */

import { BaseHandler } from "./base-handler.ts";
import { createError, toError } from "@veryfront/errors/veryfront-error.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "@veryfront/types";
import type { AuthConfig } from "./middleware/types.ts";

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
    priority: 0 as HandlerPriority, // CRITICAL priority - runs first
    patterns: [], // Checks all requests
  };

  private basicUser: string | null = null;
  private basicPass: string | null = null;
  private basicRealm: string = "Secure Area";
  private bearerToken: string | null = null;

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    // Load auth config from config file or environment
    this.loadAuthConfig(ctx);

    // Skip auth for OPTIONS requests
    if (req.method.toUpperCase() === "OPTIONS") {
      return Promise.resolve(this.continue());
    }

    // Check Basic Auth
    if (this.shouldUseBasic()) {
      const result = this.checkBasicAuth(req);
      if (result) return Promise.resolve(result);
    }

    // Check Bearer Auth
    if (this.shouldUseBearer()) {
      const result = this.checkBearerAuth(req);
      if (result) return Promise.resolve(result);
    }

    return Promise.resolve(this.continue());
  }

  private loadAuthConfig(ctx: HandlerContext): void {
    // Priority 1: Config file security.auth (allows proper test isolation)
    const authConfig = ctx.securityConfig?.auth as AuthConfig | undefined;

    if (authConfig?.basic) {
      this.basicUser = authConfig.basic.username;
      this.basicPass = authConfig.basic.password;
      this.basicRealm = authConfig.basic.realm || "Secure Area";
      return;
    }

    if (authConfig?.bearer) {
      this.bearerToken = authConfig.bearer.token;
      return;
    }

    // Priority 2: Environment variables (legacy - causes parallel test issues)
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
        headers: { "WWW-Authenticate": `Basic realm="${this.basicRealm}"` },
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
