import type { FileChangeEvent, FileChangeKind, FileWatcher } from "../../base.ts";
import {
  createFileWatcher,
  createWatcherQueue,
  normalizeWatchPaths,
  type WatcherQueue,
} from "./watcher-queue.ts";
import { getSystemErrorCode, isFileNotFoundError } from "./filesystem-errors.ts";

export { createFileWatcher, createWatcherQueue, normalizeWatchPaths, type WatcherQueue };

const WATCH_POLL_INTERVAL_MS = 200;

type WatchSnapshotEntry = {
  mtimeMs: number;
  ctimeMs: number;
  size: number;
};

function diffWatchSnapshots(
  previous: Map<string, WatchSnapshotEntry>,
  next: Map<string, WatchSnapshotEntry>,
): FileChangeEvent[] {
  const events: FileChangeEvent[] = [];
  for (const [path, nextEntry] of next) {
    const previousEntry = previous.get(path);
    if (!previousEntry) {
      events.push({ kind: "create", paths: [path] });
      continue;
    }
    if (
      nextEntry.mtimeMs !== previousEntry.mtimeMs ||
      nextEntry.ctimeMs !== previousEntry.ctimeMs ||
      nextEntry.size !== previousEntry.size
    ) {
      events.push({ kind: "modify", paths: [path] });
    }
  }
  for (const path of previous.keys()) {
    if (!next.has(path)) events.push({ kind: "delete", paths: [path] });
  }
  return events;
}

async function collectNodeWatchSnapshot(
  path: string,
  recursive: boolean,
  snapshot: Map<string, WatchSnapshotEntry>,
  fs: typeof import("node:fs/promises"),
  join: typeof import("node:path").join,
): Promise<void> {
  let info: Awaited<ReturnType<typeof fs.stat>>;
  try {
    info = await fs.stat(path);
  } catch (error) {
    if (isFileNotFoundError(error)) return;
    throw error;
  }

  if (info.isFile()) {
    snapshot.set(path, { mtimeMs: info.mtimeMs, ctimeMs: info.ctimeMs, size: info.size });
    return;
  }
  if (!info.isDirectory()) return;

  let entries: Array<import("node:fs").Dirent<string>>;
  try {
    entries = await fs.readdir(path, { withFileTypes: true, encoding: "utf8" });
  } catch (error) {
    if (isFileNotFoundError(error)) return;
    throw error;
  }

  for (const entry of entries) {
    const entryPath = join(path, entry.name);
    if (entry.isDirectory()) {
      if (recursive) await collectNodeWatchSnapshot(entryPath, recursive, snapshot, fs, join);
      continue;
    }
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    try {
      const entryInfo = await fs.stat(entryPath);
      if (entryInfo.isFile()) {
        snapshot.set(entryPath, {
          mtimeMs: entryInfo.mtimeMs,
          ctimeMs: entryInfo.ctimeMs,
          size: entryInfo.size,
        });
      }
    } catch (error) {
      if (!isFileNotFoundError(error)) throw error;
    }
  }
}

async function runNodePollingWatcher(
  path: string,
  options: {
    recursive: boolean;
    isClosed: () => boolean;
    queue: WatcherQueue;
    onError: (error: Error, path: string) => void;
  },
): Promise<void> {
  const fs = await import("node:fs/promises");
  const { join } = await import("node:path");
  let snapshot = new Map<string, WatchSnapshotEntry>();

  try {
    await collectNodeWatchSnapshot(path, options.recursive, snapshot, fs, join);
  } catch (error) {
    options.onError(normalizeWatcherError(error), path);
  }

  while (!options.isClosed()) {
    await new Promise((resolve) => setTimeout(resolve, WATCH_POLL_INTERVAL_MS));
    if (options.isClosed()) break;

    try {
      const next = new Map<string, WatchSnapshotEntry>();
      await collectNodeWatchSnapshot(path, options.recursive, next, fs, join);
      for (const event of diffWatchSnapshots(snapshot, next)) options.queue.enqueue(event);
      snapshot = next;
    } catch (error) {
      options.onError(normalizeWatcherError(error), path);
    }
  }
}

