import type { MiddlewareHandler } from "../core/types.ts";
import { getRequest } from "./types.ts";
import { serverLogger } from "#veryfront/utils";
import { getEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { HTTP_GATEWAY_TIMEOUT } from "#veryfront/utils/constants/http.ts";

const logger = serverLogger.component("timeout");

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TIMEOUT_MS = 2_147_483_647;
const MAX_MESSAGE_LENGTH = 1_024;
const MAX_EXCLUDE_PATHS = 128;
const MAX_EXCLUDE_PATH_LENGTH = 1_024;
const TIMEOUT_SENTINEL = Symbol("timeout");
const DEFAULT_EXCLUDE_PATHS = ["/healthz", "/readyz", "/_health"];
// deno-lint-ignore no-control-regex -- timeout exclusions must reject control characters
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;

function assertTimeoutMs(value: number): void {
  if (Number.isSafeInteger(value) && value > 0 && value <= MAX_TIMEOUT_MS) return;
  throw new TypeError(
    `timeoutMs must be a positive integer no greater than ${MAX_TIMEOUT_MS}`,
  );
}

function normalizeMessage(value: unknown): string {
  if (typeof value === "string" && value.length <= MAX_MESSAGE_LENGTH) return value;
  throw new TypeError(`message must be a string no longer than ${MAX_MESSAGE_LENGTH} characters`);
}

function normalizeExclude(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_EXCLUDE_PATHS) {
    throw new TypeError(`exclude must contain no more than ${MAX_EXCLUDE_PATHS} paths`);
  }

  return value.map((path) => {
    if (
      typeof path !== "string" || path.length === 0 ||
      path.length > MAX_EXCLUDE_PATH_LENGTH || !path.startsWith("/") ||
      path.includes("?") || path.includes("#") || CONTROL_CHARACTER_PATTERN.test(path)
    ) {
      throw new TypeError(
        "exclude entries must be absolute URL paths without query or fragment data",
      );
    }
    return path;
  });
}

/** Options accepted by timeout. */
export interface TimeoutOptions {
  /** Timeout in milliseconds. Defaults to 60000 and must fit a runtime timer. */
  timeoutMs?: number;

  /** Timeout response message, limited to 1024 characters. */
  message?: string;

  /** Up to 128 absolute URL paths to exclude, including nested paths. */
  exclude?: string[];
}

/** Environment values used to resolve the request timeout. */
export interface TimeoutEnvironmentConfig {
  /** Incoming request timeout in milliseconds. */
  requestTimeoutMs?: number;
}

function isExcludedPath(pathname: string, exclude: string[]): boolean {
  return exclude.some((path) =>
    pathname === path || pathname.startsWith(path.endsWith("/") ? path : `${path}/`)
  );
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
      headers: { "Content-Type": "application/json" },
    },
  );
}

/**
 * Create middleware that enforces request timeouts.
 *
 * If a request takes longer than the configured timeout, the middleware
 * returns a 504 Gateway Timeout response.
 */
export function timeout(options?: TimeoutOptions): MiddlewareHandler {
  if (
    options !== undefined &&
    (options === null || typeof options !== "object" || Array.isArray(options))
  ) {
    throw new TypeError("timeout options must be an object");
  }
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  assertTimeoutMs(timeoutMs);
  const message = normalizeMessage(options?.message ?? "Request timeout");
  const exclude = normalizeExclude(options?.exclude ?? DEFAULT_EXCLUDE_PATHS);

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
      if (timeoutId) clearTimeout(timeoutId);
    }
  };
}

/**
 * Read the request timeout from the environment configuration.
 *
 * @param env - Optional environment values for test isolation.
 */
export function getTimeoutFromEnv(
  env: TimeoutEnvironmentConfig = getEnvironmentConfig(),
): number {
  const timeoutMs = env.requestTimeoutMs;
  if (timeoutMs === undefined) return DEFAULT_TIMEOUT_MS;
  assertTimeoutMs(timeoutMs);
  return timeoutMs;
}

/**
 * Create timeout middleware using the environment configuration.
 */
export function timeoutFromEnv(
  options?: Omit<TimeoutOptions, "timeoutMs">,
): MiddlewareHandler {
  return timeout({ ...options, timeoutMs: getTimeoutFromEnv() });
}
