import type { DirectoryEntry, FSAdapter, FSAdapterConfig } from "./types.js";
import type { FileInfo } from "../../base.js";
import { ProxyFSAdapterManager } from "./proxy-manager.js";
import type { VeryfrontFSAdapter } from "./index.js";
interface RequestContext {
    projectSlug: string;
    projectId?: string;
    token: string;
    productionMode: boolean;
    /** Release ID for production mode (mutually exclusive with branch) */
    releaseId?: string | null;
    /** Branch name for preview mode (mutually exclusive with releaseId) */
    branch?: string | null;
    /** Actual environment name from API (e.g., "Development", "Production") */
    environmentName?: string | null;
    /**
     * Request-scoped file content cache.
     * Deduplicates file fetches within a single HTTP request.
     * This is especially important in preview mode where the persistent cache is disabled.
     */
    fileCache?: Map<string, string>;
}
export declare class MultiProjectFSAdapter implements FSAdapter {
    private manager;
    private defaultAdapter?;
    constructor(config: FSAdapterConfig);
    runWithContext<T>(projectSlug: string, token: string, fn: () => Promise<T>, projectId?: string, options?: {
        productionMode?: boolean;
        releaseId?: string | null;
        branch?: string | null;
        environmentName?: string | null;
    }): Promise<T>;
    setRequestContext(projectSlug: string, token: string): void;
    setProductionMode(_enabled: boolean, _releaseId?: string | null): void;
    private getAdapter;
    setDefaultAdapter(adapter: VeryfrontFSAdapter): void;
    initialize(): Promise<void>;
    readFile(path: string): Promise<string>;
    readTextFile(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<FileInfo>;
    readdir(path: string): Promise<DirectoryEntry[]>;
    resolveFile(basePath: string): Promise<string | null>;
    dispose(): void;
    getManagerStats(): ReturnType<ProxyFSAdapterManager["getStats"]>;
    getProjectData(): Promise<ReturnType<VeryfrontFSAdapter["getProjectData"]> | undefined>;
    getFilePathByEntityId(entityId: string): Promise<string | undefined>;
    getAllSourceFiles(): Promise<Array<{
        path: string;
        content?: string;
    }>>;
}
export declare function isMultiProjectAdapter(adapter: unknown): adapter is MultiProjectFSAdapter;
export declare function getCurrentRequestContext(): RequestContext | null;
export declare function getRequestScopedFile(cacheKey: string): string | undefined;
export declare function setRequestScopedFile(cacheKey: string, content: string): void;
export type { RequestContext };
//# sourceMappingURL=multi-project-adapter.d.ts.map