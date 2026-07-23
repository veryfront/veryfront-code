import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
import type {
  DirEntry,
  FileChangeKind,
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
import { makeNodeTempDir } from "../shared/temp-dir.ts";
import { getSystemErrorCode, isFileNotFoundError } from "../shared/filesystem-errors.ts";
import type { BunFSWatcher, BunWatchEvent } from "./types.ts";
import { serverLogger } from "#veryfront/utils/logger/logger.ts";

export class BunFileSystemAdapter implements FileSystemAdapter {
  readFile(path: string): Promise<string> {
    return Bun.file(path).text();
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const file = Bun.file(path);
    const buffer = await (file as unknown as { arrayBuffer(): Promise<ArrayBuffer> }).arrayBuffer();
    return new Uint8Array(buffer);
  }

  async writeFile(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
  }

  async exists(path: string): Promise<boolean> {
    const { stat } = await import("node:fs/promises");

    try {
      await stat(path);
      return true;
    } catch (error) {
      if (isFileNotFoundError(error)) return false;
      throw error;
    }
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(path, { withFileTypes: true });

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
    const { stat } = await import("node:fs/promises");

    try {
      const stats = await stat(path);
      return {
        size: stats.size,
        isFile: stats.isFile(),
        isDirectory: stats.isDirectory(),
        isSymlink: stats.isSymbolicLink(),
        mtime: stats.mtime,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      throw FILE_NOT_FOUND.create({ detail: `File not found: ${path}`, context: { path } });
    }
  }

  async lstat(path: string): Promise<FileInfo> {
    const { lstat } = await import("node:fs/promises");
    const stats = await lstat(path);

    return {
      size: stats.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      mtime: stats.mtime,
    };
  }

  async realPath(path: string): Promise<string> {
    const { realpath } = await import("node:fs/promises");
    return await realpath(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(path, { recursive: options?.recursive, force: false });
  }

  async makeTempDir(prefix: string): Promise<string> {
    return makeNodeTempDir(prefix);
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    const pathArray = normalizeWatchPaths(paths);
    const recursive = options?.recursive ?? true;
    const signal = options?.signal;

    const watchers: Array<BunFSWatcher | import("node:fs").FSWatcher> = [];

    function mapBunEventKind(type: string): FileChangeKind {
      switch (type) {
        case "create":
          return "create";
        case "change":
          return "modify";
        case "delete":
          return "delete";
        default:
          return "any";
      }
    }

    function setupBunWatcher(
      path: string,
      queue: { enqueue(event: { kind: FileChangeKind; paths: string[] }): void },
      isClosed: () => boolean,
    ): void {
      const watcher = Bun.watch(path, {
        recursive,
        onChange: (event: BunWatchEvent) => {
          if (isClosed()) return;
          queue.enqueue({ kind: mapBunEventKind(event.type), paths: [event.path] });
        },
      });

      if (isClosed()) {
        watcher.stop();
        return;
      }
      watchers.push(watcher);
    }

    function closeNativeWatchers(): void {
      for (const watcher of watchers.splice(0)) {
        try {
          if ("stop" in watcher && typeof watcher.stop === "function") {
            watcher.stop();
            continue;
          }
          if ("close" in watcher && typeof watcher.close === "function") {
            watcher.close();
          }
        } catch {
          serverLogger.debug("Bun file watcher cleanup failed");
        }
      }
    }

    return createManagedFileWatcher({
      signal,
      overflowPaths: pathArray,
      setup: async ({ queue, isClosed }) => {
        if (typeof Bun !== "undefined" && typeof Bun.watch === "function") {
          for (const path of pathArray) {
            if (isClosed()) return;
            try {
              setupBunWatcher(path, queue, isClosed);
            } catch (error) {
              serverLogger.error("Bun file watcher setup failed", {
                code: getSystemErrorCode(error),
              });
            }
          }
          return;
        }

        serverLogger.debug("Bun.watch is unavailable, using Node.js fs.watch");
        await Promise.all(
          pathArray.map((path) =>
            setupNodeFsWatcher(path, {
              recursive,
              closed: isClosed,
              signal,
              queue,
              watchers: watchers as Array<import("node:fs").FSWatcher>,
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
        serverLogger.error("Bun file watcher setup failed", {
          code: getSystemErrorCode(error),
        });
      },
    });
  }
}
