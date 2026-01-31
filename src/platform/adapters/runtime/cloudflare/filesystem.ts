import { ConfigError, FileSystemError, NotSupportedError } from "#veryfront/errors";
import type {
  DirEntry,
  FileInfo,
  FileSystemAdapter,
  FileWatcher,
  WatchOptions,
} from "../../base.ts";
import type { KVNamespace } from "./types.ts";

export class CloudflareFileSystemAdapter implements FileSystemAdapter {
  constructor(private kvNamespace?: KVNamespace) {}

  private getKV(path: string): KVNamespace {
    const kv = this.kvNamespace;
    if (!kv) {
      throw new ConfigError("KV namespace required for file operations in Workers", { path });
    }
    return kv;
  }

  async readFile(path: string): Promise<string> {
    const kv = this.getKV(path);
    const content = await kv.get(path);
    if (content === null) throw new FileSystemError(`File not found: ${path}`, { path });
    return content;
  }

  async readFileBytes(path: string): Promise<Uint8Array> {
    const content = await this.readFile(path);
    return new TextEncoder().encode(content);
  }

  async writeFile(path: string, content: string): Promise<void> {
    const kv = this.getKV(path);
    await kv.put(path, content);
  }

  async exists(path: string): Promise<boolean> {
    const value = await this.kvNamespace?.get(path);
    return value != null;
  }

  async *readDir(path: string): AsyncIterable<DirEntry> {
    const kv = this.kvNamespace;
    if (!kv) return;

    const prefix = (path || "").replace(/\/$/, "");
    const list = await kv.list({ prefix });

    for (const key of list.keys) {
      const name = prefix ? key.name.slice(prefix.length + 1) : key.name;
      if (!name || name.includes("/")) continue;

      yield { name, isFile: true, isDirectory: false, isSymlink: false };
    }
  }

  async stat(path: string): Promise<FileInfo> {
    const kv = this.getKV(path);

    const { value } = await kv.getWithMetadata(path);
    if (value) {
      return {
        size: new TextEncoder().encode(value).length,
        isFile: true,
        isDirectory: false,
        isSymlink: false,
        mtime: null,
      };
    }

    const normalizedPath = path.replace(/\/$/, "") + "/";
    const list = await kv.list({ prefix: normalizedPath });
    if (list.keys.length > 0) {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
        mtime: null,
      };
    }

    const listAlt = await kv.list({ prefix: path });
    if (listAlt.keys.some((k) => k.name.startsWith(path + "/"))) {
      return {
        size: 0,
        isFile: false,
        isDirectory: true,
        isSymlink: false,
        mtime: null,
      };
    }

    throw new FileSystemError(`File not found: ${path}`, { path });
  }

  mkdir(_path: string, _options?: { recursive?: boolean }): Promise<void> {
    return Promise.resolve();
  }

  async remove(path: string, _options?: { recursive?: boolean }): Promise<void> {
    await this.kvNamespace?.delete(path);
  }

  makeTempDir(_prefix: string): Promise<string> {
    throw new NotSupportedError("Temporary directories not supported in Cloudflare Workers", {
      platform: "cloudflare",
      operation: "makeTempDir",
    });
  }

  watch(_paths: string | string[], _options?: WatchOptions): FileWatcher {
    throw new NotSupportedError("File watching not supported in Cloudflare Workers", {
      platform: "cloudflare",
      operation: "watch",
    });
  }
}
