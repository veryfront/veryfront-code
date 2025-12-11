
import type { FileInfo } from "@veryfront/platform/adapters/base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";
import { isDeno, isNode } from "./runtime.ts";

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
}

class NodeFileSystem implements FileSystem {
  private fs: NodeFsPromises | null = null;
  private os: typeof import("node:os") | null = null;
  private path: typeof import("node:path") | null = null;
  private initialized = false;

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    if (!isNode) {
      throw toError(createError({
        type: "not_supported",
        message: "Node.js fs modules not available",
        feature: "Node.js",
      }));
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
    return await (this.fs!.readFile(path, { encoding: "utf8" }) as Promise<string>);
  }

  async readFile(path: string): Promise<Uint8Array> {
    await this.ensureInitialized();
    return await (this.fs!.readFile(path) as Promise<Uint8Array>);
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
      if (error.code === "ENOENT") {
        return false;
      }
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
      yield {
        name: entry.name,
        isFile: entry.isFile(),
        isDirectory: entry.isDirectory(),
      };
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await this.ensureInitialized();
    await this.fs!.rm(path, {
      recursive: options?.recursive ?? false,
      force: options?.recursive ?? false,
    });
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
}


class DenoFileSystem implements FileSystem {
  async readTextFile(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    return await Deno.readFile(path);
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    await Deno.writeTextFile(path, data);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await Deno.writeFile(path, data);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (error: any) {
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
      throw error;
    }
  }

  async stat(path: string): Promise<FileInfo> {
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
    await Deno.mkdir(path, { recursive: options?.recursive ?? false });
  }

  async *readDir(
    path: string,
  ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }> {
    for await (const entry of Deno.readDir(path)) {
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
      };
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await Deno.remove(path, { recursive: options?.recursive ?? false });
  }

  async makeTempDir(options?: { prefix?: string }): Promise<string> {
    return await Deno.makeTempDir({ prefix: options?.prefix });
  }
}

export function createFileSystem(): FileSystem {
  if (isDeno) {
    return new DenoFileSystem();
  } else {
    return new NodeFileSystem();
  }
}
