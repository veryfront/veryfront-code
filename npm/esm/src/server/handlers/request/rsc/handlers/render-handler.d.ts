import * as dntShim from "../../../../../../_dnt.shims.js";
import type { RSCRenderer } from "../../../../../rendering/rsc/server-renderer/index.js";
export declare class RenderHandler {
    private projectDir;
    private getRenderer;
    private isLocalDev;
    constructor(projectDir: string, getRenderer: () => RSCRenderer | null, isLocalDev?: boolean);
    handle(pathname: string, searchParams: URLSearchParams, request?: dntShim.Request): Promise<dntShim.Response>;
    private loadComponent;
    private buildProps;
    private renderPayload;
    private createResponse;
    private shouldReturn304;
    private buildHeaders;
    private createErrorResponse;
}
//# sourceMappingURL=render-handler.d.ts.map