/** Pinned pure-JavaScript ws transport with no host environment or native addon reads. */
// @ts-types="@types/ws"
import { WebSocket, WebSocketServer } from "./portable-runtime.generated.js";
import { createWsProvider } from "./provider.ts";

export const PortableWsNodeWebSocketServerProvider = createWsProvider(WebSocketServer, WebSocket);
