/**
 * Server Services
 *
 * Business logic layer extracted from handlers.
 * Services contain domain logic independent of HTTP concerns.
 *
 * @module server/services
 */

// Rendering services
export { SSRService } from "./rendering/index.ts";
export type { MemoryStatus, SSRRenderOptions, SSRRenderResult } from "./rendering/index.ts";

// RSC services
export { getRSCHandler, handleRSCEndpoint, RSCDevServerHandler } from "./rsc/index.ts";
export type {
  ActionBody,
  ActionRequestParams,
  CacheOptions,
  ManifestCacheEntry,
  ManifestData,
  RenderProps,
  RSCEndpointParams,
  RSCHandlerConfig,
  RSCRendererConfig,
  StreamSlot,
} from "./rsc/index.ts";

// Static file services
export { StaticFileService } from "./static/index.ts";
export type { StaticFileOptions, StaticFileResult } from "./static/index.ts";

// Future services will be added here as they are extracted:
// export { ModuleTransformService } from "./modules/transform.service.ts";
// export { DashboardDataService } from "./dev/dashboard-data.service.ts";
