import * as dntShim from "../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
import type { VeryfrontConfig } from "../../config/index.js";
import type { HMRServer } from "./hmr-server.js";
export declare class RequestHandler {
    private projectDir;
    private adapter;
    private isReady;
    private isDebug;
    private hmrServer?;
    private config?;
    private universalHandler?;
    constructor(projectDir: string, adapter: RuntimeAdapter, isReady: () => boolean, isDebug: () => boolean, hmrServer?: HMRServer | undefined, config?: VeryfrontConfig | undefined);
    handleRequest(req: dntShim.Request): Promise<dntShim.Response>;
    private handleHealthCheck;
    private incrementRequestMetrics;
    private handleDevEndpoint;
    private normalizeDevEndpoint;
    private getHMRRuntime;
    private handleApplicationRequest;
    invalidateUniversalHandler(): void;
    private handleServerError;
}
//# sourceMappingURL=request-handler.d.ts.map