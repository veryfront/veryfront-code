import { createFileWatcher, createWatcherIterator, setupNodeFsWatcher, } from "../shared/shared-watcher.js";
import { serverLogger } from "../../../../utils/index.js";
export class NodeFileSystemAdapter {
    async readFile(path) {
        const fs = await import("node:fs/promises");
        return fs.readFile(path, "utf-8");
    }
    async readFileBytes(path) {
        const fs = await import("node:fs/promises");
        const buffer = await fs.readFile(path);
        return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
    }
    async writeFile(path, content) {
        const fs = await import("node:fs/promises");
        await fs.writeFile(path, content, "utf-8");
    }
    async exists(path) {
        const fs = await import("node:fs/promises");
        try {
            await fs.access(path);
            return true;
        }
        catch (error) {
            serverLogger.debug(`File access check failed for ${path}:`, error);
            return false;
        }
    }
    async *readDir(path) {
        const fs = await import("node:fs/promises");
        const entries = await fs.readdir(path, { withFileTypes: true });
        for (const entry of entries) {
            yield {
                name: entry.name,
                isFile: entry.isFile(),
                isDirectory: entry.isDirectory(),
                isSymlink: entry.isSymbolicLink(),
            };
        }
    }
    async stat(path) {
        const fs = await import("node:fs/promises");
        const stats = await fs.stat(path);
        return {
            size: stats.size,
            isFile: stats.isFile(),
            isDirectory: stats.isDirectory(),
            isSymlink: stats.isSymbolicLink(),
            mtime: stats.mtime,
        };
    }
    async mkdir(path, options) {
        const fs = await import("node:fs/promises");
        await fs.mkdir(path, options);
    }
    async remove(path, options) {
        const fs = await import("node:fs/promises");
        await fs.rm(path, { recursive: options?.recursive, force: true });
    }
    async makeTempDir(prefix) {
        const { mkdtemp } = await import("node:fs/promises");
        const { join } = await import("node:path");
        const { tmpdir } = await import("node:os");
        return mkdtemp(join(tmpdir(), prefix));
    }
    watch(paths, options) {
        const pathArray = Array.isArray(paths) ? paths : [paths];
        const recursive = options?.recursive ?? true;
        const signal = options?.signal;
        let closed = false;
        const watchers = [];
        const eventQueue = [];
        let resolver = null;
        Promise.all(pathArray.map((path) => setupNodeFsWatcher(path, {
            recursive,
            closed: () => closed,
            signal,
            eventQueue,
            getResolver: () => resolver,
            setResolver: (r) => {
                resolver = r;
            },
            watchers,
            onError: (error, path) => serverLogger.error(`File watcher error for ${path}:`, error),
        }))).catch((error) => {
            serverLogger.error("Failed to setup file watchers:", error);
        });
        const iterator = createWatcherIterator(eventQueue, (r) => {
            resolver = r;
        }, () => closed, () => signal?.aborted ?? false);
        const cleanup = () => {
            closed = true;
            for (const watcher of watchers) {
                try {
                    watcher.close();
                }
                catch (error) {
                    serverLogger.debug("Error closing file watcher during cleanup:", error);
                }
            }
            resolver?.({ done: true, value: undefined });
            resolver = null;
        };
        signal?.addEventListener("abort", cleanup);
        return createFileWatcher(iterator, cleanup);
    }
}
