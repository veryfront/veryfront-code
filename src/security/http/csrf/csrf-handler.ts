/**
 * CSRF Handler validates CSRF tokens on state-changing requests.
 *
 * Reads config from `ctx.securityConfig?.csrf`. Unless a project sets
 * `security.csrf: false`, every method except GET, HEAD, and OPTIONS must
 * include a valid CSRF token (cookie + header match). `deriveSecurityContext`
 * resolves that default identically in local development and in production, so
 * a browser mutation that passes locally passes after deploy.
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
import { isExplicitlyLocalProject } from "#veryfront/security/project-locality.ts";
import {
  DEV_DASHBOARD_API_PREFIX,
  isTrustedLocalControlRequest,
} from "#veryfront/security/http/local-control-request.ts";
import { INTERNAL_ENDPOINTS } from "#veryfront/utils/constants/server.ts";
import { BaseHandler } from "../base-handler.ts";
import { browserFacingOrigin, validateCsrf } from "../../csrf/helpers.ts";
import {
  defaultCsrfCookieNameForOrigin,
  effectiveCsrfCookieNameForOrigin,
  resolveCsrfNames,
} from "../../csrf/names.ts";
import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";
import type {
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
} from "#veryfront/types";

type CsrfSetting = NonNullable<HandlerContext["securityConfig"]>["csrf"];

const CSRF_SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * The rejection served to every deployed client.
 *
 * It names nothing about the project's configuration on purpose: a deployed
 * origin answers anyone who can reach it, and the cookie and header names are
 * the project's own policy detail.
 */
const CSRF_FORBIDDEN_BODY = "Forbidden: invalid or missing CSRF token";

function isExcludedCsrfPath(csrfConfig: CsrfSetting, pathname: string): boolean {
  if (typeof csrfConfig !== "object" || !csrfConfig.excludePaths?.length) return false;

  for (const excludePath of csrfConfig.excludePaths) {
    if (excludePath === "/") return pathname === "/";
    if (pathname === excludePath || pathname.startsWith(excludePath + "/")) return true;
  }
  return false;
}

/**
 * Framework-owned mutations that only exist while `veryfront dev` is running.
 *
 * The development client logger and the `/_dev` dashboard API are served by the
 * framework, not by project code, and neither holds a `__Host-vf_csrf` cookie:
 * the logger is an inline script that fires before any user interaction, and
 * the dashboard authenticates with its own port-scoped session token. Gating
 * them on the project's CSRF policy would stop the local server's own console
 * and dashboard from working without protecting anything.
 *
 * These are surfaces, not path shapes. Both terminate at a handler that
 * re-applies `isTrustedLocalControlRequest` itself, so a request admitted here
 * still has to satisfy that gate before it does any work.
 */
function isFrameworkLocalControlSurface(method: string, pathname: string): boolean {
  if (method === "POST" && pathname === INTERNAL_ENDPOINTS.CLIENT_LOG) return true;
  return pathname.startsWith(DEV_DASHBOARD_API_PREFIX);
}

function csrfValidationOptions(csrfConfig: CsrfSetting, req: Request) {
  const configured = typeof csrfConfig === "object" ? csrfConfig : undefined;
  const origin = browserFacingOrigin(req, isProxyTopologyTrusted());
  return {
    cookieName: effectiveCsrfCookieNameForOrigin(configured?.cookieName, origin),
    headerName: configured?.headerName,
  };
}

/**
 * Explain the double-submit contract to the developer who just hit it.
 *
 * Served only to the developer's own machine. It names the cookie and header
 * actually in effect, because a project that configured its own names would
 * otherwise be told to send a header the server does not read.
 */
function localDevelopmentCsrfBody(csrfConfig: CsrfSetting, req: Request): string {
  let cookieName: string;
  let headerName: string;
  try {
    const configured = csrfValidationOptions(csrfConfig, req);
    ({ cookieName, headerName } = resolveCsrfNames({
      cookieName: configured?.cookieName ??
        defaultCsrfCookieNameForOrigin(new URL(req.url).origin),
      headerName: configured?.headerName,
    }));
  } catch {
    // Unusable names are a configuration error, not something to describe back.
    return CSRF_FORBIDDEN_BODY;
  }

  return [
    "Forbidden: invalid or missing CSRF token.",
    "",
    "Veryfront checks CSRF in local development exactly as it does after you deploy.",
    `Every request that is not GET, HEAD, or OPTIONS must send the value of the ${cookieName} cookie back in the ${headerName} header.`,
    "",
    'Build those headers with csrfMutationHeaders from "veryfront/index.client", or set security.csrf to false in your Veryfront config to turn this check off.',
  ].join("\n");
}

export class CsrfHandler extends BaseHandler {
  metadata: HandlerMetadata = {
    name: "CsrfHandler",
    priority: 5 as HandlerPriority, // After AuthHandler(0), before HMR(25)
    patterns: [], // All requests
  };

  async handle(req: Request, ctx: HandlerContext): Promise<HandlerResult> {
    const csrfConfig = ctx.securityConfig?.csrf;

    // `security.csrf: false` is the documented opt-out and applies in every
    // environment, local development included. Every other value, including the
    // absent one that derivation fills in, means the gate below runs.
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

    // A framework-owned local control surface, admitted on the same
    // transport-authenticated loopback evidence its own handler requires. That
    // gate rejects `sec-fetch-site: cross-site`, a proxy hop, and any host but
    // a canonical local-development one, so it is a stricter cross-site
    // defence than the double-submit token, not a hole beside it.
    const isLocalProject = isExplicitlyLocalProject(ctx);
    if (
      isLocalProject &&
      isFrameworkLocalControlSurface(method, pathname) &&
      isTrustedLocalControlRequest(req)
    ) {
      return this.continue();
    }

    if (isExcludedCsrfPath(csrfConfig, pathname)) return this.continue();

    if (!validateCsrf(req, csrfValidationOptions(csrfConfig, req))) {
      // `isLocalProject` is filesystem topology, not environment: a deployed
      // multi-project runtime that resolves a project directory on disk sets
      // it too. Describing the configured cookie and header names, and the
      // `security.csrf: false` opt-out, to whoever reached that origin would
      // hand a deployed client the project's own policy detail. Requiring the
      // same loopback evidence the framework's local control surfaces demand
      // keeps the diagnostic on the developer's own machine.
      const servesDeveloperDiagnostics = isLocalProject && isTrustedLocalControlRequest(req);

      return this.respond(
        this.createResponseBuilder(ctx)
          .withCORS(req, ctx.securityConfig?.cors)
          .withSecurity(ctx.securityConfig ?? undefined, req)
          .withCache("no-store")
          .text(
            servesDeveloperDiagnostics
              ? localDevelopmentCsrfBody(csrfConfig, req)
              : CSRF_FORBIDDEN_BODY,
            403,
          ),
      );
    }

    return this.continue();
  }
}
