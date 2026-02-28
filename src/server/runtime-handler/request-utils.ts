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

/** Check if host is a private/internal IP address */
export function isInternalHost(host: string): boolean {
  const hostname = host.split(":")[0] ?? "";

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
export const MONITORING_PATHS = new Set(["/healthz", "/readyz", "/_health", "/_metrics"]);

/** Cached request timeout value (lazy-loaded to avoid module-level env access) */
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
  "/_veryfront/modules/",
  "/_veryfront/preview-hmr.js",
  "/_veryfront/studio-bridge/",
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
