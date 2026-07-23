import { methodNotAllowed } from "#veryfront/http/responses";
import type { HTTPMethod } from "./module-loader/types.ts";

const HTTP_METHODS: HTTPMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function getAllowedMethods(
  handler: Record<string, unknown>,
  methods: readonly string[],
  exclude: (method: string) => boolean = () => false,
): string[] {
  const allowed = methods.filter(
    (method) => !exclude(method) && typeof handler[method] === "function",
  );
  if (allowed.includes("GET") && !allowed.includes("HEAD")) {
    allowed.splice(allowed.indexOf("GET") + 1, 0, "HEAD");
  }
  return allowed;
}

export function createAppRouteMethodNotAllowed(handlerModule: Record<string, unknown>): Response {
  const allowed = getAllowedMethods(handlerModule, HTTP_METHODS);
  return methodNotAllowed(allowed);
}

export function createPagesRouteMethodNotAllowed(handler: Record<string, unknown>): Response {
  const allowed = getAllowedMethods(handler, HTTP_METHODS);
  return methodNotAllowed(allowed);
}
