// Server public exports (minimal)
// Docs: docs/deployment.md, docs/security.md
// Dev server exports
export { createDevServer, DevServer } from "./dev-server.ts";
export { startUniversalServer } from "./production-server.ts";
export { createVeryfrontHandler } from "./universal-handler/index.ts";

// API routing exports (excluding duplicates already exported from routing)
export {
  type APIContext,
  type APIHandler,
  type APIResponse,
  type APIRoute,
  APIRouteHandler,
  applyCORSHeaders,
  badRequest,
  createContext,
  DynamicRouter as APIDynamicRouter, // Alias to avoid collision with routing DynamicRouter
  forbidden,
  handleCORSPreflight,
  json,
  normalizeParams,
  notFound,
  parseCookies,
  redirect,
  serverError,
  unauthorized,
} from "#veryfront/routing";

// Routing exports (primary exports for Route, RouteMatch, DynamicRouter)
export * from "#veryfront/routing";

// Observability exports
export * from "#veryfront/observability";
