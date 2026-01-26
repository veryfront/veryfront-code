/**
 * Push command - Upload local project files to a new Veryfront branch
 *
 * Scans local files and uploads them to the API using relative paths.
 * Creates a new branch for the changes which can be merged in Studio.
 *
 * @module cli/commands/push
 */
import { type ApiClient } from "../shared/config.js";
/**
 * Push command options
 */
export interface PushOptions {
    /** Project slug to push to (overrides config) */
    projectSlug?: string;
    /** Project directory (defaults to cwd) */
    projectDir?: string;
    /** Branch name to create (auto-generated if not provided) */
    branch?: string;
    /** Force push without confirmation */
    force?: boolean;
    /** Dry run - show what would be uploaded without uploading */
    dryRun?: boolean;
    /** Quiet mode - suppress spinner/progress output */
    quiet?: boolean;
}
/**
 * File upload operation
 */
export interface UploadOp {
    /** Relative path from project root (sent to API) */
    path: string;
    content: string;
}
/**
 * API response for branch creation
 */
export interface BranchResponse {
    id: string;
    name: string;
    projectId: string;
}
/**
 * Generate a branch name for CLI push
 */
export declare function generateBranchName(): string;
/**
 * Create a new branch for the push
 */
export declare function createBranch(client: ApiClient, projectSlug: string, branchName: string): Promise<BranchResponse>;
/**
 * Upload files to the API using the files endpoint
 * When branchId is null, files are pushed directly to main
 */
export declare function uploadFiles(client: ApiClient, projectSlug: string, branchId: string | null, ops: UploadOp[], dryRun: boolean): Promise<{
    uploaded: number;
    failed: number;
}>;
/**
 * Delete files from the API that no longer exist locally
 */
export declare function deleteFiles(client: ApiClient, projectSlug: string, branchId: string | null, paths: string[], dryRun: boolean): Promise<{
    deleted: number;
    failed: number;
}>;
/**
 * Push local files to Veryfront
 * - By default, creates a new auto-generated branch
 * - With --branch=<name>, creates a branch with that name
 * - With --branch=main, pushes directly to main (no branch creation)
 */
export declare function pushCommand(options?: PushOptions): Promise<void>;
//# sourceMappingURL=push.d.ts.map