import type { FileInfo } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { isBun, isDeno, isNode } from "./runtime.ts";
import { validateTempDirectoryPrefix } from "./temp-directory-prefix.ts";
import { readFileWithinLimit } from "../adapters/bounded-file-read.ts";
import {
  captureExclusiveCreateCapability,
  captureSnapshotReadCapability,
} from "../adapters/file-system-capabilities.ts";
import { isProxyWithoutHooks } from "./error-introspection.ts";
import { isNotFoundError } from "./not-found-error.ts";
import { primordialPromiseAll, primordialPromiseCatch } from "./primordials/promise.ts";
import {
  openNativeStreamFile,
  removeNativeStreamFile,
  renameNativeStreamFile,
} from "./native-stream-file.ts";

export { isNotFoundError };

const DEFAULT_TEMP_DIRECTORY_PREFIX = "tmp-";
const UNSUPPORTED_CHMOD_ERROR_CODES = new Set([
  "ENOSYS",
  "ENOTSUP",
  "EOPNOTSUPP",
]);
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const reflectApply = Reflect.apply;
const NativeUint8Array = Uint8Array;
const TypedArrayPrototype = Object.getPrototypeOf(NativeUint8Array.prototype);
const Uint8ArrayBufferGet = getOwnPropertyDescriptor(TypedArrayPrototype, "buffer")?.get as
  | ((this: Uint8Array) => ArrayBufferLike)
  | undefined;
const Uint8ArrayByteLengthGet = getOwnPropertyDescriptor(TypedArrayPrototype, "byteLength")
  ?.get as
    | ((this: Uint8Array) => number)
    | undefined;
const Uint8ArrayByteOffsetGet = getOwnPropertyDescriptor(TypedArrayPrototype, "byteOffset")
  ?.get as
    | ((this: Uint8Array) => number)
    | undefined;
const ReadableStreamCancel = ReadableStream.prototype.cancel;
const ReadableStreamPipeTo = ReadableStream.prototype.pipeTo;
const NativeWritableStream = WritableStream;
const NativePromise = Promise;
const NativePromiseResolve = Promise.resolve;
const NativePromiseThen = Promise.prototype.then;
const StringPrototypeCharCodeAt = String.prototype.charCodeAt;
const StringPrototypeLastIndexOf = String.prototype.lastIndexOf;
const StringPrototypeSlice = String.prototype.slice;
const capturedRandomUUID = globalThis.crypto?.randomUUID?.bind(globalThis.crypto);
const capturedUsesWindowsSeparators = (() => {
  if (isDeno) {
    const deno = Reflect.get(globalThis, "Deno") as typeof Deno | undefined;
    return deno?.build?.os === "windows";
  }
  if (!isNode && !isBun) return false;
  const process = Reflect.get(globalThis, "process") as { platform?: string } | undefined;
  return process?.platform === "win32";
})();

function createDataDescriptor<T>(
  value: T,
  enumerable: boolean,
): PropertyDescriptor {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = false;
  descriptor.enumerable = enumerable;
  descriptor.value = value;
  descriptor.writable = false;
  return descriptor;
}

function hasOwnDataValue(
  value: object,
  key: PropertyKey,
  expected: unknown,
): boolean {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined &&
    reflectApply(hasOwnProperty, descriptor, ["value"]) === true &&
    descriptor.value === expected;
}

function getByteLength(value: Uint8Array): number {
  if (!Uint8ArrayByteLengthGet) throw new TypeError("Uint8Array byteLength accessor unavailable");
  return reflectApply(Uint8ArrayByteLengthGet, value, []) as number;
}

function createByteWriteView(value: Uint8Array, offset: number): Uint8Array {
  if (!Uint8ArrayBufferGet || !Uint8ArrayByteOffsetGet) {
    throw new TypeError("Uint8Array buffer accessors unavailable");
  }
  const buffer = reflectApply(Uint8ArrayBufferGet, value, []) as ArrayBufferLike;
  const byteOffset = reflectApply(Uint8ArrayByteOffsetGet, value, []) as number;
  const byteLength = getByteLength(value);
  const view = new NativeUint8Array(buffer, byteOffset + offset, byteLength - offset);
  // Node's native fs.write wrapper reads these properties before entering the
  // binding. Keep mutable typed-array getters away from confidential chunks.
  void defineProperty(view, "buffer", createDataDescriptor(buffer, false));
  void defineProperty(view, "byteOffset", createDataDescriptor(byteOffset + offset, false));
  void defineProperty(view, "byteLength", createDataDescriptor(byteLength - offset, false));
  return view;
}

