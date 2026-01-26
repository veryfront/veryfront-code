import * as dntShim from "../../../../../_dnt.shims.js";
import { createError, toError } from "../../../../errors/index.js";
export class BunServerAdapter {
    upgradeWebSocket(request) {
        if (!Bun.upgrade(request)) {
            throw toError(createError({
                type: "network",
                message: "Failed to upgrade WebSocket connection",
            }));
        }
        const socket = new BunWebSocket();
        const response = new dntShim.Response(null, {
            status: 101,
            statusText: "Switching Protocols",
        });
        return { socket: socket, response };
    }
}
export class BunWebSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = BunWebSocket.OPEN;
    onopen = null;
    onclose = null;
    onerror = null;
    onmessage = null;
    send(_data) {
        throw toError(createError({
            type: "network",
            message: "WebSocket send called on placeholder - use Bun.serve websocket handlers",
        }));
    }
    close(_code, _reason) {
        this.readyState = BunWebSocket.CLOSED;
    }
}
