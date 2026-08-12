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
 * const hydration = JSON.parse(
 *   document.getElementById("veryfront-hydration-data")?.textContent || "{}",
 * );
 * const headers: Record<string, string> = {
 *   "x-csrf-token": getCookie("__Host-vf_csrf") ?? "",
 * };
 * const pinKey = hydration.dependencyPinningCacheKey;
 * if (typeof pinKey === "string" && pinKey.startsWith("on:")) {
 *   headers["x-veryfront-dependency-pins"] = pinKey;
 * }
 *
 * const res = await fetch("/_veryfront/rsc/action", {
 *   method: "POST",
 *   headers,
 *   body: actionPayload,
 * });
 * ```
 *
 * @module security/http/csrf/csrf-handler
 */

import { isCspReportRequest } from "#veryfront/security/http/csp-report-endpoint.ts";
import { isControlPlaneSurfaceRequest } from "#veryfront/channels/control-plane.ts";
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

    // A CSP violation report is not a user action and carries no token. See
    // `isCspReportRequest`; relying on a project to add it to `excludePaths`
    // would make reporting another thing a project has to configure first.
    if (isCspReportRequest(method, pathname)) return this.continue();

    // A control-plane dispatch is not a browser request. Release asset builds,
    // run execute/resume/cancel and agent listing all arrive as POSTs carrying
    // a signed operation envelope, verified before the handler acts on them;
    // they hold no `__Host-vf_csrf` cookie to echo and derive no authority from
    // one. Rejecting them here protects nothing and instead stops the platform
    // from building the project's own release asset manifest, which surfaces
    // only as `deploy` timing out with `last state: missing`.
    if (isControlPlaneSurfaceRequest(pathname)) return this.continue();

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
