import type { FileInfo } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "#veryfront/errors";
import { isBun, isDeno, isNode } from "./runtime.ts";

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
  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeTextFile(path: string, data: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  lstat?(path: string): Promise<FileInfo>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(
    path: string,
  ): AsyncIterable<{
    name: string;
    isFile: boolean;
    isDirectory: boolean;
    isSymlink?: boolean;
  }>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  makeTempDir(options?: { prefix?: string }): Promise<string>;
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

    const [fsModule, osModule, pathModule] = await Promise.all([
      import("node:fs/promises"),
      import("node:os"),
      import("node:path"),
    ]);

    this.fs = fsModule as unknown as NodeFsPromises;
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
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return false;
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
    isSymlink: boolean;
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
    await this.getFs().rm(path, { recursive, force: recursive });
  }

  async makeTempDir(options?: { prefix?: string }): Promise<string> {
    await this.ensureInitialized();
    const tempDir = this.getPath().join(
      this.getOs().tmpdir(),
      `${options?.prefix ?? "tmp-"}${crypto.randomUUID().slice(0, 8)}`,
    );
    await this.getFs().mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.getFs().chmod(path, mode);
    } catch {
      // Ignore errors on Windows where chmod is not fully supported.
      // Intentionally not logged: this low-level compat module must stay
      // importable without `--allow-env` (the logger reads env at import).
    }
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
      if (error instanceof denoGlobal().errors.NotFound) return false;
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
    isSymlink: boolean;
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

  makeTempDir(options?: { prefix?: string }): Promise<string> {
    return denoGlobal().makeTempDir({ prefix: options?.prefix });
  }

  async chmod(path: string, mode: number): Promise<void> {
    try {
      await denoGlobal().chmod(path, mode);
    } catch (_) {
      /* expected: chmod is not fully supported on Windows */
    }
  }
}

/** Create file system. */
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
): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }> {
  return getFs().readDir(path);
}

/** Create temp dir. */
export function makeTempDir(options?: { prefix?: string }): Promise<string> {
  return getFs().makeTempDir(options);
}

/** Change file permissions. */
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

type DenoGlobal = typeof globalThis & {
  Deno?: {
    errors?: {
      NotFound?: new (...args: unknown[]) => Error;
      AlreadyExists?: new (...args: unknown[]) => Error;
    };
  };
};

/** Error shape for is not found. */
export function isNotFoundError(error: unknown): boolean {
  const NotFound = (globalThis as DenoGlobal).Deno?.errors?.NotFound;
  if (isDeno && NotFound && error instanceof NotFound) return true;
  if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return true;
  if (
    error instanceof Error && error.name === "VeryfrontError" &&
    (error as { slug?: string }).slug === "file-not-found"
  ) {
    return true;
  }
  return false;
}

/** Error shape for is already exists. */
export function isAlreadyExistsError(error: unknown): boolean {
  const AlreadyExists = (globalThis as DenoGlobal).Deno?.errors?.AlreadyExists;
  if (isDeno && AlreadyExists && error instanceof AlreadyExists) return true;
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}
