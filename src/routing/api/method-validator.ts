import { methodNotAllowed } from "#veryfront/http/responses";
import { resolveExecutableRouteMethods } from "./route-methods.ts";

function getAllowedMethods(
  handler: Record<string, unknown>,
): string[] {
  // OPTIONS is framework-reachable for every matched API route, so RFC Allow
  // must advertise it even when the project module does not export OPTIONS.
  return resolveExecutableRouteMethods(handler);
}

export function createAppRouteMethodNotAllowed(handlerModule: Record<string, unknown>): Response {
  const allowed = getAllowedMethods(handlerModule);
  return methodNotAllowed(allowed);
}

export function createPagesRouteMethodNotAllowed(handler: Record<string, unknown>): Response {
  return methodNotAllowed(getAllowedMethods(handler));
}
