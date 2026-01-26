import type { FileChangeEvent, FileChangeKind } from "../../base.js";
import { join } from "node:path";
import { createFileWatcher, createWatcherIterator, enqueueWatchEvent } from "./watcher-queue.js";

export { createFileWatcher, createWatcherIterator, enqueueWatchEvent };

export async function setupNodeFsWatcher(
  path: string,
  options: {
    recursive: boolean;
    closed: () => boolean;
    signal: AbortSignal | undefined;
    eventQueue: FileChangeEvent[];
    getResolver: () => ((value: IteratorResult<FileChangeEvent>) => void) | null;
    setResolver: (resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void;
    watchers: Array<import("node:fs").FSWatcher>;
    onError: (error: Error, path: string) => void;
  },
): Promise<void> {
  try {
    const fs = await import("node:fs");
    const fsPromises = await import("node:fs/promises");

    const exists = await fsPromises
      .access(path)
      .then(() => true)
      .catch(() => false);

    if (!exists) return;

    const watcher = fs.watch(path, { recursive: options.recursive }, (eventType, filename) => {
      if (options.closed() || options.signal?.aborted) return;

      const kind: FileChangeKind = eventType === "change" ? "modify" : "any";
      const fullPath = filename ? join(path, filename) : path;

      enqueueWatchEvent(
        { kind, paths: [fullPath] },
        options.eventQueue,
        options.getResolver,
        options.setResolver,
      );
    });

    watcher.on("error", (error: Error) => {
      if (options.closed() || options.signal?.aborted) return;
      options.onError(error, path);
    });

    options.watchers.push(watcher);
  } catch (error) {
    options.onError(error as Error, path);
  }
}
