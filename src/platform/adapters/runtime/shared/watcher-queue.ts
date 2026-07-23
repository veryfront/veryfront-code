import type { FileChangeEvent, FileWatcher } from "../../base.ts";

const DONE_RESULT: IteratorResult<FileChangeEvent> = { done: true, value: undefined };
const DEFAULT_MAX_BUFFERED_EVENTS = 1_024;

export interface WatcherQueue {
  readonly iterator: AsyncIterator<FileChangeEvent>;
  enqueue(event: FileChangeEvent): void;
  close(): void;
}

export interface WatcherQueueOptions {
  maxBufferedEvents?: number;
  overflowPaths?: readonly string[];
}

/** Create a single-consumer event queue with FIFO support for concurrent reads. */
export function createWatcherQueue(options: WatcherQueueOptions = {}): WatcherQueue {
  const maxBufferedEvents = options.maxBufferedEvents ?? DEFAULT_MAX_BUFFERED_EVENTS;
  if (!Number.isSafeInteger(maxBufferedEvents) || maxBufferedEvents < 1) {
    throw new RangeError("maxBufferedEvents must be a positive integer");
  }

  const events: FileChangeEvent[] = [];
  const readers: Array<(result: IteratorResult<FileChangeEvent>) => void> = [];
  let closed = false;
  let overflowed = false;

  const close = (): void => {
    if (closed) return;
    closed = true;
    events.length = 0;

    for (const resolve of readers.splice(0)) resolve(DONE_RESULT);
  };

  const iterator: AsyncIterator<FileChangeEvent> = {
    next(): Promise<IteratorResult<FileChangeEvent>> {
      if (closed) return Promise.resolve(DONE_RESULT);

      const event = events.shift();
      if (event) {
        if (overflowed && events.length === 0) overflowed = false;
        return Promise.resolve({ done: false, value: event });
      }

      return new Promise((resolve) => readers.push(resolve));
    },

    return(): Promise<IteratorResult<FileChangeEvent>> {
      close();
      return Promise.resolve(DONE_RESULT);
    },
  };

  return {
    iterator,
    enqueue(event): void {
      if (closed) return;

      const resolve = readers.shift();
      if (resolve) {
        resolve({ done: false, value: event });
        return;
      }

      if (overflowed) return;
      if (events.length >= maxBufferedEvents) {
        events.length = 0;
        overflowed = true;
        events.push({
          kind: "any",
          paths: options.overflowPaths ? [...options.overflowPaths] : [...event.paths],
        });
        return;
      }
      events.push(event);
    },
    close,
  };
}

export function normalizeWatchPaths(paths: string | string[]): string[] {
  const candidates = Array.isArray(paths) ? [...paths] : [paths];
  if (candidates.length === 0) {
    throw new TypeError("File watching requires at least one path");
  }

  for (const path of candidates) {
    if (typeof path !== "string" || path.length === 0) {
      throw new TypeError("File watching requires non-empty string paths");
    }
  }

  return [...new Set(candidates)];
}

export function createFileWatcher(
  iterator: AsyncIterator<FileChangeEvent>,
  cleanup: () => void,
): FileWatcher {
  let closed = false;
  const close = (): void => {
    if (closed) return;
    closed = true;
    cleanup();
  };

  const exposedIterator: AsyncIterator<FileChangeEvent> = {
    next: () => iterator.next(),
    async return(): Promise<IteratorResult<FileChangeEvent>> {
      close();
      return iterator.return ? await iterator.return() : DONE_RESULT;
    },
  };

  return {
    [Symbol.asyncIterator](): AsyncIterator<FileChangeEvent> {
      return exposedIterator;
    },
    close,
  };
}