export interface ManagedFileWatcherOptions {
  signal?: AbortSignal;
  overflowPaths?: readonly string[];
  setup(context: { queue: WatcherQueue; isClosed: () => boolean }): Promise<void>;
  closeResources(): void;
  onError(error: unknown): void;
}

/** Manage async watcher setup, early closure, aborts, and full teardown settlement. */
export function createManagedFileWatcher(options: ManagedFileWatcherOptions): FileWatcher {
  const queue = createWatcherQueue({ overflowPaths: options.overflowPaths });
  let closed = false;
  let setupSettled = false;
  let doneSettled = false;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const settleDone = (): void => {
    if (doneSettled || !closed || !setupSettled) return;
    doneSettled = true;
    resolveDone();
  };

  const reportError = (error: unknown): void => {
    try {
      options.onError(error);
    } catch {
      // Error reporting must not block watcher teardown.
    }
  };

  const closeResources = (): void => {
    try {
      options.closeResources();
    } catch (error) {
      reportError(error);
    }
  };

  const cleanup = (): void => {
    if (closed) return;
    closed = true;
    options.signal?.removeEventListener("abort", cleanup);
    closeResources();
    queue.close();
    settleDone();
  };

  const watcher = createFileWatcher(queue.iterator, cleanup);
  watcher.done = done;

  if (options.signal?.aborted) cleanup();
  else options.signal?.addEventListener("abort", cleanup, { once: true });

  void Promise.resolve()
    .then(() => options.setup({ queue, isClosed: () => closed }))
    .then(
      () => {
        setupSettled = true;
        if (closed) closeResources();
        settleDone();
      },
      (error) => {
        setupSettled = true;
        reportError(error);
        cleanup();
        settleDone();
      },
    );

  return watcher;
}

export async function setupNodeFsWatcher(
  path: string,
  options: {
    recursive: boolean;
    closed: () => boolean;
    signal: AbortSignal | undefined;
    queue: WatcherQueue;
    watchers: Array<import("node:fs").FSWatcher>;
    onError: (error: Error, path: string) => void;
    watch?: typeof import("node:fs").watch;
  },
): Promise<void> {
  try {
    const fs = await import("node:fs");
    const { join } = await import("node:path");

    const isClosed = (): boolean => options.closed() || options.signal?.aborted === true;
    if (isClosed()) return;

    let watcher: import("node:fs").FSWatcher;
    try {
      const watch = options.watch ?? fs.watch;
      watcher = watch(path, { recursive: options.recursive }, (eventType, filename) => {
        if (isClosed()) return;

        const kind: FileChangeKind = eventType === "change" ? "modify" : "any";
        const relativePath = typeof filename === "string" ? filename : undefined;
        const fullPath = relativePath ? join(path, relativePath) : path;

        options.queue.enqueue({ kind, paths: [fullPath] });
      });
    } catch (error) {
      if (
        options.recursive &&
        getSystemErrorCode(error) === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM"
      ) {
        await runNodePollingWatcher(path, {
          recursive: true,
          isClosed,
          queue: options.queue,
          onError: options.onError,
        });
        return;
      }
      throw error;
    }

    watcher.on("error", (error: Error) => {
      if (isClosed()) return;
      options.onError(error, path);
    });

    if (isClosed()) watcher.close();
    else options.watchers.push(watcher);
  } catch (error) {
    options.onError(normalizeWatcherError(error), path);
  }
}

function normalizeWatcherError(error: unknown): Error {
  try {
    if (error instanceof Error) return error;
  } catch {
    // Revoked proxies and hostile values are normalized below.
  }
  return new Error("File watcher setup failed");
}
