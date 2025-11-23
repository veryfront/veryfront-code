/**
 * API Handler Types
 *
 * Type definitions for API handler modules.
 */

// Re-export types from parent modules
export type { AppRouteMatch, RouteHandlerModule } from "../../types.ts";

/**
 * Route handler function signature
 */
export type HandlerFn = (
  req: Request,
  ctx: { params: Record<string, string | string[]> },
) => Promise<Response> | Response;