function stringLastIndexOf(value: string, search: string): number {
  return reflectApply(StringPrototypeLastIndexOf, value, [search]) as number;
}

function stringSlice(value: string, start: number, end?: number): string {
  return reflectApply(
    StringPrototypeSlice,
    value,
    end === undefined ? [start] : [start, end],
  ) as string;
}

function stringCharCodeAt(value: string, index: number): number {
  return reflectApply(StringPrototypeCharCodeAt, value, [index]) as number;
}

function isHexAt(value: string, index: number): boolean {
  const code = stringCharCodeAt(value, index);
  return (code >= 48 && code <= 57) || (code >= 97 && code <= 102) ||
    (code >= 65 && code <= 70);
}

function isCapturedUuid(value: string): boolean {
  if (value.length !== 36) return false;
  for (let index = 0; index < value.length; index++) {
    if (index === 8 || index === 13 || index === 18 || index === 23) {
      if (stringCharCodeAt(value, index) !== 45) return false;
      continue;
    }
    if (index === 14) {
      if (stringCharCodeAt(value, index) !== 52) return false;
      continue;
    }
    if (index === 19) {
      const code = stringCharCodeAt(value, index);
      if (code !== 56 && code !== 57 && code !== 97 && code !== 98 && code !== 65 && code !== 66) {
        return false;
      }
      continue;
    }
    if (!isHexAt(value, index)) return false;
  }
  return true;
}

function createPrivateStreamPath(path: string): string {
  if (!capturedRandomUUID) throw new Error("Secure random UUID capability unavailable");
  const nonce = capturedRandomUUID();
  if (!isCapturedUuid(nonce)) throw new Error("Invalid private stream nonce");
  const slashIndex = stringLastIndexOf(path, "/");
  const backslashIndex = capturedUsesWindowsSeparators ? stringLastIndexOf(path, "\\") : -1;
  const separatorIndex = slashIndex > backslashIndex ? slashIndex : backslashIndex;
  if (separatorIndex < 0) return `.vf-download-${nonce}`;
  return `${stringSlice(path, 0, separatorIndex + 1)}.vf-download-${nonce}`;
}

async function writeStreamAtomic(
  path: string,
  source: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<number> {
  signal?.throwIfAborted();
  const temporaryPath = createPrivateStreamPath(path);
  let created = false;
  try {
    const bytes = await writeStreamExclusive(
      source,
      signal,
      () => openNativeStreamFile(temporaryPath),
      () => removeNativeStreamFile(temporaryPath),
    );
    created = true;
    signal?.throwIfAborted();
    await renameNativeStreamFile(temporaryPath, path);
    created = false;
    return bytes;
  } finally {
    if (created) await removeNativeStreamFile(temporaryPath);
  }
}

function bindNativePromiseConstructor<T>(promise: Promise<T>): Promise<T> {
  void defineProperty(promise, "constructor", createDataDescriptor(NativePromise, false));
  void defineProperty(promise, "then", createDataDescriptor(NativePromiseThen, false));
  return promise;
}

function resolveNativePromise(): Promise<void> {
  return bindNativePromiseConstructor(
    reflectApply(NativePromiseResolve, NativePromise, []) as Promise<void>,
  );
}

function observeNativePromise(promise: Promise<unknown>): Promise<void> {
  const observed = new NativePromise<void>((resolve, reject) => {
    void reflectApply(NativePromiseThen, bindNativePromiseConstructor(promise), [
      () => resolve(),
      reject,
    ]);
  });
  return bindNativePromiseConstructor(observed);
}

function observeCancellation(promise: Promise<unknown>): Promise<void> {
  const observed = new NativePromise<void>((resolve) => {
    const settle = () => resolve();
    void reflectApply(NativePromiseThen, bindNativePromiseConstructor(promise), [settle, settle]);
  });
  return bindNativePromiseConstructor(observed);
}

/** Stable native identity for one filesystem object. */
export interface PathIdentity {
  readonly device: string;
  readonly inode: string;
}

function isUnsupportedChmodError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "NotSupported") return true;

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && UNSUPPORTED_CHMOD_ERROR_CODES.has(code);
}

