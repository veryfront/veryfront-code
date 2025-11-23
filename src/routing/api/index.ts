export { APIRouteHandler } from "./handler.ts";
export type { APIContext, APIHandler, APIResponse, APIRoute } from "./handler.ts";

export { DynamicRouter } from "./api-route-matcher.ts";
export type { Route, RouteMatch } from "./api-route-matcher.ts";

export {
  badRequest,
  forbidden,
  json,
  notFound,
  redirect,
  serverError,
  unauthorized,
} from "./responses.ts";

export { applyCORSHeaders, handleCORSPreflight } from "@veryfront/security";

export type { APIContext as APIContextType } from "./context-builder.ts";
export { createContext, normalizeParams, parseCookies } from "./context-builder.ts";
