/**
 * File-system routing — dynamic route matching, slug/path mapping, API route
 * handlers with CORS/cookie support, and client-side navigation utilities.
 *
 * @module routing
 */

export type { Route, RouteMatch } from "./matchers/index.ts";
export {
  getSpecificityScore,
  matchRoute,
  normalizePath,
  PageRouteMatcher,
  parseRoute,
} from "./matchers/index.ts";

export type { PathCandidates, RouteParams } from "./slug-mapper/index.ts";
export {
  extractParams,
  getPathCandidates,
  getSlugFromPath,
  getSupportedExtensions,
  isDynamicRoute,
  matchesPattern,
  normalizeSlug,
  pathToSlug,
  slugToPath,
} from "./slug-mapper/index.ts";

export type { RouteData, SpaPageData } from "./client/index.ts";
export {
  extractPageDataFromScript,
  NavigationHandlers,
  PageLoader,
  PageTransition,
  ViewportPrefetch,
} from "./client/index.ts";

export type { APIContext, APIHandler, APIResponse, APIRoute } from "./api/index.ts";
export {
  APIRouteHandler,
  applyCORSHeaders,
  badRequest,
  createContext,
  forbidden,
  handleCORSPreflight,
  json,
  normalizeParams,
  notFound,
  parseCookies,
  redirect,
  serverError,
  unauthorized,
} from "./api/index.ts";
