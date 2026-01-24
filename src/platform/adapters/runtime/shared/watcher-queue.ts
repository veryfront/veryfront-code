import type { FileChangeEvent, FileWatcher } from "../../base.ts";

export function createWatcherIterator(
  eventQueue: FileChangeEvent[],
  setResolver: (r: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void,
  isClosed: () => boolean,
  isAborted: () => boolean,
): AsyncIterator<FileChangeEvent> {
  function isDone(): boolean {
    return isClosed() || isAborted();
  }

  function doneResult(): IteratorResult<FileChangeEvent> {
    return { done: true, value: undefined };
  }

  return {
    next(): Promise<IteratorResult<FileChangeEvent>> {
      if (isDone()) return Promise.resolve(doneResult());

      const event = eventQueue.shift();
      if (event) return Promise.resolve({ done: false, value: event });

      return new Promise((resolve) => {
        if (isDone()) {
          resolve(doneResult());
          return;
        }
        setResolver(resolve);
      });
    },

    return(): Promise<IteratorResult<FileChangeEvent>> {
      return Promise.resolve(doneResult());
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
  if (!resolver) {
    eventQueue.push(event);
    return;
  }

  resolver({ done: false, value: event });
  setResolver(null);
}

export function createFileWatcher(
  iterator: AsyncIterator<FileChangeEvent>,
  cleanup: () => void,
): FileWatcher {
  return {
    [Symbol.asyncIterator](): AsyncIterator<FileChangeEvent> {
      return iterator;
    },
    close: cleanup,
  };
}
