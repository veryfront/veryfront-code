import type {
  DirEntry,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../../base.ts";
import {
  createManagedFileWatcher,
  normalizeWatchPaths,
  setupNodeFsWatcher,
} from "../shared/shared-watcher.ts";
import { getSystemErrorCode, isFileNotFoundError } from "../shared/filesystem-errors.ts";
import { makeNodeTempDir } from "../shared/temp-dir.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";

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
      if (isFileNotFoundError(error)) return false;
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
    await fs.rm(path, { recursive: options?.recursive, force: false });
  }

  async makeTempDir(prefix: string): Promise<string> {
    return makeNodeTempDir(prefix);
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    const pathArray = normalizeWatchPaths(paths);
    const recursive = options?.recursive ?? true;
    const signal = options?.signal;

    const watchers: Array<import("node:fs").FSWatcher> = [];

    const closeNativeWatchers = (): void => {
      for (const watcher of watchers.splice(0)) {
        try {
          watcher.close();
        } catch {
          serverLogger.debug("File watcher cleanup failed");
        }
      }
    };

    return createManagedFileWatcher({
      signal,
      overflowPaths: pathArray,
      setup: async ({ queue, isClosed }) => {
        await Promise.all(
          pathArray.map((path) =>
            setupNodeFsWatcher(path, {
              recursive,
              closed: isClosed,
              signal,
              queue,
              watchers,
              onError: (error) => {
                serverLogger.error("File watcher setup failed", {
                  code: getSystemErrorCode(error),
                });
              },
            })
          ),
        );
      },
      closeResources: closeNativeWatchers,
      onError: (error) => {
        serverLogger.error("File watcher setup failed", {
          code: getSystemErrorCode(error),
        });
      },
    });
  }
}
