import type {
  DirEntry,
  FileChangeEvent,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../../base.ts";
import {
  createFileWatcher,
  createWatcherIterator,
  setupNodeFsWatcher,
} from "../shared/shared-watcher.ts";
import { makeNodeTempDir } from "../shared/temp-dir.ts";
import { serverLogger } from "#veryfront/utils";

export class NodeFileSystemAdapter implements FileSystemAdapter {
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

  async exists(path: string): Promise<boolean> {
    const fs = await import("node:fs/promises");

    try {
      await fs.access(path);
      return true;
    } catch (error) {
      serverLogger.debug(`File access check failed for ${path}:`, error);
      return false;
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
    const eventQueue: FileChangeEvent[] = [];
    let resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null = null;

    const setResolver = (r: ((value: IteratorResult<FileChangeEvent>) => void) | null): void => {
      resolver = r;
    };

    void Promise.all(
      pathArray.map((path) =>
        setupNodeFsWatcher(path, {
          recursive,
          closed: () => closed,
          signal,
          eventQueue,
          getResolver: () => resolver,
          setResolver,
          watchers,
          onError: (error, watchPath) =>
            serverLogger.error(`File watcher error for ${watchPath}:`, error),
        })
      ),
    ).catch((error) => {
      serverLogger.error("Failed to setup file watchers:", error);
    });

    const iterator = createWatcherIterator(
      eventQueue,
      (r) => {
        resolver = r;
      },
      () => closed,
      () => signal?.aborted ?? false,
    );

    const cleanup = (): void => {
      closed = true;

      for (const watcher of watchers) {
        try {
          watcher.close();
        } catch (error) {
          serverLogger.debug("Error closing file watcher during cleanup:", error);
        }
      }

      resolver?.({ done: true, value: undefined });
      resolver = null;
    };

    signal?.addEventListener("abort", cleanup, { once: true });

    return createFileWatcher(iterator, cleanup);
  }
}
