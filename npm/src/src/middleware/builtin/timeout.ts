import * as dntShim from "../../../_dnt.shims.js";
import type { Middleware } from "./types.js";
import { getRequest } from "./types.js";
import { serverLogger } from "../../utils/index.js";
import { getRuntimeEnv, type RuntimeEnv } from "../../config/runtime-env.js";

const DEFAULT_TIMEOUT_MS = 60000;
const HTTP_GATEWAY_TIMEOUT = 504;
const TIMEOUT_SENTINEL = Symbol("timeout");

export interface TimeoutOptions {
  /** Timeout in milliseconds (default: 60000) */
  timeoutMs?: number;

  /** Custom message for timeout response */
  message?: string;

  /** Paths to exclude from timeout (e.g., health checks) */
  exclude?: string[];
}

/**
 * Creates a middleware that enforces request timeouts.
 *
 * If a request takes longer than the configured timeout, the middleware
 * returns a 504 Gateway Timeout response.
 */
export function timeout(options?: TimeoutOptions): Middleware {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const message = options?.message ?? "Request timeout";
  const exclude = options?.exclude ?? ["/healthz", "/readyz", "/_health"];

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const { pathname } = new URL(req.url);

    if (exclude.some((path) => pathname === path || pathname.startsWith(path))) {
      return next();
    }

    let timeoutId: ReturnType<typeof dntShim.setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = dntShim.setTimeout(() => reject(TIMEOUT_SENTINEL), timeoutMs);
    });

    try {
      const result = await Promise.race([next(), timeoutPromise]);
      if (timeoutId) clearTimeout(timeoutId);
      return result;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);

      if (error !== TIMEOUT_SENTINEL) {
        throw error;
      }

      serverLogger.warn("[timeout] Request timed out", {
        path: pathname,
        method: req.method,
        timeoutMs,
      });

      return new dntShim.Response(
        JSON.stringify({
          error: message,
          timeoutMs,
          path: pathname,
        }),
        {
          status: HTTP_GATEWAY_TIMEOUT,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  };
}

/**
 * Gets timeout from environment variable REQUEST_TIMEOUT_MS
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
export function getTimeoutFromEnv(env: RuntimeEnv = getRuntimeEnv()): number {
  const timeoutMs = env.requestTimeoutMs;
  if (timeoutMs && timeoutMs > 0) return timeoutMs;
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Creates a timeout middleware with configuration from environment
 */
export function timeoutFromEnv(options?: Omit<TimeoutOptions, "timeoutMs">): Middleware {
  return timeout({ ...options, timeoutMs: getTimeoutFromEnv() });
}
