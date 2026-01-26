import { type GlobOptions } from "../path/glob_to_regexp.js";
import { type WalkEntry } from "./_create_walk_entry.js";
export type { GlobOptions };
/** Options for {@linkcode expandGlob} and {@linkcode expandGlobSync}. */
export interface ExpandGlobOptions extends Omit<GlobOptions, "os"> {
    /** File path where to expand from. */
    root?: string;
    /** List of glob patterns to be excluded from the expansion. */
    exclude?: string[];
    /**
     * Whether to include directories in entries.
     *
     * @default {true}
     */
    includeDirs?: boolean;
    /**
     * Whether to follow symbolic links.
     *
     * @default {false}
     */
    followSymlinks?: boolean;
    /**
     * Indicates whether the followed symlink's path should be canonicalized.
     * This option works only if `followSymlinks` is not `false`.
     *
     * @default {true}
     */
    canonicalize?: boolean;
}
/**
 * Expand the glob string from the specified `root` directory and yield each
 * result as a `WalkEntry` object.
 *
 * See [`globToRegExp()`](../path/glob.ts#globToRegExp) for details on supported
 * syntax.
 *
 * @example
 * ```ts
 * import { expandGlob } from "https://deno.land/std@$STD_VERSION/fs/expand_glob.ts";
 * for await (const file of expandGlob("**\/*.ts")) {
 *   console.log(file);
 * }
 * ```
 */
export declare function expandGlob(glob: string | URL, { root, exclude, includeDirs, extended, globstar, caseInsensitive, followSymlinks, canonicalize, }?: ExpandGlobOptions): AsyncIterableIterator<WalkEntry>;
/**
 * Synchronous version of `expandGlob()`.
 *
 * @example
 * ```ts
 * import { expandGlobSync } from "https://deno.land/std@$STD_VERSION/fs/expand_glob.ts";
 * for (const file of expandGlobSync("**\/*.ts")) {
 *   console.log(file);
 * }
 * ```
 */
export declare function expandGlobSync(glob: string | URL, { root, exclude, includeDirs, extended, globstar, caseInsensitive, followSymlinks, canonicalize, }?: ExpandGlobOptions): IterableIterator<WalkEntry>;
//# sourceMappingURL=expand_glob.d.ts.map