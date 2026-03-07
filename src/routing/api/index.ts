/**
 * Routing Api
 *
 * @module routing/api
 */

export { APIRouteHandler } from "./handler.ts";
export type { APIContext, APIHandler, APIResponse, APIRoute } from "./handler.ts";

export { ApiRouteMatcher } from "./api-route-matcher.ts";
export type { Route, RouteMatch } from "./api-route-matcher.ts";

export {
  badRequest,
  forbidden,
  internalServerError as serverError,
  jsonResponse as json,
  notFound,
  redirectResponse as redirect,
  unauthorized,
} from "#veryfront/http/responses";

export { applyCORSHeaders, handleCORSPreflight } from "#veryfront/security";

export { createContext, normalizeParams, parseCookies } from "./context-builder.ts";
export type { APIContext as APIContextType } from "./context-builder.ts";
