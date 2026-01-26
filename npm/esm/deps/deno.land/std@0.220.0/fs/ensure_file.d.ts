/**
 * Ensures that the file exists.
 * If the file that is requested to be created is in directories that do not
 * exist.
 * these directories are created. If the file already exists,
 * it is NOTMODIFIED.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @example
 * ```ts
 * import { ensureFile } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * ensureFile("./folder/targetFile.dat"); // returns promise
 * ```
 */
export declare function ensureFile(filePath: string | URL): Promise<void>;
/**
 * Ensures that the file exists.
 * If the file that is requested to be created is in directories that do not
 * exist,
 * these directories are created. If the file already exists,
 * it is NOT MODIFIED.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @example
 * ```ts
 * import { ensureFileSync } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * ensureFileSync("./folder/targetFile.dat"); // void
 * ```
 */
export declare function ensureFileSync(filePath: string | URL): void;
//# sourceMappingURL=ensure_file.d.ts.map