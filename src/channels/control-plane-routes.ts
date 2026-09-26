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

/** Matches the signed run operation routes (`execute`, `stream`, `resume`) of a control-plane run. */
export const CONTROL_PLANE_RUN_OPERATION_PATH =
  /^\/api\/control-plane\/runs\/[^/]+\/(?:execute|stream|resume)$/u;

/** Matches the bare run route, which only DELETE addresses. */
export const CONTROL_PLANE_RUN_PATH = /^\/api\/control-plane\/runs\/[^/]+$/u;

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
  return route?.test(pathname) ? pathname.split("/")[4] : undefined;
}
