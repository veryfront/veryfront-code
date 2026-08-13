/**
 * Admission policy shared by privileged local-development HTTP surfaces.
 *
 * A Host header never proves locality. This policy requires peer provenance
 * recorded by the native server adapter and rejects configured or header-
 * declared proxy paths. A local relay that deliberately removes every proxy
 * marker is indistinguishable at this boundary and must not expose these
 * routes; use a loopback-only control listener in that topology.
 *
 * @module security/http/local-control-request
 */

import {
  isLoopbackAddress,
  isRequestFromLoopbackPeer,
} from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";
import { isProxyTopologyTrusted } from "#veryfront/platform/compat/proxy-topology.ts";

const PROXY_FORWARDING_HEADERS = Object.freeze(
  [
    "forwarded",
    "via",
    "x-forwarded-for",
    "x-forwarded-host",
    "x-forwarded-port",
    "x-forwarded-proto",
    "x-real-ip",
  ] as const,
);
const MAX_LOCAL_CONTROL_URL_CHARACTERS = 8 * 1024;
const MAX_LOCAL_CONTROL_AUTHORITY_CHARACTERS = 261;
const MAX_LOCAL_CONTROL_FETCH_SITE_CHARACTERS = 32;
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_CONTROL_ACCESS_DENIED_MESSAGE =
  "Local control access requires a direct loopback connection and a trusted local-development host";

export interface LocalControlRequestOptions {
  /** Explicit trusted-proxy topology state, when the caller already resolved it. */
  readonly proxyTopologyTrusted?: boolean;
}

export function hasProxyForwardingHeaders(request: Request): boolean {
  return PROXY_FORWARDING_HEADERS.some((header) => request.headers.has(header));
}

/** Cancel a rejected body without letting hostile cancellation delay denial. */
export function cancelRejectedLocalControlRequestBody(
  request: Request,
  detail = "Local control request rejected",
): void {
  if (request.body === null) return;
  try {
    void request.body.cancel(new Error(detail)).catch(() => {});
  } catch {
    // Rejection remains fail-closed when a malformed or locked stream cannot
    // be cancelled.
  }
}

/** Build the uniform fail-closed response used by privileged local controls. */
export function createLocalControlAccessDeniedResponse(
  request: Request,
  detail = "Local control request rejected",
): Response {
  cancelRejectedLocalControlRequestBody(request, detail);
  return new Response(
    request.method === "HEAD" ? null : LOCAL_CONTROL_ACCESS_DENIED_MESSAGE,
    {
      status: 403,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
      },
    },
  );
}

function isCanonicalDnsHostname(hostname: string): boolean {
  return hostname.length > 0 &&
    hostname.length <= 253 &&
    hostname === hostname.toLowerCase() &&
    hostname.split(".").every((label) => DNS_LABEL_PATTERN.test(label));
}

/**
 * Trusted local-control roots, longest-suffix-first.
 *
 * `localhost` is a single label and therefore has no registrable domain in the
 * eTLD+1 sense, so the shape check cannot be expressed as "keep the last two
 * labels". Each root is matched as a whole suffix instead and the labels in
 * front of it are what the shape rules below constrain.
 */
const TRUSTED_LOCAL_CONTROL_ROOTS = Object.freeze(["localhost", "lvh.me"] as const);

/** Labels in front of a trusted root, or null when the host is not on one. */
function localControlSubLabels(hostname: string): string[] | null {
  for (const root of TRUSTED_LOCAL_CONTROL_ROOTS) {
    if (hostname === root) return [];
    const suffix = `.${root}`;
    if (hostname.endsWith(suffix)) {
      return hostname.slice(0, -suffix.length).split(".");
    }
  }
  return null;
}

function hasTrustedNamedLocalControlShape(hostname: string): boolean {
  const subLabels = localControlSubLabels(hostname);
  if (subLabels === null) return false;
  if (subLabels.length === 0) return true;
  if (subLabels.length === 1) {
    return subLabels[0] !== "production" && subLabels[0] !== "staging";
  }
  return subLabels.length === 2 && subLabels[1] === "preview";
}

function hasTrustedFetchSite(request: Request): boolean {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite === null) return true;

  // `same-site` is deliberately rejected. Sibling local origins can run
  // untrusted project code and must not drive privileged host controls.
  return fetchSite.length <= MAX_LOCAL_CONTROL_FETCH_SITE_CHARACTERS &&
    (fetchSite === "none" || fetchSite === "same-origin");
}

/**
 * Dedicated authority allowlist for privileged local controls.
 *
 * `localhost` is reserved by RFC 6761, never leaves the machine, and is the
 * hostname printed by the local CLI. Veryfront admits `lvh.me` because the
 * documented local-development workflow reaches projects through it; the hostname alone never grants
 * access because `isTrustedLocalControlRequest` still requires an
 * authenticated loopback transport peer and no proxy hop. Other third-party
 * wildcard DNS and development test domains are not control authorities even
 * when normal application routing accepts them. Named roots admit only the
 * bare host, one project label, or one project below `preview`; production,
 * staging, custom-domain simulation, and unknown namespaces stay denied.
 *
 * `*.localhost` gets that same shape check rather than a blanket allow. Trust
 * must not widen just because the printed dev hostname became a single-label
 * root: `project.production.localhost` and `a.b.c.localhost` are denied exactly
 * as `project.production.lvh.me` is.
 */
export function isTrustedLocalControlHostname(hostname: string): boolean {
  const address = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (hostname === "localhost" || isLoopbackAddress(address)) return true;
  if (!isCanonicalDnsHostname(hostname)) return false;
  return hasTrustedNamedLocalControlShape(hostname);
}

/** Require an exact, canonical URL and raw Host authority pair. */
export function hasTrustedLocalControlAuthority(request: Request): boolean {
  if (request.url.length > MAX_LOCAL_CONTROL_URL_CHARACTERS) return false;

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return false;
  }
  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    !isTrustedLocalControlHostname(url.hostname)
  ) return false;

  const host = request.headers.get("host");
  return host !== null &&
    host.length <= MAX_LOCAL_CONTROL_AUTHORITY_CHARACTERS &&
    host === url.host;
}

/** Require a native loopback peer and reject proxy or cross-origin browser paths. */
export function isTrustedLocalControlRequest(
  request: Request,
  options: LocalControlRequestOptions = {},
): boolean {
  const proxyTopologyTrusted = options.proxyTopologyTrusted ?? isProxyTopologyTrusted();
  return !proxyTopologyTrusted &&
    !hasProxyForwardingHeaders(request) &&
    hasTrustedFetchSite(request) &&
    isRequestFromLoopbackPeer(request) &&
    hasTrustedLocalControlAuthority(request);
}
