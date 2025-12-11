import { dirname, join } from "../../../platform/compat/path-helper.ts";
import type { RuntimeAdapter } from "@veryfront/platform/adapters/base.ts";
import type { CachePayload, CacheStore } from "../types.ts";

export interface FilesystemCacheStoreOptions {
  baseDir: string;
  adapter: RuntimeAdapter;
}

export class FilesystemCacheStore implements CacheStore {
  private baseDir: string;
  private adapter: RuntimeAdapter;

  constructor(options: FilesystemCacheStoreOptions) {
    this.baseDir = options.baseDir;
    this.adapter = options.adapter;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    try {
      const file = await this.readFileForKey(key);
      if (!file) return undefined;
      return JSON.parse(file) as CachePayload;
    } catch {
      return undefined;
    }
  }

  async set(key: string, value: CachePayload): Promise<void> {
    const filePath = this.filePathForKey(key);
    await this.ensureDir(dirname(filePath));
    await this.adapter.fs.writeFile(filePath, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    const filePath = this.filePathForKey(key);
    try {
      await this.adapter.fs.remove(filePath);
    } catch {
    }
  }

  async clear(): Promise<void> {
    try {
      await this.adapter.fs.remove(this.baseDir, { recursive: true });
    } catch {
    }
  }

  async destroy(): Promise<void> {
    await this.clear();
  }

  private filePathForKey(key: string): string {
    const safe = encodeURIComponent(key);
    return join(this.baseDir, `${safe}.json`);
  }

  private async ensureDir(path: string): Promise<void> {
    try {
      await this.adapter.fs.mkdir(path, { recursive: true });
    } catch (error) {
      if ((error as Error).message?.includes("exists")) return;
    }
  }

  private async readFileForKey(key: string): Promise<string | null> {
    const filePath = this.filePathForKey(key);
    try {
      return await this.adapter.fs.readFile(filePath);
    } catch {
      return null;
    }
  }
}
