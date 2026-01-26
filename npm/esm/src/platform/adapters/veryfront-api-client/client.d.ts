import { type FileDetail, type FileListResult, type ListFilesOptions, VeryfrontAPIOperations } from "./operations.js";
import { type VeryfrontAPIConfig } from "./types.js";
/**
 * File context for API operations.
 * - branch: Draft/working copy from a specific branch
 * - environment: Deployed content from an environment (production, preview, staging)
 * - release: Specific release version
 */
export type FileContext = {
    type: "branch";
    name: string;
} | {
    type: "environment";
    name: string;
} | {
    type: "release";
    version: string;
};
export declare class VeryfrontAPIClient {
    private config;
    private operations;
    private requestToken?;
    private requestProjectSlug?;
    private requestContext?;
    private requestBranch?;
    private initialized;
    private initializingPromise?;
    /** Cached project data from initialization - avoids redundant API calls */
    private cachedProjectData?;
    constructor(config: VeryfrontAPIConfig);
    isProxyMode(): boolean;
    setRequestToken(token: string): void;
    clearRequestToken(): void;
    setProjectSlug(slug: string): void;
    getProjectSlug(): string | undefined;
    clearProjectSlug(): void;
    setContext(context: FileContext): void;
    getContext(): FileContext;
    clearContext(): void;
    getToken(): string;
    isInitialized(): boolean;
    setRequestBranch(branch: string | null): void;
    getRequestBranch(): string | null | undefined;
    clearRequestBranch(): void;
    initialize(): Promise<void>;
    private doInitialize;
    reset(): void;
    getProjectId(): string;
    /**
     * Get the cached project data from initialization.
     * Returns undefined if not yet initialized or if projectId was provided in config.
     * Use this instead of calling getProject() to avoid redundant API calls.
     */
    getCachedProject(): Awaited<ReturnType<VeryfrontAPIOperations["getProject"]>> | undefined;
    listProjects(): Promise<{
        name: string;
        id: string;
        slug: string;
        config?: string | Record<string, unknown> | undefined;
        description?: string | undefined;
        layout?: string | null | undefined;
        provider?: string | null | undefined;
        created_at?: string | undefined;
        updated_at?: string | undefined;
        provider_id?: string | null | undefined;
        layout_id?: string | null | undefined;
    }[]>;
    getProject(projectRef?: string): Promise<{
        name: string;
        id: string;
        slug: string;
        config?: string | Record<string, unknown> | undefined;
        description?: string | undefined;
        layout?: string | null | undefined;
        provider?: string | null | undefined;
        created_at?: string | undefined;
        updated_at?: string | undefined;
        provider_id?: string | null | undefined;
        layout_id?: string | null | undefined;
    }>;
    listFiles(options?: ListFilesOptions): Promise<FileListResult>;
    listAllFiles(options?: Omit<ListFilesOptions, "cursor">): Promise<{
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        updated_at: string;
        content?: string | undefined;
        id?: string | undefined;
        version_id?: string | undefined;
    }[]>;
    getFile(pathOrId: string): Promise<FileDetail>;
    getFileContent(pathOrId: string): Promise<string>;
    listBranchFiles(branchName?: string, options?: ListFilesOptions): Promise<FileListResult>;
    getBranchFile(branchName: string, pathOrId: string): Promise<FileDetail>;
    listEnvironmentFiles(environmentName?: string, options?: ListFilesOptions): Promise<FileListResult>;
    listAllEnvironmentFiles(environmentName?: string, options?: Omit<ListFilesOptions, "cursor">): Promise<{
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        updated_at: string;
        content?: string | undefined;
        id?: string | undefined;
        version_id?: string | undefined;
    }[]>;
    getEnvironmentFile(environmentName: string, pathOrId: string): Promise<FileDetail>;
    listReleaseFiles(version?: string, options?: ListFilesOptions): Promise<FileListResult>;
    getReleaseFile(version: string, pathOrId: string): Promise<FileDetail>;
    lookupProjectByDomain(domain: string): Promise<{
        project_slug: string;
        project_id: string;
        release_id: string | null;
        project_name: string;
        environment: {
            name: string;
            id: string;
        } | null;
    } | null>;
    getFileById(entityId: string): Promise<{
        path: string;
        content: string;
    } | null>;
    searchFiles(pattern: string): Promise<{
        id?: string;
        path: string;
    }[]>;
    /**
     * Search for files matching a pattern and return them with content.
     * Useful for batch-loading files without knowing exact extensions.
     *
     * Example: searchFilesWithContent("components/Button.*") returns all files
     * like Button.tsx, Button.ts, Button.jsx etc. with their content.
     *
     * @param pattern - Glob pattern to match files (e.g., "path/file.*" or "pages/_error.*")
     * @returns Array of files with path and content
     */
    searchFilesWithContent(pattern: string): Promise<Array<{
        path: string;
        content: string;
    }>>;
    private listFilesByContext;
    /**
     * Resolve a file path without extension by searching for all possible extensions.
     * Returns the first match based on extension priority.
     *
     * @param basePath - Path without extension (e.g., "components/Button")
     * @param extensionPriority - Preferred extension order (default: .tsx, .ts, .jsx, .js, .mdx, .md)
     * @returns The resolved file with content, or null if not found
     */
    resolveFileWithExtension(basePath: string, extensionPriority?: string[]): Promise<{
        path: string;
        content: string;
    } | null>;
    listPublishedFiles(_projectId?: string, releaseId?: string, environmentName?: string): Promise<{
        type: "function" | "page" | "file" | "component";
        path: string;
        size: number;
        updated_at: string;
        content?: string | undefined;
        id?: string | undefined;
        version_id?: string | undefined;
    }[]>;
    getPublishedFileContent(path: string, releaseId?: string, environmentName?: string): Promise<string>;
}
//# sourceMappingURL=client.d.ts.map