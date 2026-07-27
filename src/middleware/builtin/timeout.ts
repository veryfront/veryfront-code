import type { Middleware } from "./types.ts";
import { getRequest } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type EnvironmentConfig,
  getEnvironmentConfig,
} from "#veryfront/config/environment-config.ts";
import { HTTP_GATEWAY_TIMEOUT } from "#veryfront/utils/constants/http.ts";
import { MAX_TIMER_DELAY_MS, normalizeTimerDurationMs } from "#veryfront/utils/timer.ts";
import { MAX_PATH_LENGTH_CHARS } from "#veryfront/utils/constants/limits.ts";

const logger = serverLogger.component("timeout");

const TIMEOUT_SENTINEL = Symbol("timeout");
const DEFAULT_EXCLUDE_PATHS = ["/healthz", "/readyz", "/_health"];

/** Options accepted by timeout. */
export interface TimeoutOptions {
  /** Timeout in milliseconds (default: 75000) */
  timeoutMs?: number;

  /** Custom message for timeout response */
  message?: string;

  /** Paths to exclude from timeout (e.g., health checks) */
  exclude?: string[];
}

function isExcludedPath(pathname: string, exclude: string[]): boolean {
  return exclude.some((path) =>
    path === "/" ||
    pathname === path ||
    pathname.startsWith(`${path}/`)
  );
}

function normalizeExcludePaths(value: unknown): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("Timeout exclude must be an array of absolute paths");
  }

  return value.map((path, index) => {
    if (
      typeof path !== "string" ||
      !path.startsWith("/") ||
      path.startsWith("//")
    ) {
      throw new TypeError(
        `Timeout exclude[${index}] must be an absolute path`,
      );
    }
    if (path.includes("?") || path.includes("#")) {
      throw new TypeError(
        `Timeout exclude[${index}] must not contain a query or fragment`,
      );
    }
    if (path.length > MAX_PATH_LENGTH_CHARS) {
      throw new RangeError(
        `Timeout exclude[${index}] exceeds ${MAX_PATH_LENGTH_CHARS} characters`,
      );
    }

    return path.length > 1 ? path.replace(/\/+$/, "") : path;
  });
}

function timeoutResponse(pathname: string, timeoutMs: number, message: string): Response {
  return new Response(
    JSON.stringify({
      error: message,
      timeoutMs,
      path: pathname,
    }),
    {
      status: HTTP_GATEWAY_TIMEOUT,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json",
      },
    },
  );
}

/**
 * Creates a middleware that enforces request timeouts.
 *
 * If a request takes longer than the configured timeout, the middleware
 * returns a 504 Gateway Timeout response.
 */
export function timeout(options?: TimeoutOptions): Middleware {
  if (
    options !== undefined &&
    (typeof options !== "object" || options === null || Array.isArray(options))
  ) {
    throw new TypeError("Timeout configuration must be an options object");
  }

  const timeoutMs = normalizeTimerDurationMs(
    options?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    "Timeout timeoutMs",
  );
  if (
    options?.message !== undefined &&
    typeof options.message !== "string"
  ) {
    throw new TypeError("Timeout message must be a string");
  }
  const message = options?.message ?? "Request timeout";
  const exclude = normalizeExcludePaths(
    options?.exclude ?? DEFAULT_EXCLUDE_PATHS,
  );

  return async (ctx, next) => {
    const req = getRequest(ctx);
    const { pathname } = new URL(req.url);

    if (isExcludedPath(pathname, exclude)) {
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

      logger.warn("Request timed out", {
        path: pathname,
        method: req.method,
        timeoutMs,
      });

      return timeoutResponse(pathname, timeoutMs, message);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  };
}

/**
 * Gets timeout from environment variable REQUEST_TIMEOUT_MS
 *
 * @param env - Optional EnvironmentConfig for test isolation
 */
export function getTimeoutFromEnv(env: EnvironmentConfig = getEnvironmentConfig()): number {
  const timeoutMs = env.requestTimeoutMs;
  if (timeoutMs === undefined) return DEFAULT_REQUEST_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `Environment requestTimeoutMs must be an integer between 1 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return timeoutMs;
}

/**
 * Creates a timeout middleware with configuration from environment
 */
export function timeoutFromEnv(options?: Omit<TimeoutOptions, "timeoutMs">): Middleware {
  return timeout({ ...options, timeoutMs: getTimeoutFromEnv() });
}
