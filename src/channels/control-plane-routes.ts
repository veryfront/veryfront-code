/**
 * Route patterns for the control-plane surface.
 *
 * These live outside `control-plane.ts` because that module is a published
 * entrypoint (`./channels/control-plane` in deno.json). Keeping the patterns
 * here lets the dispatch-ordering guard read the run operation verbs without
 * widening the public API.
 *
 * @internal
 */

/**
 * Matches the signed run operation routes (`execute`, `stream`, `resume`) of a
 * control-plane run. Group 1 is the run id.
 */
export const CONTROL_PLANE_RUN_OPERATION_PATH =
  /^\/api\/control-plane\/runs\/([^/]+)\/(?:execute|stream|resume)$/u;

/** Matches the bare run route, which only DELETE addresses. Group 1 is the run id. */
export const CONTROL_PLANE_RUN_PATH = /^\/api\/control-plane\/runs\/([^/]+)$/u;

/**
 * The run id a control-plane run route addresses, or `undefined` when the
 * method and path pair is not one a run handler serves.
 */
export function controlPlaneRunIdFromPath(method: string, pathname: string): string | undefined {
  const normalizedMethod = method.toUpperCase();
  const route = normalizedMethod === "POST"
    ? CONTROL_PLANE_RUN_OPERATION_PATH
    : normalizedMethod === "DELETE"
    ? CONTROL_PLANE_RUN_PATH
    : undefined;
  return route?.exec(pathname)?.[1];
}

/**
 * True for the run routes the platform sends straight to the owning pod, past the proxy:
 * cancel (`DELETE /runs/{runId}`) and `POST /runs/{runId}/resume`. Their release headers
 * are unverified. On a pod that does not own the run, the call is platform-scoped, with no
 * release.
 */
export function isDirectToPodRunRoute(method: string, pathname: string): boolean {
  const normalizedMethod = method.toUpperCase();
  if (normalizedMethod === "DELETE") return CONTROL_PLANE_RUN_PATH.test(pathname);
  return normalizedMethod === "POST" && pathname.endsWith("/resume") &&
    CONTROL_PLANE_RUN_OPERATION_PATH.test(pathname);
}
