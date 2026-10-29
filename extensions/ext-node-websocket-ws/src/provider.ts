// @ts-types="@types/ws"
import type { WebSocket, WebSocketServer } from "ws";
import {
  captureNodeWebSocketServer,
  createNodeWebSocketServerProvider,
} from "veryfront/extensions/websocket";

/** Preserve the transport contract for both native-optimized and portable ws. */
export function createWsProvider(
  Server: typeof WebSocketServer,
  Connection: typeof WebSocket,
) {
  return createNodeWebSocketServerProvider(
    (options) => captureNodeWebSocketServer(new Server(options)),
    {
      supportsIdleTimeout: true,
      getBufferedAmount(connection) {
        if (!(connection instanceof Connection)) throw new TypeError("Unknown ws connection");
        return connection.bufferedAmount;
      },
    },
  );
}
