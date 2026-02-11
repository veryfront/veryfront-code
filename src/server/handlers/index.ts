/**
 * Server Handlers
 *
 * @module server/handlers
 */

// Handler barrel — tightened to selective exports.
//
// NOTE: No file imports from this barrel. All consumers use deep paths
// (e.g. "../handlers/response/cors.ts", "#veryfront/server/handlers/utils/content-types.ts").
// Kept as a minimal public surface for discoverability.

export type {
  AppRouteMatch,
  Handler,
  HandlerContext,
  HandlerMetadata,
  HandlerResult,
  MiddlewareFunction,
  ParsedDomain,
  RouteHandlerModule,
  RoutePattern,
  RouteRegistryConfig,
  SecurityConfig,
} from "./types.ts";

export { HandlerPriority } from "./types.ts";

export { getContentType, getContentTypeForPath } from "./utils/content-types.ts";

export { BaseHandler } from "./response/base.ts";
export { CorsHandler } from "./response/cors.ts";
export { NotFoundHandler } from "./response/not-found.ts";
