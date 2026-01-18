/**
 * Server Modules
 *
 * Development server utilities including API server, module serving, rate limiting, and WebSocket handling.
 * Provides infrastructure for development-time module resolution and hot module replacement.
 *
 * @example
 * ```typescript
 * import { APIServer, serveModule, RateLimiter } from '@veryfront/modules/server'
 *
 * // Create API server
 * const apiServer = new APIServer({ projectDir, adapter })
 * await apiServer.initialize()
 *
 * // Serve modules for development
 * if (isModuleRequest(req)) {
 *   return await serveModule(req, options)
 * }
 *
 * // Rate limiting
 * const limiter = new RateLimiter({ maxRequests: 100, windowMs: 60000 })
 * ```
 *
 * @module server/modules
 */

// API Server (development-time API route handling)
export {
  APIServer,
  type APIServerOptions,
  type PageRendererLike,
  type PageRenderResult,
} from "./api-server.ts";

// Module Server (ESM module serving for development)
export { isModuleRequest, type ModuleServerOptions, serveModule } from "./module-server.ts";

// Rate Limiter (request throttling)
export { RateLimiter } from "./rate-limiter.ts";

// WebSocket Handler (HMR and live reload)
export { closeAllConnections, setupWebSocketHandlers } from "./websocket-handler.ts";
