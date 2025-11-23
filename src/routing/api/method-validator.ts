import { HTTP_METHOD_NOT_ALLOWED } from "@veryfront/utils";

type HTTPMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS";

export function createAppRouteMethodNotAllowed(
  handlerModule: Record<string, unknown>,
): Response {
  const candidates: HTTPMethod[] = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
  const implemented = candidates.filter((m) => typeof handlerModule[m] === "function");
  const allow = implemented.join(", ");
  return new Response("Method not allowed", {
    status: HTTP_METHOD_NOT_ALLOWED,
    headers: { Allow: allow },
  });
}

export function createPagesRouteMethodNotAllowed(
  handler: Record<string, unknown>,
): Response {
  const allowedMethods = Object.keys(handler)
    .filter((m) => m !== "default" && typeof handler[m] === "function")
    .join(", ");
  return new Response("Method not allowed", {
    status: HTTP_METHOD_NOT_ALLOWED,
    headers: { Allow: allowedMethods },
  });
}
