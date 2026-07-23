import { VeryfrontError } from "#veryfront/errors";
import { TimeoutError } from "#veryfront/rendering/utils/stream-utils.ts";
import { ResponseBuilder } from "#veryfront/security/index.ts";
import { serverLogger } from "#veryfront/utils";
import {
  HTTP_GATEWAY_TIMEOUT,
  HTTP_INTERNAL_SERVER_ERROR,
  HTTP_NOT_FOUND,
} from "#veryfront/utils/constants/http.ts";
import type { HandlerContext } from "../../types.ts";
import { getSafeErrorName } from "../../../utils/error-name.ts";

function isPageDataNotFound(error: unknown): boolean {
  try {
    return error instanceof VeryfrontError && error.status === HTTP_NOT_FOUND;
  } catch {
    return false;
  }
}

export function createPageDataErrorResponse(
  error: unknown,
  req: Request,
  ctx: HandlerContext,
): Response {
  if (error instanceof TimeoutError) {
    serverLogger.warn("[page-data] Request timed out", {
      errorName: getSafeErrorName(error),
      status: HTTP_GATEWAY_TIMEOUT,
    });
    return ResponseBuilder.json(
      { error: "Page data request timed out", status: HTTP_GATEWAY_TIMEOUT },
      req,
      {
        securityConfig: ctx.securityConfig,
        corsConfig: ctx.securityConfig?.cors,
        status: HTTP_GATEWAY_TIMEOUT,
      },
    );
  }

  const notFound = isPageDataNotFound(error);
  const status = notFound ? HTTP_NOT_FOUND : HTTP_INTERNAL_SERVER_ERROR;
  serverLogger.error("[page-data] Failed to resolve page data", {
    errorName: getSafeErrorName(error),
    status,
  });
  return ResponseBuilder.json(
    { error: notFound ? "Page not found" : "Internal server error", status },
    req,
    {
      securityConfig: ctx.securityConfig,
      corsConfig: ctx.securityConfig?.cors,
      status,
    },
  );
}
