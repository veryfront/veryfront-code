import { join } from "node:path";
import { createFileWatcher, createWatcherIterator, enqueueWatchEvent } from "./watcher-queue.js";
export { createFileWatcher, createWatcherIterator, enqueueWatchEvent };
export async function setupNodeFsWatcher(path, options) {
    try {
        const fs = await import("node:fs");
        const fsPromises = await import("node:fs/promises");
        const exists = await fsPromises
            .access(path)
            .then(() => true)
            .catch(() => false);
        if (!exists)
            return;
        const watcher = fs.watch(path, { recursive: options.recursive }, (eventType, filename) => {
            if (options.closed() || options.signal?.aborted)
                return;
            const kind = eventType === "change" ? "modify" : "any";
            const fullPath = filename ? join(path, filename) : path;
            enqueueWatchEvent({ kind, paths: [fullPath] }, options.eventQueue, options.getResolver, options.setResolver);
        });
        watcher.on("error", (error) => {
            if (options.closed() || options.signal?.aborted)
                return;
            options.onError(error, path);
        });
        options.watchers.push(watcher);
    }
    catch (error) {
        options.onError(error, path);
    }
}
