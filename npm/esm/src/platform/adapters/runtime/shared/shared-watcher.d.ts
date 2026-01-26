import type { FileChangeEvent } from "../../base.js";
import { createFileWatcher, createWatcherIterator, enqueueWatchEvent } from "./watcher-queue.js";
export { createFileWatcher, createWatcherIterator, enqueueWatchEvent };
export declare function setupNodeFsWatcher(path: string, options: {
    recursive: boolean;
    closed: () => boolean;
    signal: AbortSignal | undefined;
    eventQueue: FileChangeEvent[];
    getResolver: () => ((value: IteratorResult<FileChangeEvent>) => void) | null;
    setResolver: (resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void;
    watchers: Array<import("node:fs").FSWatcher>;
    onError: (error: Error, path: string) => void;
}): Promise<void>;
//# sourceMappingURL=shared-watcher.d.ts.map