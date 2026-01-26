import { NodeFileSystemAdapter } from "./filesystem-adapter.js";
import { NodeEnvironmentAdapter } from "./environment-adapter.js";
import { NodeServerAdapter } from "./websocket-adapter.js";
import { createNodeServer } from "./http-server.js";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.js";
export class NodeAdapter {
    id = "node";
    name = "node";
    fs = new NodeFileSystemAdapter();
    env = new NodeEnvironmentAdapter();
    server = new NodeServerAdapter();
    shell = new NodeBasedShellAdapter();
    capabilities = {
        typescript: false,
        jsx: false,
        http2: true,
        websocket: true,
        workers: true,
        fileWatching: true,
        shell: true,
        kvStore: false,
        writableFs: true,
    };
    activeServer = null;
    async serve(handler, options = {}) {
        const server = await createNodeServer(handler, options);
        this.activeServer = server;
        return server;
    }
    async shutdown() {
        const server = this.activeServer;
        if (!server)
            return;
        this.activeServer = null;
        await server.stop();
    }
}
export const nodeAdapter = new NodeAdapter();
