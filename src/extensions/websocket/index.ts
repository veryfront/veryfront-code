/** Contracts for extension-owned Node.js WebSocket implementations. */

export {
  captureNodeWebSocketServer,
  createNodeWebSocketServerProvider,
  NODE_WEBSOCKET_SERVER_PROVIDER_MISSING_MESSAGE,
  NODE_WEBSOCKET_SERVER_PROVIDER_PACKAGE,
  type NodeWebSocketConnection,
  type NodeWebSocketMessageData,
  type NodeWebSocketServer,
  type NodeWebSocketServerOptions,
  type NodeWebSocketServerProvider,
  NodeWebSocketServerProviderName,
  snapshotNodeWebSocketServerProvider,
} from "./node-websocket-server-provider.ts";
