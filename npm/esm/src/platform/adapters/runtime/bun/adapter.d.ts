import * as dntShim from "../../../../../_dnt.shims.js";
import type { RuntimeAdapter, RuntimeCapabilities, ServeOptions, Server } from "../../base.js";
import { BunEnvironmentAdapter } from "./environment-adapter.js";
import { BunFileSystemAdapter } from "./filesystem-adapter.js";
import { BunServerAdapter } from "./websocket-adapter.js";
import { NodeBasedShellAdapter } from "../shared/node-based-shell-adapter.js";
export declare class BunAdapter implements RuntimeAdapter {
    readonly id: "bun";
    readonly name = "bun";
    readonly fs: BunFileSystemAdapter;
    readonly env: BunEnvironmentAdapter;
    readonly server: BunServerAdapter;
    readonly shell: NodeBasedShellAdapter;
    readonly capabilities: RuntimeCapabilities;
    private activeServer;
    serve(handler: (request: dntShim.Request) => Promise<dntShim.Response> | dntShim.Response, options?: ServeOptions): Promise<Server>;
    shutdown(): Promise<void>;
}
export declare const bunAdapter: BunAdapter;
//# sourceMappingURL=adapter.d.ts.map