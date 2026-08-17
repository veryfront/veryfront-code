/**
 * Cross-cutting pieces every other runtime module needs: the debug switch, the
 * loggers, the DEBUG-only perf timers, and the route-param normalizer.
 *
 * These used to be free variables that happened to be in scope because
 * router.ts was concatenated first. They are now imported.
 */

import type { RuntimeDocument, RuntimeWindow } from "./env.ts";

/** The module server the loader resolves project modules against. */
export function moduleServerUrl(window: RuntimeWindow): string {
  return window.location.origin + "/_vf_modules";
}

export interface RuntimeLogging {
  DEBUG: boolean;
  log: (...args: unknown[]) => void;
  logError: (...args: unknown[]) => void;
  logBackgroundFetchFailure: (reason: string, path: string, error: unknown) => void;
  perfStart: (label: string) => void;
  perfEnd: (label: string) => number;
}

/**
 * Debug logging is production-safe: `log` compiles away to a no-op unless the
 * page opted in via `window.__VERYFRONT_DEBUG__` or `?vf_debug`.
 */
export function createLogging(window: RuntimeWindow): RuntimeLogging {
  const DEBUG = Boolean(
    window.__VERYFRONT_DEBUG__ || new URLSearchParams(window.location.search).has("vf_debug"),
  );

  const log: (...args: unknown[]) => void = DEBUG
    ? console.log.bind(console, "[Veryfront]")
    : () => {};
  const logError: (...args: unknown[]) => void = console.error.bind(console, "[Veryfront]");

  function logBackgroundFetchFailure(reason: string, path: string, error: unknown): void {
    const message = (error as { message?: string })?.message ?? String(error);
    log(reason + " failed:", path, message);
  }

  const perfTimers = new Map<string, number>();
  const perfStart = DEBUG
    ? (label: string) => {
      perfTimers.set(label, performance.now());
    }
    : () => {};
  const perfEnd = DEBUG
    ? (label: string) => {
      const start = perfTimers.get(label);
      // A recorded 0 is a real timestamp, so absence has to be the test —
      // falsiness would leak the entry and silently skip the measurement.
      if (start === undefined) return 0;

      const duration = performance.now() - start;
      perfTimers.delete(label);
      console.log(
        "[Veryfront Perf] %c" + label + ": %c" + duration.toFixed(2) + "ms",
        "color: #888",
        duration > 100 ? "color: #f00; font-weight: bold" : "color: #0a0",
      );
      return duration;
    }
    : () => 0;

  return { DEBUG, log, logError, logBackgroundFetchFailure, perfStart, perfEnd };
}

export function isAbortError(error: unknown): boolean {
  return (error as { name?: string })?.name === "AbortError";
}

/**
 * Resolves a target the runtime is about to hand to a document navigation,
 * returning null when it is not safe to follow.
 *
 * Assigning a `javascript:` or `data:` URL to `location.href` EXECUTES it, so
 * every path that leaves the SPA has to resolve and check the scheme first —
 * not just the getServerData redirect path, which is where this check first
 * appeared. Returning the resolved absolute URL means callers navigate to
 * exactly the string that was vetted.
 */
export function resolveDocumentNavigationUrl(
  target: string,
  baseUrl: string,
): string | null {
  try {
    const url = new URL(target, baseUrl);
    if (url.protocol === "http:" || url.protocol === "https:") return url.href;
  } catch (_) {
    /* unparseable target — do not navigate */
  }
  return null;
}

/** The CSP nonce the document was served with, so injected styles inherit it. */
export function getDocumentNonce(document: RuntimeDocument): string | undefined {
  const element = document.querySelector("script[nonce], style[nonce], link[nonce]");
  if (!element) return undefined;

  return element.nonce || element.getAttribute("nonce") || undefined;
}

/**
 * Catch-all segments arrive as arrays and are joined so no path info is lost.
 *
 * This is the server's own flattener, not a client copy of it: the client and
 * the SSR render must agree on the joined form exactly (issue #2742), and the
 * module is a dependency-free leaf so it bundles into the client runtime.
 *
 * TODO(convergence): rendering/rsc/hydration-router.ts and
 * client/spa/ClientApp.tsx still carry their own `normalizeParams`, which write
 * `undefined` values through instead of skipping them. Collapsing those onto
 * flattenRouteParams is a behaviour change for undefined params, so it is left
 * out of this refactor.
 */
export { flattenRouteParams as normalizeRouteParams } from "#veryfront/routing/flatten-route-params.ts";
