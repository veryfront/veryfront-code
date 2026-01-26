export type { Route, RouteMatch } from "./matchers/index.js";
export { DynamicRouter, getSpecificityScore, matchRoute, normalizePath, parseRoute, } from "./matchers/index.js";
export type { PathCandidates, RouteParams } from "./slug-mapper/index.js";
export { extractParams, getPathCandidates, getSlugFromPath, getSupportedExtensions, isDynamicRoute, matchesPattern, normalizeSlug, pathToSlug, slugToPath, } from "./slug-mapper/index.js";
export type { RouteData, SpaPageData } from "./client/index.js";
export { extractPageDataFromScript, NavigationHandlers, PageLoader, PageTransition, ViewportPrefetch, } from "./client/index.js";
export type { APIContext, APIHandler, APIResponse, APIRoute } from "./api/index.js";
export { APIRouteHandler, applyCORSHeaders, badRequest, createContext, forbidden, handleCORSPreflight, json, normalizeParams, notFound, parseCookies, redirect, serverError, unauthorized, } from "./api/index.js";
//# sourceMappingURL=index.d.ts.map