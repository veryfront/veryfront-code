/**
 * API Handler Types
 *
 * Type definitions for API handler modules.
 */

export type { AppRouteMatch, RouteHandlerModule } from "../../types.ts";

export type HandlerFn = (
  req: Request,
  ctx: { params: Record<string, string | string[]> },
) => Promise<Response> | Response;
