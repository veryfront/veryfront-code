import { join } from "#veryfront/compat/path/index.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { logger } from "#veryfront/utils";
import type { CacheBackend } from "../types.ts";
import { type CacheGlob, compileCacheGlob } from "./glob.ts";

const CACHE_SUBDIR = "veryfront-files";
const MAX_GLOB_CACHE_SIZE = 100;
const fsPromises = import("node:fs/promises");

interface DiskCacheEnvelope {
  key: string;
  value: string;
  expiresAt?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDiskCacheEnvelope(value: unknown): DiskCacheEnvelope | null {
  if (!isRecord(value)) return null;
  if (typeof value.key !== "string") return null;
  if (typeof value.value !== "string") return null;
  if (
    value.expiresAt !== undefined &&
    (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt))
  ) {
    return null;
  }
  return {
    key: value.key,
    value: value.value,
    expiresAt: value.expiresAt,
  };
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
  private globCache = new Map<string, CacheGlob>();

  constructor(baseDir?: string, keyPrefix?: string) {
    const base = join(baseDir ?? getCacheBaseDir(), CACHE_SUBDIR);
    this.dir = keyPrefix ? join(base, keyPrefix) : base;
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
      const envelope = parseDiskCacheEnvelope(JSON.parse(raw));
      if (!envelope) return null;
      if (envelope.key !== key) {
        // The filename hash collided: this file belongs to a different key, so a
        // prior write for one of them silently overwrote the other's data. Surface
        // it (instead of a silent miss) so collisions are diagnosable in prod.
        logger.warn("[DiskCache] Filename hash collision; stored key does not match", {
          requestedKey: key.slice(-60),
          storedKey: envelope.key.slice(-60),
        });
        return null;
      }
      if (envelope.expiresAt != null && Date.now() > envelope.expiresAt) {
        this.del(key).catch((cleanupError) => {
          logger.debug("[DiskCache] Expired entry cleanup failed", {
            key: key.slice(-60),
            error: cleanupError,
          });
        });
        return null;
      }
      return envelope.value;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        logger.error("[DiskCache] Read error", {
          key: key.slice(-60),
          error: error instanceof Error ? error.message : String(error),
          code,
        });
      }
      return null;
    }
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    try {
      const { readFile } = await fsPromises;
      const envelope = parseDiskCacheEnvelope(
        JSON.parse(await readFile(this.filePath(key), "utf-8")),
      );
      if (!envelope || envelope.key !== key) return null;
      if (envelope.expiresAt == null) return Infinity;

      const remainingMs = envelope.expiresAt - Date.now();
      if (remainingMs <= 0) return null;
      return remainingMs / 1000;
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
    const tmpPath = `${filePath}.tmp.${Date.now()}.${crypto.randomUUID().slice(0, 8)}`;
    const content = JSON.stringify(envelope);
    const { writeFile, rename, unlink } = await fsPromises;
    try {
      await writeFile(tmpPath, content, "utf-8");
      await rename(tmpPath, filePath);
    } catch (error) {
      await unlink(tmpPath).catch((cleanupError) => {
        logger.debug("[DiskCache] Temp file cleanup failed", {
          key: key.slice(-60),
          tmpPath,
          error: cleanupError,
        });
      });
      throw error;
    }
  }

  async del(key: string): Promise<void> {
    try {
      const { unlink } = await fsPromises;
      await unlink(this.filePath(key));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        logger.error("[DiskCache] Delete error", {
          key: key.slice(-60),
          error: error instanceof Error ? error.message : String(error),
          code,
        });
      }
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    let glob = this.globCache.get(pattern);
    if (!glob) {
      glob = compileCacheGlob(pattern) ?? undefined;
      if (!glob) return 0;
      if (this.globCache.size >= MAX_GLOB_CACHE_SIZE) {
        const firstKey = this.globCache.keys().next().value as string | undefined;
        if (firstKey) this.globCache.delete(firstKey);
      }
      this.globCache.set(pattern, glob);
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
          const envelope = parseDiskCacheEnvelope(JSON.parse(raw));
          if (!envelope) {
            logger.error("[DiskCache] Skip invalid cache file", { file });
            continue;
          }
          if (glob.test(envelope.key)) {
            await unlink(filePath);
            deleted++;
          }
        } catch (error) {
          logger.error("[DiskCache] Skip unreadable cache file", {
            file,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } catch (error) {
      logger.error("[DiskCache] delByPattern: directory not accessible", {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    return deleted;
  }
}
