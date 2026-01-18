import type { Middleware } from "./types.ts";
import { getRequest } from "./types.ts";
import { serverLogger } from "@veryfront/utils";
import { getEnv } from "@veryfront/platform/compat/process.ts";

const DEFAULT_TIMEOUT_MS = 30000;
const HTTP_GATEWAY_TIMEOUT = 504;

export interface TimeoutOptions {
  /** Timeout in milliseconds (default: 30000) */
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
      const result = await Promise.race([next(), timeoutPromise]);
      clearTimeout(timeoutId);
      return result;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error === TIMEOUT_SENTINEL) {
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
      }

      throw error;
    }
  };
}

const TIMEOUT_SENTINEL = Symbol("timeout");

/**
 * Gets timeout from environment variable REQUEST_TIMEOUT_MS
 */
export function getTimeoutFromEnv(): number {
  const envTimeout = getEnv("REQUEST_TIMEOUT_MS");
  if (envTimeout) {
    const parsed = parseInt(envTimeout, 10);
    if (!isNaN(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return DEFAULT_TIMEOUT_MS;
}

/**
 * Creates a timeout middleware with configuration from environment
 */
export function timeoutFromEnv(options?: Omit<TimeoutOptions, "timeoutMs">): Middleware {
  return timeout({
    ...options,
    timeoutMs: getTimeoutFromEnv(),
  });
}
