/** Options for {@linkcode copy} and {@linkcode copySync}. */
export interface CopyOptions {
    /**
     * overwrite existing file or directory.
     * @default {false}
     */
    overwrite?: boolean;
    /**
     * When `true`, will set last modification and access times to the ones of the
     * original source files.
     * When `false`, timestamp behavior is OS-dependent.
     *
     * @default {false}
     */
    preserveTimestamps?: boolean;
}
/**
 * Copy a file or directory. The directory can have contents. Like `cp -r`.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @example
 * ```ts
 * import { copy } from "https://deno.land/std@$STD_VERSION/fs/copy.ts";
 * copy("./foo", "./bar"); // returns a promise
 * ```
 *
 * @param src the file/directory path.
 *            Note that if `src` is a directory it will copy everything inside
 *            of this directory, not the entire directory itself
 * @param dest the destination path. Note that if `src` is a file, `dest` cannot
 *             be a directory
 * @param options
 */
export declare function copy(src: string | URL, dest: string | URL, options?: CopyOptions): Promise<void>;
/**
 * Copy a file or directory. The directory can have contents. Like `cp -r`.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @example
 * ```ts
 * import { copySync } from "https://deno.land/std@$STD_VERSION/fs/copy.ts";
 * copySync("./foo", "./bar"); // void
 * ```
 * @param src the file/directory path.
 *            Note that if `src` is a directory it will copy everything inside
 *            of this directory, not the entire directory itself
 * @param dest the destination path. Note that if `src` is a file, `dest` cannot
 *             be a directory
 * @param options
 */
export declare function copySync(src: string | URL, dest: string | URL, options?: CopyOptions): void;
//# sourceMappingURL=copy.d.ts.map