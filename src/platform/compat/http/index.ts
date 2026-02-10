/**
 * Compat - Http
 *
 * @module platform/compat/http
 */

export type {
  Handler,
  HttpServer,
  ServeOptions,
  WebSocketUpgradeOptions,
  WebSocketUpgradeResult,
} from "./types.ts";
export type {
  NodeHttpModule,
  NodeIncomingMessage,
  NodeServer,
  NodeServerResponse,
  NodeUrlModule,
} from "./node-types.ts";

export { DenoHttpServer } from "./deno-server.ts";
export { NodeHttpServer } from "./node-server.ts";
export { convertNodeRequestToWebRequest } from "./request-adapter.ts";
export { createHttpServer } from "./factory.ts";
export { isWebSocketUpgrade, upgradeWebSocket } from "./websocket.ts";
export {
  badGateway,
  badRequest,
  created,
  errorResponse,
  forbidden,
  HttpStatus,
  type HttpStatusCode,
  internalServerError,
  jsonErrorResponse,
  jsonResponse,
  methodNotAllowed,
  noContent,
  notFound,
  ok,
  redirectResponse,
  serviceUnavailable,
  unauthorized,
} from "./responses.ts";
