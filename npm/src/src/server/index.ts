// Server public exports (minimal)
// Docs: docs/deployment.md, docs/security.md
import "../../_dnt.polyfills.js";

export { createDevServer, DevServer } from "./dev-server.js";
export { startUniversalServer } from "./production-server.js";
export { createVeryfrontHandler } from "./universal-handler/index.js";

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
  DynamicRouter as APIDynamicRouter,
  forbidden,
  handleCORSPreflight,
  json,
  normalizeParams,
  notFound,
  parseCookies,
  redirect,
  serverError,
  unauthorized,
} from "../routing/index.js";

// Routing exports (primary exports for Route, RouteMatch, DynamicRouter)
export * from "../routing/index.js";

// Observability exports
export * from "../observability/index.js";
