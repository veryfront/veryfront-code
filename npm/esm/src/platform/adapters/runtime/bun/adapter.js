import { BunEnvironmentAdapter } from "./environment-adapter.js";
import { BunFileSystemAdapter } from "./filesystem-adapter.js";
import { createBunServer } from "./http-server.js";
import { BunServerAdapter } from "./websocket-adapter.js";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.js";
export class BunAdapter {
    id = "bun";
    name = "bun";
    fs = new BunFileSystemAdapter();
    env = new BunEnvironmentAdapter();
    server = new BunServerAdapter();
    shell = new NodeBasedShellAdapter();
    capabilities = {
        typescript: true,
        jsx: true,
        http2: false,
        websocket: true,
        workers: true,
        fileWatching: true,
        shell: true,
        kvStore: false,
        writableFs: true,
    };
    activeServer = null;
    async serve(handler, options = {}) {
        const server = await createBunServer(handler, options);
        this.activeServer = server;
        return server;
    }
    async shutdown() {
        const server = this.activeServer;
        if (!server)
            return;
        await server.stop();
        this.activeServer = null;
    }
}
export const bunAdapter = new BunAdapter();
