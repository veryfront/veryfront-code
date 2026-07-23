/**
 * Request Utilities
 *
 * Utility functions for request classification, monitoring path detection,
 * and timeout configuration.
 *
 * @module server/runtime-handler/request-utils
 */

import { getTimeoutFromEnv } from "#veryfront/middleware/builtin/timeout.ts";
import { HTTP_GATEWAY_TIMEOUT } from "#veryfront/utils/constants/http.ts";
import { isLocalDevHost } from "../utils/domain-parser.ts";
import { canonicalizeLocalProjectSlug } from "./project-slug.ts";

function normalizeHostname(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const closingBracket = value.indexOf("]");
    if (closingBracket > 0) return value.slice(1, closingBracket);
  }

  const firstColon = value.indexOf(":");
  const lastColon = value.lastIndexOf(":");
  const hostname = firstColon > 0 && firstColon === lastColon ? value.slice(0, firstColon) : value;
  return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
}

function parseIPv4(hostname: string): [number, number, number, number] | null {
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return octets as [number, number, number, number];
}

function isInternalIPv6(hostname: string): boolean {
  const address = hostname.split("%", 1)[0] ?? hostname;
  if (address === "::" || address === "::1") return true;

  if (address.startsWith("::ffff:")) {
    const mappedAddress = parseIPv4(address.slice("::ffff:".length));
    return mappedAddress ? isInternalIPv4(mappedAddress) : false;
  }

  const firstSegment = address.split(":", 1)[0];
  if (!firstSegment || !/^[0-9a-f]{1,4}$/.test(firstSegment)) return false;
  const firstValue = Number.parseInt(firstSegment, 16);
  return (firstValue & 0xfe00) === 0xfc00 || (firstValue & 0xffc0) === 0xfe80;
}

function isInternalIPv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 192 && b === 168;
}

/** Check if host is a private/internal IP address */
export function isInternalHost(host: string): boolean {
  const hostname = normalizeHostname(host);

  if (hostname === "localhost") return true;
  const ipv4 = parseIPv4(hostname);
  if (ipv4) return isInternalIPv4(ipv4);
  return hostname.includes(":") && isInternalIPv6(hostname);
}

/** Monitoring paths that should skip domain lookup */
export const MONITORING_PATHS = new Set(["/healthz", "/readyz", "/_health"]);

/** Cached request timeout value (lazy-loaded to avoid module-level env access).
 *  Intentionally cached: the timeout env var is expected to be stable for the process
 *  lifetime and is read at first use (after bootstrap env loading completes).
 *  If you need to read a live env var change, call getTimeoutFromEnv() directly. */
let _requestTimeoutMs: number | null = null;

/** Get request timeout in milliseconds (configurable via getRequestTimeout() env var) */
export function getRequestTimeout(): number {
  if (_requestTimeoutMs === null) {
    _requestTimeoutMs = getTimeoutFromEnv();
  }
  return _requestTimeoutMs;
}

export { HTTP_GATEWAY_TIMEOUT };

/** Sentinel value for timeout detection (avoids string comparison) */
export const TIMEOUT_SENTINEL = Symbol("request_timeout");

/** Check if request path is a monitoring endpoint that should skip domain lookup */
export function isMonitoringPath(pathname: string): boolean {
  return MONITORING_PATHS.has(pathname);
}

/** Lightweight paths that should skip concurrency limiting (modules, static assets) */
export const LIGHTWEIGHT_PATH_PREFIXES = [
  "/_vf_modules/",
  "/_vf_styles/",
  "/_veryfront/modules/",
  "/_veryfront/hydration-runtime",
  "/_veryfront/preview-hmr.js",
  "/_veryfront/studio-bridge.js",
  "/_vf/css/",
  "/_lib_modules/",
];

/** Check if path is a lightweight request that should skip concurrency limiting */
export function isLightweightPath(pathname: string): boolean {
  return LIGHTWEIGHT_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/** Check if path is the WebSocket endpoint (long-lived, handled by HMR handler) */
export function isWebSocketPath(pathname: string): boolean {
  return pathname === "/_ws";
}

/** Read a canonical HMR project override from a trusted proxy or local development host. */
export function getWebSocketProjectSlugOverride(
  url: URL,
  options: { effectiveHost?: string; proxyTrusted?: boolean } = {},
): string | undefined {
  if (!isWebSocketPath(url.pathname)) return undefined;
  const rawSlug = url.searchParams.get("x-project-slug");
  if (!rawSlug) return undefined;
  const slug = canonicalizeLocalProjectSlug(rawSlug);
  if (!slug || slug !== rawSlug) return undefined;

  const effectiveHost = options.effectiveHost ?? url.host;
  if (!options.proxyTrusted && !isLocalDevHost(effectiveHost)) return undefined;
  return slug;
}

/**
 * Requests that do not need render-specific enriched context.
 *
 * These routes still receive the normal handler context, but they can skip
 * render cache prefix/content-source derivation and the enriched render payload.
 */
export function shouldSkipEnrichedContext(pathname: string): boolean {
  return isWebSocketPath(pathname) || pathname.startsWith("/api/") ||
    pathname.startsWith("/api/control-plane/agents/");
}
