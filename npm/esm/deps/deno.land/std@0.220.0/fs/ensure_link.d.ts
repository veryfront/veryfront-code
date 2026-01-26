/**
 * Ensures that the hard link exists.
 * If the directory structure does not exist, it is created.
 *
 * @example
 * ```ts
 * import { ensureSymlink } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * ensureSymlink("./folder/targetFile.dat", "./folder/targetFile.link.dat"); // returns promise
 * ```
 *
 * @param src the source file path. Directory hard links are not allowed.
 * @param dest the destination link path
 */
export declare function ensureLink(src: string | URL, dest: string | URL): Promise<void>;
/**
 * Ensures that the hard link exists.
 * If the directory structure does not exist, it is created.
 *
 * @example
 * ```ts
 * import { ensureSymlinkSync } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * ensureSymlinkSync("./folder/targetFile.dat", "./folder/targetFile.link.dat"); // void
 * ```
 *
 * @param src the source file path. Directory hard links are not allowed.
 * @param dest the destination link path
 */
export declare function ensureLinkSync(src: string | URL, dest: string | URL): void;
//# sourceMappingURL=ensure_link.d.ts.map