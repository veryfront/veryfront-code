import type { FileInfo } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import { isBun, isDeno, isNode } from "./runtime.ts";
import { createNodeTempDirectory, validateTempDirectoryPrefix } from "./temp-dir.ts";

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

/** Public API contract for file system. */
export interface FileSystem {
  /** Read a UTF-8 text file. */
  readTextFile(path: string): Promise<string>;
  /** Read a file as bytes. */
  readFile(path: string): Promise<Uint8Array>;
  /** Write a UTF-8 text file, replacing an existing file. */
  writeTextFile(path: string, data: string): Promise<void>;
  /** Write bytes to a file, replacing an existing file. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /** Return whether a path exists. */
  exists(path: string): Promise<boolean>;
  /** Read metadata while following a terminal symbolic link. */
  stat(path: string): Promise<FileInfo>;
  /** Read metadata without following a terminal symbolic link. */
  lstat?(path: string): Promise<FileInfo>;
  /** Resolve a path to its canonical absolute form. */
  realPath?(path: string): Promise<string>;
  /** Create a symbolic link. */
  symlink?(target: string, path: string): Promise<void>;
  /** Atomically rename a path when the filesystem supports it. */
  rename?(oldPath: string, newPath: string): Promise<void>;
  /** Create a directory. */
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Iterate over the immediate entries in a directory. */
  readDir(
    path: string,
  ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean; isSymlink?: boolean }>;
  /** Remove a file or directory. */
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  /** Create a uniquely named temporary directory. */
  makeTempDir(options?: { prefix?: string }): Promise<string>;
  /** Change file permissions. */
  chmod(path: string, mode: number): Promise<void>;
}

interface NodeFsPromises {
  readFile(
    path: string,
    options?: { encoding?: string; flag?: string } | string,
  ): Promise<string | Uint8Array>;
  writeFile(
    path: string,
    data: string | Uint8Array,
    options?: { encoding?: string; flag?: string } | string,
  ): Promise<void>;
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
  realpath(path: string): Promise<string>;
  symlink(target: string, path: string): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
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
  chmod(path: string, mode: number): Promise<void>;
}

class NodeFileSystem implements FileSystem {
  private fs?: NodeFsPromises;
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

    const fsModule = await import("node:fs/promises");

    this.fs = fsModule as unknown as NodeFsPromises;
    this.initialized = true;
  }

  private getFs(): NodeFsPromises {
    if (!this.fs) throw new Error("NodeFileSystem not initialized");
    return this.fs;
  }

  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.getFs().readFile(path, { encoding: "utf8" }) as Promise<string>;
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    return this.getFs().readFile(path) as Promise<Uint8Array>;
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().writeFile(path, data, { encoding: "utf8" });
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().writeFile(path, data);
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

  async realPath(path: string): Promise<string> {
    await this.ensureInitialized();
    return await this.getFs().realpath(path);
  }

  async symlink(target: string, path: string): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().symlink(target, path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().rename(oldPath, newPath);
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
    for (const entry of entries) {
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
    await this.getFs().rm(path, { recursive, force: false });
  }

  async makeTempDir(options?: { prefix?: string }): Promise<string> {
    return await createNodeTempDirectory(options?.prefix ?? "tmp-");
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.ensureInitialized();
    await this.getFs().chmod(path, mode);
  }
}

class DenoFileSystem implements FileSystem {
  readTextFile(path: string): Promise<string> {
    return denoGlobal().readTextFile(path);
  }

