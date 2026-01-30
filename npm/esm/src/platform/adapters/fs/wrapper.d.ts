import type { DirEntry, FileInfo, FileSystemAdapter, FileWatcher, WatchOptions } from "../base.js";
import type { DirectoryEntry, FSAdapter } from "./veryfront/types.js";
export interface ExtendedFileSystemAdapter extends FileSystemAdapter {
    getUnderlyingAdapter(): FSAdapter;
    getAdapterType(): string;
    isVeryfrontAdapter(): boolean;
    isMultiProjectMode(): boolean;
    isContextualMode(): boolean;
    setRequestToken(token: string): void;
    clearRequestToken(): void;
    setRequestBranch(branch: string | null): void;
    getRequestBranch(): string | null;
    clearRequestBranch(): void;
    setProductionMode(enabled: boolean, releaseId?: string | null): void;
    runWithContext<T>(projectSlug: string, token: string, fn: () => Promise<T>, projectId?: string, options?: {
        productionMode?: boolean;
        releaseId?: string | null;
        branch?: string | null;
        environmentName?: string | null;
    }): Promise<T>;
    readFileBytes(path: string): Promise<Uint8Array>;
    readdir(path: string): Promise<DirectoryEntry[]>;
    shutdown(): Promise<void>;
}
export declare function isExtendedFSAdapter(fs: FileSystemAdapter): fs is ExtendedFileSystemAdapter;
/**
 * Check if the adapter is using a virtual filesystem (Veryfront API, GitHub, etc.)
 * Centralized predicate — use this instead of inline checks.
 */
export declare function isVirtualFilesystem(fs: FileSystemAdapter): boolean;
export declare class NotSupportedError extends Error {
    constructor(operation: string, adapterType?: string);
}
export declare class FSAdapterWrapper implements ExtendedFileSystemAdapter {
    private readonly _fsAdapter;
    constructor(fsAdapter: FSAdapter);
    getUnderlyingAdapter(): FSAdapter;
    getAdapterType(): string;
    isVeryfrontAdapter(): boolean;
    private get contextual();
    setRequestToken(token: string): void;
    clearRequestToken(): void;
    setRequestBranch(branch: string | null): void;
    getRequestBranch(): string | null;
    clearRequestBranch(): void;
    setProductionMode(enabled: boolean, releaseId?: string | null): void;
    runWithContext<T>(projectSlug: string, token: string, fn: () => Promise<T>, projectId?: string, options?: {
        productionMode?: boolean;
        releaseId?: string | null;
        branch?: string | null;
        environmentName?: string | null;
    }): Promise<T>;
    isMultiProjectMode(): boolean;
    isContextualMode(): boolean;
    readFile(path: string): Promise<string>;
    readFileBytes(path: string): Promise<Uint8Array>;
    writeFile(path: string, content: string): Promise<void>;
    exists(path: string): Promise<boolean>;
    private getDirEntries;
    readDir(path: string): AsyncIterable<DirEntry>;
    readdir(path: string): Promise<DirectoryEntry[]>;
    stat(path: string): Promise<FileInfo>;
    resolveFile(basePath: string): Promise<string | null>;
    mkdir(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    remove(path: string, options?: {
        recursive?: boolean;
    }): Promise<void>;
    makeTempDir(_prefix: string): Promise<string>;
    watch(_paths: string | string[], _options?: WatchOptions): FileWatcher;
    shutdown(): Promise<void>;
}
export declare function wrapFSAdapter(fsAdapter: FSAdapter): ExtendedFileSystemAdapter;
//# sourceMappingURL=wrapper.d.ts.map