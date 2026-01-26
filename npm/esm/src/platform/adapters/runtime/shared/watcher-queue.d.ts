import type { FileChangeEvent, FileWatcher } from "../../base.js";
export declare function createWatcherIterator(eventQueue: FileChangeEvent[], setResolver: (r: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void, isClosed: () => boolean, isAborted: () => boolean): AsyncIterator<FileChangeEvent>;
export declare function enqueueWatchEvent(event: FileChangeEvent, eventQueue: FileChangeEvent[], getResolver: () => ((value: IteratorResult<FileChangeEvent>) => void) | null, setResolver: (resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void): void;
export declare function createFileWatcher(iterator: AsyncIterator<FileChangeEvent>, cleanup: () => void): FileWatcher;
//# sourceMappingURL=watcher-queue.d.ts.map