  readFile(path: string): Promise<Uint8Array> {
    return denoGlobal().readFile(path);
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    await denoGlobal().writeTextFile(path, data);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await denoGlobal().writeFile(path, data);
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

  realPath(path: string): Promise<string> {
    return denoGlobal().realPath(path);
  }

  async symlink(target: string, path: string): Promise<void> {
    await denoGlobal().symlink(target, path);
  }

  async rename(oldPath: string, newPath: string): Promise<void> {
    await denoGlobal().rename(oldPath, newPath);
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
    const prefix = options?.prefix ?? "tmp-";
    validateTempDirectoryPrefix(prefix);
    return await denoGlobal().makeTempDir({ prefix });
  }

  async chmod(path: string, mode: number): Promise<void> {
    await denoGlobal().chmod(path, mode);
  }
}

/**
 * Create a filesystem implementation for the active runtime.
 *
 * Deno uses its native filesystem APIs. Node.js and Bun use the Node
 * filesystem compatibility layer, which loads filesystem modules lazily.
 */
export function createFileSystem(): FileSystem {
  return isDeno ? new DenoFileSystem() : new NodeFileSystem();
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

/** Check whether a path exists. */
export function exists(path: string): Promise<boolean> {
  return getFs().exists(path);
}

/** Read file metadata. */
export function stat(path: string): Promise<FileInfo> {
  return getFs().stat(path);
}

/** Read file metadata without following a terminal symbolic link. */
export async function lstat(path: string): Promise<FileInfo> {
  const fs = getFs();
  if (!fs.lstat) throw unsupportedFileSystemOperation("lstat");
  return await fs.lstat(path);
}

/** Create a directory. */
export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  return getFs().mkdir(path, options);
}

/** Remove a file or directory. */
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

/** Create a uniquely named directory under the runtime's temporary directory. */
export function makeTempDir(options?: { prefix?: string }): Promise<string> {
  return getFs().makeTempDir(options);
}

/** Change file permissions. */
export function chmod(path: string, mode: number): Promise<void> {
  return getFs().chmod(path, mode);
}

/** Create a symbolic link at `path` that points to `target`. */
export async function symlink(target: string, path: string): Promise<void> {
  const fs = getFs();
  if (!fs.symlink) throw unsupportedFileSystemOperation("symlink");
  await fs.symlink(target, path);
}

/** Atomically replace a path when the runtime supports same-filesystem rename. */
export async function rename(oldPath: string, newPath: string): Promise<void> {
  const fs = getFs();
  if (!fs.rename) throw unsupportedFileSystemOperation("rename");
  await fs.rename(oldPath, newPath);
}

/**
 * Resolve a path to its canonical absolute form, following symlinks.
 * Throws if the path does not exist. Useful for containment checks where a
 * symlink could otherwise escape an intended directory.
 */
export async function realPath(path: string): Promise<string> {
  const fs = getFs();
  if (!fs.realPath) throw unsupportedFileSystemOperation("realPath");
  return await fs.realPath(path);
}

function unsupportedFileSystemOperation(operation: string): Error {
  return toError(
    createError({
      type: "not_supported",
      message: `File system operation ${operation} is not available`,
      feature: operation,
    }),
  );
}

type DenoGlobal = typeof globalThis & {
  Deno?: {
    errors?: {
      NotFound?: new (...args: unknown[]) => Error;
      NotADirectory?: new (...args: unknown[]) => Error;
      AlreadyExists?: new (...args: unknown[]) => Error;
    };
  };
};

/**
 * Return whether an unknown error represents a missing path.
 *
 * Recognizes native Deno errors, Node-compatible `ENOENT` and `ENOTDIR`
 * errors, Veryfront file-not-found errors, and matching errors in a cause
 * chain. Unreadable or cyclic error objects return `false`.
 */
export function isNotFoundError(error: unknown, seen: Set<unknown> = new Set()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);

  const NotFound = (globalThis as DenoGlobal).Deno?.errors?.NotFound;
  if (isDeno && NotFound && error instanceof NotFound) return true;
  const NotADirectory = (globalThis as DenoGlobal).Deno?.errors?.NotADirectory;
  if (isDeno && NotADirectory && error instanceof NotADirectory) return true;
  const code = getStringProperty(error, "code");
  if (code === "ENOENT" || code === "ENOTDIR") return true;
  if (
    getStringProperty(error, "name") === "VeryfrontError" &&
    getStringProperty(error, "slug") === "file-not-found"
  ) {
    return true;
  }

  const cause = getProperty(error, "cause");
  if (cause !== undefined) return isNotFoundError(cause, seen);

  return false;
}

/**
 * Return whether an unknown error reports that a filesystem entry already
 * exists, including matching errors in a cause chain.
 */
export function isAlreadyExistsError(error: unknown, seen: Set<unknown> = new Set()): boolean {
  if (seen.has(error)) return false;
  seen.add(error);

  const AlreadyExists = (globalThis as DenoGlobal).Deno?.errors?.AlreadyExists;
  if (isDeno && AlreadyExists && error instanceof AlreadyExists) return true;
  if (getStringProperty(error, "code") === "EEXIST") return true;
  const cause = getProperty(error, "cause");
  return cause === undefined ? false : isAlreadyExistsError(cause, seen);
}

function getProperty(value: unknown, property: string): unknown {
  if ((typeof value !== "object" && typeof value !== "function") || value === null) {
    return undefined;
  }
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

function getStringProperty(value: unknown, property: string): string | undefined {
  const candidate = getProperty(value, property);
  return typeof candidate === "string" ? candidate : undefined;
}
