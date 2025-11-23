/**
 * RSC endpoints module - barrel exports
 * @module rsc-endpoints
 */

// Main endpoint handler
export { handleRSCEndpoint } from "./endpoint-router.ts";

// Handler registry
export { __resetRSCHandlerForTests, getRSCHandler } from "./handler-registry.ts";

// Types
export type { ActionBody, ActionRequestParams, RSCEndpointParams } from "./types.ts";

// Sub-handlers (for testing)
export { parseActionBody } from "./action-parser.ts";
export { handleActionRequest } from "./action-handler.ts";
export { handleClientScript, handleDomScript } from "./script-handlers.ts";
