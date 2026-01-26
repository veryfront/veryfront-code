import * as dntShim from "../../../../../_dnt.shims.js";
import type { ServerAdapter, WebSocketUpgrade } from "../../base.js";
export declare class BunServerAdapter implements ServerAdapter {
    upgradeWebSocket(request: dntShim.Request): WebSocketUpgrade;
}
export declare class BunWebSocket {
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSING = 2;
    static readonly CLOSED = 3;
    readyState: number;
    onopen: ((event: Event) => void) | null;
    onclose: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    send(_data: string | ArrayBuffer): void;
    close(_code?: number, _reason?: string): void;
}
//# sourceMappingURL=websocket-adapter.d.ts.map