function normalizePathIdentity(
  device: number | bigint | null,
  inode: number | bigint | null,
): PathIdentity | undefined {
  const isValidPart = (value: number | bigint | null): value is number | bigint =>
    (typeof value === "bigint" && value >= 0n) ||
    (typeof value === "number" && Number.isSafeInteger(value) && value >= 0);

  if (!isValidPart(device) || !isValidPart(inode)) return undefined;
  return Object.freeze({
    device: String(device),
    inode: String(inode),
  });
}

/**
 * Typed accessor for the Deno global.
 *
 * This is pure typing only — it reads no environment variables and performs no
 * side effects, so this module stays importable without `--allow-env`. It
 * exists to retire the `@ts-ignore` comments that were previously required to
 * access `Deno.*` APIs from runtime-agnostic compat code.
 */
function denoGlobal(): typeof Deno {
  return (globalThis as { Deno: typeof Deno }).Deno;
}

/**
 * Runtime-neutral filesystem contract.
 *
 * Operations reject filesystem failures. Callers that intentionally tolerate a
 * missing path can classify the rejection with {@link isNotFoundError}.
 */
export interface FileSystem {
  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  /** Exact bounded binary read; implementations must reject oversized files before materializing them. */
  readFileBytesWithinLimit?(path: string, byteLimit: number): Promise<Uint8Array>;
  readFileSnapshotWithinLimit?(
    path: string,
    containmentRoot: string,
    byteLimit: number,
  ): Promise<Uint8Array>;
  writeTextFile(path: string, data: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Create an exclusive file and stream bytes without buffering the complete input. */
  writeFileStream?(
    path: string,
    source: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<number>;
  /** Stream to a private sibling path, then atomically promote it over the target. */
  writeFileStreamAtomic?(
    path: string,
    source: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<number>;
  /** Promote a completed private stream file through captured host operations. */
  promoteStreamFile?(from: string, to: string): Promise<void>;
  /** Remove a private stream file through captured host operations. */
  removeStreamFile?(path: string): Promise<void>;
  createFileBytesExclusive?(path: string, data: Uint8Array): Promise<void>;
  /** Atomically replace a path when same-filesystem rename is supported. */
  rename?(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  lstat?(path: string): Promise<FileInfo>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(
    path: string,
  ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean; isSymlink?: boolean }>;
  /** Remove a path, rejecting when it does not exist. */
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Atomically create a unique directory beneath the operating-system temp root. */
  makeTempDir(options?: { prefix?: string }): Promise<string>;
  /** Change permissions, rejecting operational failures. */
  chmod(path: string, mode: number): Promise<void>;
  /** Update access and modification times, rejecting operational failures. */
  utime?(path: string, atime: Date, mtime: Date): Promise<void>;
}

interface NodeFsPromises {
  open(path: string, flags: "r" | "wx", mode?: number): Promise<{
    write(buffer: Uint8Array): Promise<{ bytesWritten: number }>;
    read(buffer: Uint8Array): Promise<{ bytesRead: number }>;
    close(): Promise<void>;
  }>;
  readFile(
    path: string,
    options?: { encoding?: string; flag?: string } | string,
  ): Promise<string | Uint8Array>;
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { encoding?: string; flag?: string } | string,
  ): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  access(path: string, mode?: number): Promise<void>;
  stat(path: string): Promise<{
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    size: number;
    mtime: Date;
  }>;
  lstat(path: string): Promise<{
    isFile(): boolean;
    isDirectory(): boolean;
    isSymbolicLink(): boolean;
    size: number;
    mtime: Date;
  }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<
    Array<{
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
      isSymbolicLink(): boolean;
    }>
  >;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  rmdir(path: string): Promise<void>;
  mkdtemp(prefix: string): Promise<string>;
  chmod(path: string, mode: number): Promise<void>;
  utimes(path: string, atime: Date, mtime: Date): Promise<void>;
}

class NodeFileSystem implements FileSystem {
  private fs?: NodeFsPromises;
  private os?: typeof import("node:os");
  private path?: typeof import("node:path");
  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (!isNode && !isBun) {
      throw toError(
        createError({
          type: "not_supported",
          message: "Node.js fs modules not available",
          feature: "Node.js",
        }),
      );
    }

    const modules = await primordialPromiseAll([
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
    ]);
    const fsModule = modules[0]!;
    const osModule = modules[1]!;
    const pathModule = modules[2]!;

    this.fs = fsModule as NodeFsPromises;
    this.os = osModule;
    this.path = pathModule;
    this.initialized = true;
  }

  private getFs(): NodeFsPromises {
    if (!this.fs) throw new Error("NodeFileSystem not initialized");
    return this.fs;
  }

  private getOs(): typeof import("node:os") {
    if (!this.os) throw new Error("NodeFileSystem not initialized");
    return this.os;
  }

  private getPath(): typeof import("node:path") {
    if (!this.path) throw new Error("NodeFileSystem not initialized");
    return this.path;
  }

  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return await (this.getFs().readFile(path, { encoding: "utf8" }) as Promise<string>);
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    return await (this.getFs().readFile(path) as Promise<Uint8Array>);
  }

  async readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    await this.ensureInitialized();
    return await readFileWithinLimit(async () => {
      const handle = await this.getFs().open(path, "r");
      return {
        close: () => handle.close(),
        read: async (buffer: Uint8Array) => (await handle.read(buffer)).bytesRead,
      };
    }, byteLimit);
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().writeFile(path, data, { encoding: "utf8" });
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().writeFile(path, data);
  }

