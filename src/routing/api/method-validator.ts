import { methodNotAllowed } from "@veryfront/http/responses.ts";
import type { HTTPMethod } from "./module-loader/types.ts";

const HTTP_METHODS: HTTPMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

export function createAppRouteMethodNotAllowed(
  handlerModule: Record<string, unknown>,
): Response {
  const allowed = HTTP_METHODS.filter((m) => typeof handlerModule[m] === "function");
  return methodNotAllowed(allowed);
}

export function createPagesRouteMethodNotAllowed(
  handler: Record<string, unknown>,
): Response {
  const allowed = Object.keys(handler)
    .filter((m) => m !== "default" && typeof handler[m] === "function");
  return methodNotAllowed(allowed);
}
