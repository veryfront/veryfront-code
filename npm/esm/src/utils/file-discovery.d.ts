/****
 * Consolidated file discovery utility
 *
 * Provides unified file walking, filtering, and pattern matching
 * for route discovery, build asset scanning, and module discovery.
 */
import type { RuntimeAdapter } from "../platform/adapters/base.js";
export interface FileDiscoveryOptions {
    baseDir: string;
    extensions?: string[];
    patterns?: string[];
    recursive?: boolean;
    maxDepth?: number;
    ignorePatterns?: string[];
    includeDirs?: boolean;
    followSymlinks?: boolean;
    adapter?: RuntimeAdapter;
}
export interface FileDiscoveryResult {
    path: string;
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    depth: number;
}
export declare function discoverFiles(options: FileDiscoveryOptions): AsyncGenerator<FileDiscoveryResult>;
export declare function collectFiles(options: FileDiscoveryOptions): Promise<FileDiscoveryResult[]>;
export declare function hasMatchingFiles(options: FileDiscoveryOptions): Promise<boolean>;
export declare function countFiles(options: FileDiscoveryOptions): Promise<number>;
//# sourceMappingURL=file-discovery.d.ts.map