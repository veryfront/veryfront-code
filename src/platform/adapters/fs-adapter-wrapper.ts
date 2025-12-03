import type { DirEntry, FileInfo, FileSystemAdapter, FileWatcher, WatchOptions } from "./base.ts";
import type { DirectoryEntry, FSAdapter } from "./veryfront-fs-adapter/types.ts";
import { logger } from "@veryfront/utils";

export class FSAdapterWrapper implements FileSystemAdapter {
  constructor(private fsAdapter: FSAdapter) {}

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

  async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
    if (!this.fsAdapter.mkdir) {
      logger.debug("[FSAdapterWrapper] mkdir not supported, skipping");
      return;
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
