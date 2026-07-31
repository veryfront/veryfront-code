/**
 * Request Utilities
 *
 * Utility functions for request classification, monitoring path detection,
 * and timeout configuration.
 *
 * @module server/runtime-handler/request-utils
 */

import { getTimeoutFromEnv } from "#veryfront/middleware/builtin/timeout.ts";
import { isWebSocketUpgrade } from "#veryfront/platform/compat/http/websocket.ts";
import { HTTP_GATEWAY_TIMEOUT } from "#veryfront/utils/constants/http.ts";
import {
  isVersionedProdHydrationModulePath,
  PROD_HYDRATION_MODULE_PATH,
} from "#veryfront/html/hydration-script-builder/prod-scripts.ts";

function hostnameFromHostValue(host: string): string {
  if (host.startsWith("[")) {
    const closingBracket = host.indexOf("]");
    if (closingBracket < 0) return "";

    const suffix = host.slice(closingBracket + 1);
    if (suffix !== "" && !/^:\d+$/.test(suffix)) return "";
    return host.slice(1, closingBracket);
  }

  const firstColon = host.indexOf(":");
  if (firstColon < 0) return host;
  if (firstColon === host.lastIndexOf(":")) {
    return /^\d+$/.test(host.slice(firstColon + 1)) ? host.slice(0, firstColon) : "";
  }

  // Unbracketed multi-colon values are IPv6 literals, not host:port pairs.
  return host;
}

/** Check if host is a private/internal IP address */
export function isInternalHost(host: string): boolean {
  const hostname = hostnameFromHostValue(host);

  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4Match) return false;

  const a = Number(ipv4Match[1]);
  const b = Number(ipv4Match[2]);

  if (a === 10) return true; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16

  return false;
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

/**
 * Paths that can skip render-specific context work and use terse request
 * logging. This classification does not exempt work from project isolation.
 */
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

/** Check if a path can use lightweight context and logging behavior. */
export function isLightweightPath(pathname: string): boolean {
  return LIGHTWEIGHT_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Fixed, framework-owned assets whose response work is bounded at startup.
 * Dynamic module transforms and CSS scans deliberately do not qualify.
 */
export function isIsolationExemptPath(pathname: string): boolean {
  return pathname === PROD_HYDRATION_MODULE_PATH ||
    isVersionedProdHydrationModulePath(pathname) ||
    pathname === "/_veryfront/preview-hmr.js";
}

/** Check if path is the WebSocket endpoint (long-lived, handled by HMR handler) */
export function isWebSocketPath(pathname: string): boolean {
  return pathname === "/_ws";
}

/** Check whether a request is the exact HMR WebSocket upgrade that must retain native identity. */
export function isHMRWebSocketUpgrade(request: Request, pathname: string): boolean {
  return isWebSocketPath(pathname) && isWebSocketUpgrade(request);
}

/**
 * Requests that do not need render-specific enriched context.
 *
 * These routes still receive the normal handler context, but they can skip
 * render cache prefix/content-source derivation and the enriched render payload.
 */
export function shouldSkipEnrichedContext(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname.startsWith("/api/control-plane/agents/");
}
