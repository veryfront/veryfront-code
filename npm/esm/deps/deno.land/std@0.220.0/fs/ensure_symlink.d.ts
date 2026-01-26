/**
 * Ensures that the link exists, and points to a valid file.
 * If the directory structure does not exist, it is created.
 * If the link already exists, it is not modified but error is thrown if it is not point to the given target.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @param target the source file path
 * @param linkName the destination link path
 */
export declare function ensureSymlink(target: string | URL, linkName: string | URL): Promise<void>;
/**
 * Ensures that the link exists, and points to a valid file.
 * If the directory structure does not exist, it is created.
 * If the link already exists, it is not modified but error is thrown if it is not point to the given target.
 * Requires the `--allow-read` and `--allow-write` flag.
 *
 * @param target the source file path
 * @param linkName the destination link path
 */
export declare function ensureSymlinkSync(target: string | URL, linkName: string | URL): void;
//# sourceMappingURL=ensure_symlink.d.ts.map