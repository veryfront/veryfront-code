import type { Plugin } from "esbuild";
import type { RuntimeAdapter } from "../../../../platform/adapters/base.js";
import { type LockfileManager } from "../../../../utils/import-lockfile.js";
/** Create relative file system plugin for resolving imports via adapter's fs */
export declare function createRelativeFsPlugin(projectDir: string, adapter: RuntimeAdapter): Plugin;
export interface BareExternalPluginOptions {
    bundle?: boolean;
    lockfile?: LockfileManager;
    projectDir?: string;
    strict?: boolean;
}
/** Create bare module external plugin that rewrites npm imports to esm.sh URLs */
export declare function createBareExternalPlugin(options?: BareExternalPluginOptions | boolean): Plugin;
//# sourceMappingURL=esbuild-plugins.d.ts.map