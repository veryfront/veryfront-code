import type { DirEntry, FileInfo, FileSystemAdapter, FileWatcher, WatchOptions } from "./base.ts";
import type { DirectoryEntry, FSAdapter } from "./veryfront-fs-adapter/types.ts";

export class FSAdapterWrapper implements FileSystemAdapter {
  constructor(public readonly fsAdapter: FSAdapter) {}

  /**
   * Set a per-request token for API calls.
   * Only applies if the underlying FSAdapter supports it (e.g., VeryfrontFSAdapter).
   */
  setRequestToken(token: string): void {
    const adapter = this.fsAdapter as unknown as { setRequestToken?: (t: string) => void };
    if (typeof adapter.setRequestToken === "function") {
      adapter.setRequestToken(token);
    }
  }

  /**
   * Clear the per-request token.
   */
  clearRequestToken(): void {
    const adapter = this.fsAdapter as unknown as { clearRequestToken?: () => void };
    if (typeof adapter.clearRequestToken === "function") {
      adapter.clearRequestToken();
    }
  }

  /**
   * Set a per-request branch for file fetching.
   * Only applies if the underlying FSAdapter supports it (e.g., VeryfrontFSAdapter).
   */
  setRequestBranch(branch: string | null): void {
    const adapter = this.fsAdapter as unknown as { setRequestBranch?: (b: string | null) => void };
    if (typeof adapter.setRequestBranch === "function") {
      adapter.setRequestBranch(branch);
    }
  }

  /**
   * Get the current per-request branch.
   */
  getRequestBranch(): string | null {
    const adapter = this.fsAdapter as unknown as { getRequestBranch?: () => string | null };
    if (typeof adapter.getRequestBranch === "function") {
      return adapter.getRequestBranch();
    }
    return null;
  }

  /**
   * Clear the per-request branch.
   */
  clearRequestBranch(): void {
    const adapter = this.fsAdapter as unknown as { clearRequestBranch?: () => void };
    if (typeof adapter.clearRequestBranch === "function") {
      adapter.clearRequestBranch();
    }
  }

  /**
   * Set production mode for the adapter.
   * In production mode, adapters skip WebSocket connections and serve published content.
   * Only applies if the underlying FSAdapter supports it.
   */
  setProductionMode(enabled: boolean, releaseId?: string | null): void {
    const adapter = this.fsAdapter as unknown as {
      setProductionMode?: (enabled: boolean, releaseId?: string | null) => void;
    };
    if (typeof adapter.setProductionMode === "function") {
      adapter.setProductionMode(enabled, releaseId);
    }
  }

  /**
   * Run a function with the specified project context.
   * Only applies if the underlying FSAdapter supports it (e.g., MultiProjectFSAdapter).
   * For adapters that don't support this, the function runs directly.
   */
  runWithContext<T>(
    projectSlug: string,
    token: string,
    fn: () => Promise<T>,
    projectId?: string,
  ): Promise<T> {
    console.log("[FSAdapterWrapper] runWithContext called with:", {
      projectSlug,
      projectId: projectId || "(none)",
      hasToken: !!token,
    });
    const adapter = this.fsAdapter as unknown as {
      runWithContext?: <T>(slug: string, token: string, fn: () => Promise<T>, projectId?: string) => Promise<T>;
    };
    if (typeof adapter.runWithContext === "function") {
      return adapter.runWithContext(projectSlug, token, fn, projectId);
    }
    // Fallback: just run the function directly
    return fn();
  }

  /**
   * Check if the adapter supports multi-project mode.
   */
  isMultiProjectMode(): boolean {
    const adapter = this.fsAdapter as unknown as { runWithContext?: unknown };
    return typeof adapter.runWithContext === "function";
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
    if (this.fsAdapter.readFile) {
      const result = await this.fsAdapter.readFile(path);
      return typeof result === "string" ? new TextEncoder().encode(result) : result;
    }
    if (this.fsAdapter.readTextFile) {
      const text = await this.fsAdapter.readTextFile(path);
      return new TextEncoder().encode(text);
    }
    throw new NotSupportedError("readFile/readTextFile not supported by this FSAdapter");
  }

  async writeFile(path: string, content: string): Promise<void> {
    if (!this.fsAdapter.writeFile) {
      throw new NotSupportedError("writeFile not supported by this FSAdapter");
    }
    await this.fsAdapter.writeFile(path, content);
  }

  async exists(path: string): Promise<boolean> {
    return await this.fsAdapter.exists(path);
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    if (!this.fsAdapter.readdir && !this.fsAdapter.readDir) {
      throw new NotSupportedError("readdir/readDir not supported by this FSAdapter");
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

  async readdir(path: string) {
    if (!this.fsAdapter.readdir && !this.fsAdapter.readDir) {
      throw new NotSupportedError("readdir/readDir not supported by this FSAdapter");
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
    const adapter = this.fsAdapter as unknown as {
      resolveFile?: (path: string) => Promise<string | null>;
    };
    if (typeof adapter.resolveFile === "function") {
      return adapter.resolveFile(basePath);
    }
    return Promise.resolve(null);
  }

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fsAdapter.mkdir) {
      throw new NotSupportedError("mkdir not supported by this FSAdapter");
    }
    await this.fsAdapter.mkdir(path, options);
  }

  async remove(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fsAdapter.remove) {
      throw new NotSupportedError("remove not supported by this FSAdapter");
    }
    await this.fsAdapter.remove(path, options);
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw new NotSupportedError("makeTempDir not supported by FSAdapter (use local filesystem)");
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw new NotSupportedError("watch not supported by FSAdapter (use local filesystem)");
  }
}

export class NotSupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotSupportedError";
  }
}

export function wrapFSAdapter(fsAdapter: FSAdapter): FileSystemAdapter {
  return new FSAdapterWrapper(fsAdapter);
}
