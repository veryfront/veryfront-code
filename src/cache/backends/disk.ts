import { join } from "#veryfront/compat/path/index.ts";
import { constants as fsConstants } from "node:fs";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { logger } from "#veryfront/utils";
import type { CacheBackend } from "../types.ts";
import { type CacheGlob, compileCacheGlob } from "./glob.ts";
import { CACHE_ERROR, INVALID_ARGUMENT, VeryfrontError } from "#veryfront/errors";
import { containsUnsafeCacheStringCharacter } from "../validation.ts";

const CACHE_SUBDIR = "veryfront-files";
const MAX_GLOB_CACHE_SIZE = 100;
const MAX_CACHE_KEY_LENGTH = 4096;
const MAX_CACHE_KEY_PREFIX_LENGTH = 512;
const MAX_CACHE_PATH_LENGTH = 4096;
const MAX_CACHE_VALUE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_ENVELOPE_BYTES = MAX_CACHE_VALUE_BYTES + 16 * 1024;
const MAX_CACHE_TTL_SECONDS = 365 * 24 * 60 * 60;
const valueEncoder = new TextEncoder();
const valueDecoder = new TextDecoder();
const fsPromises = import("node:fs/promises");
const SAFE_FILE_READ_FLAGS = fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0);

function invalidArgument(message: string): never {
  throw INVALID_ARGUMENT.create({ message });
}

function diskFailure(operation: string): never {
  throw CACHE_ERROR.create({ detail: `Disk cache ${operation} failed` });
}

function assertBoundedString(
  value: unknown,
  label: string,
  maxLength: number,
  allowEmpty = false,
): asserts value is string {
  if (
    typeof value !== "string" || (!allowEmpty && value.length === 0) ||
    value.length > maxLength || containsUnsafeCacheStringCharacter(value)
  ) {
    invalidArgument(
      `${label} must be a bounded string without control characters or unpaired UTF-16 surrogates`,
    );
  }
}

function assertCacheKey(key: unknown): asserts key is string {
  assertBoundedString(key, "Cache key", MAX_CACHE_KEY_LENGTH);
}

