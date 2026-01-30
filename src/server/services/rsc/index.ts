/**
 * RSC Services
 *
 * React Server Components business logic extracted from handlers.
 * - endpoints/: RSC endpoint routing and action handling
 * - orchestrators/: RSC rendering orchestration
 *
 * @module server/services/rsc
 */

// Endpoints (RSC request routing)
export { handleRSCEndpoint } from "./endpoints/index.ts";
export { __resetRSCHandlerForTests, getRSCHandler } from "./endpoints/handler-registry.ts";
export type { ActionBody, ActionRequestParams, RSCEndpointParams } from "./endpoints/types.ts";

// Orchestrators (RSC rendering)
export { RSCDevServerHandler } from "./orchestrators/index.ts";
export type {
  CacheOptions,
  ManifestCacheEntry,
  ManifestData,
  RenderProps,
  RSCHandlerConfig,
  RSCRendererConfig,
  StreamSlot,
} from "./orchestrators/types.ts";
