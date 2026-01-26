/**
 * Asset Generation for Build
 * Handles copying static assets from public directory
 */
import { serverLogger as logger } from "../../utils/index.js";
import { dirname, join, relative } from "../../platform/compat/path/index.js";
import { walk } from "../../../deps/deno.land/std@0.220.0/fs/mod.js";
import { CLIENT_STYLES } from "./templates.js";
import { createFileSystem, isNotFoundError as isNotFoundErrorCompat, } from "../../platform/compat/fs.js";
/**
 * Check if an error is a "not found" error.
 * Handles Node.js ENOENT, Deno NotFound, and Veryfront FILE_NOT_FOUND errors.
 */
function isNotFoundError(error) {
    if (isNotFoundErrorCompat(error))
        return true;
    if (!error || typeof error !== "object")
        return false;
    return error.code === "FILE_NOT_FOUND";
}
/**
 * Converts various file info formats to a normalized PathStat.
 * Supports both property-based (Deno-style) and method-based (Node.js-style) file info.
 */
function toPathStat(info) {
    if (typeof info.isFile === "function") {
        return {
            isFile: info.isFile(),
            isDirectory: info.isDirectory(),
            isSymlink: info.isSymbolicLink?.() ?? false,
            size: info.size,
        };
    }
    return {
        isFile: info.isFile,
        isDirectory: info.isDirectory,
        isSymlink: info.isSymlink ?? false,
        size: info.size ?? 0,
    };
}
async function statPath(path, adapter) {
    const fs = createFileSystem();
    try {
        return toPathStat(await fs.stat(path));
    }
    catch (error) {
        if (!isNotFoundError(error))
            throw error;
    }
    return toPathStat(await adapter.fs.stat(path));
}
function isDirectoryExistsError(error) {
    if (!error || typeof error !== "object")
        return false;
    const code = error.code;
    return code === "EEXIST" || code === "ERR_FS_EISDIR";
}
async function ensureDirPath(path, adapter) {
    if (!path)
        return;
    const fs = createFileSystem();
    try {
        await fs.mkdir(path, { recursive: true });
        return;
    }
    catch (error) {
        if (isDirectoryExistsError(error))
            return;
    }
    await adapter.fs.mkdir(path, { recursive: true });
}
/**
 * Copy static assets from public directory to output directory
 */
export async function copyStaticAssets(adapter, projectDir, outputDir, dryRun = false) {
    const stats = { assets: 0, totalSize: 0 };
    const publicDir = join(projectDir, "public");
    let publicDirInfo;
    try {
        publicDirInfo = await statPath(publicDir, adapter);
    }
    catch (error) {
        if (isNotFoundError(error)) {
            logger.debug("[build] No public directory found, skipping static assets");
            return stats;
        }
        throw error;
    }
    if (!publicDirInfo.isDirectory) {
        logger.debug("[build] Public path is not a directory, skipping static assets", { publicDir });
        return stats;
    }
    const fs = createFileSystem();
    const readFileBytes = async (path) => {
        const buffer = await fs.readFile(path);
        return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    };
    const writeFileBytes = async (path, data) => {
        await fs.writeFile(path, data);
    };
    // Verify write access by creating and removing a test file
    if (!dryRun) {
        await ensureDirPath(outputDir, adapter);
        const testFilePath = join(outputDir, ".vf_write_test.tmp");
        await writeFileBytes(testFilePath, new Uint8Array([0]));
        try {
            await fs.remove(testFilePath);
        }
        catch {
            // Best-effort cleanup; ignore failures to remove test file.
        }
    }
    for await (const entry of walk(publicDir, { followSymlinks: true, includeDirs: true })) {
        const relativePath = relative(publicDir, entry.path);
        if (!relativePath || relativePath.startsWith(".."))
            continue;
        const destinationPath = join(outputDir, relativePath);
        if (entry.isDirectory) {
            if (!dryRun)
                await ensureDirPath(destinationPath, adapter);
            continue;
        }
        try {
            const fileInfo = await statPath(entry.path, adapter);
            if (!fileInfo.isFile && !fileInfo.isSymlink)
                continue;
            stats.assets += 1;
            stats.totalSize += fileInfo.size;
            if (dryRun)
                continue;
            await ensureDirPath(dirname(destinationPath), adapter);
            await writeFileBytes(destinationPath, await readFileBytes(entry.path));
        }
        catch (error) {
            logger.debug("[build] Failed to copy static asset", { path: entry.path, error });
            throw error;
        }
    }
    logger.info(`Copied ${stats.assets} static assets`);
    return stats;
}
/**
 * Load CSS template (embedded for npm compatibility)
 */
export function loadClientStyles() {
    return CLIENT_STYLES;
}
