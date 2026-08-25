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
