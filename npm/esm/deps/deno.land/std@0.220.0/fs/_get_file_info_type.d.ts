import * as dntShim from "../../../../_dnt.shims.js";
export type PathType = "file" | "dir" | "symlink";
/**
 * Get a human readable file type string.
 *
 * @param fileInfo A FileInfo describes a file and is returned by `stat`,
 *                 `lstat`
 */
export declare function getFileInfoType(fileInfo: dntShim.Deno.FileInfo): PathType | undefined;
//# sourceMappingURL=_get_file_info_type.d.ts.map