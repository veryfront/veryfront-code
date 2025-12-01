/**
 * Cross-platform filesystem abstraction for CLI commands and standalone utilities.
 *
 * This module provides a synchronous-style API for filesystem operations that works
 * across Deno, Node.js, and Bun runtimes. It's designed for CLI commands and scripts
 * where you don't have access to a RuntimeAdapter context.
 *
 * For server/rendering contexts where you have an adapter, prefer using adapter.fs directly:
 * ```ts
 * const adapter = await getAdapter();
 * const content = await adapter.fs.readFile(path);
 * ```
 *
 * For CLI commands and standalone utilities, use createFileSystem():
 * ```ts
 * import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
 * const fs = createFileSystem();
 * const content = await fs.readTextFile(path);
 * ```
 *
 * @module
 */

import type { FileInfo } from "@veryfront/platform/adapters/base.ts";
import { createError, toError } from "../../core/errors/veryfront-error.ts";

/**
 * Cross-platform filesystem interface for CLI commands and standalone utilities.
 * Compatible with RuntimeAdapter.fs (FileSystemAdapter) for easy interoperability.
 */
export interface FileSystem {
  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
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

  private async initNodeModules(): Promise<void> {
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

  async readFile(path: string): Promise<string> {
    return this.readTextFile(path);
  }

  async writeTextFile(path: string, data: string): Promise<void> {
    if (!this.fs) await this.initNodeModules();
    await this.fs!.writeFile(path, data, "utf8");
  }

  async writeFile(path: string, data: string): Promise<void> {
    return this.writeTextFile(path, data);
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
      isSymlink: false,
      size: stat.size,
      mtime: stat.mtime,
    };
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fs) await this.initNodeModules();
    await this.fs!.mkdir(path, { recursive: options?.recursive ?? false });
  }

  async *readDir(
    path: string,
  ): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }> {
    if (!this.fs) await this.initNodeModules();
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
    if (!this.fs) await this.initNodeModules();
    if (options?.recursive) {
      await this.fs!.rm(path, { recursive: true, force: true });
    } else {
      await this.fs!.unlink(path);
    }
  }
}

/**
 * Create a cross-platform filesystem instance for CLI commands and standalone utilities.
 *
 * Use this for CLI commands that don't have access to a RuntimeAdapter context:
 * ```ts
 * const fs = createFileSystem();
 * const content = await fs.readTextFile(path);
 * await fs.writeTextFile(outputPath, result);
 * ```
 *
 * For server/rendering contexts, prefer using adapter.fs directly.
 *
 * Note: For npm package, always uses Node.js fs APIs for cross-platform compatibility.
 */
export function createFileSystem(): FileSystem {
  // Always use NodeFileSystem for npm package compatibility
  // This avoids bundling Deno-specific code that would fail at runtime
  return new NodeFileSystem();
}
