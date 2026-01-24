import type { FileInfo } from "#veryfront/platform/adapters/base.ts";
import { createError, toError } from "../../errors/veryfront-error.ts";
import { isBun, isDeno, isNode } from "./runtime.ts";

export interface FileSystem {
  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>;
  writeTextFile(path: string, data: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
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

  async readTextFile(path: string): Promise<string> {
    await this.ensureInitialized();
    return this.fs!.readFile(path, { encoding: "utf8" }) as Promise<string>;
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    return this.fs!.readFile(path) as Promise<Uint8Array>;
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    await this.ensureInitialized();
    await this.fs!.writeFile(path, data, { encoding: "utf8" });
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.ensureInitialized();
    await this.fs!.writeFile(path, data);
  }

  async exists(path: string): Promise<boolean> {
    await this.ensureInitialized();
    try {
      await this.fs!.access(path);
      return true;
    } catch (error: any) {
      if (error?.code === "ENOENT") return false;
      throw error;
    }
  }

  async stat(path: string): Promise<FileInfo> {
    await this.ensureInitialized();
    const stat = await this.fs!.stat(path);
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
    await this.fs!.mkdir(path, { recursive: options?.recursive ?? false });
  }

  async *readDir(
    path: string,
  ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }> {
    await this.ensureInitialized();
    const entries = await this.fs!.readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      yield { name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() };
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.ensureInitialized();
    const recursive = options?.recursive ?? false;
    await this.fs!.rm(path, { recursive, force: recursive });
  }

  async makeTempDir(options?: { prefix?: string }): Promise<string> {
    await this.ensureInitialized();
    const tempDir = this.path!.join(
      this.os!.tmpdir(),
      `${options?.prefix ?? "tmp-"}${Math.random().toString(36).substring(2, 8)}`,
    );
    await this.fs!.mkdir(tempDir, { recursive: true });
    return tempDir;
  }

  async chmod(path: string, mode: number): Promise<void> {
    await this.ensureInitialized();
    try {
      await this.fs!.chmod(path, mode);
    } catch {
      // Ignore errors on Windows where chmod is not fully supported
    }
  }
}

class DenoFileSystem implements FileSystem {
  readTextFile(path: string): Promise<string> {
    // @ts-ignore - Deno global
    return Deno.readTextFile(path);
  }

  readFile(path: string): Promise<Uint8Array> {
    // @ts-ignore - Deno global
    return Deno.readFile(path);
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    // @ts-ignore - Deno global
    await Deno.writeTextFile(path, data);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    // @ts-ignore - Deno global
    await Deno.writeFile(path, data);
  }

  async exists(path: string): Promise<boolean> {
    try {
      // @ts-ignore - Deno global
      await Deno.stat(path);
      return true;
    } catch (error: any) {
      // @ts-ignore - Deno global
      if (error instanceof Deno.errors.NotFound) return false;
      throw error;
    }
  }

  async stat(path: string): Promise<FileInfo> {
    // @ts-ignore - Deno global
    const stat = await Deno.stat(path);
    return {
      isFile: stat.isFile,
      isDirectory: stat.isDirectory,
      isSymlink: stat.isSymlink,
      size: stat.size,
      mtime: stat.mtime,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    // @ts-ignore - Deno global
    await Deno.mkdir(path, { recursive: options?.recursive ?? false });
  }

  async *readDir(
    path: string,
  ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }> {
    // @ts-ignore - Deno global
    for await (const entry of Deno.readDir(path)) {
      yield { name: entry.name, isFile: entry.isFile, isDirectory: entry.isDirectory };
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    // @ts-ignore - Deno global
    await Deno.remove(path, { recursive: options?.recursive ?? false });
  }

  makeTempDir(options?: { prefix?: string }): Promise<string> {
    // @ts-ignore - Deno global
    return Deno.makeTempDir({ prefix: options?.prefix });
  }

  async chmod(path: string, mode: number): Promise<void> {
    try {
      // @ts-ignore - Deno global
      await Deno.chmod(path, mode);
    } catch {
      // Ignore errors on Windows where chmod is not fully supported
    }
  }
}

export function createFileSystem(): FileSystem {
  return isDeno ? new DenoFileSystem() : new NodeFileSystem();
}

let _fs: FileSystem | null = null;
function getFs(): FileSystem {
  _fs ??= createFileSystem();
  return _fs;
}

export function readTextFile(path: string): Promise<string> {
  return getFs().readTextFile(path);
}

export function readFile(path: string): Promise<Uint8Array> {
  return getFs().readFile(path);
}

export function writeTextFile(path: string, data: string): Promise<void> {
  return getFs().writeTextFile(path, data);
}

export function writeFile(path: string, data: Uint8Array): Promise<void> {
  return getFs().writeFile(path, data);
}

export function exists(path: string): Promise<boolean> {
  return getFs().exists(path);
}

export function stat(path: string): Promise<FileInfo> {
  return getFs().stat(path);
}

export function mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
  return getFs().mkdir(path, options);
}

export function remove(path: string, options?: { recursive?: boolean }): Promise<void> {
  return getFs().remove(path, options);
}

export function readDir(
  path: string,
): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }> {
  return getFs().readDir(path);
}

export function makeTempDir(options?: { prefix?: string }): Promise<string> {
  return getFs().makeTempDir(options);
}

export function chmod(path: string, mode: number): Promise<void> {
  return getFs().chmod(path, mode);
}

export async function symlink(target: string, path: string): Promise<void> {
  if (isDeno) {
    // @ts-ignore - Deno global
    await Deno.symlink(target, path);
    return;
  }

  const fs = await import("node:fs/promises");
  await fs.symlink(target, path);
}

export function isNotFoundError(error: unknown): boolean {
  if (isDeno && error instanceof (globalThis as any).Deno.errors.NotFound) return true;
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

export function isAlreadyExistsError(error: unknown): boolean {
  if (isDeno && error instanceof (globalThis as any).Deno.errors.AlreadyExists) return true;
  return (error as NodeJS.ErrnoException)?.code === "EEXIST";
}
