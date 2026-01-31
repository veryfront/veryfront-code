import { createError, toError } from "../../errors/veryfront-error.ts";
import type { FileChangeEvent, FileWatcher, RuntimeAdapter, WatchOptions } from "./base.ts";

export interface MockRuntimeAdapter extends RuntimeAdapter {
  fs: RuntimeAdapter["fs"] & {
    files: Map<string, string>;
    directories: Set<string>;
  };
}

function fileNotFoundError(path: string): Error {
  return toError(createError({ type: "file", message: `File not found: ${path}` }));
}

function pathNotFoundError(path: string): Error {
  return toError(createError({ type: "file", message: `Path not found: ${path}` }));
}

export function createMockAdapter(): MockRuntimeAdapter {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const envVars = new Map<string, string>();

  function hasPath(path: string): boolean {
    if (files.has(path) || directories.has(path)) return true;

    for (const filePath of files.keys()) {
      if (filePath.startsWith(`${path}/`)) return true;
    }

    return false;
  }

  function isDirectoryPath(path: string): boolean {
    if (directories.has(path)) return true;

    for (const filePath of files.keys()) {
      if (filePath.startsWith(`${path}/`)) return true;
    }

    return false;
  }

  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: false,
      jsx: false,
      http2: false,
      websocket: false,
      workers: false,
      fileWatching: false,
      shell: false,
      kvStore: false,
      writableFs: true,
    },
    serve: (_handler, _options) =>
      Promise.resolve({
        stop: () => Promise.resolve(),
        addr: { hostname: "localhost", port: 8000 },
      }),
    shutdown: () => Promise.resolve(),
    fs: {
      files,
      directories,
      readFile: (path: string) => {
        const content = files.get(path);
        if (content == null) return Promise.reject(fileNotFoundError(path));
        return Promise.resolve(content);
      },
      readFileBytes: (path: string) => {
        const content = files.get(path);
        if (content == null) return Promise.reject(fileNotFoundError(path));
        return Promise.resolve(new TextEncoder().encode(content));
      },
      writeFile: (path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
      },
      exists: (path: string) => Promise.resolve(hasPath(path)),
      readDir: async function* (path: string) {
        const entries = new Map<string, { isFile: boolean; isDirectory: boolean }>();

        for (const filePath of files.keys()) {
          if (!filePath.startsWith(`${path}/`)) continue;

          const relativePath = filePath.slice(path.length + 1);
          const [name, ...rest] = relativePath.split("/");
          if (!name) continue;

          if (entries.has(name)) continue;

          entries.set(name, {
            isFile: rest.length === 0,
            isDirectory: rest.length > 0,
          });
        }

        for (const [name, meta] of entries) {
          yield { name, ...meta, isSymlink: false };
        }
      },
      stat: (path: string) => {
        const content = files.get(path);
        if (content != null) {
          return Promise.resolve({
            size: content.length,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          });
        }

        if (isDirectoryPath(path)) {
          return Promise.resolve({
            size: 0,
            isFile: false,
            isDirectory: true,
            isSymlink: false,
            mtime: new Date(),
          });
        }

        return Promise.reject(pathNotFoundError(path));
      },
      mkdir: (path: string, options?: { recursive?: boolean }) => {
        directories.add(path);

        if (options?.recursive) {
          const parts = path.split("/").filter(Boolean);
          let current = "";
          for (const part of parts) {
            current += `/${part}`;
            directories.add(current);
          }
        }

        return Promise.resolve();
      },
      remove: (path: string, options?: { recursive?: boolean }) => {
        files.delete(path);
        directories.delete(path);

        if (options?.recursive) {
          for (const filePath of files.keys()) {
            if (filePath.startsWith(`${path}/`)) files.delete(filePath);
          }
          for (const dirPath of directories) {
            if (dirPath.startsWith(`${path}/`)) directories.delete(dirPath);
          }
        }

        return Promise.resolve();
      },
      makeTempDir: (prefix: string) =>
        Promise.resolve(`/tmp/${prefix}-${Math.random().toString(36).slice(2)}`),
      watch: (_paths: string | string[], _options?: WatchOptions): FileWatcher => ({
        async *[Symbol.asyncIterator](): AsyncIterator<FileChangeEvent> {
          // Mock watcher doesn't emit events
        },
        close: () => {},
      }),
    },
    env: {
      get: (key: string) => envVars.get(key),
      set: (key: string, value: string) => {
        envVars.set(key, value);
      },
      toObject: () => Object.fromEntries(envVars),
    },
    server: {
      upgradeWebSocket: (_request) => {
        throw toError(
          createError({
            type: "not_supported",
            message: "WebSocket upgrade not available in mock adapter. " +
              "Use integration tests with actual runtime adapters for WebSocket testing.",
          }),
        );
      },
    },
  };
}
