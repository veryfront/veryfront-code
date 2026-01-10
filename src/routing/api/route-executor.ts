import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createContext, normalizeParams } from "./context-builder.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type {
  APIRoute,
  AppRouteContext,
  AppRouteHandler,
  HTTPMethod,
  PagesRouteHandler,
} from "./module-loader/types.ts";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "./method-validator.ts";
import { handleAPIError } from "./error-handler.ts";

/** Validates that a handler returned a Response instance */
function validateResponse(response: unknown): asserts response is Response {
  if (!(response instanceof Response)) {
    throw toError(createError({
      type: "api",
      message: "API handler must return a Response",
    }));
  }
}

/** Creates a HEAD response from an existing response (body stripped) */
function toHeadResponse(response: Response): Response {
  return new Response(null, {
    status: response.status,
    headers: response.headers,
  });
}

export async function executeAppRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
): Promise<Response> {
  const method = request.method.toUpperCase() as HTTPMethod;
  const handlerModule = handler as Record<string, unknown>;
  const handlerFn = handlerModule[method] as AppRouteHandler | undefined;
  const defaultFn = handlerModule.default as AppRouteHandler | undefined;
  let resolvedFn = handlerFn || defaultFn;

  // HEAD requests can fall back to GET handler
  if (!resolvedFn && method === "HEAD") {
    resolvedFn = handlerModule.GET as AppRouteHandler | undefined;
  }

  if (!resolvedFn) {
    return createAppRouteMethodNotAllowed(handlerModule);
  }

  try {
    const appContext: AppRouteContext = { params: normalizeParams(match.params) };
    const response = await resolvedFn(request, appContext);
    validateResponse(response);
    return method === "HEAD" ? toHeadResponse(response) : response;
  } catch (error) {
    return handleAPIError(error, pathname, adapter);
  }
}

export async function executePagesRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
): Promise<Response> {
  const method = request.method as keyof APIRoute;
  const methodHandler = handler[method] || handler.default;

  if (!methodHandler) {
    return createPagesRouteMethodNotAllowed(handler as Record<string, unknown>);
  }

  try {
    const ctx = createContext(request, match, adapter.fs);
    const response = await (methodHandler as PagesRouteHandler)(ctx);
    validateResponse(response);
    return response;
  } catch (error) {
    return handleAPIError(error, pathname, adapter);
  }
}
