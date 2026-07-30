/**
 * CSRF Handler — validates CSRF tokens on state-changing requests.
 *
 * Reads config from `ctx.securityConfig?.csrf`. When enabled, every method
 * except GET, HEAD, and OPTIONS must include a valid CSRF token (cookie +
 * header match).
 *
 * ## Server Actions integration
 *
 * When `security.csrf` is enabled, Server Action POSTs to `/_veryfront/rsc/action`
 * are **not** exempt and require a valid CSRF token. Client-side code that calls
 * Server Actions must:
 *
 * 1. Read the `__Host-vf_csrf` cookie (set automatically on HTML responses)
 * 2. Include it as the `x-csrf-token` request header on every POST
 *
 * Example (client-side fetch wrapper):
 * ```ts
 * function getCookie(name: string): string | undefined {
 *   return document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))?.[1];
 * }
 *
 * const res = await fetch("/_veryfront/rsc/action", {
 *   method: "POST",
 *   headers: { "x-csrf-token": getCookie("__Host-vf_csrf") ?? "" },
 *   body: actionPayload,
 * });
 * ```
 *
 * @module security/http/csrf/csrf-handler
 */

import { BaseHandler } from "../base-handler.ts";
import { validateCsrf } from "../../csrf/helpers.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "#veryfront/types";

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export class CsrfHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CsrfHandler",
    priority: 5 as HandlerPriority, // After AuthHandler(0), before HMR(25)
    patterns: [], // All requests
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const csrfConfig = ctx.securityConfig?.csrf;

    // Not configured or explicitly disabled
    if (!csrfConfig) return this.continue();

    const method = req.method.toUpperCase();

    // Unknown and extension methods fail closed. Only the explicitly safe HTTP
    // methods bypass token validation.
    if (CSRF_SAFE_METHODS.has(method)) return this.continue();

    const { pathname } = new URL(req.url);

    // Check exclude paths
    if (typeof csrfConfig === "object" && csrfConfig.excludePaths?.length) {
      for (const excludePath of csrfConfig.excludePaths) {
        if (pathname === excludePath || pathname.startsWith(excludePath + "/")) {
          return this.continue();
        }
      }
    }

    const options = typeof csrfConfig === "object"
      ? { cookieName: csrfConfig.cookieName, headerName: csrfConfig.headerName }
      : undefined;

    if (!validateCsrf(req, options)) {
      return this.respond(
        this.createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache("no-store")
          .text("Forbidden – invalid or missing CSRF token", 403),
      );
    }

    return this.continue();
  }
}
