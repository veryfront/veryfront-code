import { FILE_NOT_FOUND } from "#veryfront/errors/error-registry/general.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { validateTempDirectoryPrefix } from "#veryfront/platform/compat/temp-directory-prefix.ts";
import { requireBoundedFileReadLimit } from "#veryfront/platform/adapters/bounded-file-read.ts";
import type { FileChangeEvent, FileWatcher, RuntimeAdapter, WatchOptions } from "./base.ts";
import { FileSnapshotChangedError } from "./file-snapshot-error.ts";
import { resolve } from "#veryfront/platform/compat/path/index.ts";
import { isPathContainedBy } from "./path-containment.ts";

export interface MockRuntimeAdapter extends RuntimeAdapter {
  fs: RuntimeAdapter["fs"] & {
    files: Map<string, string>;
    byteFiles: Map<string, Uint8Array>;
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

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index++) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function getMockUtf8CodePoint(
  content: string,
  index: number,
): { codePoint: number; codeUnits: number } {
  const value = content.codePointAt(index) ?? 0xfffd;
  if (value >= 0xd800 && value <= 0xdfff) {
    return { codePoint: 0xfffd, codeUnits: 1 };
  }
  return { codePoint: value, codeUnits: value > 0xffff ? 2 : 1 };
}

function getMockUtf8ByteLength(content: string): number {
  let byteLength = 0;
  for (let index = 0; index < content.length;) {
    const { codePoint, codeUnits } = getMockUtf8CodePoint(content, index);
    byteLength += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
    index += codeUnits;
  }
  return byteLength;
}

const MOCK_BOUNDED_UTF8_CHUNK_BYTES = 64 * 1024;

function encodeMockUtf8Prefix(content: string, byteLimit: number): Uint8Array {
  const chunks: Uint8Array[] = [];
  let output = new Uint8Array(Math.min(byteLimit, MOCK_BOUNDED_UTF8_CHUNK_BYTES));
  let outputLength = 0;
  let byteLength = 0;
  const writeByte = (value: number): boolean => {
    if (byteLength >= byteLimit) return false;
    if (outputLength === output.byteLength) {
      chunks.push(output);
      output = new Uint8Array(
        Math.min(byteLimit - byteLength, MOCK_BOUNDED_UTF8_CHUNK_BYTES),
      );
      outputLength = 0;
    }
    output[outputLength++] = value;
    byteLength += 1;
    return true;
  };

  for (let index = 0; index < content.length && byteLength < byteLimit;) {
    const { codePoint, codeUnits } = getMockUtf8CodePoint(content, index);
    index += codeUnits;
    if (codePoint <= 0x7f) {
      writeByte(codePoint);
      continue;
    }
    if (codePoint <= 0x7ff) {
      if (!writeByte(0xc0 | (codePoint >> 6))) break;
      writeByte(0x80 | (codePoint & 0x3f));
      continue;
    }
    if (codePoint <= 0xffff) {
      if (!writeByte(0xe0 | (codePoint >> 12))) break;
      if (!writeByte(0x80 | ((codePoint >> 6) & 0x3f))) break;
      writeByte(0x80 | (codePoint & 0x3f));
      continue;
    }
    if (!writeByte(0xf0 | (codePoint >> 18))) break;
    if (!writeByte(0x80 | ((codePoint >> 12) & 0x3f))) break;
    if (!writeByte(0x80 | ((codePoint >> 6) & 0x3f))) break;
    writeByte(0x80 | (codePoint & 0x3f));
  }
  if (outputLength > 0) {
    chunks.push(outputLength === output.byteLength ? output : output.slice(0, outputLength));
  }
  if (chunks.length === 0) return new Uint8Array();
  if (chunks.length === 1) return chunks[0]!;
  const result = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

export function createMockAdapter(): MockRuntimeAdapter {
  let fileGeneration = 0;
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
  const byteFiles = new GenerationMap<Uint8Array>();
  const directories = new Set<string>();
  const envVars = new Map<string, string>();

  function hasPath(path: string): boolean {
    const normalizedPath = normalizeMockPath(path);
    if (
      normalizedPath === "" ||
      normalizedPath === "/" ||
      files.has(normalizedPath) ||
      byteFiles.has(normalizedPath) ||
      directories.has(normalizedPath)
    ) {
      return true;
    }

    for (const filePath of files.keys()) {
      if (isDescendantPath(filePath, normalizedPath)) return true;
    }
    for (const filePath of byteFiles.keys()) {
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
    for (const filePath of byteFiles.keys()) {
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
      symlinkSemantics: "none",
      files,
      byteFiles,
      directories,
      readFile: (path: string) => {
        const normalizedPath = normalizeMockPath(path);
        const content = files.get(normalizedPath);
        if (content != null) return Promise.resolve(content);
        const bytes = byteFiles.get(normalizedPath);
        if (bytes != null) return Promise.resolve(new TextDecoder().decode(bytes));
        return Promise.reject(fileNotFoundError(path));
      },
      readFileBytes: (path: string) => {
        const normalizedPath = normalizeMockPath(path);
        const bytes = byteFiles.get(normalizedPath);
        if (bytes != null) return Promise.resolve(bytes.slice());
        const content = files.get(normalizedPath);
        if (content != null) return Promise.resolve(new TextEncoder().encode(content));
        return Promise.reject(fileNotFoundError(path));
      },
      readFileBytesBounded: async (path: string, byteLimit: number) => {
        const boundedLimit = requireBoundedFileReadLimit(byteLimit);
        const normalizedPath = normalizeMockPath(path);
        const bytes = byteFiles.get(normalizedPath);
        if (bytes != null) {
          return bytes.slice(0, boundedLimit);
        }
        const content = files.get(normalizedPath);
        if (content != null) {
          return encodeMockUtf8Prefix(content, boundedLimit);
        }
        throw fileNotFoundError(path);
      },
      readFileBytesWithinLimit: async (path: string, byteLimit: number) => {
        const boundedLimit = requireBoundedFileReadLimit(byteLimit);
        const normalizedPath = normalizeMockPath(path);
        const bytes = byteFiles.get(normalizedPath);
        if (bytes != null) {
          if (bytes.byteLength > boundedLimit) {
            throw new RangeError(`File exceeds byte limit of ${boundedLimit} bytes`);
          }
          return bytes.slice();
        }
        const content = files.get(normalizedPath);
        if (content != null) {
          if (getMockUtf8ByteLength(content) > boundedLimit) {
            throw new RangeError(`File exceeds byte limit of ${boundedLimit} bytes`);
          }
          return encodeMockUtf8Prefix(content, boundedLimit);
        }
        throw fileNotFoundError(path);
      },
      readFileSnapshotWithinLimit: async (
        path: string,
        containmentRoot: string,
        byteLimit: number,
      ) => {
        const boundedLimit = requireBoundedFileReadLimit(byteLimit);
        if (!isPathContainedBy(resolve(path), resolve(containmentRoot))) {
          throw new TypeError("Snapshot path must be contained by the requested root");
        }
        const normalizedPath = normalizeMockPath(path);
        const storedBytes = byteFiles.get(normalizedPath);
        const storedText = files.get(normalizedPath);
        if (storedBytes === undefined && storedText === undefined) throw fileNotFoundError(path);
        const generation = fileGeneration;
        const bytes = storedBytes?.slice() ?? new TextEncoder().encode(storedText!);
        if (bytes.byteLength > boundedLimit) {
          throw new RangeError(`File exceeds byte limit of ${boundedLimit} bytes`);
        }

        await Promise.resolve();
        const currentBytes = byteFiles.get(normalizedPath);
        const currentText = files.get(normalizedPath);
        const unchanged = generation === fileGeneration &&
          (storedBytes !== undefined
            ? currentBytes === storedBytes && currentText === undefined &&
              equalBytes(storedBytes, bytes)
            : currentText === storedText && currentBytes === undefined);
        if (!unchanged) {
          throw new FileSnapshotChangedError("File generation changed during snapshot read");
        }
        return bytes;
      },
      writeFile: (path: string, content: string) => {
        const normalizedPath = normalizeMockPath(path);
        files.set(normalizedPath, content);
        byteFiles.delete(normalizedPath);
        return Promise.resolve();
      },
      writeFileBytes: (path: string, content: Uint8Array) => {
        const normalizedPath = normalizeMockPath(path);
        byteFiles.set(normalizedPath, content.slice());
        files.delete(normalizedPath);
        return Promise.resolve();
      },
      exists: (path: string) => Promise.resolve(hasPath(path)),
      readDir: async function* (path: string) {
        const normalizedPath = normalizeMockPath(path);
        if (!isDirectoryPath(normalizedPath)) {
          if (files.has(normalizedPath) || byteFiles.has(normalizedPath)) {
            throw new TypeError(`Path is not a directory: ${path}`);
          }
          throw pathNotFoundError(path);
        }

        const entries = new Map<string, { isFile: boolean; isDirectory: boolean }>();

        for (const filePath of files.keys()) {
          addDirectoryEntry(entries, filePath, normalizedPath, false);
        }
        for (const filePath of byteFiles.keys()) {
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
            size: getMockUtf8ByteLength(content),
            isFile: true,
            isDirectory: false,
            isSymlink: false,
            mtime: new Date(),
          });
        }
        const bytes = byteFiles.get(normalizedPath);
        if (bytes != null) {
          return Promise.resolve({
            size: bytes.byteLength,
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
        byteFiles.delete(normalizedPath);
        directories.delete(normalizedPath);

        if (options?.recursive) {
          for (const filePath of files.keys()) {
            if (isDescendantPath(filePath, normalizedPath)) files.delete(filePath);
          }
          for (const filePath of byteFiles.keys()) {
            if (isDescendantPath(filePath, normalizedPath)) byteFiles.delete(filePath);
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
