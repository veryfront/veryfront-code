import * as dntShim from "../../../../../_dnt.shims.js";
import { DEFAULT_PORT } from "../../../../config/index.js";
import { serverLogger } from "../../../../utils/index.js";
export class BunServer {
    server;
    hostname;
    port;
    constructor(server, hostname, port) {
        this.server = server;
        this.hostname = hostname;
        this.port = port;
    }
    stop() {
        this.server.stop();
        return Promise.resolve();
    }
    get addr() {
        return { hostname: this.hostname, port: this.port };
    }
}
export function createBunServer(handler, options = {}) {
    const { port = DEFAULT_PORT, hostname = "localhost", onListen } = options;
    const server = Bun.serve({
        port,
        hostname,
        fetch: async (request) => {
            try {
                return await handler(request);
            }
            catch (error) {
                serverLogger.error("Request handler error:", error);
                return new dntShim.Response("Internal Server Error", { status: 500 });
            }
        },
    });
    onListen?.({ hostname, port });
    return Promise.resolve(new BunServer(server, hostname, port));
}
