import type { DirEntry, FileInfo, FileSystemAdapter, FileWatcher, WatchOptions } from "../base.ts";
import type { ContextualFSAdapter, DirectoryEntry, FSAdapter } from "./veryfront/types.ts";

/**
 * Extended FileSystemAdapter interface with wrapper-specific methods.
 * Use this type when you need access to the wrapper's introspection and contextual methods.
 */
export interface ExtendedFileSystemAdapter extends FileSystemAdapter {
  /** Get the underlying FSAdapter for adapter-specific functionality */
  getUnderlyingAdapter(): FSAdapter;

  /** Get the adapter type name (constructor name) for logging */
  getAdapterType(): string;

  /** Check if this is a Veryfront API adapter (single or multi-project) */
  isVeryfrontAdapter(): boolean;

  /** Check if the adapter supports multi-project mode */
  isMultiProjectMode(): boolean;

  /** Check if the adapter supports contextual operations (token, branch, etc.) */
  isContextualMode(): boolean;

  /** Set a per-request token for API calls */
  setRequestToken(token: string): void;

  /** Clear the per-request token */
  clearRequestToken(): void;

  /** Set a per-request branch for file fetching */
  setRequestBranch(branch: string | null): void;

  /** Get the current per-request branch */
  getRequestBranch(): string | null;

  /** Clear the per-request branch */
  clearRequestBranch(): void;

  /** Set production mode for the adapter */
  setProductionMode(enabled: boolean, releaseId?: string | null): void;

  /** Run a function with the specified project context */
  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: { productionMode?: boolean; releaseId?: string | null; branch?: string | null },
  ): Promise<T>;

  /** Read raw bytes when binary-safe access is required */
  readFileBytes(path: string): Promise<Uint8Array>;

  /** Read directory entries as an array */
  readdir(path: string): Promise<DirectoryEntry[]>;

  /** Shutdown the adapter and release resources */
  shutdown(): Promise<void>;
}

/**
 * Type guard to check if a FileSystemAdapter is an ExtendedFileSystemAdapter.
 */
export function isExtendedFSAdapter(fs: FileSystemAdapter): fs is ExtendedFileSystemAdapter {
  return "isVeryfrontAdapter" in fs &&
    "getUnderlyingAdapter" in fs &&
    "isMultiProjectMode" in fs;
}

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
 * Wraps an FSAdapter to implement the ExtendedFileSystemAdapter interface.
 * Provides a unified interface for all filesystem operations with additional
 * introspection and contextual methods.
 */
export class FSAdapterWrapper implements ExtendedFileSystemAdapter {
  private readonly _fsAdapter: FSAdapter;

  constructor(fsAdapter: FSAdapter) {
    this._fsAdapter = fsAdapter;
  }

  /**
   * Get the underlying FSAdapter.
   * Use this when you need direct access to adapter-specific functionality.
   */
  getUnderlyingAdapter(): FSAdapter {
    return this._fsAdapter;
  }

  /**
   * Get the adapter type name (constructor name).
   * Use this for logging and debugging, not for type checks.
   */
  getAdapterType(): string {
    return this._fsAdapter.constructor.name;
  }

  /**
   * Check if this is a Veryfront API adapter (single or multi-project).
   */
  isVeryfrontAdapter(): boolean {
    const name = this._fsAdapter.constructor.name;
    return name === "VeryfrontFSAdapter" || name === "MultiProjectFSAdapter";
  }

  /**
   * Set a per-request token for API calls.
   * Only applies if the underlying FSAdapter supports it.
   * @throws {NotSupportedError} if adapter doesn't support token management
   */
  setRequestToken(token: string): void {
    if (!isContextualAdapter(this._fsAdapter) || !this._fsAdapter.setRequestToken) {
      throw new NotSupportedError("setRequestToken", this._fsAdapter.constructor.name);
    }
    this._fsAdapter.setRequestToken(token);
  }

  /**
   * Clear the per-request token.
   * @throws {NotSupportedError} if adapter doesn't support token management
   */
  clearRequestToken(): void {
    if (!isContextualAdapter(this._fsAdapter) || !this._fsAdapter.clearRequestToken) {
      throw new NotSupportedError("clearRequestToken", this._fsAdapter.constructor.name);
    }
    this._fsAdapter.clearRequestToken();
  }

  /**
   * Set a per-request branch for file fetching.
   * @throws {NotSupportedError} if adapter doesn't support branch management
   */
  setRequestBranch(branch: string | null): void {
    if (!isContextualAdapter(this._fsAdapter) || !this._fsAdapter.setRequestBranch) {
      throw new NotSupportedError("setRequestBranch", this._fsAdapter.constructor.name);
    }
    this._fsAdapter.setRequestBranch(branch);
  }

