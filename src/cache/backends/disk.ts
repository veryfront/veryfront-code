import { join } from "#veryfront/compat/path/index.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { logger } from "#veryfront/utils";
import type { CacheBackend } from "../types.ts";

const CACHE_SUBDIR = "veryfront-files";
const fsPromises = import("node:fs/promises");

interface DiskCacheEnvelope {
  key: string;
  value: string;
  expiresAt?: number;
}

function hashKey(input: string): string {
  const seeds = [0x811c9dc5, 0x6c62272e, 0x2e726c6f, 0x636f6465];
  return seeds
    .map((seed) => {
      let h = seed;
      for (let i = 0; i < input.length; i++) {
        h ^= input.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
      }
      return (h >>> 0).toString(16).padStart(8, "0");
    })
    .join("");
}

export class DiskCacheBackend implements CacheBackend {
  readonly type = "disk" as const;
  private dir: string;
  private regexCache = new Map<string, RegExp>();

  constructor(baseDir?: string) {
    this.dir = join(baseDir ?? getCacheBaseDir(), CACHE_SUBDIR);
  }

  private filePath(key: string): string {
    return join(this.dir, `${hashKey(key)}.json`);
  }

  private async ensureDir(): Promise<void> {
    const { mkdir } = await fsPromises;
    await mkdir(this.dir, { recursive: true });
  }

  async get(key: string): Promise<string | null> {
    try {
      const { readFile } = await fsPromises;
      const raw = await readFile(this.filePath(key), "utf-8");
      const envelope: DiskCacheEnvelope = JSON.parse(raw);
      if (envelope.key !== key) return null;
      if (envelope.expiresAt != null && Date.now() > envelope.expiresAt) {
        this.del(key).catch(() => {});
        return null;
      }
      return envelope.value;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    await this.ensureDir();
    const envelope: DiskCacheEnvelope = {
      key,
      value,
      expiresAt: ttlSeconds != null ? Date.now() + ttlSeconds * 1000 : undefined,
    };
    const filePath = this.filePath(key);
    const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
    const content = JSON.stringify(envelope);
    const { writeFile, rename } = await fsPromises;
    try {
      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, filePath);
    } catch (error) {
      try {
        const { unlink } = await fsPromises;
        await unlink(tmpPath);
      } catch { /* ignore cleanup failure */ }
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      const { unlink } = await fsPromises;
      await unlink(this.filePath(key));
    } catch { /* File may not exist */ }
  }

  async delByPattern(pattern: string): Promise<number> {
    let regex = this.regexCache.get(pattern);
    if (!regex) {
      regex = new RegExp(`^${pattern.replace(/\*/g, ".*").replace(/\?/g, ".")}$`);
      if (this.regexCache.size >= 100) {
        const firstKey = this.regexCache.keys().next().value as string | undefined;
        if (firstKey) this.regexCache.delete(firstKey);
      }
      this.regexCache.set(pattern, regex);
    }
    let deleted = 0;
    try {
      const { readdir, readFile, unlink } = await fsPromises;
      const files = await readdir(this.dir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const filePath = join(this.dir, file);
          const raw = await readFile(filePath, "utf-8");
          const envelope: DiskCacheEnvelope = JSON.parse(raw);
          if (regex.test(envelope.key)) {
            await unlink(filePath);
            deleted++;
          }
        } catch { /* Skip unreadable files */ }
      }
    } catch {
      logger.debug("[DiskCache] delByPattern: directory not accessible");
    }
    return deleted;
  }
}
