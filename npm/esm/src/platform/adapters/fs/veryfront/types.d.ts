import type { Project } from "../../veryfront-api-client/index.js";
import type { GitHubConfig } from "../github/types.js";
import type { DirectoryEntry } from "../shared-types.js";
export type { DirectoryEntry };
export interface FSAdapter {
    readFile(path: string): Promise<Uint8Array | string>;
    readTextFile?(path: string): Promise<string>;
    exists(path: string): Promise<boolean>;
    stat(path: string): Promise<{
        isFile: boolean;
        isDirectory: boolean;
        isSymlink: boolean;
        size: number;
        mtime: Date | null;
    }>;
    readDir?(path: string): AsyncIterable<DirectoryEntry>;
    readdir?(path: string): AsyncIterable<DirectoryEntry> | Promise<DirectoryEntry[]>;
    writeFile?(path: string, content: string): Promise<void>;
    mkdir?(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    remove?(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    initialize?(): Promise<void>;
    shutdown?(): Promise<void>;
    resolveFile?(basePath: string): Promise<string | null>;
}
export interface ContextualFSAdapter extends FSAdapter {
    setRequestToken?(token: string): void;
    clearRequestToken?(): void;
    setRequestBranch?(branch: string | null): void;
    getRequestBranch?(): string | null;
    clearRequestBranch?(): void;
    setProductionMode?(enabled: boolean, releaseId?: string | null): void;
    runWithContext?<T>(projectSlug: string, token: string, fn: () => Promise<T>, projectId?: string, options?: {
        productionMode?: boolean;
        releaseId?: string | null;
        branch?: string | null;
        environmentName?: string | null;
    }): Promise<T>;
}
export type ContentSource = {
    type: "branch";
    branch?: string;
} | {
    type: "environment";
    name: string;
} | {
    type: "domain";
    domain: string;
} | {
    type: "release";
    releaseId?: string;
};
export interface ResolvedContentContext {
    sourceType: "branch" | "environment" | "release";
    projectSlug: string;
    branch?: string;
    environmentName?: string;
    releaseId?: string;
}
export interface FSAdapterConfig {
    type?: "local" | "veryfront-api" | "memory" | "github";
    projectDir?: string;
    veryfront?: {
        apiKey?: string;
        apiToken?: string;
        projectSlug?: string;
        projectId?: string;
        baseUrl?: string;
        proxyMode?: boolean;
        contentSource?: ContentSource;
        cache?: {
            enabled?: boolean;
            ttl?: number;
        };
        retry?: {
            maxRetries?: number;
            retryDelay?: number;
        };
    };
    github?: GitHubConfig;
    invalidationCallbacks?: InvalidationCallbacks;
}
export interface VeryfrontConfig {
    apiBaseUrl: string;
    apiToken: string;
    projectSlug: string;
    projectId?: string;
    proxyMode?: boolean;
    contentSource: ContentSource;
    cache: {
        enabled: boolean;
        ttl: number;
        maxSize: number;
        maxMemory: number;
    };
    retry: {
        maxRetries: number;
        initialDelay: number;
        maxDelay: number;
    };
}
export interface VeryfrontFSState {
    initialized: boolean;
    projectDir?: string;
    projectData?: Project;
}
export interface CacheStats {
    cache: {
        size: number;
        memoryUsed: number;
        hits: number;
        misses: number;
        hitRate: number;
    };
    poke?: {
        received: number;
        invalidationsTriggered: number;
        lastPokeTime: number;
        connectionId: string | null;
    };
}
export interface InvalidationProjectContext {
    projectId?: string;
    projectSlug?: string;
    projectDir?: string;
    environment?: "preview" | "production";
    branch?: string | null;
    releaseId?: string | null;
}
export interface InvalidationCallbacks {
    clearSSRModuleCache?: () => void;
    clearSSRModuleCacheForProject?: (projectId: string) => void;
    clearRouterDetectionCache?: () => void;
    clearRouterDetectionCacheForProject?: (projectDir: string) => void;
    clearModulePathCache?: () => void;
    invalidateModulePaths?: (changedPaths: string[]) => void;
    clearSnippetCache?: () => void;
    clearSnippetCacheForProject?: (projectSlug: string) => void;
    triggerReload?: (changedPaths?: string[], project?: InvalidationProjectContext) => void;
    clearRendererCache?: () => void | Promise<void>;
    clearRendererCacheForProject?: (projectId: string) => void | Promise<void>;
    /** Invalidate project-level CSS cache when source files change */
    clearProjectCSSCache?: (projectSlug: string) => void;
    /** Clear domain lookup cache to refresh release IDs after publishing */
    clearDomainCache?: () => void;
}
export declare function createVeryfrontConfig(config: FSAdapterConfig): VeryfrontConfig;
//# sourceMappingURL=types.d.ts.map