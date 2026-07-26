import type { FileChangeEvent, FileChangeKind } from "../../base.ts";
import { createFileWatcher, createWatcherIterator, enqueueWatchEvent } from "./watcher-queue.ts";

export { createFileWatcher, createWatcherIterator, enqueueWatchEvent };

interface NodeWatcherSetupOptions {
  readonly recursive: boolean;
  readonly closed: () => boolean;
  readonly signal: AbortSignal | undefined;
  readonly eventQueue: FileChangeEvent[];
  readonly getResolver: () => ((value: IteratorResult<FileChangeEvent>) => void) | null;
  readonly setResolver: (
    resolver: ((value: IteratorResult<FileChangeEvent>) => void) | null,
  ) => void;
  readonly watchers: Array<import("node:fs").FSWatcher>;
  readonly onError: (error: Error, path: string) => void;
  readonly trackTask?: (task: Promise<void>) => void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function isRecursiveWatchUnsupported(error: unknown): boolean {
  const code = (error as { code?: unknown }).code;
  return code === "ERR_FEATURE_UNAVAILABLE_ON_PLATFORM";
}

export async function setupNodeFsWatcher(
  rootPath: string,
  options: NodeWatcherSetupOptions,
): Promise<void> {
  try {
    const fs = await import("node:fs");
    const fsPromises = await import("node:fs/promises");
    const { isAbsolute, relative, resolve, sep } = await import("node:path");

    const isClosed = (): boolean => options.closed() || options.signal?.aborted === true;
    if (isClosed()) return;

    let rootInfo: import("node:fs").Stats;
    try {
      rootInfo = await fsPromises.lstat(rootPath);
    } catch (error) {
      options.onError(toError(error), rootPath);
      return;
    }
    if (isClosed()) return;

    const emit = (
      kind: FileChangeKind,
      watchedPath: string,
      filename: string | Uint8Array | null,
    ): string => {
      const candidate = filename === null ? watchedPath : resolve(watchedPath, String(filename));
      const pathFromRoot = relative(resolve(rootPath), candidate);
      const eventPath = pathFromRoot === "" || (
          pathFromRoot !== ".." &&
          !pathFromRoot.startsWith(`..${sep}`) &&
          !isAbsolute(pathFromRoot)
        )
        ? candidate
        : watchedPath;
      enqueueWatchEvent(
        { kind, paths: [eventPath] },
        options.eventQueue,
        options.getResolver,
        options.setResolver,
      );
      return eventPath;
    };

    const registerWatcher = (
      watchedPath: string,
      recursive: boolean,
      listener: (eventType: string, filename: string | Uint8Array | null) => void,
    ): import("node:fs").FSWatcher => {
      const watcher = fs.watch(
        watchedPath,
        { recursive, encoding: "utf8" },
        listener,
      );
      watcher.on("error", (error: Error) => {
        if (!isClosed()) options.onError(error, watchedPath);
      });
      if (isClosed()) {
        watcher.close();
        return watcher;
      }
      options.watchers.push(watcher);
      return watcher;
    };

    if (options.recursive && rootInfo.isDirectory() && !rootInfo.isSymbolicLink()) {
      try {
        registerWatcher(rootPath, true, (eventType, filename) => {
          if (isClosed()) return;
          emit(eventType === "change" ? "modify" : "any", rootPath, filename);
        });
        return;
      } catch (error) {
        if (!isRecursiveWatchUnsupported(error)) throw error;
      }

      // Node 18 does not provide recursive fs.watch on Linux. Maintain one
      // non-recursive watcher per physical directory and reconcile the set
      // whenever a directory entry is renamed.
      const directoryWatchers = new Map<string, import("node:fs").FSWatcher>();
      let reconcileTail = Promise.resolve();

      const removeSubtreeWatchers = (path: string): void => {
        const prefix = path.endsWith(sep) ? path : `${path}${sep}`;
        for (const [directory, watcher] of directoryWatchers) {
          if (directory !== path && !directory.startsWith(prefix)) continue;
          directoryWatchers.delete(directory);
          try {
            watcher.close();
          } catch (error) {
            if (!isClosed()) options.onError(toError(error), directory);
          }
        }
      };

      const watchDirectoryTree = async (path: string): Promise<void> => {
        if (isClosed() || directoryWatchers.has(path)) return;

        let info: import("node:fs").Stats;
        try {
          info = await fsPromises.lstat(path);
        } catch (error) {
          if ((error as { code?: unknown }).code === "ENOENT") {
            removeSubtreeWatchers(path);
            return;
          }
          throw error;
        }
        if (!info.isDirectory() || info.isSymbolicLink() || isClosed()) return;

        const watcher = registerWatcher(path, false, (eventType, filename) => {
          if (isClosed()) return;
          const changedPath = emit(
            eventType === "change" ? "modify" : "any",
            path,
            filename,
          );
          if (eventType !== "rename") return;

          reconcileTail = reconcileTail
            .then(() => watchDirectoryTree(changedPath))
            .catch((error) => {
              if (!isClosed()) options.onError(toError(error), changedPath);
            });
          options.trackTask?.(reconcileTail);
        });
        directoryWatchers.set(path, watcher);
        watcher.once("close", () => {
          if (directoryWatchers.get(path) === watcher) directoryWatchers.delete(path);
        });

        const entries = await fsPromises.readdir(path, { withFileTypes: true });
        for (const entry of entries) {
          if (isClosed()) return;
          if (entry.isDirectory() && !entry.isSymbolicLink()) {
            await watchDirectoryTree(resolve(path, entry.name));
          }
        }
      };

      await watchDirectoryTree(resolve(rootPath));
      return;
    }

    registerWatcher(rootPath, false, (eventType, filename) => {
      if (isClosed()) return;
      emit(eventType === "change" ? "modify" : "any", rootPath, filename);
    });
  } catch (error) {
    options.onError(toError(error), rootPath);
  }
}
