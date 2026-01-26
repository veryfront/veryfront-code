import { dirname, join } from "../../../platform/compat/path-helper.js";
import { getLocalAdapter } from "../../../platform/adapters/registry.js";
import type { RuntimeAdapter } from "../../../platform/adapters/base.js";
import { getErrorMessage } from "../../../errors/veryfront-error.js";
import type { CachePayload, CacheStore } from "../types.js";

export interface FilesystemCacheStoreOptions {
  baseDir: string;
}

export class FilesystemCacheStore implements CacheStore {
  private baseDir: string;
  private localAdapterPromise: Promise<RuntimeAdapter>;

  constructor(options: FilesystemCacheStoreOptions) {
    this.baseDir = options.baseDir;
    this.localAdapterPromise = getLocalAdapter();
  }

  private async getLocalFS() {
    const adapter = await this.localAdapterPromise;
    return adapter.fs;
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

    const fs = await this.getLocalFS();
    await fs.writeFile(filePath, JSON.stringify(value));
  }

  async delete(key: string): Promise<void> {
    const filePath = this.filePathForKey(key);

    try {
      const fs = await this.getLocalFS();
      await fs.remove(filePath);
    } catch {
      // ignore missing files
    }
  }

  async deleteByPrefix(prefix: string): Promise<number> {
    const fs = await this.getLocalFS();
    const encodedPrefix = encodeURIComponent(prefix);
    let deleted = 0;

    try {
      for await (const entry of fs.readDir(this.baseDir)) {
        if (!entry.isFile || !entry.name.endsWith(".json")) continue;
        if (!entry.name.startsWith(encodedPrefix)) continue;
        await fs.remove(join(this.baseDir, entry.name));
        deleted++;
      }
    } catch {
      // ignore missing dir or read errors
    }

    return deleted;
  }

  async clear(): Promise<void> {
    try {
      const fs = await this.getLocalFS();
      await fs.remove(this.baseDir, { recursive: true });
    } catch {
      // ignore
    }
  }

  async destroy(): Promise<void> {
    await this.clear();
  }

  private filePathForKey(key: string): string {
    return join(this.baseDir, `${encodeURIComponent(key)}.json`);
  }

  private async ensureDir(path: string): Promise<void> {
    try {
      const fs = await this.getLocalFS();
      await fs.mkdir(path, { recursive: true });
    } catch (error) {
      if (getErrorMessage(error).includes("exists")) return;
      throw error;
    }
  }

  private async readFileForKey(key: string): Promise<string | null> {
    const filePath = this.filePathForKey(key);

    try {
      const fs = await this.getLocalFS();
      return await fs.readFile(filePath);
    } catch {
      return null;
    }
  }
}
