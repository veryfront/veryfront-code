import { type WalkEntry } from "./_create_walk_entry.js";
/** Error thrown in {@linkcode walk} or {@linkcode walkSync} during iteration. */
export declare class WalkError extends Error {
    /** File path of the root that's being walked. */
    root: string;
    /** Constructs a new instance. */
    constructor(cause: unknown, root: string);
}
/** Options for {@linkcode walk} and {@linkcode walkSync}. */
export interface WalkOptions {
    /**
     * The maximum depth of the file tree to be walked recursively.
     * @default {Infinity}
     */
    maxDepth?: number;
    /**
     * Indicates whether file entries should be included or not.
     * @default {true}
     */
    includeFiles?: boolean;
    /**
     * Indicates whether directory entries should be included or not.
     * @default {true}
     */
    includeDirs?: boolean;
    /**
     * Indicates whether symlink entries should be included or not.
     * This option is meaningful only if `followSymlinks` is set to `false`.
     * @default {true}
     */
    includeSymlinks?: boolean;
    /**
     * Indicates whether symlinks should be resolved or not.
     * @default {false}
     */
    followSymlinks?: boolean;
    /**
     * Indicates whether the followed symlink's path should be canonicalized.
     * This option works only if `followSymlinks` is not `false`.
     * @default {true}
     */
    canonicalize?: boolean;
    /**
     * List of file extensions used to filter entries.
     * If specified, entries without the file extension specified by this option are excluded.
     * @default {undefined}
     */
    exts?: string[];
    /**
     * List of regular expression patterns used to filter entries.
     * If specified, entries that do not match the patterns specified by this option are excluded.
     * @default {undefined}
     */
    match?: RegExp[];
    /**
     * List of regular expression patterns used to filter entries.
     * If specified, entries matching the patterns specified by this option are excluded.
     * @default {undefined}
     */
    skip?: RegExp[];
}
export type { WalkEntry };
/**
 * Walks the file tree rooted at root, yielding each file or directory in the
 * tree filtered according to the given options.
 *
 * @example
 * ```ts
 * import { walk } from "https://deno.land/std@$STD_VERSION/fs/walk.ts";
 * import { assert } from "https://deno.land/std@$STD_VERSION/assert/assert.ts";
 *
 * for await (const entry of walk(".")) {
 *   console.log(entry.path);
 *   assert(entry.isFile);
 * }
 * ```
 */
export declare function walk(root: string | URL, { maxDepth, includeFiles, includeDirs, includeSymlinks, followSymlinks, canonicalize, exts, match, skip, }?: WalkOptions): AsyncIterableIterator<WalkEntry>;
/** Same as {@linkcode walk} but uses synchronous ops */
export declare function walkSync(root: string | URL, { maxDepth, includeFiles, includeDirs, includeSymlinks, followSymlinks, canonicalize, exts, match, skip, }?: WalkOptions): IterableIterator<WalkEntry>;
//# sourceMappingURL=walk.d.ts.map