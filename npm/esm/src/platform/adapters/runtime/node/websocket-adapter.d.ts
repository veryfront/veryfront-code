import * as dntShim from "../../../../../_dnt.shims.js";
import type { ServerAdapter, WebSocketUpgrade } from "../../base.js";
import type { WSWebSocket } from "./types.js";
export declare class NodeServerAdapter implements ServerAdapter {
    upgradeWebSocket(request: dntShim.Request): WebSocketUpgrade;
    private generateAcceptKey;
}
export declare class NodeWebSocket {
    private ws;
    readyState: number;
    onopen: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    private pendingMessages;
    _attachRealSocket(ws: WSWebSocket): void;
    _emitError(error: Error): void;
    send(data: string | ArrayBuffer): void;
    close(code?: number, reason?: string): void;
    addEventListener(type: string, listener: EventListener): void;
    removeEventListener(type: string, _listener: EventListener): void;
}
//# sourceMappingURL=websocket-adapter.d.ts.map