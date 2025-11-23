/**
 * SSR Handler - Barrel Exports
 *
 * Server-side rendering handler with modular architecture.
 *
 * @module server/handlers/request/ssr
 */

// Export main handler
export { SSRHandler } from "./ssr-handler.ts";

// Export utilities (for testing/advanced usage)
export { getRenderer } from "./renderer-manager.ts";
export { computeSSRETag } from "./etag-handler.ts";
export { tryNotFoundFallback } from "./not-found-fallback.ts";
