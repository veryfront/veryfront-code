import { methodNotAllowed } from "#veryfront/http/responses";
import type { HTTPMethod } from "./module-loader/types.ts";

const HTTP_METHODS: HTTPMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function createAppRouteMethodNotAllowed(handlerModule: Record<string, unknown>): Response {
  const allowed = HTTP_METHODS.filter((method) => typeof handlerModule[method] === "function");
  return methodNotAllowed(allowed);
}

export function createPagesRouteMethodNotAllowed(handler: Record<string, unknown>): Response {
  const allowed = Object.keys(handler).filter(
    (method) => method !== "default" && typeof handler[method] === "function",
  );
  return methodNotAllowed(allowed);
}
