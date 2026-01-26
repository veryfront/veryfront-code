/** Module Server - serves transformed ESM modules at /_vf_modules/* URLs */
import * as dntShim from "../../../_dnt.shims.js";
import type { RuntimeAdapter } from "../../platform/adapters/base.js";
export interface ModuleServerOptions {
    /** Project identifier (directory path, legacy naming) */
    projectId: string;
    /** Project root directory */
    projectDir: string;
    /** Runtime adapter */
    adapter: RuntimeAdapter;
    /** Development mode */
    dev?: boolean;
    /** Project UUID for multi-project mode (from domain lookup) */
    projectUUID?: string;
    /** Project slug for multi-project mode (from proxy headers or domain lookup) */
    projectSlug?: string;
    /** Branch name for branch-aware file resolution */
    branch?: string | null;
    /** Release ID for production mode (published files) */
    releaseId?: string | null;
    /**
     * Restrict module imports to specific directories (opt-in security).
     * When not set, users can import from any directory in the project.
     */
    allowedImportDirs?: string[];
}
/** Serve transformed module at /_vf_modules/* path */
export declare function serveModule(req: dntShim.Request, options: ModuleServerOptions): Promise<dntShim.Response>;
/**
 * Check if request is for a module
 *
 * @param req - HTTP request
 * @returns true if request path starts with /_vf_modules/
 */
export declare function isModuleRequest(req: dntShim.Request): boolean;
//# sourceMappingURL=module-server.d.ts.map