import { serverLogger as logger } from "#veryfront/utils";
import { isDevelopment as isDevelopmentEnv } from "#veryfront/build/config/environment.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { HttpStatus, internalServerError, jsonResponse } from "#veryfront/http/responses";

function isDevelopment(adapter: RuntimeAdapter): boolean {
  const env = adapter.env.get("MODE") ??
    adapter.env.get("NODE_ENV") ??
    adapter.env.get("DENO_ENV");

  if (!env) return isDevelopmentEnv();

  const normalized = env.toLowerCase();
  return normalized === "development" || normalized === "dev";
}

export function handleAPIError(
  error: unknown,
  pathname: string,
  adapter: RuntimeAdapter,
): Response {
  logger.error(`API route error in ${pathname}:`, error);

  if (!isDevelopment(adapter)) return internalServerError();

  const err = error instanceof Error ? error : null;

  return jsonResponse(
    {
      error: err?.message ?? "Internal server error",
      stack: err?.stack,
    },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
