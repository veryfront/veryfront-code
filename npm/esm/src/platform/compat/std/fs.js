/**
 * Portable @std/fs shim for Node.js and Bun.
 *
 * In Deno: Uses @std/fs
 * In Node.js/Bun: Provides compatible implementations using node:fs
 *
 * @module
 */
import { statSync } from "node:fs";
import { isDeno } from "../runtime.js";
async function nodeEnsureDir(dir) {
    const { mkdir } = await import("node:fs/promises");
    try {
        await mkdir(dir, { recursive: true });
    }
    catch (error) {
        if (error.code !== "EEXIST")
            throw error;
    }
}
function nodeExistsSync(path) {
    try {
        statSync(path);
        return true;
    }
    catch {
        return false;
    }
}
async function nodeExists(path) {
    const { stat } = await import("node:fs/promises");
    try {
        await stat(path);
        return true;
    }
    catch {
        return false;
    }
}
async function* nodeWalk(root, options = {}) {
    const { readdir, stat } = await import("node:fs/promises");
    const { join, extname } = await import("node:path");
    const { maxDepth = Infinity, includeFiles = true, includeDirs = true, includeSymlinks = true, followSymlinks = false, exts, match, skip, } = options;
    async function* walkDir(dir, depth) {
        if (depth > maxDepth)
            return;
        let rawEntries;
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            rawEntries = entries.map((e) => ({
                name: String(e.name),
                isFile: () => e.isFile(),
                isDirectory: () => e.isDirectory(),
                isSymbolicLink: () => e.isSymbolicLink(),
            }));
        }
        catch {
            return;
        }
        for (const entry of rawEntries) {
            const entryName = entry.name;
            const path = join(dir, entryName);
            if (skip?.some((pattern) => pattern.test(path)))
                continue;
            const isSymlink = entry.isSymbolicLink();
            let isFile = entry.isFile();
            let isDirectory = entry.isDirectory();
            if (isSymlink && followSymlinks) {
                try {
                    const stats = await stat(path);
                    isFile = stats.isFile();
                    isDirectory = stats.isDirectory();
                }
                catch {
                    continue;
                }
            }
            if (exts && isFile && !exts.includes(extname(entryName)))
                continue;
            if (match && !match.some((pattern) => pattern.test(path)))
                continue;
            const walkEntry = {
                path,
                name: entryName,
                isFile,
                isDirectory,
                isSymlink,
            };
            if (isFile) {
                if (includeFiles)
                    yield walkEntry;
            }
            else if (isDirectory) {
                if (includeDirs)
                    yield walkEntry;
            }
            else if (isSymlink && includeSymlinks && !followSymlinks) {
                yield walkEntry;
            }
            if (isDirectory)
                yield* walkDir(path, depth + 1);
        }
    }
    yield* walkDir(root, 0);
}
export let ensureDir;
export let exists;
export let existsSync;
export let walk;
if (isDeno) {
    const stdFs = await import("../../../../deps/deno.land/std@0.220.0/fs/mod.js");
    ensureDir = stdFs.ensureDir;
    exists = stdFs.exists;
    existsSync = stdFs.existsSync;
    walk = stdFs.walk;
}
else {
    ensureDir = nodeEnsureDir;
    exists = nodeExists;
    existsSync = nodeExistsSync;
    walk = nodeWalk;
}
