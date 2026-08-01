import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { FileChangeEvent, FileWatcher, RuntimeAdapter, WatchOptions } from "./base.ts";
import { requireBoundedFileReadLimit } from "./bounded-file-read.ts";
import { FileSnapshotChangedError } from "./file-snapshot-error.ts";
import { isAbsolute, relative, resolve, sep } from "#veryfront/platform/compat/path/index.ts";

export interface MockRuntimeAdapter extends RuntimeAdapter {
  fs: RuntimeAdapter["fs"] & {
    files: Map<string, string>;
    directories: Set<string>;
    readFileBytes: NonNullable<RuntimeAdapter["fs"]["readFileBytes"]>;
    readFileBytesBounded: NonNullable<RuntimeAdapter["fs"]["readFileBytesBounded"]>;
    readFileBytesWithinLimit: NonNullable<RuntimeAdapter["fs"]["readFileBytesWithinLimit"]>;
    readFileSnapshotWithinLimit: NonNullable<
      RuntimeAdapter["fs"]["readFileSnapshotWithinLimit"]
    >;
    createFileBytesExclusive: NonNullable<RuntimeAdapter["fs"]["createFileBytesExclusive"]>;
  };
}

function fileNotFoundError(path: string): Error {
  return FILE_NOT_FOUND.create({ detail: `File not found: ${path}`, context: { path } });
}

function pathNotFoundError(path: string): Error {
  return FILE_NOT_FOUND.create({ detail: `Path not found: ${path}`, context: { path } });
}

export function createMockAdapter(): MockRuntimeAdapter {
  let fileGeneration = 1;
  class GenerationMap<T> extends Map<string, T> {
    override set(key: string, value: T): this {
      fileGeneration++;
      return super.set(key, value);
    }

    override delete(key: string): boolean {
      const deleted = super.delete(key);
      if (deleted) fileGeneration++;
      return deleted;
    }

    override clear(): void {
      if (this.size > 0) fileGeneration++;
      super.clear();
    }
  }
  const files = new GenerationMap<string>();
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
      symlinkSemantics: "none",
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
      readFileBytesBounded: (path: string, byteLimit: number) => {
        const limit = requireBoundedFileReadLimit(byteLimit);
        const content = files.get(path);
        if (content == null) return Promise.reject(fileNotFoundError(path));
        return Promise.resolve(new TextEncoder().encode(content).slice(0, limit));
      },
      readFileBytesWithinLimit: (path: string, byteLimit: number) => {
        const limit = requireBoundedFileReadLimit(byteLimit);
        const content = files.get(path);
        if (content == null) return Promise.reject(fileNotFoundError(path));
        const bytes = new TextEncoder().encode(content);
        if (bytes.byteLength > limit) {
          return Promise.reject(new RangeError(`File exceeds byte limit of ${limit} bytes`));
        }
        return Promise.resolve(bytes);
      },
      readFileSnapshotWithinLimit: async (
        path: string,
        containmentRoot: string,
        byteLimit: number,
      ) => {
        const limit = requireBoundedFileReadLimit(byteLimit);
        const relation = relative(resolve(containmentRoot), resolve(path));
        if (
          relation === ".." || relation.startsWith(`..${sep}`) || isAbsolute(relation)
        ) {
          throw new TypeError("Snapshot path must be contained by the requested root");
        }
        const content = files.get(path);
        if (content == null) throw fileNotFoundError(path);
        const generation = fileGeneration;
        const bytes = new TextEncoder().encode(content);
        if (bytes.byteLength > limit) {
          throw new RangeError(`File exceeds byte limit of ${limit} bytes`);
        }
        await Promise.resolve();
        if (fileGeneration !== generation || files.get(path) !== content) {
          throw new FileSnapshotChangedError("Mock file generation changed during snapshot read");
        }
        return bytes;
      },
      writeFile: (path: string, content: string) => {
        files.set(path, content);
        return Promise.resolve();
      },
      createFileBytesExclusive: (path: string, content: Uint8Array) => {
        if (files.has(path)) {
          return Promise.reject(
            Object.assign(new Error(`File exists: ${path}`), { code: "EEXIST" }),
          );
        }
        files.set(path, new TextDecoder("utf-8", { fatal: true }).decode(content));
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
      makeTempDir: (prefix: string) => Promise.resolve(`/tmp/${prefix}-${crypto.randomUUID()}`),
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
