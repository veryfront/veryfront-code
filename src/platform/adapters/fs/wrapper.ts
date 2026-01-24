import type { DirEntry, FileInfo, FileSystemAdapter, FileWatcher, WatchOptions } from "../base.ts";
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

  private get contextual(): ContextualFSAdapter {
    if (!isContextualAdapter(this._fsAdapter)) {
      throw new NotSupportedError("contextual operations", this._fsAdapter.constructor.name);
    }
    return this._fsAdapter;
  }

  setRequestToken(token: string): void {
    const adapter = this.contextual;
    if (!adapter.setRequestToken) {
      throw new NotSupportedError("setRequestToken", this._fsAdapter.constructor.name);
    }
    adapter.setRequestToken(token);
  }

  clearRequestToken(): void {
    const adapter = this.contextual;
    if (!adapter.clearRequestToken) {
      throw new NotSupportedError("clearRequestToken", this._fsAdapter.constructor.name);
    }
    adapter.clearRequestToken();
  }

  setRequestBranch(branch: string | null): void {
    const adapter = this.contextual;
    if (!adapter.setRequestBranch) {
      throw new NotSupportedError("setRequestBranch", this._fsAdapter.constructor.name);
    }
    adapter.setRequestBranch(branch);
  }

  getRequestBranch(): string | null {
    const adapter = this.contextual;
    if (!adapter.getRequestBranch) {
      throw new NotSupportedError("getRequestBranch", this._fsAdapter.constructor.name);
    }
    return adapter.getRequestBranch();
  }

  clearRequestBranch(): void {
    const adapter = this.contextual;
    if (!adapter.clearRequestBranch) {
      throw new NotSupportedError("clearRequestBranch", this._fsAdapter.constructor.name);
    }
    adapter.clearRequestBranch();
  }

  setProductionMode(enabled: boolean, releaseId?: string | null): void {
    const adapter = this.contextual;
    if (!adapter.setProductionMode) {
      throw new NotSupportedError("setProductionMode", this._fsAdapter.constructor.name);
    }
    adapter.setProductionMode(enabled, releaseId);
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
    const adapter = this.contextual;
    if (!adapter.runWithContext) {
      throw new NotSupportedError("runWithContext", this._fsAdapter.constructor.name);
    }
    return adapter.runWithContext(projectSlug, token, fn, projectId, options);
  }

  isMultiProjectMode(): boolean {
    return isContextualAdapter(this._fsAdapter) &&
      typeof this._fsAdapter.runWithContext === "function";
  }

  isContextualMode(): boolean {
    return isContextualAdapter(this._fsAdapter);
  }

  async readFile(path: string): Promise<string> {
    if (this._fsAdapter.readTextFile) {
      return this._fsAdapter.readTextFile(path);
    }

    const result = await this._fsAdapter.readFile(path);
    return typeof result === "string" ? result : new TextDecoder().decode(result);
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

  exists(path: string): Promise<boolean> {
    return this._fsAdapter.exists(path);
  }

  private async getDirEntries(path: string): Promise<DirectoryEntry[]> {
    if (this._fsAdapter.readdir) {
      const result = this._fsAdapter.readdir(path);
      if (result instanceof Promise) {
        return await result;
      }
      return await Array.fromAsync(result);
    }
    if (this._fsAdapter.readDir) {
      return await Array.fromAsync(this._fsAdapter.readDir(path));
    }
    throw new NotSupportedError("readdir", this._fsAdapter.constructor.name);
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
    await this._fsAdapter.shutdown?.();
  }
}

export function wrapFSAdapter(fsAdapter: FSAdapter): ExtendedFileSystemAdapter {
  return new FSAdapterWrapper(fsAdapter);
}
