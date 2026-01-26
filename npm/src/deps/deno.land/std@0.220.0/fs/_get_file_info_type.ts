// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
// Copyright the Browserify authors. MIT License.
import * as dntShim from "../../../../_dnt.shims.js";


export type PathType = "file" | "dir" | "symlink";

/**
 * Get a human readable file type string.
 *
 * @param fileInfo A FileInfo describes a file and is returned by `stat`,
 *                 `lstat`
 */
export function getFileInfoType(fileInfo: dntShim.Deno.FileInfo): PathType | undefined {
  return fileInfo.isFile
    ? "file"
    : fileInfo.isDirectory
    ? "dir"
    : fileInfo.isSymlink
    ? "symlink"
    : undefined;
}
