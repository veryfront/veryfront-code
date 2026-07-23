import type { HandlerContext } from "#veryfront/types";

/**
 * Return whether a request would execute explicitly remote project code in the
 * host process.
 *
 * An absent locality signal remains compatible with standalone callers. The
 * runtime handler always supplies an explicit boolean for resolved projects.
 */
export function shouldRejectUnisolatedProjectCode(
  ctx: Pick<HandlerContext, "isLocalProject">,
): boolean {
  // Data and rendering still resolve and import project modules in the host
  // before their optional worker stages. Feature flags cannot make these paths
  // safe until discovery, module loading, and execution all move into a worker.
  return ctx.isLocalProject === false;
}

/** Build a generic, non-cacheable response without exposing isolation details. */
export function createProjectCodeUnavailableResponse(
  requestOrMethod?: Request | string,
  status = 503,
): Response {
  const method = typeof requestOrMethod === "string" ? requestOrMethod : requestOrMethod?.method;
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  const body = method?.toUpperCase() === "HEAD"
    ? null
    : JSON.stringify({ error: "Service temporarily unavailable" });
  return new Response(body, { status, headers });
}
