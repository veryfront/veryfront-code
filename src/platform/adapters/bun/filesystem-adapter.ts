import { FileSystemError } from "@veryfront/errors";
import { createError, toError } from "../../../core/errors/veryfront-error.ts";
import type {
  DirEntry,
  FileChangeEvent,
  FileChangeKind,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../base.ts";

import {
  createFileWatcher,
  createWatcherIterator,
  enqueueWatchEvent,
} from "../shared-watcher.ts";
import type { BunFSWatcher, BunWatchEvent } from "./types.ts";
import { serverLogger } from "@veryfront/utils";

export class BunFileSystemAdapter implements FileSystemAdapter {
  async readFile(path: string): Promise<string> {
    const file = Bun.file(path);
    return await file.text();
  }

  async writeFile(path: string, content: string): Promise<void> {
    await Bun.write(path, content);
  }

  async exists(path: string): Promise<boolean> {
    const file = Bun.file(path);
    return await file.exists();
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
    const file = Bun.file(path);
    const exists = await file.exists();
    if (!exists) {
      throw new FileSystemError(`File not found: ${path}`, { path });
    }

    const { stat } = await import("node:fs/promises");
    const stats = await stat(path);

    return {
      size: file.size,
      isFile: stats.isFile(),
      isDirectory: stats.isDirectory(),
      isSymlink: stats.isSymbolicLink(),
      mtime: stats.mtime,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    const { rm } = await import("node:fs/promises");
    await rm(path, { recursive: options?.recursive, force: true });
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
    const watchers: Array<BunFSWatcher | import("node:fs").FSWatcher> = [];
    const eventQueue: FileChangeEvent[] = [];
    let resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null = null;

    const mapBunEventKind = (type: string): FileChangeKind => {
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
    };

    const setupWatcher = (path: string) => {
      try {
        if (typeof Bun !== "undefined" && Bun.watch) {
          const watcher = Bun.watch(path, {
            recursive,
            onChange: (event: BunWatchEvent) => {
              if (closed || signal?.aborted) return;

              enqueueWatchEvent(
                { kind: mapBunEventKind(event.type), paths: [event.path] },
                eventQueue,
                () => resolver,
                (r) => {
                  resolver = r;
                },
              );
            },
          });
          watchers.push(watcher);
        } else {
          throw toError(createError({
            type: "not_supported",
            message: "Bun.watch is not available in this environment",
            feature: "Bun.watch",
          }));
        }
      } catch (error) {
        serverLogger.error(`Failed to watch ${path}:`, error);
      }
    };

    Promise.all(pathArray.map(setupWatcher)).catch((error) => {
      serverLogger.error("Failed to setup Bun file watchers:", error);
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
          if ("stop" in watcher && typeof watcher.stop === "function") {
            watcher.stop();
          } else if ("close" in watcher && typeof watcher.close === "function") {
            watcher.close();
          }
        } catch (error) {
          serverLogger.debug("Error closing Bun file watcher during cleanup:", error);
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
