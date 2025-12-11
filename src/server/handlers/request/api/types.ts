
export type { AppRouteMatch, RouteHandlerModule } from "../../types.ts";

export type HandlerFn = (
  req: Request,
  ctx: { params: Record<string, string | string[]> },
) => Promise<Response> | Response;
