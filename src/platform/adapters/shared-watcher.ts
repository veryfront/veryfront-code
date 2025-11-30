import type { FileChangeEvent, FileChangeKind, FileWatcher } from "./base.ts";
import { join } from "node:path";

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

    const exists = await fsPromises.access(path).then(() => true).catch(() => false);
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
      if (!options.closed() && !options.signal?.aborted) {
        options.onError(error, path);
      }
    });

    options.watchers.push(watcher);
  } catch (error) {
    options.onError(error as Error, path);
  }
}

export function createWatcherIterator(
  eventQueue: FileChangeEvent[],
  _getResolver: () => ((value: IteratorResult<FileChangeEvent>) => void) | null,
  setResolver: (resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void,
  isClosed: () => boolean,
  isAborted: () => boolean,
): AsyncIterator<FileChangeEvent> {
  return {
    next(): Promise<IteratorResult<FileChangeEvent>> {
      if (isClosed() || isAborted()) {
        return Promise.resolve({ done: true, value: undefined });
      }

      if (eventQueue.length > 0) {
        const event = eventQueue.shift()!;
        return Promise.resolve({ done: false, value: event });
      }

      return new Promise((resolve) => {
        if (isClosed() || isAborted()) {
          resolve({ done: true, value: undefined });
          return;
        }
        setResolver(resolve);
      });
    },

    return(): Promise<IteratorResult<FileChangeEvent>> {
      return Promise.resolve({ done: true, value: undefined });
    },
  };
}

export function enqueueWatchEvent(
  event: FileChangeEvent,
  eventQueue: FileChangeEvent[],
  getResolver: () => ((value: IteratorResult<FileChangeEvent>) => void) | null,
  setResolver: (resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void,
): void {
  const resolver = getResolver();
  if (resolver) {
    resolver({ done: false, value: event });
    setResolver(null);
  } else {
    eventQueue.push(event);
  }
}

export function createFileWatcher(
  iterator: AsyncIterator<FileChangeEvent>,
  cleanup: () => void,
): FileWatcher {
  return {
    [Symbol.asyncIterator]() {
      return iterator;
    },
    close: cleanup,
  };
}
