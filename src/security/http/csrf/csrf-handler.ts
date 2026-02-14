/**
 * CSRF Handler — validates CSRF tokens on state-changing requests.
 *
 * Reads config from `ctx.securityConfig?.csrf`. When enabled, POST/PUT/PATCH/DELETE
 * requests must include a valid CSRF token (cookie + header match).
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

const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export class CsrfHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CsrfHandler",
    priority: 5 as HandlerPriority, // After AuthHandler(0), before HMR(25)
    patterns: [], // All requests
  };

  handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const csrfConfig = ctx.securityConfig?.csrf;

    // Not configured or explicitly disabled
    if (!csrfConfig) return Promise.resolve(this.continue());

    const method = req.method.toUpperCase();

    // OPTIONS never needs CSRF
    if (method === "OPTIONS") return Promise.resolve(this.continue());

    // Internal paths are exempt
    const { pathname } = new URL(req.url);
    if (pathname.startsWith("/_veryfront/")) return Promise.resolve(this.continue());

    // Only validate state-changing methods
    if (!STATE_CHANGING_METHODS.has(method)) return Promise.resolve(this.continue());

    // Check exclude paths
    if (typeof csrfConfig === "object" && csrfConfig.excludePaths?.length) {
      for (const excludePath of csrfConfig.excludePaths) {
        if (pathname === excludePath || pathname.startsWith(excludePath + "/")) {
          return Promise.resolve(this.continue());
        }
      }
    }

    const options = typeof csrfConfig === "object"
      ? { cookieName: csrfConfig.cookieName, headerName: csrfConfig.headerName }
      : undefined;

    if (!validateCsrf(req, options)) {
      return Promise.resolve(
        this.respond(
          new Response("Forbidden – invalid or missing CSRF token", { status: 403 }),
        ),
      );
    }

    return Promise.resolve(this.continue());
  }
}
