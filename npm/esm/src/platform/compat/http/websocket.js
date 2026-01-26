import * as dntShim from "../../../../_dnt.shims.js";
import { isDeno } from "../runtime.js";
export function upgradeWebSocket(request, options) {
    if (!isDeno) {
        throw new Error("WebSocket upgrade on Node.js requires server-level handling. " +
            "Use a WebSocket library like 'ws' with server.on('upgrade').");
    }
    return upgradeWebSocketDeno(request, options);
}
export function isWebSocketUpgrade(request) {
    return request.headers.get("upgrade")?.toLowerCase() === "websocket";
}
function upgradeWebSocketDeno(request, options) {
    const denoOptions = options?.protocol
        ? { protocol: options.protocol }
        : {};
    const { socket, response } = dntShim.Deno.upgradeWebSocket(request, denoOptions);
    return { socket, response };
}
