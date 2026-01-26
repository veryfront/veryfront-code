import * as dntShim from "../../_dnt.shims.js";
import type { RuntimeAdapter } from "../platform/adapters/base.js";
interface VirtualModule {
    id: string;
    source: string;
    transformed?: string;
    contentType: string;
}
export declare class VirtualModuleSystem {
    private modules;
    private baseUrl;
    private adapter;
    constructor(baseUrl?: string, adapter?: RuntimeAdapter);
    register(id: string, source: string, projectDir: string): Promise<string>;
    registerModule(id: string, source: string, projectDir: string): Promise<string>;
    getModule(id: string): VirtualModule | undefined;
    handleRequest(request: dntShim.Request): dntShim.Response | null;
    clear(): void;
}
export {};
//# sourceMappingURL=virtual-module-system.d.ts.map