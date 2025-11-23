/**
 * Veryfront Handlers - Flat Architecture
 *
 * Modular handler system with logical grouping:
 * - request/ - Request handlers (API, RSC, SSR, Module, Static)
 * - dev/ - Development handlers (HMR, file bundling)
 * - response/ - Response handlers (Base, CORS, 404)
 * - monitoring/ - Monitoring handlers (Metrics, Health, Logging)
 * - security/ - Security handlers (Auth, Config)
 * - utils/ - Shared utilities
 *
 * Note: Routing has been consolidated to src/routing/registry/
 */

// Re-export types
export type * from "./types.ts";

// Request handlers
export * from "./request/index.ts";

// Development handlers
export * from "./dev/index.ts";

// Response handlers
export * from "./response/index.ts";

// Monitoring handlers
export * from "./monitoring/index.ts";

// Security handlers (avoid conflicts by not re-exporting security middleware from handlers)
// Note: Security middleware is available via direct import from security/http/middleware
// export * from "./security/index.ts";

// Utilities (export specific items to avoid conflicts with security/http/middleware)
export { getContentType } from "./utils/content-types.ts";

// Routing (re-export from new location for backward compatibility)
export * from "../../routing/registry/index.ts";
