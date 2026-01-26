import { type LockfileManager } from "../../../utils/index.js";
import type { Plugin } from "esbuild";
export interface HTTPPluginOptions {
    allowedHosts: string[];
    lockfile?: LockfileManager;
    projectDir?: string;
    strict?: boolean;
}
export declare function createHTTPPlugin(options: HTTPPluginOptions | string[]): Plugin;
//# sourceMappingURL=esbuild-plugin.d.ts.map