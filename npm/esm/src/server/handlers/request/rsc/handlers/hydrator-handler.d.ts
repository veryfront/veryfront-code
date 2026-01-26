import * as dntShim from "../../../../../../_dnt.shims.js";
import type { FileSystemAdapter } from "../../../../../platform/adapters/base.js";
export declare class HydratorHandler {
    private fsAdapter?;
    constructor(fsAdapter?: FileSystemAdapter | undefined);
    handle(): Promise<dntShim.Response>;
    private readHydratorFile;
    private bundleHydrator;
    private fallbackToSource;
    private createJavaScriptResponse;
    private createFallbackResponse;
}
//# sourceMappingURL=hydrator-handler.d.ts.map