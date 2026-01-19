import type { FileChangeEvent, FileWatcher } from "../../base.ts";

export function createWatcherIterator(
  eventQueue: FileChangeEvent[],
  setResolver: (r: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void,
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
