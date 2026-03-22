import type {
  DirEntry,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  ResolveFileOptions,
  WatchOptions,
} from "../base.ts";
import type { ContextualFSAdapter, DirectoryEntry, FSAdapter } from "./veryfront/types.ts";

export interface ExtendedFileSystemAdapter extends FileSystemAdapter {
  getUnderlyingAdapter(): FSAdapter;
  getAdapterType(): string;
  isVeryfrontAdapter(): boolean;
  isMultiProjectMode(): boolean;
  isContextualMode(): boolean;
  setRequestToken(token: string): void;
  clearRequestToken(): void;
  setRequestBranch(branch: string | null): void;
  getRequestBranch(): string | null;
  clearRequestBranch(): void;
  setProductionMode(enabled: boolean, releaseId?: string | null): void;
  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ): Promise<T>;
  readFileBytes(path: string): Promise<Uint8Array>;
  readdir(path: string): Promise<DirectoryEntry[]>;
  shutdown(): Promise<void>;
}

export function isExtendedFSAdapter(fs: FileSystemAdapter): fs is ExtendedFileSystemAdapter {
  return "isVeryfrontAdapter" in fs && "getUnderlyingAdapter" in fs && "isMultiProjectMode" in fs;
}

/**
 * Virtual filesystem adapters that fetch files remotely (API, GitHub, etc.)
 * rather than reading from a local disk.
 */
const VIRTUAL_FS_ADAPTERS = new Set([
  "VeryfrontFSAdapter",
  "MultiProjectFSAdapter",
  "GitHubFSAdapter",
]);

/**
 * Check if the adapter is using a virtual filesystem (Veryfront API, GitHub, etc.)
 * Centralized predicate — use this instead of inline checks.
 */
export function isVirtualFilesystem(fs: FileSystemAdapter): boolean {
  if (!fs || typeof fs !== "object") return false;
  if (!isExtendedFSAdapter(fs)) return false;
  if (fs.isVeryfrontAdapter()) return true;
  return VIRTUAL_FS_ADAPTERS.has(fs.getAdapterType());
}

export class NotSupportedError extends Error {
  constructor(operation: string, adapterType?: string) {
    super(
      adapterType
        ? `Operation '${operation}' is not supported by ${adapterType}`
        : `Operation '${operation}' is not supported by this FSAdapter`,
    );
    this.name = "NotSupportedError";
  }
}

function isContextualAdapter(adapter: FSAdapter): adapter is ContextualFSAdapter {
  return "setRequestToken" in adapter || "runWithContext" in adapter;
}

export class FSAdapterWrapper implements ExtendedFileSystemAdapter {
  private readonly _fsAdapter: FSAdapter;

  constructor(fsAdapter: FSAdapter) {
    this._fsAdapter = fsAdapter;
  }

  getUnderlyingAdapter(): FSAdapter {
    return this._fsAdapter;
  }

  getAdapterType(): string {
    return this._fsAdapter.constructor.name;
  }

  isVeryfrontAdapter(): boolean {
    const name = this._fsAdapter.constructor.name;
    return name === "VeryfrontFSAdapter" || name === "MultiProjectFSAdapter";
  }

  private get adapterType(): string {
    return this._fsAdapter.constructor.name;
  }

  private get contextual(): ContextualFSAdapter {
    if (!isContextualAdapter(this._fsAdapter)) {
      throw new NotSupportedError("contextual operations", this.adapterType);
    }
    return this._fsAdapter;
  }

  private requireContextualMethod<K extends keyof ContextualFSAdapter>(
    operation: string,
    key: K,
  ): NonNullable<ContextualFSAdapter[K]> {
    const adapter = this.contextual;
    const method = adapter[key];
    if (!method) throw new NotSupportedError(operation, this.adapterType);
    return method as NonNullable<ContextualFSAdapter[K]>;
  }

  setRequestToken(token: string): void {
    this.requireContextualMethod("setRequestToken", "setRequestToken")(token);
  }

  clearRequestToken(): void {
    this.requireContextualMethod("clearRequestToken", "clearRequestToken")();
  }

  setRequestBranch(branch: string | null): void {
    this.requireContextualMethod("setRequestBranch", "setRequestBranch")(branch);
  }

  getRequestBranch(): string | null {
    return this.requireContextualMethod("getRequestBranch", "getRequestBranch")();
  }

  clearRequestBranch(): void {
    this.requireContextualMethod("clearRequestBranch", "clearRequestBranch")();
  }

  setProductionMode(enabled: boolean, releaseId?: string | null): void {
    this.requireContextualMethod("setProductionMode", "setProductionMode")(enabled, releaseId);
  }

  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
    options?: {
      productionMode?: boolean;
      releaseId?: string | null;
      branch?: string | null;
      environmentName?: string | null;
    },
  ): Promise<T> {
    return this.requireContextualMethod("runWithContext", "runWithContext")(
      projectSlug,
      token,
      fn,
      projectId,
      options,
    );
  }

  isMultiProjectMode(): boolean {
    return isContextualAdapter(this._fsAdapter) &&
      typeof this._fsAdapter.runWithContext === "function";
  }

  isContextualMode(): boolean {
    return isContextualAdapter(this._fsAdapter);
  }

  async readFile(path: string): Promise<string> {
    if (this._fsAdapter.readTextFile) return this._fsAdapter.readTextFile(path);

    const result = await this._fsAdapter.readFile(path);
    return typeof result === "string" ? result : new TextDecoder().decode(result);
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const result = await this._fsAdapter.readFile(path);
    return typeof result === "string" ? new TextEncoder().encode(result) : result;
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this._fsAdapter.writeFile) throw new NotSupportedError("writeFile", this.adapterType);
    await this._fsAdapter.writeFile(path, content);
  }

  exists(path: string): Promise<boolean> {
    return this._fsAdapter.exists(path);
  }

  private async getDirEntries(path: string): Promise<DirectoryEntry[]> {
    if (this._fsAdapter.readdir) {
      const result = this._fsAdapter.readdir(path);
      return result instanceof Promise ? await result : await Array.fromAsync(result);
    }

    if (this._fsAdapter.readDir) return await Array.fromAsync(this._fsAdapter.readDir(path));

    throw new NotSupportedError("readdir", this.adapterType);
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const entries = await this.getDirEntries(path);
    for (const entry of entries) {
      yield {
        name: entry.name,
        isFile: entry.isFile,
        isDirectory: entry.isDirectory,
        isSymlink: entry.isSymlink,
      };
    }
  }

  readdir(path: string): Promise<DirectoryEntry[]> {
    return this.getDirEntries(path);
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

  resolveFile(basePath: string, options?: ResolveFileOptions): Promise<string | null> {
    if (!this._fsAdapter.resolveFile) throw new NotSupportedError("resolveFile", this.adapterType);
    return this._fsAdapter.resolveFile(basePath, options);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this._fsAdapter.mkdir) throw new NotSupportedError("mkdir", this.adapterType);
    await this._fsAdapter.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this._fsAdapter.remove) throw new NotSupportedError("remove", this.adapterType);
    await this._fsAdapter.remove(path, options);
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw new NotSupportedError("makeTempDir", this.adapterType);
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw new NotSupportedError("watch", this.adapterType);
  }

  async shutdown(): Promise<void> {
    await this._fsAdapter.shutdown?.();
  }
}

export function wrapFSAdapter(fsAdapter: FSAdapter): ExtendedFileSystemAdapter {
  return new FSAdapterWrapper(fsAdapter);
}
