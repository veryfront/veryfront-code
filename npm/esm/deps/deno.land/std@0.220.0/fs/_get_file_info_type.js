/**
 * Get a human readable file type string.
 *
 * @param fileInfo A FileInfo describes a file and is returned by `stat`,
 *                 `lstat`
 */
export function getFileInfoType(fileInfo) {
    return fileInfo.isFile
        ? "file"
        : fileInfo.isDirectory
            ? "dir"
            : fileInfo.isSymlink
                ? "symlink"
                : undefined;
}
