import type { ComponentProps } from "../../types/index.js";
import type { VeryfrontConfig } from "../../config/index.js";
export interface DevScriptsOptions {
    /** Skip hmr.js when preview-hmr.js will be used (proxy mode) */
    skipDevHMR?: boolean;
    /** Skip error logger when endpoint is not available (preview mode) */
    skipErrorLogger?: boolean;
}
export declare function getDevScripts(_slug: string, config: VeryfrontConfig, _params?: Record<string, string | string[]>, _props?: ComponentProps, nonce?: string, options?: DevScriptsOptions): string;
//# sourceMappingURL=dev-scripts.d.ts.map