// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
// Documentation and interface for walk were adapted from Go
// https://golang.org/pkg/path/filepath/#Walk
// Copyright 2009 The Go Authors. All rights reserved. BSD license.
import * as dntShim from "../../../../_dnt.shims.js";
import { join } from "../path/join.js";
import { normalize } from "../path/normalize.js";
import { toPathString } from "./_to_path_string.js";
import { createWalkEntry, createWalkEntrySync, } from "./_create_walk_entry.js";
/** Error thrown in {@linkcode walk} or {@linkcode walkSync} during iteration. */
export class WalkError extends Error {
    /** File path of the root that's being walked. */
    root;
    /** Constructs a new instance. */
    constructor(cause, root) {
        super(`${cause instanceof Error ? cause.message : cause} for path "${root}"`);
        this.cause = cause;
        this.name = "WalkError";
        this.root = root;
    }
}
function include(path, exts, match, skip) {
    if (exts && !exts.some((ext) => path.endsWith(ext))) {
        return false;
    }
    if (match && !match.some((pattern) => !!path.match(pattern))) {
        return false;
    }
    if (skip && skip.some((pattern) => !!path.match(pattern))) {
        return false;
    }
    return true;
}
function wrapErrorWithPath(err, root) {
    if (err instanceof WalkError)
        return err;
    return new WalkError(err, root);
}
/**
 * Walks the file tree rooted at root, yielding each file or directory in the
 * tree filtered according to the given options.
 *
 * @example
 * ```ts
 * import { walk } from "https://deno.land/std@$STD_VERSION/fs/walk.ts";
 * import { assert } from "https://deno.land/std@$STD_VERSION/assert/assert.ts";
 *
 * for await (const entry of walk(".")) {
 *   console.log(entry.path);
 *   assert(entry.isFile);
 * }
 * ```
 */
export async function* walk(root, { maxDepth = Infinity, includeFiles = true, includeDirs = true, includeSymlinks = true, followSymlinks = false, canonicalize = true, exts = undefined, match = undefined, skip = undefined, } = {}) {
    if (maxDepth < 0) {
        return;
    }
    root = toPathString(root);
    if (includeDirs && include(root, exts, match, skip)) {
        yield await createWalkEntry(root);
    }
    if (maxDepth < 1 || !include(root, undefined, undefined, skip)) {
        return;
    }
    try {
        for await (const entry of dntShim.Deno.readDir(root)) {
            let path = join(root, entry.name);
            let { isSymlink, isDirectory } = entry;
            if (isSymlink) {
                if (!followSymlinks) {
                    if (includeSymlinks && include(path, exts, match, skip)) {
                        yield { path, ...entry };
                    }
                    continue;
                }
                const realPath = await dntShim.Deno.realPath(path);
                if (canonicalize) {
                    path = realPath;
                }
                // Caveat emptor: don't assume |path| is not a symlink. realpath()
                // resolves symlinks but another process can replace the file system
                // entity with a different type of entity before we call lstat().
                ({ isSymlink, isDirectory } = await dntShim.Deno.lstat(realPath));
            }
            if (isSymlink || isDirectory) {
                yield* walk(path, {
                    maxDepth: maxDepth - 1,
                    includeFiles,
                    includeDirs,
                    includeSymlinks,
                    followSymlinks,
                    exts,
                    match,
                    skip,
                });
            }
            else if (includeFiles && include(path, exts, match, skip)) {
                yield { path, ...entry };
            }
        }
    }
    catch (err) {
        throw wrapErrorWithPath(err, normalize(root));
    }
}
/** Same as {@linkcode walk} but uses synchronous ops */
export function* walkSync(root, { maxDepth = Infinity, includeFiles = true, includeDirs = true, includeSymlinks = true, followSymlinks = false, canonicalize = true, exts = undefined, match = undefined, skip = undefined, } = {}) {
    root = toPathString(root);
    if (maxDepth < 0) {
        return;
    }
    if (includeDirs && include(root, exts, match, skip)) {
        yield createWalkEntrySync(root);
    }
    if (maxDepth < 1 || !include(root, undefined, undefined, skip)) {
        return;
    }
    let entries;
    try {
        entries = dntShim.Deno.readDirSync(root);
    }
    catch (err) {
        throw wrapErrorWithPath(err, normalize(root));
    }
    for (const entry of entries) {
        let path = join(root, entry.name);
        let { isSymlink, isDirectory } = entry;
        if (isSymlink) {
            if (!followSymlinks) {
                if (includeSymlinks && include(path, exts, match, skip)) {
                    yield { path, ...entry };
                }
                continue;
            }
            const realPath = dntShim.Deno.realPathSync(path);
            if (canonicalize) {
                path = realPath;
            }
            // Caveat emptor: don't assume |path| is not a symlink. realpath()
            // resolves symlinks but another process can replace the file system
            // entity with a different type of entity before we call lstat().
            ({ isSymlink, isDirectory } = dntShim.Deno.lstatSync(realPath));
        }
        if (isSymlink || isDirectory) {
            yield* walkSync(path, {
                maxDepth: maxDepth - 1,
                includeFiles,
                includeDirs,
                includeSymlinks,
                followSymlinks,
                exts,
                match,
                skip,
            });
        }
        else if (includeFiles && include(path, exts, match, skip)) {
            yield { path, ...entry };
        }
    }
}