function normalizeTtl(ttlSeconds: unknown): number | undefined {
  if (ttlSeconds === undefined) return undefined;
  if (
    typeof ttlSeconds !== "number" || !Number.isFinite(ttlSeconds) || ttlSeconds < 0 ||
    ttlSeconds > MAX_CACHE_TTL_SECONDS
  ) {
    invalidArgument("Cache TTL must be a finite number within the supported range");
  }
  return ttlSeconds;
}

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
  private readonly rootDir: string;
  private readonly dir: string;
  private globCache = new Map<string, CacheGlob>();

  constructor(baseDir?: string, keyPrefix?: string) {
    const configuredBaseDir = baseDir ?? getCacheBaseDir();
    assertBoundedString(configuredBaseDir, "Disk cache base directory", MAX_CACHE_PATH_LENGTH);
    if (keyPrefix !== undefined) {
      assertBoundedString(keyPrefix, "Disk cache key prefix", MAX_CACHE_KEY_PREFIX_LENGTH);
    }
    const base = join(configuredBaseDir, CACHE_SUBDIR);
    this.rootDir = base;
    this.dir = keyPrefix ? join(base, `namespace-${hashKey(keyPrefix)}`) : base;
  }

  private filePath(key: string): string {
    return join(this.dir, `${hashKey(key)}.json`);
  }

  private async assertSafeDirectory(directory: string): Promise<void> {
    const { lstat } = await fsPromises;
    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      diskFailure("directory validation");
    }
  }

  private async assertSafeCacheDirectories(): Promise<void> {
    await this.assertSafeDirectory(this.rootDir);
    if (this.dir !== this.rootDir) await this.assertSafeDirectory(this.dir);
  }

  private async ensureDir(): Promise<void> {
    const { chmod, mkdir } = await fsPromises;
    const ensureSafeDirectory = async (directory: string): Promise<void> => {
      try {
        await this.assertSafeDirectory(directory);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
        await mkdir(directory, { recursive: true, mode: 0o700 });
      }
      // Re-check after creation to catch an existing generated-path symlink and
      // narrow the race window before chmod or entry writes follow that path.
      await this.assertSafeDirectory(directory);
      // mkdir's mode only applies when it creates the directory. Repair an
      // existing cache directory as well so cached source never inherits broad
      // permissions from an earlier process or manual setup.
      await chmod(directory, 0o700);
    };

    await ensureSafeDirectory(this.rootDir);
    if (this.dir !== this.rootDir) await ensureSafeDirectory(this.dir);
  }

  private async readBoundedFile(filePath: string): Promise<string> {
    const { lstat, open } = await fsPromises;
    const pathStats = await lstat(filePath);
    if (pathStats.isSymbolicLink() || !pathStats.isFile()) {
      diskFailure("entry read");
    }
    // O_NOFOLLOW closes the lstat/open swap window without rejecting a normal
    // atomic cache-file replacement that happens between those operations.
    const handle = await open(filePath, SAFE_FILE_READ_FLAGS);
    try {
      const stats = await handle.stat();
      if (
        !stats.isFile() || !Number.isSafeInteger(stats.size) ||
        stats.size > MAX_CACHE_ENVELOPE_BYTES
      ) {
        diskFailure("entry read");
      }
      const bytes = new Uint8Array(stats.size);
      let offset = 0;
      while (offset < bytes.length) {
        const result = await handle.read(bytes, offset, bytes.length - offset, offset);
        if (result.bytesRead === 0) break;
        offset += result.bytesRead;
      }
      return valueDecoder.decode(bytes.subarray(0, offset));
    } finally {
      await handle.close();
    }
  }

  private async removeCorruptFile(filePath: string): Promise<void> {
    try {
      const { unlink } = await fsPromises;
      await unlink(filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        logger.debug("[DiskCache] Corrupt entry cleanup failed", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
      }
    }
  }

  async get(key: string): Promise<string | null> {
    assertCacheKey(key);
    const filePath = this.filePath(key);
    try {
      await this.assertSafeCacheDirectories();
      const raw = await this.readBoundedFile(filePath);
      const envelope = parseDiskCacheEnvelope(JSON.parse(raw));
      if (!envelope) {
        await this.removeCorruptFile(filePath);
        return null;
      }
      if (envelope.key !== key) {
        // The filename hash collided: this file belongs to a different key, so a
        // prior write for one of them silently overwrote the other's data. Surface
        // it (instead of a silent miss) so collisions are diagnosable in prod.
        logger.warn("[DiskCache] Filename hash collision; stored key does not match");
        return null;
      }
      if (envelope.expiresAt != null && Date.now() >= envelope.expiresAt) {
        this.del(key).catch((cleanupError) => {
          logger.debug("[DiskCache] Expired entry cleanup failed", {
            errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
          });
        });
        return null;
      }
      return envelope.value;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (error instanceof SyntaxError) {
        await this.removeCorruptFile(filePath);
        return null;
      }
      if (code !== "ENOENT") {
        logger.error("[DiskCache] Read error", {
          errorName: error instanceof Error ? error.name : typeof error,
          code,
        });
      }
      return null;
    }
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    assertCacheKey(key);
    try {
      await this.assertSafeCacheDirectories();
      const envelope = parseDiskCacheEnvelope(
        JSON.parse(await this.readBoundedFile(this.filePath(key))),
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
    assertCacheKey(key);
    if (
      typeof value !== "string" || valueEncoder.encode(value).byteLength > MAX_CACHE_VALUE_BYTES
    ) {
      invalidArgument("Cache value must be a string within the supported byte size");
    }
    const ttl = normalizeTtl(ttlSeconds);
    try {
      await this.ensureDir();
    } catch {
      diskFailure("directory initialization");
    }
    const envelope: DiskCacheEnvelope = {
      key,
      value,
      expiresAt: ttl !== undefined ? Date.now() + ttl * 1000 : undefined,
    };
    const filePath = this.filePath(key);
    const tmpPath = `${filePath}.tmp.${Date.now()}.${crypto.randomUUID().slice(0, 8)}`;
    const content = JSON.stringify(envelope);
    const { writeFile, rename, unlink } = await fsPromises;
    try {
      await writeFile(tmpPath, content, { encoding: "utf-8", mode: 0o600 });
      await rename(tmpPath, filePath);
    } catch (error) {
      await unlink(tmpPath).catch((cleanupError) => {
        logger.debug("[DiskCache] Temp file cleanup failed", {
          errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
        });
      });
      logger.error("[DiskCache] Write failed", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      diskFailure("write");
    }
  }

  async del(key: string): Promise<void> {
    assertCacheKey(key);
    try {
      await this.assertSafeCacheDirectories();
      const { unlink } = await fsPromises;
      await unlink(this.filePath(key));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        logger.error("[DiskCache] Delete error", {
          errorName: error instanceof Error ? error.name : typeof error,
          code,
        });
        diskFailure("delete");
      }
    }
  }

  async delByPattern(pattern: string): Promise<number> {
    assertBoundedString(pattern, "Cache pattern", MAX_CACHE_KEY_LENGTH, true);
    let glob = this.globCache.get(pattern);
    if (!glob) {
      glob = compileCacheGlob(pattern) ?? undefined;
      if (!glob) return 0;
      if (this.globCache.size >= MAX_GLOB_CACHE_SIZE) {
        const firstKey = this.globCache.keys().next().value as string | undefined;
        if (firstKey !== undefined) this.globCache.delete(firstKey);
      }
      this.globCache.set(pattern, glob);
    }
    let deleted = 0;
    try {
      await this.assertSafeCacheDirectories();
      const { opendir, unlink } = await fsPromises;
      const directory = await opendir(this.dir);
      for await (const entry of directory) {
        if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
        const filePath = join(this.dir, entry.name);
        try {
          const raw = await this.readBoundedFile(filePath);
          const envelope = parseDiskCacheEnvelope(JSON.parse(raw));
          if (!envelope) {
            await this.removeCorruptFile(filePath);
            continue;
          }
          if (glob.test(envelope.key)) {
            await unlink(filePath);
            deleted++;
          }
        } catch (error) {
          const code = (error as NodeJS.ErrnoException)?.code;
          if (code === "ENOENT") continue;
          if (error instanceof SyntaxError) {
            await this.removeCorruptFile(filePath);
            continue;
          }
          throw error;
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === "ENOENT") return 0;
      logger.error("[DiskCache] delByPattern: directory not accessible", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      if (error instanceof VeryfrontError) throw error;
      diskFailure("pattern delete");
    }
    return deleted;
  }
}
