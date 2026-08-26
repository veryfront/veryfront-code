/**
 * API Handler Types
 *
 * Type definitions for API handler modules.
 */

import type { ApplicationIdentity } from "#veryfront/security/application-auth/types.ts";
export type { AppRouteMatch, RouteHandlerModule } from "../../types.ts";

export type HandlerFn = (
  req: Request,
  ctx: {
    params: Record<string, string | string[]>;
    identity: ApplicationIdentity | null;
  },
) => Response | Promise<Response>;
