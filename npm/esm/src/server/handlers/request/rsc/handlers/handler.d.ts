import * as dntShim from "../../../../../../_dnt.shims.js";
export declare class RSCDevServerHandler {
    private projectDir;
    private renderer;
    private clientManifest;
    private readonly manifestHandler;
    private readonly renderHandler;
    private readonly streamHandler;
    private readonly pageHandler;
    private readonly hydratorHandler;
    constructor(projectDir: string);
    handleManifest(): Promise<dntShim.Response>;
    handleRender(pathname: string, searchParams: URLSearchParams, request?: dntShim.Request): Promise<dntShim.Response>;
    handleStream(pathname: string, searchParams: URLSearchParams): Promise<dntShim.Response>;
    handlePage(pathname: string, searchParams: URLSearchParams): dntShim.Response;
    handleHydratorScript(): Promise<dntShim.Response>;
    private ensureRenderer;
}
//# sourceMappingURL=handler.d.ts.map