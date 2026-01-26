import type { WebSocketContext } from "../../server/dev-server/hmr-types.js";
export declare function setupWebSocketHandlers(socket: WebSocket, context: WebSocketContext): void;
export declare function closeAllConnections(clients: Set<WebSocket>, rateLimiter: {
    cleanup(socket: WebSocket): void;
}): Promise<void>;
//# sourceMappingURL=websocket-handler.d.ts.map