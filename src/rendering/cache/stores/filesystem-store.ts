import { dirname, join, normalize, parse } from "#veryfront/compat/path";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CachePayload, CacheStore } from "../types.ts";

export interface FilesystemCacheStoreOptions {
  baseDir: string;
}

export class FilesystemCacheStore implements CacheStore {
  private baseDir: string;
  private localAdapterPromise: Promise<RuntimeAdapter>;

  constructor(options: FilesystemCacheStoreOptions) {
    if (isUnsafeCacheRoot(options.baseDir)) {
      throw new TypeError("Filesystem cache baseDir must identify a dedicated directory");
    }
    this.baseDir = options.baseDir;
    this.localAdapterPromise = getLocalAdapter();
  }

  private async getLocalFS() {
    const adapter = await this.localAdapterPromise;
    return adapter.fs;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    const file = await this.readFileForKey(key);
    if (!file) return undefined;

    try {
      const parsed = JSON.parse(file) as unknown;
      if (isCachePayload(parsed)) return parsed;
      await this.delete(key);
      return undefined;
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      // Remove corrupt entries so every read does not repeat the same parse
      // failure and a later write can heal the cache.
      await this.delete(key);
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
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: file may not exist */
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
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: directory may not exist */
    }

    return deleted;
  }

  async clear(): Promise<void> {
    try {
      const fs = await this.getLocalFS();
      await fs.remove(this.baseDir, { recursive: true });
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: directory may not exist */
    }
  }

  async destroy(): Promise<void> {
    // Filesystem entries are durable by design. There are no open resources to
    // release, and process shutdown must not erase a shared cache directory.
  }

  private filePathForKey(key: string): string {
    return join(this.baseDir, `${encodeURIComponent(key)}.json`);
  }

  private async ensureDir(path: string): Promise<void> {
    try {
      const fs = await this.getLocalFS();
      await fs.mkdir(path, { recursive: true });
    } catch (error) {
      // mkdir({ recursive: true }) should not throw when the directory already
      // exists on Node or Deno, but custom FS adapters may. Check the error
      // code/name rather than matching a locale-dependent message string.
      if (isAlreadyExistsError(error)) return;
      throw error;
    }
  }

  private async readFileForKey(key: string): Promise<string | null> {
    const filePath = this.filePathForKey(key);

    try {
      const fs = await this.getLocalFS();
      return await fs.readFile(filePath);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      /* expected: cache file may not exist */
      return null;
    }
  }
}

function isUnsafeCacheRoot(path: string): boolean {
  const normalized = normalize(path).replace(/[\\/]+$/, "");
  if (normalized === "" || normalized === "." || normalized === "..") return true;
  const parsed = parse(normalized);
  return normalized === parsed.root;
}

function isCachePayload(value: unknown): value is CachePayload {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const payload = value as Record<string, unknown>;
  if (!Number.isFinite(payload.storedAt)) return false;
  if (payload.expiresAt !== undefined && !Number.isFinite(payload.expiresAt)) return false;
  if (payload.staleUntil !== undefined && !Number.isFinite(payload.staleUntil)) return false;
  if (
    typeof payload.result !== "object" || payload.result === null || Array.isArray(payload.result)
  ) {
    return false;
  }
  const result = payload.result as Record<string, unknown>;
  return typeof result.html === "string" &&
    typeof result.frontmatter === "object" && result.frontmatter !== null &&
    !Array.isArray(result.frontmatter);
}