  async writeFileStream(
    path: string,
    source: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<number> {
    return await writeStreamExclusive(
      source,
      signal,
      () => openNativeStreamFile(path),
      () => removeNativeStreamFile(path),
    );
  }

  async promoteStreamFile(from: string, to: string): Promise<void> {
    await renameNativeStreamFile(from, to);
  }

  async removeStreamFile(path: string): Promise<void> {
    await removeNativeStreamFile(path);
  }

  async rename(from: string, to: string): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().rename(from, to);
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    try {
      await this.getFs().access(path);
      return true;
    } catch (error: unknown) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  async stat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    const stat = await this.getFs().stat(path);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      isSymlink: stat.isSymbolicLink(),
      size: stat.size,
      mtime: stat.mtime,
    };
  }

  async lstat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    const stat = await this.getFs().lstat(path);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      isSymlink: stat.isSymbolicLink(),
      size: stat.size,
      mtime: stat.mtime,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().mkdir(path, { recursive: options?.recursive ?? false });
  }

  async *readDir(
    path: string,
  ): AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink?: boolean;
  }> {
    await this.ensureInitialized();
    const entries = await this.getFs().readdir(path, { withFileTypes: true });
    for (let index = 0; index < entries.length; index++) {
      const entry = entries[index]!;
      yield {
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
        isSymlink: entry.isSymbolicLink(),
      };
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.ensureInitialized();
    const recursive = options?.recursive ?? false;
    try {
      await this.getFs().rm(path, { recursive, force: false });
    } catch (error) {
      // Deno removes an empty directory without `recursive`; `node:fs` `rm`
      // refuses one, and refuses it with a different code on Node (ERR_FS_EISDIR)
      // than on Bun (EFAULT). Ask the filesystem instead of reading the code.
      if (recursive) throw error;
      const info = await primordialPromiseCatch(this.getFs().lstat(path), () => undefined);
      if (!info?.isDirectory()) throw error;
      await this.getFs().rmdir(path);
    }
  }

  async makeTempDir(options?: { prefix?: string }): Promise<string> {
    await this.ensureInitialized();
    const prefix = validateTempDirectoryPrefix(
      options?.prefix ?? DEFAULT_TEMP_DIRECTORY_PREFIX,
    );
    const tempRoot = this.getOs().tmpdir();
    const separator = this.getPath().sep;
    const tempRootPrefix = tempRoot.endsWith(separator) ? tempRoot : `${tempRoot}${separator}`;
    return await this.getFs().mkdtemp(`${tempRootPrefix}${prefix}`);
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.getFs().chmod(path, mode);
    } catch (error: unknown) {
      if (this.getOs().platform() === "win32" && isUnsupportedChmodError(error)) {
        return;
      }
      throw error;
    }
  }

  async utime(path: string, atime: Date, mtime: Date): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().utimes(path, atime, mtime);
  }
}

