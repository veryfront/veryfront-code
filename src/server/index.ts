/**
 * Server Module Public API
 *
 * This module exports the public interface for the Veryfront server.
 * For routing utilities, import from "#veryfront/routing" directly.
 * For observability utilities, import from "#veryfront/observability" directly.
 *
 * @module server
 * @see docs/deployment.md
 * @see docs/security.md
 */

// Server creation utilities
export { createDevServer, DevServer } from "./dev-server.ts";
export { startUniversalServer } from "./production-server.ts";
export { createVeryfrontHandler } from "./universal-handler/index.ts";

// Note: Wildcard re-exports removed to prevent circular dependency risks.
// Import from "#veryfront/routing" for Route, RouteMatch, DynamicRouter, etc.
// Import from "#veryfront/observability" for tracing and metrics utilities.
