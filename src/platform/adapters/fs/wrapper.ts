import type { DirEntry, FileInfo, FileSystemAdapter, FileWatcher, WatchOptions } from "../base.ts";
import type { ContextualFSAdapter, DirectoryEntry, FSAdapter } from "./veryfront/types.ts";

/**
 * Error thrown when an operation is not supported by the underlying FSAdapter.
 */
export class NotSupportedError extends Error {
  constructor(operation: string, adapterType?: string) {
    const message = adapterType
      ? `Operation '${operation}' is not supported by ${adapterType}`
      : `Operation '${operation}' is not supported by this FSAdapter`;
    super(message);
    this.name = "NotSupportedError";
  }
}

/**
 * Type guard to check if adapter supports contextual operations.
 */
function isContextualAdapter(adapter: FSAdapter): adapter is ContextualFSAdapter {
  return "setRequestToken" in adapter || "runWithContext" in adapter;
}

/**
 * Wraps an FSAdapter to implement the FileSystemAdapter interface.
 * Provides a unified interface for all filesystem operations.
 */
export class FSAdapterWrapper implements FileSystemAdapter {
  constructor(public readonly fsAdapter: FSAdapter) {}

  /**
   * Set a per-request token for API calls.
   * Only applies if the underlying FSAdapter supports it.
   * @throws {NotSupportedError} if adapter doesn't support token management
   */
  setRequestToken(token: string): void {
    if (!isContextualAdapter(this.fsAdapter) || !this.fsAdapter.setRequestToken) {
      throw new NotSupportedError("setRequestToken", this.fsAdapter.constructor.name);
    }
    this.fsAdapter.setRequestToken(token);
  }

  /**
   * Clear the per-request token.
   * @throws {NotSupportedError} if adapter doesn't support token management
   */
  clearRequestToken(): void {
    if (!isContextualAdapter(this.fsAdapter) || !this.fsAdapter.clearRequestToken) {
      throw new NotSupportedError("clearRequestToken", this.fsAdapter.constructor.name);
    }
    this.fsAdapter.clearRequestToken();
  }

  /**
   * Set a per-request branch for file fetching.
   * @throws {NotSupportedError} if adapter doesn't support branch management
   */
  setRequestBranch(branch: string | null): void {
    if (!isContextualAdapter(this.fsAdapter) || !this.fsAdapter.setRequestBranch) {
      throw new NotSupportedError("setRequestBranch", this.fsAdapter.constructor.name);
    }
    this.fsAdapter.setRequestBranch(branch);
  }

  /**
   * Get the current per-request branch.
   * @throws {NotSupportedError} if adapter doesn't support branch management
   */
  getRequestBranch(): string | null {
    if (!isContextualAdapter(this.fsAdapter) || !this.fsAdapter.getRequestBranch) {
      throw new NotSupportedError("getRequestBranch", this.fsAdapter.constructor.name);
    }
    return this.fsAdapter.getRequestBranch();
  }

  /**
   * Clear the per-request branch.
   * @throws {NotSupportedError} if adapter doesn't support branch management
   */
  clearRequestBranch(): void {
    if (!isContextualAdapter(this.fsAdapter) || !this.fsAdapter.clearRequestBranch) {
      throw new NotSupportedError("clearRequestBranch", this.fsAdapter.constructor.name);
    }
    this.fsAdapter.clearRequestBranch();
  }

  /**
   * Set production mode for the adapter.
   * @throws {NotSupportedError} if adapter doesn't support production mode
   */
  setProductionMode(enabled: boolean, releaseId?: string | null): void {
    if (!isContextualAdapter(this.fsAdapter) || !this.fsAdapter.setProductionMode) {
      throw new NotSupportedError("setProductionMode", this.fsAdapter.constructor.name);
    }
    this.fsAdapter.setProductionMode(enabled, releaseId);
  }

