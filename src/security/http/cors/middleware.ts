import type { Context, MiddlewareHandler } from "#veryfront/middleware/core/index.ts";
import type { CORSConfig } from "./types.ts";
import { handleCORSPreflight, isPreflightRequest } from "./preflight.ts";
import { applyCORSHeaders } from "./headers.ts";
import { validateCORSConfig } from "./validators.ts";
import { createError, toError } from "#veryfront/errors";
import { isWebSocketUpgradeResponse } from "#veryfront/platform/adapters/base.ts";

/** Create CORS middleware. */
export function cors(config?: boolean | CORSConfig): MiddlewareHandler {
  const validation = validateCORSConfig(config);
  if (!validation.valid) {
    throw toError(
      createError({
        type: "config",
        message: `[CORS] Invalid configuration: ${validation.error}`,
      }),
    );
  }

  return async (c: Context, next) => {
    const request = c.req;

    if (isPreflightRequest(request)) {
      return handleCORSPreflight({ request, config });
    }

    const response = await next();
    if (!response) return undefined;
    if (isWebSocketUpgradeResponse(response) || response.status === 101) return response;

    return (await applyCORSHeaders({ request, response, config })) ?? response;
  };
}

export function corsSimple(origin: string = "*"): MiddlewareHandler {
  return cors({
    origin,
    credentials: false,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  });
}
