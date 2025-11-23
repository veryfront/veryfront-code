import type { DirEntry, FileInfo, FileSystemAdapter, FileWatcher, WatchOptions } from "../base.ts";
import { createFileWatcher, createWatcherIterator, setupNodeFsWatcher } from "../shared-watcher.ts";
import { serverLogger } from "@veryfront/utils";
import type { FileChangeEvent } from "../base.ts";

export class NodeFileSystemAdapter implements FileSystemAdapter {
  async readFile(path: string): Promise<string> {
    const fs = await import("node:fs/promises");
    return await fs.readFile(path, "utf-8");
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
    const { mkdtemp } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    return await mkdtemp(join(tmpdir(), prefix));
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    const pathArray = Array.isArray(paths) ? paths : [paths];
    const recursive = options?.recursive ?? true;
    const signal = options?.signal;

    let closed = false;
    const watchers: Array<import("node:fs").FSWatcher> = [];
    const eventQueue: FileChangeEvent[] = [];
    let resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null = null;

    Promise.all(
      pathArray.map((path) =>
        setupNodeFsWatcher(path, {
          recursive,
          closed: () => closed,
          signal,
          eventQueue,
          getResolver: () => resolver,
          setResolver: (r) => {
            resolver = r;
          },
          watchers,
          onError: (error, path) => serverLogger.error(`File watcher error for ${path}:`, error),
        })
      ),
    ).catch((error) => {
      serverLogger.error("Failed to setup file watchers:", error);
    });

    const iterator = createWatcherIterator(
      eventQueue,
      () => resolver,
      (r) => {
        resolver = r;
      },
      () => closed,
      () => signal?.aborted ?? false,
    );

    const cleanup = () => {
      closed = true;
      watchers.forEach((watcher) => {
        try {
          watcher.close();
        } catch (error) {
          serverLogger.debug("Error closing file watcher during cleanup:", error);
        }
      });
      if (resolver) {
        resolver({ done: true, value: undefined });
        resolver = null;
      }
    };

    if (signal) {
      signal.addEventListener("abort", cleanup);
    }

    return createFileWatcher(iterator, cleanup);
  }
}