  /**
   * Run a function with the specified project context.
   * @throws {NotSupportedError} if adapter doesn't support multi-project context
   */
  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: { productionMode?: boolean; releaseId?: string | null },
  ): Promise<T> {
    if (!isContextualAdapter(this.fsAdapter) || !this.fsAdapter.runWithContext) {
      throw new NotSupportedError("runWithContext", this.fsAdapter.constructor.name);
    }
    return this.fsAdapter.runWithContext(projectSlug, token, fn, projectId, options);
  }

  /**
   * Check if the adapter supports multi-project mode.
   */
  isMultiProjectMode(): boolean {
    return isContextualAdapter(this.fsAdapter) &&
      typeof this.fsAdapter.runWithContext === "function";
  }

  /**
   * Check if the adapter supports contextual operations (token, branch, etc.)
   */
  isContextualMode(): boolean {
    return isContextualAdapter(this.fsAdapter);
  }

  async readFile(path: string): Promise<string> {
    if (this.fsAdapter.readTextFile) {
      return await this.fsAdapter.readTextFile(path);
    }
    const result = await this.fsAdapter.readFile(path);
    if (typeof result === "string") {
      return result;
    }
    return new TextDecoder().decode(result);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const result = await this.fsAdapter.readFile(path);
    return typeof result === "string" ? new TextEncoder().encode(result) : result;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.fsAdapter.writeFile) {
      throw new NotSupportedError("writeFile", this.fsAdapter.constructor.name);
    }
    await this.fsAdapter.writeFile(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return await this.fsAdapter.exists(path);
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    if (!this.fsAdapter.readdir && !this.fsAdapter.readDir) {
      throw new NotSupportedError("readDir", this.fsAdapter.constructor.name);
    }

    const entries = this.fsAdapter.readdir
      ? await this.fsAdapter.readdir(path)
      : this.fsAdapter.readDir
      ? await Array.fromAsync(this.fsAdapter.readDir(path))
      : [];

    const entriesArray = Array.isArray(entries)
      ? entries
      : await Array.fromAsync(entries as AsyncIterable<DirectoryEntry>);

    for (const entry of entriesArray) {
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isSymlink: entry.isSymlink,
      };
    }
  }

  async readdir(path: string): Promise<DirectoryEntry[]> {
    if (!this.fsAdapter.readdir && !this.fsAdapter.readDir) {
      throw new NotSupportedError("readdir", this.fsAdapter.constructor.name);
    }

    const entries = this.fsAdapter.readdir
      ? await this.fsAdapter.readdir(path)
      : this.fsAdapter.readDir
      ? await Array.fromAsync(this.fsAdapter.readDir(path))
      : [];

    return Array.isArray(entries)
      ? entries
      : await Array.fromAsync(entries as AsyncIterable<DirectoryEntry>);
  }

  async stat(path: string): Promise<FileInfo> {
    const info = await this.fsAdapter.stat(path);
    return {
      size: info.size,
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      mtime: info.mtime,
    };
  }

  resolveFile(basePath: string): Promise<string | null> {
    if (!this.fsAdapter.resolveFile) {
      throw new NotSupportedError("resolveFile", this.fsAdapter.constructor.name);
    }
    return this.fsAdapter.resolveFile(basePath);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fsAdapter.mkdir) {
      throw new NotSupportedError("mkdir", this.fsAdapter.constructor.name);
    }
    await this.fsAdapter.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fsAdapter.remove) {
      throw new NotSupportedError("remove", this.fsAdapter.constructor.name);
    }
    await this.fsAdapter.remove(path, options);
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw new NotSupportedError("makeTempDir", this.fsAdapter.constructor.name);
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw new NotSupportedError("watch", this.fsAdapter.constructor.name);
  }

  async shutdown(): Promise<void> {
    if (this.fsAdapter.shutdown) {
      await this.fsAdapter.shutdown();
    }
  }
}

/**
 * Create a FileSystemAdapter wrapper for an FSAdapter.
 */
export function wrapFSAdapter(fsAdapter: FSAdapter): FileSystemAdapter {
  return new FSAdapterWrapper(fsAdapter);
}
