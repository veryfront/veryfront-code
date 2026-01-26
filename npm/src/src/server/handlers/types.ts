/**
 * Shared types for the universal handler architecture
 *
 * Re-exported from @veryfront/types for backward compatibility.
 * New code should import directly from @veryfront/types.
 */

export type {
  AppRouteMatch,
  Handler,
  HandlerContext,
  HandlerMetadata,
  HandlerPriority,
  HandlerResult,
  MiddlewareFunction,
  ParsedDomain,
  RouteHandlerModule,
  RoutePattern,
  RouteRegistryConfig,
  SecurityConfig,
} from "../../types/index.js";
