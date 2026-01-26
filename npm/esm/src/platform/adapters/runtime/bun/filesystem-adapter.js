import { createError, FileSystemError, toError } from "../../../../errors/index.js";
import { createFileWatcher, createWatcherIterator, enqueueWatchEvent, } from "../shared/shared-watcher.js";
import { serverLogger } from "../../../../utils/index.js";
export class BunFileSystemAdapter {
    readFile(path) {
        return Bun.file(path).text();
    }
    async readFileBytes(path) {
        const file = Bun.file(path);
        const buffer = await file.arrayBuffer();
        return new Uint8Array(buffer);
    }
    async writeFile(path, content) {
        await Bun.write(path, content);
    }
    async exists(path) {
        try {
            const { stat } = await import("node:fs/promises");
            await stat(path);
            return true;
        }
        catch {
            return false;
        }
    }
    async *readDir(path) {
        const { readdir } = await import("node:fs/promises");
        const entries = await readdir(path, { withFileTypes: true });
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
        const { stat } = await import("node:fs/promises");
        try {
            const stats = await stat(path);
            return {
                size: stats.size,
                isFile: stats.isFile(),
                isDirectory: stats.isDirectory(),
                isSymlink: stats.isSymbolicLink(),
                mtime: stats.mtime,
            };
        }
        catch {
            throw new FileSystemError(`File not found: ${path}`, { path });
        }
    }
    async mkdir(path, options) {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path, options);
    }
    async remove(path, options) {
        const { rm } = await import("node:fs/promises");
        await rm(path, { recursive: options?.recursive, force: true });
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
        function mapBunEventKind(type) {
            switch (type) {
                case "create":
                    return "create";
                case "change":
                    return "modify";
                case "delete":
                    return "delete";
                default:
                    return "any";
            }
        }
        function setupWatcher(path) {
            try {
                if (typeof Bun === "undefined" || !Bun.watch) {
                    throw toError(createError({
                        type: "not_supported",
                        message: "Bun.watch is not available in this environment",
                        feature: "Bun.watch",
                    }));
                }
                const watcher = Bun.watch(path, {
                    recursive,
                    onChange: (event) => {
                        if (closed || signal?.aborted)
                            return;
                        enqueueWatchEvent({ kind: mapBunEventKind(event.type), paths: [event.path] }, eventQueue, () => resolver, (r) => {
                            resolver = r;
                        });
                    },
                });
                watchers.push(watcher);
            }
            catch (error) {
                serverLogger.error(`Failed to watch ${path}:`, error);
            }
        }
        for (const path of pathArray)
            setupWatcher(path);
        const iterator = createWatcherIterator(eventQueue, (r) => {
            resolver = r;
        }, () => closed, () => signal?.aborted ?? false);
        function cleanup() {
            closed = true;
            for (const watcher of watchers) {
                try {
                    if ("stop" in watcher && typeof watcher.stop === "function") {
                        watcher.stop();
                        continue;
                    }
                    if ("close" in watcher && typeof watcher.close === "function") {
                        watcher.close();
                    }
                }
                catch (error) {
                    serverLogger.debug("Error closing Bun file watcher during cleanup:", error);
                }
            }
            resolver?.({ done: true, value: undefined });
            resolver = null;
        }
        if (signal)
            signal.addEventListener("abort", cleanup);
        return createFileWatcher(iterator, cleanup);
    }
}
