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
 * 1. Import `csrfMutationHeaders` from `veryfront/index.client`
 * 2. Use it to include the CSRF token on every POST
 *
 * Example (client-side fetch wrapper):
 * ```ts
 * import { csrfMutationHeaders } from "veryfront/index.client";
 *
 * const hydration = JSON.parse(
 *   document.getElementById("veryfront-hydration-data")?.textContent || "{}",
 * );
 * const headers = csrfMutationHeaders("/_veryfront/rsc/action");
 * const pinKey = hydration.dependencyPinningCacheKey;
 * if (typeof pinKey === "string" && pinKey.startsWith("on:")) {
 *   headers.set("x-veryfront-dependency-pins", pinKey);
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
import {
  isSignedChannelDispatch,
  isSignedControlPlaneDispatch,
} from "#veryfront/channels/control-plane.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import { isExplicitlyLocalProject } from "#veryfront/security/project-locality.ts";
import { BaseHandler } from "../base-handler.ts";
import { validateCsrf } from "../../csrf/helpers.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "#veryfront/types";

type CsrfSetting = NonNullable<HandlerContext["securityConfig"]>["csrf"];

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const DEFAULT_CSRF_HEADER_NAME = "x-csrf-token";
const MAX_WARNED_PATHS = 100;
const REDACTED_PATH_LABEL = "request [path redacted]";

function localProjectWarningScope(ctx: HandlerContext): string {
  return ctx.projectId ?? ctx.projectSlug ?? ctx.projectDir;
}

function missingCsrfWarningKey(ctx: HandlerContext, method: string, pathname: string): string {
  return hashString(JSON.stringify([localProjectWarningScope(ctx), method, pathname]));
}

function shouldWarnAboutProductionDefault(req: Request, ctx: HandlerContext): boolean {
  if (!isExplicitlyLocalProject(ctx)) return false;

  // `validateCsrf` treats an empty header token as missing, so a wrapper that
  // sends `getCookie(...) ?? ""` is rejected in production exactly like one
  // that sends no header at all. Testing presence alone would hide that
  // production-breaking request shape from this development diagnostic; header
  // values are whitespace-normalized, so an empty string covers both.
  return (req.headers.get(DEFAULT_CSRF_HEADER_NAME) ?? "") === "";
}

function isExcludedCsrfPath(csrfConfig: CsrfSetting, pathname: string): boolean {
  if (typeof csrfConfig !== "object" || !csrfConfig.excludePaths?.length) return false;

  for (const excludePath of csrfConfig.excludePaths) {
    if (pathname === excludePath || pathname.startsWith(excludePath + "/")) return true;
  }
  return false;
}

function csrfValidationOptions(csrfConfig: CsrfSetting) {
  return typeof csrfConfig === "object"
    ? { cookieName: csrfConfig.cookieName, headerName: csrfConfig.headerName }
    : undefined;
}

export class CsrfHandler extends BaseHandler {
  private readonly warnedMissingCsrfKeys = new Set<string>();

  metadata: HandlerMetadata = {
    name: "CsrfHandler",
    priority: 5 as HandlerPriority, // After AuthHandler(0), before HMR(25)
    patterns: [], // All requests
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const csrfConfig = ctx.securityConfig?.csrf;

    // An explicit opt-out applies in every environment and should not produce
    // development guidance about the production default.
    if (csrfConfig === false) return this.continue();

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
    // run execute/resume/cancel and agent listing arrive carrying a signed
    // operation envelope, verified before the handler acts on them; they hold
    // no `__Host-vf_csrf` cookie to echo and derive no authority from one.
    // Rejecting them here protects nothing and instead stops the platform from
    // building the project's own release asset manifest, which surfaces only as
    // `deploy` timing out with `last state: missing`.
    //
    // The exemption is keyed on a registered surface, not on a path shape:
    // `isSignedControlPlaneDispatch` requires both a method/path pair that a
    // control-plane handler owns and the signature header that handler
    // verifies. The `/api/control-plane/` namespace is reserved but not
    // exclusively routed, so a project App or Pages API route can sit under it
    // in a custom runtime; such a route is cookie authenticated, is not a
    // registered surface, and keeps CSRF enforced.
    //
    // The predicate cannot tell a genuine dispatch from a set header, and it
    // does not try to. Assume an attacker can set it. What bounds the
    // exemption is that the routes it admits terminate at a handler that
    // verifies the envelope, ahead of `ApiHandlerWrapper`, so a forged header
    // reaches a 401 rather than project code.
    if (isSignedControlPlaneDispatch(req)) return this.continue();

    // A platform channel dispatch is not a browser request either. A Slack or
    // Discord message reaches an agent because the channel dispatcher POSTs
    // `/channels/invoke` carrying a signed dispatch envelope, and the runtime
    // re-dispatches to the same route when another instance owns the run.
    // Neither caller holds a `__Host-vf_csrf` cookie, so gating them here does
    // not stop a cross-site request; it silently stops the project's own
    // channels from answering at all.
    //
    // This is a separate predicate rather than another entry in the
    // control-plane route table on purpose. A channel dispatch carries a
    // different envelope under a different header, verified by
    // `verifyDispatchJws` against the dispatch id, platform, project id and
    // body hash, so the two are not interchangeable and neither header may
    // stand in for the other.
    if (isSignedChannelDispatch(req)) return this.continue();

    if (csrfConfig === undefined) {
      if (shouldWarnAboutProductionDefault(req, ctx)) {
        this.warnMissingCsrfHeaderOnce(ctx, method, pathname);
      }
      return this.continue();
    }

    if (isExcludedCsrfPath(csrfConfig, pathname)) return this.continue();

    if (!validateCsrf(req, csrfValidationOptions(csrfConfig))) {
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

  private warnMissingCsrfHeaderOnce(
    ctx: HandlerContext,
    method: string,
    pathname: string,
  ): void {
    const warningKey = missingCsrfWarningKey(ctx, method, pathname);
    if (this.warnedMissingCsrfKeys.has(warningKey)) {
      return;
    }

    if (this.warnedMissingCsrfKeys.size >= MAX_WARNED_PATHS) {
      const oldest = this.warnedMissingCsrfKeys.values().next();
      if (!oldest.done) this.warnedMissingCsrfKeys.delete(oldest.value);
    }

    this.warnedMissingCsrfKeys.add(warningKey);
    this.logWarn(
      `${method} ${REDACTED_PATH_LABEL} has no ${DEFAULT_CSRF_HEADER_NAME} header. ` +
        "Production enables CSRF protection by default and would reject this request. " +
        'Use csrfMutationHeaders from "veryfront/index.client" for browser mutations, ' +
        "or configure security.csrf explicitly.",
    );
  }
}
