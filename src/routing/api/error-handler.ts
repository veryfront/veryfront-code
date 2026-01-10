import { isDevelopmentEnvironment, serverLogger as logger } from "@veryfront/utils";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { HttpStatus, internalServerError, jsonResponse } from "../../http/responses.ts";

/**
 * Checks if the environment is development mode.
 * Checks adapter env first, then falls back to runtime env.
 */
function isDevelopment(adapter: RuntimeAdapter): boolean {
  const envFromAdapter = adapter.env.get("MODE") ??
    adapter.env.get("NODE_ENV") ??
    adapter.env.get("DENO_ENV");

  if (envFromAdapter) {
    const env = envFromAdapter.toLowerCase();
    return env === "development" || env === "dev";
  }

  return isDevelopmentEnvironment();
}

export function handleAPIError(
  error: unknown,
  pathname: string,
  adapter: RuntimeAdapter,
): Response {
  logger.error(`API route error in ${pathname}:`, error);

  if (isDevelopment(adapter)) {
    return jsonResponse(
      {
        error: error instanceof Error ? error.message : "Internal server error",
        stack: error instanceof Error ? error.stack : undefined,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  return internalServerError();
}
