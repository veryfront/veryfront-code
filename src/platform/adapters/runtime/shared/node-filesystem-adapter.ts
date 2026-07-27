import type {
  DirEntry,
  FileChangeEvent,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../../base.ts";
import { createFileWatcher, createWatcherIterator, setupNodeFsWatcher } from "./shared-watcher.ts";
import { makeNodeTempDir } from "./temp-dir.ts";
import { isNotFoundError } from "../../../compat/fs.ts";

export interface NodeFileSystemLogger {
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

const silentLogger: NodeFileSystemLogger = {
  error: () => {},
  debug: () => {},
};

/**
 * Filesystem implementation shared by runtimes that provide Node-compatible
 * `node:fs` APIs (currently Node.js and Bun).
 */
export class NodeCompatibleFileSystemAdapter implements FileSystemAdapter {
  constructor(private readonly logger: NodeFileSystemLogger = silentLogger) {}

  async readFile(path: string): Promise<string> {
    const fs = await import("node:fs/promises");
    return fs.readFile(path, "utf-8");
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const fs = await import("node:fs/promises");
    const buffer = await fs.readFile(path);
    return buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.writeFile(path, content, "utf-8");
  }

  async rename(from: string, to: string): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.rename(from, to);
  }

  async exists(path: string): Promise<boolean> {
    const fs = await import("node:fs/promises");
    try {
      await fs.access(path);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const fs = await import("node:fs/promises");
    const entries = await fs.readdir(path, { withFileTypes: true });

    for (const entry of entries) {
      yield {
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
      };
    }
  }

  async stat(path: string): Promise<FileInfo> {
    const fs = await import("node:fs/promises");
    const stats = await fs.stat(path);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      mtime: stats.mtime,
    };
  }

  async lstat(path: string): Promise<FileInfo> {
    const fs = await import("node:fs/promises");
    const stats = await fs.lstat(path);
    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      mtime: stats.mtime,
    };
  }

  async realPath(path: string): Promise<string> {
    const fs = await import("node:fs/promises");
    return await fs.realpath(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const fs = await import("node:fs/promises");
    await fs.rm(path, { recursive: options?.recursive, force: true });
  }

  async makeTempDir(prefix: string): Promise<string> {
    return makeNodeTempDir(prefix);
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    const recursive = options?.recursive ?? true;
    const signal = options?.signal;

    let closed = false;
    const watchers: Array<import("node:fs").FSWatcher> = [];
    const closedWatchers = new WeakSet<import("node:fs").FSWatcher>();
    const pendingTasks = new Set<Promise<void>>();
    const eventQueue: FileChangeEvent[] = [];
    let resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null = null;
    let resolveClosed!: () => void;
    const closedSignal = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const setResolver = (
      value: ((result: IteratorResult<FileChangeEvent>) => void) | null,
    ): void => {
      resolver = value;
    };
    const trackTask = (task: Promise<void>): void => {
      pendingTasks.add(task);
      void task.then(
        () => pendingTasks.delete(task),
        () => pendingTasks.delete(task),
      );
    };

    const setup = Promise.all(
      pathArray.map((path) =>
        setupNodeFsWatcher(path, {
          recursive,
          closed: () => closed,
          signal,
          eventQueue,
          getResolver: () => resolver,
          setResolver,
          watchers,
          trackTask,
          onError: (error, watchPath) =>
            this.logger.error(`File watcher error for ${watchPath}`, { error }),
        })
      ),
    ).then(() => undefined);

    const iterator = createWatcherIterator(
      eventQueue,
      setResolver,
      () => closed,
      () => signal?.aborted ?? false,
    );

    const closeNativeWatchers = (): void => {
      for (const watcher of watchers) {
        if (closedWatchers.has(watcher)) continue;
        closedWatchers.add(watcher);
        try {
          watcher.close();
        } catch (error) {
          this.logger.debug("Error closing file watcher during cleanup", { error });
        }
      }
    };

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", cleanup);
      closeNativeWatchers();

      resolver?.({ done: true, value: undefined });
      resolver = null;
      resolveClosed();
    };

    if (signal?.aborted) cleanup();
    else signal?.addEventListener("abort", cleanup, { once: true });
    const watcher = createFileWatcher(iterator, cleanup);
    watcher.ready = setup;
    watcher.done = Promise.all([setup, closedSignal])
      .then(async () => {
        while (pendingTasks.size > 0) {
          await Promise.allSettled([...pendingTasks]);
        }
      })
      .then(closeNativeWatchers);
    return watcher;
  }
}
