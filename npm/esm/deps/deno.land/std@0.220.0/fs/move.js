// Copyright 2018-2024 the Deno authors. All rights reserved. MIT license.
import * as dntShim from "../../../../_dnt.shims.js";
import { isSubdir } from "./_is_subdir.js";
import { isSamePath } from "./_is_same_path.js";
const EXISTS_ERROR = new dntShim.Deno.errors.AlreadyExists("dest already exists.");
/**
 * Error thrown in {@linkcode move} or {@linkcode moveSync} when the
 * destination is a subdirectory of the source.
 */
export class SubdirectoryMoveError extends Error {
    /** Constructs a new instance. */
    constructor(src, dest) {
        super(`Cannot move '${src}' to a subdirectory of itself, '${dest}'.`);
    }
}
/**
 * Moves a file or directory.
 *
 * @example
 * ```ts
 * import { move } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * move("./foo", "./bar"); // returns a promise
 * ```
 */
export async function move(src, dest, { overwrite = false } = {}) {
    const srcStat = await dntShim.Deno.stat(src);
    if (srcStat.isDirectory &&
        (isSubdir(src, dest) || isSamePath(src, dest))) {
        throw new SubdirectoryMoveError(src, dest);
    }
    if (overwrite) {
        if (isSamePath(src, dest))
            return;
        try {
            await dntShim.Deno.remove(dest, { recursive: true });
        }
        catch (error) {
            if (!(error instanceof dntShim.Deno.errors.NotFound)) {
                throw error;
            }
        }
    }
    else {
        try {
            await dntShim.Deno.lstat(dest);
            return Promise.reject(EXISTS_ERROR);
        }
        catch {
            // Do nothing...
        }
    }
    await dntShim.Deno.rename(src, dest);
}
/**
 * Moves a file or directory synchronously.
 *
 * @example
 * ```ts
 * import { moveSync } from "https://deno.land/std@$STD_VERSION/fs/mod.ts";
 *
 * moveSync("./foo", "./bar"); // void
 * ```
 */
export function moveSync(src, dest, { overwrite = false } = {}) {
    const srcStat = dntShim.Deno.statSync(src);
    if (srcStat.isDirectory &&
        (isSubdir(src, dest) || isSamePath(src, dest))) {
        throw new SubdirectoryMoveError(src, dest);
    }
    if (overwrite) {
        if (isSamePath(src, dest))
            return;
        try {
            dntShim.Deno.removeSync(dest, { recursive: true });
        }
        catch (error) {
            if (!(error instanceof dntShim.Deno.errors.NotFound)) {
                throw error;
            }
        }
    }
    else {
        try {
            dntShim.Deno.lstatSync(dest);
            throw EXISTS_ERROR;
        }
        catch (error) {
            if (error === EXISTS_ERROR) {
                throw error;
            }
        }
    }
    dntShim.Deno.renameSync(src, dest);
}