class DenoFileSystem implements FileSystem {
  readTextFile(path: string): Promise<string> {
    return denoGlobal().readTextFile(path);
  }

  readFile(path: string): Promise<Uint8Array> {
    return denoGlobal().readFile(path);
  }

  async readFileBytesWithinLimit(path: string, byteLimit: number): Promise<Uint8Array> {
    return await readFileWithinLimit(async () => {
      const file = await denoGlobal().open(path, { read: true });
      return {
        close: () => file.close(),
        read: (buffer: Uint8Array) => file.read(buffer),
      };
    }, byteLimit);
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    await denoGlobal().writeTextFile(path, data);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await denoGlobal().writeFile(path, data);
  }

  async writeFileStream(
    path: string,
    source: ReadableStream<Uint8Array>,
    signal?: AbortSignal,
  ): Promise<number> {
    return await writeStreamExclusive(
      source,
      signal,
      () => openNativeStreamFile(path),
      () => removeNativeStreamFile(path),
    );
  }

  async promoteStreamFile(from: string, to: string): Promise<void> {
    await renameNativeStreamFile(from, to);
  }

  async removeStreamFile(path: string): Promise<void> {
    await removeNativeStreamFile(path);
  }

  async rename(from: string, to: string): Promise<void> {
    await denoGlobal().rename(from, to);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await denoGlobal().stat(path);
      return true;
    } catch (error: unknown) {
      if (isNotFoundError(error)) return false;
      throw error;
    }
  }

  async stat(path: string): Promise<FileInfo> {
    const stat = await denoGlobal().stat(path);
    return {
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      isSymlink: stat.isSymlink,
      size: stat.size,
      mtime: stat.mtime,
    };
  }

  async lstat(path: string): Promise<FileInfo> {
    const stat = await denoGlobal().lstat(path);
    return {
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      isSymlink: stat.isSymlink,
      size: stat.size,
      mtime: stat.mtime,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    await denoGlobal().mkdir(path, { recursive: options?.recursive ?? false });
  }

  async *readDir(
    path: string,
  ): AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink?: boolean;
  }> {
    for await (const entry of denoGlobal().readDir(path)) {
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isSymlink: entry.isSymlink,
      };
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await denoGlobal().remove(path, { recursive: options?.recursive ?? false });
  }

  async makeTempDir(options?: { prefix?: string }): Promise<string> {
    const prefix = validateTempDirectoryPrefix(
      options?.prefix ?? DEFAULT_TEMP_DIRECTORY_PREFIX,
    );
    return await denoGlobal().makeTempDir({ prefix });
  }

  async chmod(path: string, mode: number): Promise<void> {
    try {
      await denoGlobal().chmod(path, mode);
    } catch (error: unknown) {
      if (denoGlobal().build.os === "windows" && isUnsupportedChmodError(error)) {
        return;
      }
      throw error;
    }
  }

  async utime(path: string, atime: Date, mtime: Date): Promise<void> {
    await denoGlobal().utime(path, atime, mtime);
  }
}

