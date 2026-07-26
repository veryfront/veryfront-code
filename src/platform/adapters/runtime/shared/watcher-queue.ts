import type { FileChangeEvent, FileWatcher } from "../../base.ts";

export function createWatcherIterator(
  eventQueue: FileChangeEvent[],
  setResolver: (r: ((value: IteratorResult<FileChangeEvent>) => void) | null) => void,
  isClosed: () => boolean,
  isAborted: () => boolean,
): AsyncIterator<FileChangeEvent> {
  let pendingResolve: ((value: IteratorResult<FileChangeEvent>) => void) | null = null;

  function isDone(): boolean {
    return isClosed() || isAborted();
  }

  const doneResult: IteratorResult<FileChangeEvent> = { done: true, value: undefined };

  return {
    next(): Promise<IteratorResult<FileChangeEvent>> {
      if (isDone()) return Promise.resolve(doneResult);

      const event = eventQueue.shift();
      if (event) return Promise.resolve({ done: false, value: event });
      if (pendingResolve) {
        return Promise.reject(
          new TypeError("FileWatcher does not support concurrent next() calls"),
        );
      }

      return new Promise((resolve) => {
        if (isDone()) {
          resolve(doneResult);
          return;
        }
        pendingResolve = resolve;
        setResolver((result) => {
          pendingResolve = null;
          resolve(result);
        });
      });
    },

    return(): Promise<IteratorResult<FileChangeEvent>> {
      setResolver(null);
      pendingResolve?.(doneResult);
      pendingResolve = null;
      return Promise.resolve(doneResult);
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

  setResolver(null);
  resolver({ done: false, value: event });
}

export function createFileWatcher(
  iterator: AsyncIterator<FileChangeEvent>,
  cleanup: () => void,
): FileWatcher {
  let closed = false;
  const cleanupOnce = (): void => {
    if (closed) return;
    closed = true;
    cleanup();
  };
  const wrappedIterator: AsyncIterator<FileChangeEvent> = {
    next: () => iterator.next(),
    async return(value?: unknown): Promise<IteratorResult<FileChangeEvent>> {
      cleanupOnce();
      if (iterator.return) return await iterator.return(value);
      return { done: true, value: undefined };
    },
    async throw(error?: unknown): Promise<IteratorResult<FileChangeEvent>> {
      cleanupOnce();
      if (iterator.throw) return await iterator.throw(error);
      throw error;
    },
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<FileChangeEvent> {
      return wrappedIterator;
    },
    close: cleanupOnce,
  };
}
