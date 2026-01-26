import * as dntShim from "../../../_dnt.shims.js";
import { isDevelopmentEnvironment, serverLogger as logger } from "../../utils/index.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import { HttpStatus, internalServerError, jsonResponse } from "../../platform/compat/http/responses.js";

function isDevelopment(adapter: RuntimeAdapter): boolean {
  const env = adapter.env.get("MODE") ??
    adapter.env.get("NODE_ENV") ??
    adapter.env.get("DENO_ENV");

  if (!env) return isDevelopmentEnvironment();

  const normalized = env.toLowerCase();
  return normalized === "development" || normalized === "dev";
}

export function handleAPIError(
  error: unknown,
  pathname: string,
  adapter: RuntimeAdapter,
): dntShim.Response {
  logger.error(`API route error in ${pathname}:`, error);

  if (!isDevelopment(adapter)) return internalServerError();

  const err = error instanceof Error ? error : undefined;

  return jsonResponse(
    {
      error: err?.message ?? "Internal server error",
      stack: err?.stack,
    },
    HttpStatus.INTERNAL_SERVER_ERROR,
  );
}
