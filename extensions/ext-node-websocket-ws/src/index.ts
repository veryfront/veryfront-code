/** Default `ws` implementation of Veryfront's Node WebSocket contract. */

import type { ExtensionFactory } from "veryfront/extensions";
import {
  captureNodeWebSocketServer,
  createNodeWebSocketServerProvider,
  NodeWebSocketServerProviderName,
} from "veryfront/extensions/websocket";
// @ts-types="@types/ws"
import { WebSocketServer } from "ws";

export const WsNodeWebSocketServerProvider = createNodeWebSocketServerProvider(
  (options) => captureNodeWebSocketServer(new WebSocketServer(options)),
);

/** Create the standard Node.js `ws` transport extension. */
export const extNodeWebSocketWs: ExtensionFactory = () => {
  let active = false;
  return {
    name: "ext-node-websocket-ws",
    version: "0.1.0",
    contracts: {
      provides: [NodeWebSocketServerProviderName],
    },
    capabilities: [{
      type: "env:read",
      keys: ["WS_NO_BUFFER_UTIL", "WS_NO_UTF_8_VALIDATE"],
    }],
    setup(ctx) {
      if (active) throw new Error("ext-node-websocket-ws is already set up");
      if (ctx.signal?.aborted) {
        throw ctx.signal.reason ?? new DOMException(
          "Node WebSocket extension setup was aborted",
          "AbortError",
        );
      }
      ctx.provide(
        NodeWebSocketServerProviderName,
        WsNodeWebSocketServerProvider,
      );
      active = true;
      ctx.logger.debug("[ext-node-websocket-ws] Node WebSocket provider registered");
    },
    teardown() {
      active = false;
    },
  };
};

export default extNodeWebSocketWs;
