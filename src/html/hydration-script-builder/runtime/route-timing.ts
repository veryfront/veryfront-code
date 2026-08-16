/**
 * Route transition instrumentation: the `veryfront:route-timing` events, and
 * the Server-Timing / Resource Timing details attached to page-data fetches.
 *
 * Everything here is best-effort — a browser that lacks an API, or a header the
 * server did not send, must never fail a navigation.
 */

import type { RouteTimingEntry, RuntimeResponse, RuntimeWindow } from "./env.ts";
import type { RuntimeLogging } from "./shared.ts";

export const MAX_ROUTE_TIMINGS = 100;
export const MAX_SERVER_TIMING_LENGTH = 1024;

export function routeTimingNow(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export function sanitizeServerTimingMetricName(name: string | undefined): string {
  return String(name || "").trim().replace(/[^A-Za-z0-9_.-]/g, "_").slice(0, 128);
}

/**
 * A Server-Timing header is attacker-influenceable text that ends up in a
 * client event, so it is stripped to printable ASCII, reduced to well-formed
 * `name;dur=` metrics, and length-capped before anything reads it.
 */
export function sanitizeServerTimingHeader(value: string | null | undefined): string | null {
  if (!value) return null;

  const metrics: string[] = [];
  const printable = String(value).replace(/[^\x20-\x7E]/g, " ").trim();
  if (!printable) return null;

  for (const item of printable.split(",")) {
    const segments = item.split(";").map((segment) => segment.trim()).filter(Boolean);
    const name = sanitizeServerTimingMetricName(segments[0]);
    if (!name) continue;

    for (const segment of segments.slice(1)) {
      const [key, rawValue = ""] = segment.split("=");
      if ((key ?? "").trim().toLowerCase() !== "dur") continue;

      const duration = Number(rawValue.trim().replace(/^"|"$/g, ""));
      if (!Number.isFinite(duration) || duration < 0) continue;

      metrics.push(name + ";dur=" + (Math.round(duration * 100) / 100).toFixed(2));
      break;
    }
  }

  const sanitized = metrics.join(", ");
  return sanitized ? sanitized.slice(0, MAX_SERVER_TIMING_LENGTH) : null;
}

export function parseServerTimingMetrics(
  value: string | null | undefined,
): Record<string, number> | null {
  const header = sanitizeServerTimingHeader(value);
  if (!header) return null;

  const metrics: Record<string, number> = {};
  for (const item of header.split(",")) {
    const segments = item.split(";").map((segment) => segment.trim()).filter(Boolean);
    const name = sanitizeServerTimingMetricName(segments[0]);
    if (!name) continue;

    for (const segment of segments.slice(1)) {
      const [key, rawValue = ""] = segment.split("=");
      if ((key ?? "").trim().toLowerCase() !== "dur") continue;

      const duration = Number(rawValue.trim().replace(/^"|"$/g, ""));
      if (Number.isFinite(duration) && duration >= 0) {
        metrics[name] = Math.round(duration * 100) / 100;
      }
    }
  }

  return Object.keys(metrics).length ? metrics : null;
}

export function readResponseServerTiming(response: RuntimeResponse): string | null {
  try {
    return sanitizeServerTimingHeader(response.headers?.get("server-timing"));
  } catch (_) {
    return null;
  }
}

function roundRouteTimingValue(value: number): number {
  return Math.round(value * 100) / 100;
}

export function extractResourceTiming(
  entry: Record<string, unknown> | undefined | null,
): Record<string, number> | null {
  const fields = [
    "startTime",
    "requestStart",
    "responseStart",
    "responseEnd",
    "duration",
    "transferSize",
    "encodedBodySize",
    "decodedBodySize",
  ];
  const timing: Record<string, number> = {};

  for (const field of fields) {
    const value = entry?.[field];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      timing[field] = roundRouteTimingValue(value);
    }
  }

  return Object.keys(timing).length ? timing : null;
}

export interface RouteTimingRecorder {
  emitRouteTiming(
    phase: string,
    path: string,
    startedAt: number,
    detail?: Record<string, unknown>,
  ): RouteTimingEntry;
  buildPageDataTimingDetail(
    response: RuntimeResponse,
    endpoint: string,
    fetchStartedAt: number,
    source: string,
  ): Record<string, unknown>;
}

export function createRouteTimingRecorder(
  window: RuntimeWindow,
  logging: RuntimeLogging,
): RouteTimingRecorder {
  const { log } = logging;

  function emitRouteTiming(
    phase: string,
    path: string,
    startedAt: number,
    detail: Record<string, unknown> = {},
  ): RouteTimingEntry {
    const entry: RouteTimingEntry = {
      phase,
      path,
      duration: Math.max(0, routeTimingNow() - startedAt),
      timestamp: Date.now(),
      ...detail,
    };
    const timings = Array.isArray(window.__veryfrontRouteTimings)
      ? window.__veryfrontRouteTimings
      : [];

    timings.push(entry);
    if (timings.length > MAX_ROUTE_TIMINGS) {
      timings.splice(0, timings.length - MAX_ROUTE_TIMINGS);
    }

    window.__veryfrontRouteTimings = timings;

    try {
      window.dispatchEvent(new CustomEvent("veryfront:route-timing", { detail: entry }));
    } catch (_) {
      // CustomEvent dispatch is best-effort instrumentation.
    }

    log("Route timing:", entry);
    return entry;
  }

  function getPageDataResourceTiming(
    endpoint: string,
    fetchStartedAt: number,
  ): Record<string, number> | null {
    try {
      if (
        typeof performance === "undefined" || typeof performance.getEntriesByName !== "function"
      ) {
        return null;
      }

      const href = new URL(endpoint, window.location.href).href;
      const entries = performance.getEntriesByName(href, "resource");
      if (!entries.length) return null;

      for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index] as PerformanceEntry & Record<string, unknown>;
        const responseEnd = entry?.responseEnd;
        if (
          typeof responseEnd === "number" &&
          Number.isFinite(responseEnd) &&
          responseEnd + 1 >= fetchStartedAt
        ) {
          return extractResourceTiming(entry);
        }
      }

      return null;
    } catch (_) {
      return null;
    }
  }

  function buildPageDataTimingDetail(
    response: RuntimeResponse,
    endpoint: string,
    fetchStartedAt: number,
    source: string,
  ): Record<string, unknown> {
    const detail: Record<string, unknown> = { source, status: response.status };
    const serverTiming = readResponseServerTiming(response);
    if (serverTiming) {
      detail.serverTiming = serverTiming;
      const serverTimingMetrics = parseServerTimingMetrics(serverTiming);
      if (serverTimingMetrics) detail.serverTimingMetrics = serverTimingMetrics;
    }

    const resourceTiming = getPageDataResourceTiming(response.url || endpoint, fetchStartedAt);
    if (resourceTiming) detail.resourceTiming = resourceTiming;

    return detail;
  }

  return { emitRouteTiming, buildPageDataTimingDetail };
}
