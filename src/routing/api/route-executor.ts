import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import { createContext, normalizeParams } from "./context-builder.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import type {
  APIRoute,
  AppRouteContext,
  AppRouteHandler,
  PagesRouteHandler,
} from "./module-loader/types.ts";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "./method-validator.ts";
import { handleAPIError } from "./error-handler.ts";

type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

export async function executeAppRoute(
  handler: APIRoute,
  request: Request,
  match: RouteMatch,
  pathname: string,
  adapter: RuntimeAdapter,
): Promise<Response> {
  const method = request.method.toUpperCase() as HTTPMethod;
  const handlerModule = handler as Record<string, unknown>;
  const handlerFn = handlerModule[method] as PagesRouteHandler | AppRouteHandler | undefined;
  const defaultFn = handlerModule.default as PagesRouteHandler | AppRouteHandler | undefined;
  let resolvedFn = handlerFn || defaultFn;
  const appContext: AppRouteContext = { params: normalizeParams(match.params) };

  if (!resolvedFn && method === "HEAD") {
    const getFn = handlerModule.GET as PagesRouteHandler | AppRouteHandler | undefined;
    if (typeof getFn === "function") {
      resolvedFn = getFn;
    }
  }

  if (!resolvedFn) {
    return createAppRouteMethodNotAllowed(handlerModule);
  }

  try {
    const response: Response = await (resolvedFn as AppRouteHandler)(
      request,
      appContext,
    );

    if (!(response instanceof Response)) {
      throw toError(createError({
        type: "api",
        message: "API handler must return a Response",
      }));
    }

    if (method === "HEAD") {
      return new Response(null, {
        status: response.status,
        headers: response.headers,
      });
    }

    return response;
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
  const ctx = createContext(request, match);
  const method = request.method as keyof APIRoute;
  const methodHandler = handler[method] || handler.default;

  if (!methodHandler) {
    return createPagesRouteMethodNotAllowed(handler as Record<string, unknown>);
  }

  try {
    const response = await (methodHandler as PagesRouteHandler)(ctx);

    if (!(response instanceof Response)) {
      throw toError(createError({
        type: "api",
        message: "API handler must return a Response",
      }));
    }

    return response;
  } catch (error) {
    return handleAPIError(error, pathname, adapter);
  }
}
