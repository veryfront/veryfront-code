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
import { isBun, isDeno, isNode } from "./runtime.ts";

/**
 * Cross-platform filesystem interface for CLI commands and standalone utilities.
 * Compatible with RuntimeAdapter.fs (FileSystemAdapter) for easy interoperability.
 */
export interface FileSystem {
  readTextFile(path: string): Promise<string>;
  readFile(path: string): Promise<Uint8Array>; // Changed to Uint8Array for binary
  writeTextFile(path: string, data: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>; // Changed to Uint8Array for binary
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<FileInfo>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  readDir(path: string): AsyncIterable<{ name: string; isFile: boolean; isDirectory: boolean }>;
  remove(path: string, options?: { recursive?: boolean }): Promise<void>;
  makeTempDir(options?: { prefix?: string }): Promise<string>; // New for temp dirs
}

// ============================================================================
// Node.js Implementation
// ============================================================================

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

    // Bun supports Node.js fs modules, so allow both Node.js and Bun
    if (!isNode && !isBun) {
      throw toError(createError({
        type: "not_supported",
        message: "Node.js fs modules not available",
        feature: "Node.js",
      }));
    }

    // Use dynamic ESM imports for Node.js modules
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
    // Node.js fs.rm requires force for recursive deletion of non-empty directories
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

// ============================================================================
// Deno Implementation
// ============================================================================

class DenoFileSystem implements FileSystem {
  async readTextFile(path: string): Promise<string> {
    // @ts-ignore - Deno global
    return await Deno.readTextFile(path);
  }

  async readFile(path: string): Promise<Uint8Array> {
    // @ts-ignore - Deno global
    return await Deno.readFile(path);
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
      if (error instanceof Deno.errors.NotFound) {
        return false;
      }
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
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
      };
    }
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    // @ts-ignore - Deno global
    await Deno.remove(path, { recursive: options?.recursive ?? false });
  }

  async makeTempDir(options?: { prefix?: string }): Promise<string> {
    // @ts-ignore - Deno global
    return await Deno.makeTempDir({ prefix: options?.prefix });
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
  // Node.js or Bun falls through to NodeFileSystem
  return isDeno ? new DenoFileSystem() : new NodeFileSystem();
}
