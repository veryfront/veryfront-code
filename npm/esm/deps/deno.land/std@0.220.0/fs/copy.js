// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
import * as dntShim from "../../../../_dnt.shims.js";
import { basename } from "../path/basename.js";
import { join } from "../path/join.js";
import { resolve } from "../path/resolve.js";
import { ensureDir, ensureDirSync } from "./ensure_dir.js";
import { assert } from "../assert/assert.js";
import { getFileInfoType } from "./_get_file_info_type.js";
import { toPathString } from "./_to_path_string.js";
import { isSubdir } from "./_is_subdir.js";
const isWindows = dntShim.Deno.build.os === "windows";
async function ensureValidCopy(src, dest, options) {
    let destStat;
    try {
        destStat = await dntShim.Deno.lstat(dest);
    }
    catch (err) {
        if (err instanceof dntShim.Deno.errors.NotFound) {
            return;
        }
        throw err;
    }
    if (options.isFolder && !destStat.isDirectory) {
        throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
    }
    if (!options.overwrite) {
        throw new dntShim.Deno.errors.AlreadyExists(`'${dest}' already exists.`);
    }
    return destStat;
}
function ensureValidCopySync(src, dest, options) {
    let destStat;
    try {
        destStat = dntShim.Deno.lstatSync(dest);
    }
    catch (err) {
        if (err instanceof dntShim.Deno.errors.NotFound) {
            return;
        }
        throw err;
    }
    if (options.isFolder && !destStat.isDirectory) {
        throw new Error(`Cannot overwrite non-directory '${dest}' with directory '${src}'.`);
    }
    if (!options.overwrite) {
        throw new dntShim.Deno.errors.AlreadyExists(`'${dest}' already exists.`);
    }
    return destStat;
}
/* copy file to dest */
async function copyFile(src, dest, options) {
    await ensureValidCopy(src, dest, options);
    await dntShim.Deno.copyFile(src, dest);
    if (options.preserveTimestamps) {
        const statInfo = await dntShim.Deno.stat(src);
        assert(statInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(statInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        await dntShim.Deno.utime(dest, statInfo.atime, statInfo.mtime);
    }
}
/* copy file to dest synchronously */
function copyFileSync(src, dest, options) {
    ensureValidCopySync(src, dest, options);
    dntShim.Deno.copyFileSync(src, dest);
    if (options.preserveTimestamps) {
        const statInfo = dntShim.Deno.statSync(src);
        assert(statInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(statInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        dntShim.Deno.utimeSync(dest, statInfo.atime, statInfo.mtime);
    }
}
/* copy symlink to dest */
async function copySymLink(src, dest, options) {
    await ensureValidCopy(src, dest, options);
    const originSrcFilePath = await dntShim.Deno.readLink(src);
    const type = getFileInfoType(await dntShim.Deno.lstat(src));
    if (isWindows) {
        await dntShim.Deno.symlink(originSrcFilePath, dest, {
            type: type === "dir" ? "dir" : "file",
        });
    }
    else {
        await dntShim.Deno.symlink(originSrcFilePath, dest);
    }
    if (options.preserveTimestamps) {
        const statInfo = await dntShim.Deno.lstat(src);
        assert(statInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(statInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        await dntShim.Deno.utime(dest, statInfo.atime, statInfo.mtime);
    }
}
/* copy symlink to dest synchronously */
function copySymlinkSync(src, dest, options) {
    ensureValidCopySync(src, dest, options);
    const originSrcFilePath = dntShim.Deno.readLinkSync(src);
    const type = getFileInfoType(dntShim.Deno.lstatSync(src));
    if (isWindows) {
        dntShim.Deno.symlinkSync(originSrcFilePath, dest, {
            type: type === "dir" ? "dir" : "file",
        });
    }
    else {
        dntShim.Deno.symlinkSync(originSrcFilePath, dest);
    }
    if (options.preserveTimestamps) {
        const statInfo = dntShim.Deno.lstatSync(src);
        assert(statInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(statInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        dntShim.Deno.utimeSync(dest, statInfo.atime, statInfo.mtime);
    }
}
/* copy folder from src to dest. */
async function copyDir(src, dest, options) {
    const destStat = await ensureValidCopy(src, dest, {
        ...options,
        isFolder: true,
    });
    if (!destStat) {
        await ensureDir(dest);
    }
    if (options.preserveTimestamps) {
        const srcStatInfo = await dntShim.Deno.stat(src);
        assert(srcStatInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(srcStatInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        await dntShim.Deno.utime(dest, srcStatInfo.atime, srcStatInfo.mtime);
    }
    src = toPathString(src);
    dest = toPathString(dest);
    const promises = [];
    for await (const entry of dntShim.Deno.readDir(src)) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, basename(srcPath));
        if (entry.isSymlink) {
            promises.push(copySymLink(srcPath, destPath, options));
        }
        else if (entry.isDirectory) {
            promises.push(copyDir(srcPath, destPath, options));
        }
        else if (entry.isFile) {
            promises.push(copyFile(srcPath, destPath, options));
        }
    }
    await Promise.all(promises);
}
/* copy folder from src to dest synchronously */
function copyDirSync(src, dest, options) {
    const destStat = ensureValidCopySync(src, dest, {
        ...options,
        isFolder: true,
    });
    if (!destStat) {
        ensureDirSync(dest);
    }
    if (options.preserveTimestamps) {
        const srcStatInfo = dntShim.Deno.statSync(src);
        assert(srcStatInfo.atime instanceof Date, `statInfo.atime is unavailable`);
        assert(srcStatInfo.mtime instanceof Date, `statInfo.mtime is unavailable`);
        dntShim.Deno.utimeSync(dest, srcStatInfo.atime, srcStatInfo.mtime);
    }
    src = toPathString(src);
    dest = toPathString(dest);
    for (const entry of dntShim.Deno.readDirSync(src)) {
        const srcPath = join(src, entry.name);
        const destPath = join(dest, basename(srcPath));
        if (entry.isSymlink) {
            copySymlinkSync(srcPath, destPath, options);
        }
        else if (entry.isDirectory) {
            copyDirSync(srcPath, destPath, options);
        }
        else if (entry.isFile) {
            copyFileSync(srcPath, destPath, options);
        }
    }
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
export async function copy(src, dest, options = {}) {
    src = resolve(toPathString(src));
    dest = resolve(toPathString(dest));
    if (src === dest) {
        throw new Error("Source and destination cannot be the same.");
    }
    const srcStat = await dntShim.Deno.lstat(src);
    if (srcStat.isDirectory && isSubdir(src, dest)) {
        throw new Error(`Cannot copy '${src}' to a subdirectory of itself, '${dest}'.`);
    }
    if (srcStat.isSymlink) {
        await copySymLink(src, dest, options);
    }
    else if (srcStat.isDirectory) {
        await copyDir(src, dest, options);
    }
    else if (srcStat.isFile) {
        await copyFile(src, dest, options);
    }
}
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
export function copySync(src, dest, options = {}) {
    src = resolve(toPathString(src));
    dest = resolve(toPathString(dest));
    if (src === dest) {
        throw new Error("Source and destination cannot be the same.");
    }
    const srcStat = dntShim.Deno.lstatSync(src);
    if (srcStat.isDirectory && isSubdir(src, dest)) {
        throw new Error(`Cannot copy '${src}' to a subdirectory of itself, '${dest}'.`);
    }
    if (srcStat.isSymlink) {
        copySymlinkSync(src, dest, options);
    }
    else if (srcStat.isDirectory) {
        copyDirSync(src, dest, options);
    }
    else if (srcStat.isFile) {
        copyFileSync(src, dest, options);
    }
}
