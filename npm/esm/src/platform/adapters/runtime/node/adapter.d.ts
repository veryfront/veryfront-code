import * as dntShim from "../../../../../_dnt.shims.js";
import type { RuntimeAdapter, RuntimeCapabilities, ServeOptions, Server } from "../../base.js";
import { NodeFileSystemAdapter } from "./filesystem-adapter.js";
import { NodeEnvironmentAdapter } from "./environment-adapter.js";
import { NodeServerAdapter } from "./websocket-adapter.js";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.js";
export declare class NodeAdapter implements RuntimeAdapter {
    readonly id: "node";
    readonly name = "node";
    readonly fs: NodeFileSystemAdapter;
    readonly env: NodeEnvironmentAdapter;
    readonly server: NodeServerAdapter;
    readonly shell: NodeBasedShellAdapter;
    readonly capabilities: RuntimeCapabilities;
    private activeServer;
    serve(handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response, options?: ServeOptions): Promise<Server>;
    shutdown(): Promise<void>;
}
export declare const nodeAdapter: NodeAdapter;
//# sourceMappingURL=adapter.d.ts.map