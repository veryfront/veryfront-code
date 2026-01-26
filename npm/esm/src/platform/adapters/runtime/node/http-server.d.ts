import * as dntShim from "../../../../../_dnt.shims.js";
import type { ServeOptions, Server } from "../../base.js";
import type { NodeHttpServer, WSWebSocket } from "./types.js";
export declare class NodeServer implements Server {
    private server;
    private hostname;
    private port;
    constructor(server: NodeHttpServer, hostname: string, port: number);
    stop(): Promise<void>;
    get addr(): {
        hostname: string;
        port: number;
    };
}
export declare function registerWebSocketUpgrade(requestId: string): Promise<WSWebSocket>;
export declare function createNodeServer(handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response, options?: ServeOptions): Promise<Server>;
//# sourceMappingURL=http-server.d.ts.map