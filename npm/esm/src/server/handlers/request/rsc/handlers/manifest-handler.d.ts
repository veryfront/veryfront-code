import * as dntShim from "../../../../../../_dnt.shims.js";
import type { ClientComponentMeta } from "../../../../../rendering/rsc/types.js";
export declare class ManifestHandler {
    private projectDir;
    private cache;
    constructor(projectDir: string);
    handle(clientManifest: Map<string, ClientComponentMeta> | null): Promise<dntShim.Response>;
    private isCacheValid;
    private buildManifest;
    private createResponse;
}
//# sourceMappingURL=manifest-handler.d.ts.map