/**
 * Ensures that a directory is empty.
 * Deletes directory contents if the directory is not empty.
 * If the directory does not exist, it is created.
 * The directory itself is not deleted.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @example
 * ```ts
 * import { emptyDir } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * emptyDir("./foo"); // returns a promise
 * ```
 */
export declare function emptyDir(dir: string | URL): Promise<void>;
/**
 * Ensures that a directory is empty.
 * Deletes directory contents if the directory is not empty.
 * If the directory does not exist, it is created.
 * The directory itself is not deleted.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @example
 * ```ts
 * import { emptyDirSync } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * emptyDirSync("./foo"); // void
 * ```
 */
export declare function emptyDirSync(dir: string | URL): void;
//# sourceMappingURL=empty_dir.d.ts.map