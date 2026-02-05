import type { Middleware } from "./types.ts";
import { getRequest } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { getEnvironmentConfig, type EnvironmentConfig } from "#veryfront/config/environment-config.ts";

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

    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(TIMEOUT_SENTINEL), timeoutMs);
    });

    try {
      return await Promise.race([next(), timeoutPromise]);
    } catch (error) {
      if (error !== TIMEOUT_SENTINEL) throw error;

      serverLogger.warn("[timeout] Request timed out", {
        path: pathname,
        method: req.method,
        timeoutMs,
      });

      return new Response(
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
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}

/**
 * Gets timeout from environment variable REQUEST_TIMEOUT_MS
 *
 * @param env - Optional RuntimeEnv for test isolation
 */
export function getTimeoutFromEnv(env: EnvironmentConfig = getEnvironmentConfig()): number {
  const timeoutMs = env.requestTimeoutMs;
  return timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS;
}

/**
 * Creates a timeout middleware with configuration from environment
 */
export function timeoutFromEnv(options?: Omit<TimeoutOptions, "timeoutMs">): Middleware {
  return timeout({ ...options, timeoutMs: getTimeoutFromEnv() });
}
