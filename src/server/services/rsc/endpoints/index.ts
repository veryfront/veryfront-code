/**
 * Rsc - Endpoints
 *
 * @module server/services/rsc/endpoints
 */

export { parseActionBody } from "./action-parser.ts";
export { handleActionRequest } from "./action-handler.ts";
export { handleRSCEndpoint } from "./endpoint-router.ts";
export { __resetRSCHandlerForTests, getRSCHandler } from "./handler-registry.ts";
export { handleClientScript, handleDomScript } from "./script-handlers.ts";
export type { ActionBody, ActionRequestParams, RSCEndpointParams } from "./types.ts";
