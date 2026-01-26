/**
 * Portable @std/fs shim for Node.js and Bun.
 *
 * In Deno: Uses @std/fs
 * In Node.js/Bun: Provides compatible implementations using node:fs
 *
 * @module
 */
export interface WalkEntry {
    path: string;
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink: boolean;
}
export interface WalkOptions {
    maxDepth?: number;
    includeFiles?: boolean;
    includeDirs?: boolean;
    includeSymlinks?: boolean;
    followSymlinks?: boolean;
    exts?: string[];
    match?: RegExp[];
    skip?: RegExp[];
}
export declare let ensureDir: (dir: string) => Promise<void>;
export declare let exists: (path: string) => Promise<boolean>;
export declare let existsSync: (path: string) => boolean;
export declare let walk: (root: string, options?: WalkOptions) => AsyncIterableIterator<WalkEntry>;
//# sourceMappingURL=fs.d.ts.map