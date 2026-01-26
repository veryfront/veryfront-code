import * as dntShim from "../../../../../_dnt.shims.js";
import type { ServeOptions, Server } from "../../base.js";
import type { BunServer as BunServerType } from "./types.js";
export declare class BunServer implements Server {
    private server;
    private hostname;
    private port;
    constructor(server: BunServerType, hostname: string, port: number);
    stop(): Promise<void>;
    get addr(): {
        hostname: string;
        port: number;
    };
}
export declare function createBunServer(handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response, options?: ServeOptions): Promise<Server>;
//# sourceMappingURL=http-server.d.ts.map