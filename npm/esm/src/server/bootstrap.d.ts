import type { RuntimeAdapter } from "../platform/adapters/base.js";
import type { VeryfrontConfig } from "../config/index.js";
export interface BootstrapResult {
    /** Enhanced runtime adapter (with FSAdapter if configured) */
    adapter: RuntimeAdapter;
    /** Loaded configuration */
    config: VeryfrontConfig;
    /** Whether FSAdapter was initialized */
    usingFSAdapter: boolean;
    /** FSAdapter type (if used) */
    fsAdapterType?: string;
}
export declare function bootstrap(projectDir: string, adapter: RuntimeAdapter): Promise<BootstrapResult>;
export declare function bootstrapDev(projectDir: string, adapter: RuntimeAdapter): Promise<BootstrapResult>;
export declare function bootstrapProd(projectDir: string, adapter: RuntimeAdapter): Promise<BootstrapResult>;
//# sourceMappingURL=bootstrap.d.ts.map