/** Create the runtime-native filesystem implementation. */
export function createFileSystem(): FileSystem {
  const fileSystem = isDeno ? new DenoFileSystem() : new NodeFileSystem();
  let semanticAdapter:
    | Promise<import("../adapters/base.ts").FileSystemAdapter>
    | undefined;
  const loadSemanticAdapter = () =>
    semanticAdapter ??= (async () => {
      if (isDeno) {
        const { DenoFileSystemAdapter } = await import(
          "../adapters/runtime/deno/filesystem-adapter.ts"
        );
        return new DenoFileSystemAdapter();
      }
      const { NodeCompatibleFileSystemAdapter } = await import(
        "../adapters/runtime/shared/node-filesystem-adapter.ts"
      );
      return new NodeCompatibleFileSystemAdapter();
    })();

  defineProperty(
    fileSystem,
    "readFileSnapshotWithinLimit",
    createDataDescriptor(
      async (
        path: string,
        containmentRoot: string,
        byteLimit: number,
      ) => {
        const snapshotReader = captureSnapshotReadCapability(
          await loadSemanticAdapter(),
          "Native filesystem adapter",
        );
        if (snapshotReader === undefined) {
          throw new DOMException(
            "Native filesystem adapter does not support snapshot reads",
            "NotSupportedError",
          );
        }
        return await snapshotReader.read(path, containmentRoot, byteLimit);
      },
      true,
    ),
  );
  defineProperty(
    fileSystem,
    "writeFileStreamAtomic",
    createDataDescriptor(writeStreamAtomic, true),
  );
  defineProperty(
    fileSystem,
    "createFileBytesExclusive",
    createDataDescriptor(
      async (path: string, content: Uint8Array) => {
        const exclusiveCreator = captureExclusiveCreateCapability(
          await loadSemanticAdapter(),
          "Native filesystem adapter",
        );
        if (exclusiveCreator === undefined) {
          throw new Error("Native filesystem adapter does not support exclusive creates");
        }
        await exclusiveCreator.create(path, content);
      },
      true,
    ),
  );
  return fileSystem;
}

let _fs: FileSystem | null = null;

function getFs(): FileSystem {
  _fs ??= createFileSystem();
  return _fs;
}

/** Read a file as text. */
export function readTextFile(path: string): Promise<string> {
  return getFs().readTextFile(path);
}

/** Read a file as bytes. */
export function readFile(path: string): Promise<Uint8Array> {
  return getFs().readFile(path);
}

/** Write text to a file. */
export function writeTextFile(path: string, data: string): Promise<void> {
  return getFs().writeTextFile(path, data);
}

/** Write bytes to a file. */
export function writeFile(path: string, data: Uint8Array): Promise<void> {
  return getFs().writeFile(path, data);
}

/** Return false for a missing path and propagate every other filesystem error. */
export function exists(path: string): Promise<boolean> {
  return getFs().exists(path);
}

/** Read file metadata. */
export function stat(path: string): Promise<FileInfo> {
  return getFs().stat(path);
}

/** Read file metadata without following a terminal symbolic link. */
export async function lstat(path: string): Promise<FileInfo> {
  if (isDeno) {
    const info = await denoGlobal().lstat(path);
    return {
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      size: info.size,
      mtime: info.mtime,
    };
  }

  const fs = await import("node:fs/promises");
  const info = await fs.lstat(path);
  return {
    isFile: info.isFile(),
    isDirectory: info.isDirectory(),
    isSymlink: info.isSymbolicLink(),
    size: info.size,
    mtime: info.mtime,
  };
}

/**
 * Read a path's native device/inode identity without following a terminal
 * symbolic link. Returns undefined only when the runtime cannot expose a
 * stable identity for the backing filesystem.
 */
export async function getPathIdentity(path: string): Promise<PathIdentity | undefined> {
  if (isDeno) {
    const info = await denoGlobal().lstat(path);
    return normalizePathIdentity(info.dev, info.ino);
  }

  const fs = await import("node:fs/promises");
  const info = await fs.lstat(path, { bigint: true });
  return normalizePathIdentity(info.dev, info.ino);
}

/** Create a directory. */
export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  return getFs().mkdir(path, options);
}

/** Remove a file or directory, rejecting when the path does not exist. */
export function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  return getFs().remove(path, options);
}

/** Read directory entries. */
export function readDir(
  path: string,
): AsyncIterable<{
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  isSymlink?: boolean;
}> {
  return getFs().readDir(path);
}

