import type { Context, MiddlewareHandler } from "#veryfront/middleware/core/index.ts";
import type { CORSConfig } from "./types.ts";
import { handleCORSPreflight, isPreflightRequest } from "./preflight.ts";
import { applyCORSHeaders } from "./headers.ts";
import { validateCORSConfig } from "./validators.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";

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

  return async (
    c: Context,
    next: () => Promise<Response | undefined> | Response,
  ): Promise<Response | undefined> => {
    const request = c.req;

    if (isPreflightRequest(request)) {
      return handleCORSPreflight({ request, config });
    }

    const response = await next();
    if (!response) return response;

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
