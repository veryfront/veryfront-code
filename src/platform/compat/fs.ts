import { isDeno } from "./runtime.ts";
import type { FileInfo } from "@veryfront/platform/adapters/base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

export interface FileSystem {
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
}

class DenoFileSystem implements FileSystem {
  async readTextFile(path: string): Promise<string> {
    return await Deno.readTextFile(path);
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    await Deno.writeTextFile(path, data);
  }

  async exists(path: string): Promise<boolean> {
    try {
      await Deno.stat(path);
      return true;
    } catch (_error) {
      return false;
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

  async readDir(
    path: string,
  ): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>> {
    const entries = [];
    for await (const entry of Deno.readDir(path)) {
      entries.push({
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
      });
    }
    return entries;
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    await Deno.remove(path, { recursive: options?.recursive ?? false });
  }
}

interface NodeFsPromises {
  readFile(path: string, encoding: string): Promise<string>;
  writeFile(path: string, data: string, encoding: string): Promise<void>;
  access(path: string): Promise<void>;
  stat(path: string): Promise<{
    isFile(): boolean;
    isDirectory(): boolean;
    size: number;
    mtime: Date;
  }>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readdir(path: string, options: { withFileTypes: true }): Promise<
    Array<{
      name: string;
      isFile(): boolean;
      isDirectory(): boolean;
    }>
  >;
  rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>;
  unlink(path: string): Promise<void>;
}

class NodeFileSystem implements FileSystem {
  private fs: NodeFsPromises | null = null;

  constructor() {
    this.initNodeModules();
  }

  private async initNodeModules() {
    try {
      this.fs = await import("node:fs/promises") as NodeFsPromises;
    } catch (_error) {
      throw toError(createError({
        type: "not_supported",
        message: "Node.js fs modules not available",
        feature: "Node.js",
      }));
    }
  }

  async readTextFile(path: string): Promise<string> {
    if (!this.fs) await this.initNodeModules();
    return await this.fs!.readFile(path, "utf8");
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    if (!this.fs) await this.initNodeModules();
    await this.fs!.writeFile(path, data, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    if (!this.fs) await this.initNodeModules();
    try {
      await this.fs!.access(path);
      return true;
    } catch (_error) {
      return false;
    }
  }

  async stat(path: string): Promise<FileInfo> {
    if (!this.fs) await this.initNodeModules();
    const stat = await this.fs!.stat(path);
    return {
      isFile: stat.isFile(),
      isDirectory: stat.isDirectory(),
      isSymlink: false, // Node.js stat doesn't track symlinks by default
      size: stat.size,
      mtime: stat.mtime,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fs) await this.initNodeModules();
    await this.fs!.mkdir(path, { recursive: options?.recursive ?? false });
  }

  async readDir(
    path: string,
  ): Promise<Array<{ name: string; isFile: boolean; isDirectory: boolean }>> {
    if (!this.fs) await this.initNodeModules();
    const entries = await this.fs!.readdir(path, { withFileTypes: true });
    return entries.map((entry: { name: string; isFile(): boolean; isDirectory(): boolean }) => ({
      name: entry.name,
      isFile: entry.isFile(),
      isDirectory: entry.isDirectory(),
    }));
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fs) await this.initNodeModules();
    if (options?.recursive) {
      await this.fs!.rm(path, { recursive: true, force: true });
    } else {
      await this.fs!.unlink(path);
    }
  }
}

export function createFileSystem() {
  if (isDeno) {
    return new DenoFileSystem();
  } else {
    return new NodeFileSystem();
  }
}
