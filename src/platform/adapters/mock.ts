import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { validateTempDirectoryPrefix } from "#veryfront/platform/compat/temp-directory-prefix.ts";
import type { FileChangeEvent, FileWatcher, RuntimeAdapter, WatchOptions } from "./base.ts";

export interface MockRuntimeAdapter extends RuntimeAdapter {
  fs: RuntimeAdapter["fs"] & {
    files: Map<string, string>;
    directories: Set<string>;
  };
}

function fileNotFoundError(path: string): Error {
  return FILE_NOT_FOUND.create({ detail: `File not found: ${path}`, context: { path } });
}

function pathNotFoundError(path: string): Error {
  return FILE_NOT_FOUND.create({ detail: `Path not found: ${path}`, context: { path } });
}

function normalizeMockPath(path: string): string {
  const withoutTrailingSeparators = path.replace(/\/+$/, "");
  if (withoutTrailingSeparators === ".") return "";
  if (withoutTrailingSeparators === "") return path.startsWith("/") ? "/" : "";
  return withoutTrailingSeparators;
}

function descendantPrefix(path: string): string {
  const normalized = normalizeMockPath(path);
  if (normalized === "" || normalized === "/") return normalized;
  return `${normalized}/`;
}

function isDescendantPath(candidate: string, path: string): boolean {
  const normalizedCandidate = normalizeMockPath(candidate);
  const normalizedPath = normalizeMockPath(path);
  if (normalizedCandidate === normalizedPath) return false;
  return normalizedCandidate.startsWith(descendantPrefix(normalizedPath));
}

export function createMockAdapter(): MockRuntimeAdapter {
  const files = new Map<string, string>();
  const directories = new Set<string>();
  const envVars = new Map<string, string>();

  function hasPath(path: string): boolean {
    const normalizedPath = normalizeMockPath(path);
    if (
      normalizedPath === "" ||
      normalizedPath === "/" ||
      files.has(normalizedPath) ||
      directories.has(normalizedPath)
    ) {
      return true;
    }

    for (const filePath of files.keys()) {
      if (isDescendantPath(filePath, normalizedPath)) return true;
    }
    for (const directoryPath of directories) {
      if (isDescendantPath(directoryPath, normalizedPath)) return true;
    }

    return false;
  }

  function isDirectoryPath(path: string): boolean {
    const normalizedPath = normalizeMockPath(path);
    if (
      normalizedPath === "" ||
      normalizedPath === "/" ||
      directories.has(normalizedPath)
    ) {
      return true;
    }

    for (const filePath of files.keys()) {
      if (isDescendantPath(filePath, normalizedPath)) return true;
    }
    for (const directoryPath of directories) {
      if (isDescendantPath(directoryPath, normalizedPath)) return true;
    }

    return false;
  }

  function addDirectoryEntry(
    entries: Map<string, { isFile: boolean; isDirectory: boolean }>,
    candidatePath: string,
    directoryPath: string,
    candidateIsDirectory: boolean,
  ): void {
    const normalizedDirectory = normalizeMockPath(directoryPath);
    const normalizedCandidate = normalizeMockPath(candidatePath);
    if (!isDescendantPath(normalizedCandidate, normalizedDirectory)) return;

    const relativePath = normalizedCandidate.slice(
      descendantPrefix(normalizedDirectory).length,
    );
    const [name, ...rest] = relativePath.split("/");
    if (!name) return;

    const isDirectory = candidateIsDirectory || rest.length > 0;
    const existing = entries.get(name);
    if (existing?.isDirectory) return;
    entries.set(name, {
      isFile: !isDirectory,
      isDirectory,
    });
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
        const content = files.get(normalizeMockPath(path));
        if (content == null) return Promise.reject(fileNotFoundError(path));
        return Promise.resolve(content);
      },
      readFileBytes: (path: string) => {
        const content = files.get(normalizeMockPath(path));
        if (content == null) return Promise.reject(fileNotFoundError(path));
        return Promise.resolve(new TextEncoder().encode(content));
      },
      writeFile: (path: string, content: string) => {
        files.set(normalizeMockPath(path), content);
        return Promise.resolve();
      },
      exists: (path: string) => Promise.resolve(hasPath(path)),
      readDir: async function* (path: string) {
        const normalizedPath = normalizeMockPath(path);
        if (!isDirectoryPath(normalizedPath)) {
          if (files.has(normalizedPath)) {
            throw new TypeError(`Path is not a directory: ${path}`);
          }
          throw pathNotFoundError(path);
        }

        const entries = new Map<string, { isFile: boolean; isDirectory: boolean }>();

        for (const filePath of files.keys()) {
          addDirectoryEntry(entries, filePath, normalizedPath, false);
        }
        for (const directoryPath of directories) {
          addDirectoryEntry(entries, directoryPath, normalizedPath, true);
        }

        for (const [name, meta] of entries) {
          yield { name, ...meta, isSymlink: false };
        }
      },
      stat: (path: string) => {
        const normalizedPath = normalizeMockPath(path);
        const content = files.get(normalizedPath);
        if (content != null) {
          return Promise.resolve({
            size: new TextEncoder().encode(content).byteLength,
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          });
        }

        if (isDirectoryPath(normalizedPath)) {
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
        const normalizedPath = normalizeMockPath(path);
        directories.add(normalizedPath);

        if (options?.recursive) {
          const parts = normalizedPath.split("/").filter(Boolean);
          let current = normalizedPath.startsWith("/") ? "/" : "";
          for (const part of parts) {
            current = current === "/" ? `/${part}` : current ? `${current}/${part}` : part;
            directories.add(current);
          }
        }

        return Promise.resolve();
      },
      remove: (path: string, options?: { recursive?: boolean }) => {
        const normalizedPath = normalizeMockPath(path);
        files.delete(normalizedPath);
        directories.delete(normalizedPath);

        if (options?.recursive) {
          for (const filePath of files.keys()) {
            if (isDescendantPath(filePath, normalizedPath)) files.delete(filePath);
          }
          for (const dirPath of directories) {
            if (isDescendantPath(dirPath, normalizedPath)) directories.delete(dirPath);
          }
        }

        return Promise.resolve();
      },
      makeTempDir: (prefix: string) =>
        Promise.resolve().then(() => {
          const path = `/tmp/${validateTempDirectoryPrefix(prefix)}${crypto.randomUUID()}`;
          directories.add(path);
          return path;
        }),
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
