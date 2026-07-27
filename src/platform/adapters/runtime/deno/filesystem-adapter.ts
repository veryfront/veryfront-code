import type {
  DirEntry,
  FileChangeEvent,
  FileChangeKind,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../../base.ts";
import { NOT_SUPPORTED } from "#veryfront/errors/error-registry/general.ts";
import { createFileWatcher } from "../shared/watcher-queue.ts";
import { resolve, sep } from "../../../compat/path/index.ts";
import { validateTempDirectoryPrefix } from "../../../compat/temp-directory-prefix.ts";

function assertDenoRuntime(method: string): void {
  if (typeof Deno === "undefined") {
    throw NOT_SUPPORTED.create({
      detail: `DenoFileSystemAdapter.${method}() can only be used in Deno runtime`,
    });
  }
}

function toFileInfo(stat: Deno.FileInfo): FileInfo {
  return {
    size: stat.size,
    isFile: stat.isFile,
    isDirectory: stat.isDirectory,
    isSymlink: stat.isSymlink,
    mtime: stat.mtime,
  };
}

function toFileChangeKind(kind: Deno.FsEvent["kind"]): FileChangeKind {
  switch (kind) {
    case "create":
      return "create";
    case "modify":
      return "modify";
    case "remove":
      return "delete";
    default:
      return "any";
  }
}

interface WatchRoot {
  readonly nativePath: string;
  readonly exposedPath: string;
}

function mapNativeWatchPath(path: string, roots: readonly WatchRoot[]): string {
  for (const root of roots) {
    if (path === root.nativePath) return root.exposedPath;
    const prefix = root.nativePath.endsWith(sep) ? root.nativePath : `${root.nativePath}${sep}`;
    if (path.startsWith(prefix)) {
      const exposedPrefix = root.exposedPath.endsWith(sep)
        ? root.exposedPath
        : `${root.exposedPath}${sep}`;
      return `${exposedPrefix}${path.slice(prefix.length)}`;
    }
  }
  return path;
}

function createClosedWatcher(): FileWatcher {
  const doneResult: IteratorResult<FileChangeEvent> = {
    done: true,
    value: undefined,
  };
  const iterator: AsyncIterator<FileChangeEvent> = {
    next: () => Promise.resolve(doneResult),
    return: () => Promise.resolve(doneResult),
  };
  const watcher = createFileWatcher(iterator, () => {});
  watcher.ready = Promise.resolve();
  watcher.done = Promise.resolve();
  return watcher;
}

export class DenoFileSystemAdapter implements FileSystemAdapter {
  async readFile(path: string): Promise<string> {
    assertDenoRuntime("readFile");
    return Deno.readTextFile(path);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    assertDenoRuntime("readFileBytes");
    return Deno.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    assertDenoRuntime("writeFile");
    await Deno.writeTextFile(path, content);
  }

  async rename(from: string, to: string): Promise<void> {
    assertDenoRuntime("rename");
    await Deno.rename(from, to);
  }

  async exists(path: string): Promise<boolean> {
    assertDenoRuntime("exists");
    try {
      await Deno.stat(path);
      return true;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    assertDenoRuntime("readDir");
    for await (const entry of Deno.readDir(path)) {
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isSymlink: entry.isSymlink,
      };
    }
  }

  async stat(path: string): Promise<FileInfo> {
    assertDenoRuntime("stat");
    return toFileInfo(await Deno.stat(path));
  }

  async lstat(path: string): Promise<FileInfo> {
    assertDenoRuntime("lstat");
    return toFileInfo(await Deno.lstat(path));
  }

  async realPath(path: string): Promise<string> {
    assertDenoRuntime("realPath");
    return await Deno.realPath(path);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    assertDenoRuntime("mkdir");
    await Deno.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    assertDenoRuntime("remove");
    await Deno.remove(path, options);
  }

  async makeTempDir(prefix: string): Promise<string> {
    assertDenoRuntime("makeTempDir");
    return Deno.makeTempDir({ prefix: validateTempDirectoryPrefix(prefix) });
  }

  watch(paths: string | string[], options?: WatchOptions): FileWatcher {
    assertDenoRuntime("watch");
    const signal = options?.signal;
    if (signal?.aborted) return createClosedWatcher();

    const pathArray = Array.isArray(paths) ? paths : [paths];
    const roots = pathArray
      .map((path): WatchRoot => ({
        nativePath: Deno.realPathSync(path),
        exposedPath: resolve(path),
      }))
      .sort((left, right) => right.nativePath.length - left.nativePath.length);
    const nativeWatcher = Deno.watchFs(pathArray, {
      recursive: options?.recursive ?? true,
    });
    const nativeIterator = nativeWatcher[Symbol.asyncIterator]();
    const doneResult: IteratorResult<FileChangeEvent> = {
      done: true,
      value: undefined,
    };

    let closed = false;
    let closeFailed = false;
    let closeError: unknown;
    let terminalFailed = false;
    let terminalError: unknown;
    let pendingNext: Promise<IteratorResult<FileChangeEvent>> | undefined;
    let resolveClosed!: () => void;
    const closedSignal = new Promise<void>((resolve) => {
      resolveClosed = resolve;
    });

    const cleanup = (): void => {
      if (closed) return;
      closed = true;
      signal?.removeEventListener("abort", cleanup);
      try {
        nativeWatcher.close();
      } catch (error) {
        closeFailed = true;
        closeError = error;
      }
      resolveClosed();
    };

    const iterator: AsyncIterator<FileChangeEvent> = {
      next(): Promise<IteratorResult<FileChangeEvent>> {
        if (closed) return Promise.resolve(doneResult);
        if (pendingNext) {
          return Promise.reject(
            new TypeError("FileWatcher does not support concurrent next() calls"),
          );
        }

        const operation = nativeIterator.next().then(
          (result): IteratorResult<FileChangeEvent> => {
            if (result.done || closed) {
              cleanup();
              return doneResult;
            }
            return {
              done: false,
              value: {
                kind: toFileChangeKind(result.value.kind),
                paths: result.value.paths.map((path) => mapNativeWatchPath(path, roots)),
              },
            };
          },
          (error): IteratorResult<FileChangeEvent> => {
            if (closed) return doneResult;
            terminalFailed = true;
            terminalError = error;
            cleanup();
            throw error;
          },
        );
        const tracked = operation.finally(() => {
          if (pendingNext === tracked) pendingNext = undefined;
        });
        pendingNext = tracked;
        return tracked;
      },

      return(): Promise<IteratorResult<FileChangeEvent>> {
        cleanup();
        return Promise.resolve(doneResult);
      },
    };

    signal?.addEventListener("abort", cleanup, { once: true });
    const watcher = createFileWatcher(iterator, cleanup);
    watcher.ready = Promise.resolve();
    watcher.done = closedSignal.then(async () => {
      const operation = pendingNext;
      if (operation) await operation.catch(() => undefined);
      if (terminalFailed) throw terminalError;
      if (closeFailed) throw closeError;
    });
    return watcher;
  }
}
