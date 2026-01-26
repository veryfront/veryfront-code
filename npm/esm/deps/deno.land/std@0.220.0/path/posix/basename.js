// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
// This module is browser compatible.
import { assertArgs, lastPathSegment, stripSuffix, } from "../_common/basename.js";
import { stripTrailingSeparators } from "../_common/strip_trailing_separators.js";
import { isPosixPathSeparator } from "./_util.js";
/**
 * Return the last portion of a `path`.
 * Trailing directory separators are ignored, and optional suffix is removed.
 *
 * @example
 * ```ts
 * import { basename } from "https://deno.land/std@$STD_VERSION/path/basename.ts";
 *
 * console.log(basename("/home/user/Documents/")); // "Documents"
 * console.log(basename("/home/user/Documents/image.png")); // "image.png"
 * console.log(basename("/home/user/Documents/image.png", ".png")); // "image"
 * ```
 *
 * @param path - path to extract the name from.
 * @param [suffix] - suffix to remove from extracted name.
 */
export function basename(path, suffix = "") {
    assertArgs(path, suffix);
    const lastSegment = lastPathSegment(path, isPosixPathSeparator);
    const strippedSegment = stripTrailingSeparators(lastSegment, isPosixPathSeparator);
    return suffix ? stripSuffix(strippedSegment, suffix) : strippedSegment;
}
