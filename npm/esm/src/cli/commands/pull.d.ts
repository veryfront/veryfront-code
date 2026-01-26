/**
 * Pull command - Download project files from Veryfront API
 *
 * Downloads all files from the remote Veryfront project using the files API
 * and writes them to the local filesystem with their original paths.
 *
 * @module cli/commands/pull
 */
import { createApiClient } from "../shared/config.js";
/**
 * Pull source type - determines which API endpoint to use
 */
export type PullSource = {
    type: "main";
} | {
    type: "branch";
    name: string;
} | {
    type: "environment";
    name: string;
} | {
    type: "release";
    version: string;
};
/**
 * Pull command options
 */
export interface PullOptions {
    /** Project slug to pull from */
    projectSlug?: string;
    /** List of project slugs to pull (each into its own directory) */
    projects?: string[];
    /** Project directory (defaults to cwd) */
    projectDir?: string;
    /** Branch name to pull from (optional) */
    branch?: string;
    /** Environment name to pull from (e.g., "production", "staging") */
    env?: string;
    /** Release version to pull from (e.g., "v1.2.0") */
    release?: string;
    /** Force overwrite without confirmation */
    force?: boolean;
    /** Dry run - show what would be written without writing */
    dryRun?: boolean;
    /** Quiet mode - suppress spinner/progress output */
    quiet?: boolean;
}
/**
 * Resolve pull source from options
 * Priority: env > release > branch > main
 */
export declare function resolvePullSource(options: PullOptions): PullSource;
interface ProjectFile {
    path: string;
    size: number;
    type: string;
    created_at: string;
    updated_at: string;
}
/**
 * Build the files list URL based on pull source
 */
export declare function buildFilesListUrl(projectSlug: string, source: PullSource): string;
/**
 * Fetch all files from API with pagination
 * Supports main, branch, environment, and release sources
 */
export declare function listAllFiles(client: ReturnType<typeof createApiClient>, projectSlug: string, source: PullSource): Promise<ProjectFile[]>;
/**
 * Build the file content URL based on pull source
 */
export declare function buildFileContentUrl(projectSlug: string, path: string, source: PullSource): string;
/**
 * Get file content from API
 * Supports main, branch, environment, and release sources
 */
export declare function getFileContent(client: ReturnType<typeof createApiClient>, projectSlug: string, path: string, source: PullSource): Promise<string>;
/**
 * Pull files from Veryfront API
 */
export declare function pullCommand(options?: PullOptions): Promise<void>;
export {};
//# sourceMappingURL=pull.d.ts.map