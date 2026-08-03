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
const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

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

function isCanonicalDnsHostname(hostname: string): boolean {
  return hostname.length > 0 &&
    hostname.length <= 253 &&
    hostname === hostname.toLowerCase() &&
    hostname.split(".").every((label) => DNS_LABEL_PATTERN.test(label));
}

/**
 * Dedicated authority allowlist for privileged local controls.
 *
 * `veryfront.me` is product-controlled and is the hostname printed by the
 * local CLI. `lvh.me` is admitted because the documented local-development
 * workflow reaches projects through it; the hostname alone never grants
 * access because `isTrustedLocalControlRequest` still requires an
 * authenticated loopback transport peer and no proxy hop. Other third-party
 * wildcard DNS and development test domains are not control authorities even
 * when normal application routing accepts them.
 */
export function isTrustedLocalControlHostname(hostname: string): boolean {
  const address = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (hostname === "localhost" || isLoopbackAddress(address)) return true;
  if (!isCanonicalDnsHostname(hostname)) return false;
  if (hostname.endsWith(".localhost")) return true;
  if (hostname === "lvh.me" || hostname.endsWith(".lvh.me")) return true;
  if (hostname === "veryfront.me") return true;

  const labels = hostname.split(".");
  if (labels.at(-2) !== "veryfront" || labels.at(-1) !== "me") return false;
  if (labels.length === 3) {
    return labels[0] !== "production" && labels[0] !== "staging";
  }
  return labels.length === 4 && labels[1] === "preview";
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

/** Require a native loopback peer and reject every declared proxy path. */
export function isTrustedLocalControlRequest(
  request: Request,
  options: LocalControlRequestOptions = {},
): boolean {
  const proxyTopologyTrusted = options.proxyTopologyTrusted ?? isProxyTopologyTrusted();
  return !proxyTopologyTrusted &&
    !hasProxyForwardingHeaders(request) &&
    isRequestFromLoopbackPeer(request) &&
    hasTrustedLocalControlAuthority(request);
}