  /**
   * Get the current per-request branch.
   * @throws {NotSupportedError} if adapter doesn't support branch management
   */
  getRequestBranch(): string | null {
    if (!isContextualAdapter(this._fsAdapter) || !this._fsAdapter.getRequestBranch) {
      throw new NotSupportedError("getRequestBranch", this._fsAdapter.constructor.name);
    }
    return this._fsAdapter.getRequestBranch();
  }

  /**
   * Clear the per-request branch.
   * @throws {NotSupportedError} if adapter doesn't support branch management
   */
  clearRequestBranch(): void {
    if (!isContextualAdapter(this._fsAdapter) || !this._fsAdapter.clearRequestBranch) {
      throw new NotSupportedError("clearRequestBranch", this._fsAdapter.constructor.name);
    }
    this._fsAdapter.clearRequestBranch();
  }

  /**
   * Set production mode for the adapter.
   * @throws {NotSupportedError} if adapter doesn't support production mode
   */
  setProductionMode(enabled: boolean, releaseId?: string | null): void {
    if (!isContextualAdapter(this._fsAdapter) || !this._fsAdapter.setProductionMode) {
      throw new NotSupportedError("setProductionMode", this._fsAdapter.constructor.name);
    }
    this._fsAdapter.setProductionMode(enabled, releaseId);
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
    options?: { productionMode?: boolean; releaseId?: string | null; branch?: string | null },
  ): Promise<T> {
    if (!isContextualAdapter(this._fsAdapter) || !this._fsAdapter.runWithContext) {
      throw new NotSupportedError("runWithContext", this._fsAdapter.constructor.name);
    }
    return this._fsAdapter.runWithContext(projectSlug, token, fn, projectId, options);
  }

  /**
   * Check if the adapter supports multi-project mode.
   */
  isMultiProjectMode(): boolean {
    return isContextualAdapter(this._fsAdapter) &&
      typeof this._fsAdapter.runWithContext === "function";
  }

  /**
   * Check if the adapter supports contextual operations (token, branch, etc.)
   */
  isContextualMode(): boolean {
    return isContextualAdapter(this._fsAdapter);
  }

  async readFile(path: string): Promise<string> {
    if (this._fsAdapter.readTextFile) {
      return await this._fsAdapter.readTextFile(path);
    }
    const result = await this._fsAdapter.readFile(path);
    if (typeof result === "string") {
      return result;
    }
    return new TextDecoder().decode(result);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const result = await this._fsAdapter.readFile(path);
    return typeof result === "string" ? new TextEncoder().encode(result) : result;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this._fsAdapter.writeFile) {
      throw new NotSupportedError("writeFile", this._fsAdapter.constructor.name);
    }
    await this._fsAdapter.writeFile(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return await this._fsAdapter.exists(path);
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    if (!this._fsAdapter.readdir && !this._fsAdapter.readDir) {
      throw new NotSupportedError("readDir", this._fsAdapter.constructor.name);
    }

    const entries = this._fsAdapter.readdir
      ? await this._fsAdapter.readdir(path)
      : this._fsAdapter.readDir
      ? await Array.fromAsync(this._fsAdapter.readDir(path))
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
    if (!this._fsAdapter.readdir && !this._fsAdapter.readDir) {
      throw new NotSupportedError("readdir", this._fsAdapter.constructor.name);
    }

    const entries = this._fsAdapter.readdir
      ? await this._fsAdapter.readdir(path)
      : this._fsAdapter.readDir
      ? await Array.fromAsync(this._fsAdapter.readDir(path))
      : [];

    return Array.isArray(entries)
      ? entries
      : await Array.fromAsync(entries as AsyncIterable<DirectoryEntry>);
  }

  async stat(path: string): Promise<FileInfo> {
    const info = await this._fsAdapter.stat(path);
    return {
      size: info.size,
      isFile: info.isFile,
      isDirectory: info.isDirectory,
      isSymlink: info.isSymlink,
      mtime: info.mtime,
    };
  }

  resolveFile(basePath: string): Promise<string | null> {
    if (!this._fsAdapter.resolveFile) {
      throw new NotSupportedError("resolveFile", this._fsAdapter.constructor.name);
    }
    return this._fsAdapter.resolveFile(basePath);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this._fsAdapter.mkdir) {
      throw new NotSupportedError("mkdir", this._fsAdapter.constructor.name);
    }
    await this._fsAdapter.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this._fsAdapter.remove) {
      throw new NotSupportedError("remove", this._fsAdapter.constructor.name);
    }
    await this._fsAdapter.remove(path, options);
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw new NotSupportedError("makeTempDir", this._fsAdapter.constructor.name);
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw new NotSupportedError("watch", this._fsAdapter.constructor.name);
  }

  async shutdown(): Promise<void> {
    if (this._fsAdapter.shutdown) {
      await this._fsAdapter.shutdown();
    }
  }
}

/**
 * Create an ExtendedFileSystemAdapter wrapper for an FSAdapter.
 */
export function wrapFSAdapter(fsAdapter: FSAdapter): ExtendedFileSystemAdapter {
  return new FSAdapterWrapper(fsAdapter);
}