/** Atomically create a unique directory beneath the operating-system temp root. */
export function makeTempDir(options?: { prefix?: string }): Promise<string> {
  return getFs().makeTempDir(options);
}

/** Change file permissions, rejecting operational failures. */
export function chmod(path: string, mode: number): Promise<void> {
  return getFs().chmod(path, mode);
}

export async function symlink(target: string, path: string): Promise<void> {
  if (isDeno) {
    await denoGlobal().symlink(target, path);
    return;
  }

  const fs = await import("node:fs/promises");
  await fs.symlink(target, path);
}

/**
 * Resolve a path to its canonical absolute form, following symlinks.
 * Throws if the path does not exist. Useful for containment checks where a
 * symlink could otherwise escape an intended directory.
 */
export async function realPath(path: string): Promise<string> {
  if (isDeno) {
    return await denoGlobal().realPath(path);
  }

  const fs = await import("node:fs/promises");
  return await fs.realpath(path);
}

/** Error shape for is already exists. */
export function isAlreadyExistsError(error: unknown): boolean {
  if (typeof error !== "object" || error === null || isProxyWithoutHooks(error)) {
    return false;
  }

  try {
    const AlreadyExists = isDeno ? denoGlobal().errors.AlreadyExists : undefined;
    if (AlreadyExists && error instanceof AlreadyExists) return true;
    return hasOwnDataValue(error, "code", "EEXIST");
  } catch {
    return false;
  }
}

/** @internal Stream sequencing is exported only for focused backend regressions. */
export async function writeStreamExclusive(
  source: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  open: () => Promise<{ write(chunk: Uint8Array): Promise<number>; close(): void | Promise<void> }>,
  remove: () => Promise<void>,
): Promise<number> {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let closed = false;
  let failed = true;
  let bytes = 0;

  const closeHandle = (): Promise<void> => {
    if (!handle || closed) return resolveNativePromise();
    closed = true;
    const closing = reflectApply(NativePromiseResolve, NativePromise, [handle.close()]) as Promise<
      unknown
    >;
    return observeNativePromise(closing);
  };

  const cancelSource = async (): Promise<void> => {
    try {
      await observeCancellation(
        reflectApply(ReadableStreamCancel, source, [signal?.reason]) as Promise<void>,
      );
    } catch {
      await resolveNativePromise();
    }
  };

  const writeChunk = (chunk: Uint8Array): Promise<void> => {
    const writing = (async () => {
      signal?.throwIfAborted();
      const current = handle;
      if (!current) throw new Error("Upload file stream handle unavailable");
      let offset = 0;
      const byteLength = getByteLength(chunk);
      while (offset < byteLength) {
        signal?.throwIfAborted();
        const written = await bindNativePromiseConstructor(
          current.write(createByteWriteView(chunk, offset)), // NOSONAR: partial writes must be sequenced to preserve byte order and backpressure.
        );
        if (written <= 0) throw new Error("Upload file write made no progress");
        offset += written;
      }
      bytes += byteLength;
    })();
    return bindNativePromiseConstructor(writing);
  };

  let pipeStarted = false;
  try {
    signal?.throwIfAborted();
    handle = await bindNativePromiseConstructor(open());
    const sink = createObject(null) as UnderlyingSink<Uint8Array>;
    sink.write = writeChunk;
    sink.close = closeHandle;
    sink.abort = closeHandle;
    const options = createObject(null) as StreamPipeOptions;
    if (signal) options.signal = signal;
    const strategy = createObject(null) as QueuingStrategy<Uint8Array>;
    strategy.highWaterMark = 1;
    const writable = new NativeWritableStream<Uint8Array>(sink, strategy);
    try {
      pipeStarted = true;
      await bindNativePromiseConstructor(
        reflectApply(ReadableStreamPipeTo, source, [writable, options]) as Promise<void>,
      );
    } catch (error) {
      if (signal?.aborted && signal.reason instanceof Error) throw signal.reason;
      throw error;
    }
    failed = false;
    return bytes;
  } finally {
    if (failed) {
      if (!pipeStarted) await cancelSource();
      if (handle) {
        try {
          await closeHandle();
        } finally {
          await remove();
        }
      }
    }
  }
}
