import { basename, dirname, join, resolve } from "#veryfront/compat/path";
import { getLocalAdapter } from "#veryfront/platform/adapters/registry.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { CachePayload, CacheStore } from "../types.ts";
import { parseCachePayload, serializeCachePayload } from "../cache-payload.ts";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { isWithinDirectory } from "#veryfront/utils/path-utils.ts";
import { FILE_CACHE_MAX_ENTRIES } from "#veryfront/utils/constants/cache.ts";

const CACHE_DATA_DIRECTORY = "v2";
const CACHE_OWNER_MARKER = ".veryfront-render-cache";
const CACHE_OWNER_MARKER_CONTENT = "veryfront-render-cache:v2\n";
const CACHE_ENTRY_FORMAT = 1;
const CACHE_ENTRY_FILE_PATTERN = /^v1-[0-9a-f]{64}\.json$/;
const MAX_CACHE_KEY_BYTES = 16_384;

interface FilesystemCacheEnvelope {
  format: typeof CACHE_ENTRY_FORMAT;
  key: string;
  writtenAt: number;
  payload: CachePayload;
}

interface CapacityCandidate {
  path: string;
  writtenAt: number;
}

export interface FilesystemCacheStoreOptions {
  baseDir: string;
  /** Optional containment root; required when the path comes from configuration. */
  ownerRoot?: string;
  /** Persistent entry cap. Oldest writes are evicted deterministically. */
  maxEntries?: number;
  /** Optional runtime adapter for embedding/tests. */
  adapter?: RuntimeAdapter;
  /** Optional clock for deterministic embedding/tests. */
  now?: () => number;
}

export class FilesystemCacheStore implements CacheStore {
  /** Versioned owned directory. Legacy cache roots remain untouched. */
  private readonly baseDir: string;
  private readonly ownerRoot?: string;
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly localAdapterPromise: Promise<RuntimeAdapter>;
  private ownershipInitialization?: Promise<void>;
  private mutationTail: Promise<void> = Promise.resolve();
  private destroyed = false;

  constructor(options: FilesystemCacheStoreOptions) {
    if (typeof options.baseDir !== "string" || options.baseDir.trim().length === 0) {
      throw new TypeError("Filesystem render cache baseDir must be a non-blank path");
    }
    const cacheRoot = resolve(options.baseDir);
    this.baseDir = join(cacheRoot, CACHE_DATA_DIRECTORY);
    this.ownerRoot = options.ownerRoot === undefined ? undefined : resolve(options.ownerRoot);
    if (
      this.ownerRoot !== undefined &&
      (cacheRoot === this.ownerRoot || !isWithinDirectory(this.ownerRoot, cacheRoot))
    ) {
      throw new TypeError("Filesystem render cache directory must be inside its owner root");
    }
    const maxEntries = options.maxEntries ?? FILE_CACHE_MAX_ENTRIES;
    if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
      throw new RangeError("Filesystem render cache maxEntries must be a positive safe integer");
    }
    if (options.now !== undefined && typeof options.now !== "function") {
      throw new TypeError("Filesystem render cache now must be a function");
    }
    this.maxEntries = maxEntries;
    this.now = options.now ?? Date.now;
    this.localAdapterPromise = options.adapter
      ? Promise.resolve(options.adapter)
      : getLocalAdapter();
  }

  private assertActive(): void {
    if (this.destroyed) throw new Error("Filesystem render cache store has been destroyed");
  }

  private async getLocalFS() {
    const adapter = await this.localAdapterPromise;
    return adapter.fs;
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    this.assertActive();
    const result = this.mutationTail.then(operation, operation);
    this.mutationTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async get(key: string): Promise<CachePayload | undefined> {
    this.assertActive();
    const { filePath, normalizedKey } = await this.filePathForKey(key);
    const fs = await this.getLocalFS();
    if (!(await this.assertOwnedExistingDirectory(fs))) return undefined;
    const raw = await this.readCacheFile(fs, filePath);
    if (raw === null) return undefined;

    const envelope = this.parseEnvelope(raw);
    if (!envelope) {
      await this.runMutation(() => this.removeIfPresent(fs, filePath));
      return undefined;
    }
    if (envelope.key !== normalizedKey) {
      throw new Error("Filesystem render cache key digest collision detected");
    }
    return envelope.payload;
  }

  set(key: string, value: CachePayload): Promise<void> {
    const normalizedKey = this.validateKey(key);
    const serializedPayload = JSON.parse(serializeCachePayload(value)) as unknown;
    return this.runMutation(async () => {
      const fs = await this.getLocalFS();
      await this.ensureOwnedDirectory(fs);
      const filePath = await this.filePathForValidatedKey(normalizedKey);
      const existing = await this.readCacheFile(fs, filePath);
      if (existing !== null) {
        const envelope = this.parseEnvelope(existing);
        if (envelope?.key !== undefined && envelope.key !== normalizedKey) {
          throw new Error("Filesystem render cache key digest collision detected");
        }
      }

      await this.enforceCapacity(fs, filePath);
      const writtenAt = this.now();
      if (!Number.isSafeInteger(writtenAt) || writtenAt < 0) {
        throw new RangeError("Filesystem render cache clock returned an invalid timestamp");
      }
      const envelope = JSON.stringify({
        format: CACHE_ENTRY_FORMAT,
        key: normalizedKey,
        writtenAt,
        payload: serializedPayload,
      });
      await this.writeAtomically(fs, filePath, envelope);
    });
  }

  delete(key: string): Promise<void> {
    const normalizedKey = this.validateKey(key);
    return this.runMutation(async () => {
      const fs = await this.getLocalFS();
      if (!(await this.assertOwnedExistingDirectory(fs))) return;
      const filePath = await this.filePathForValidatedKey(normalizedKey);
      const existing = await this.readCacheFile(fs, filePath);
      if (existing === null) return;
      const envelope = this.parseEnvelope(existing);
      if (envelope?.key !== undefined && envelope.key !== normalizedKey) {
        throw new Error("Filesystem render cache key digest collision detected");
      }
      await this.removeIfPresent(fs, filePath);
    });
  }

  deleteByPrefix(prefix: string): Promise<number> {
    this.validatePrefix(prefix);
    return this.runMutation(async () => {
      const fs = await this.getLocalFS();
      if (!(await this.assertOwnedExistingDirectory(fs))) return 0;
      let deleted = 0;

      for await (const entry of fs.readDir(this.baseDir)) {
        if (!this.isCacheEntry(entry)) continue;
        const path = join(this.baseDir, entry.name);
        const raw = await this.readCacheFile(fs, path);
        if (raw === null) continue;
        const envelope = this.parseEnvelope(raw);
        if (!envelope) {
          await this.removeIfPresent(fs, path);
          continue;
        }
        if (!envelope.key.startsWith(prefix)) continue;
        await this.removeIfPresent(fs, path);
        deleted++;
      }
      return deleted;
    });
  }

  clear(): Promise<void> {
    return this.runMutation(async () => {
      const fs = await this.getLocalFS();
      if (!(await this.assertOwnedExistingDirectory(fs))) return;
      try {
        await fs.remove(this.baseDir, { recursive: true });
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    });
  }

  async destroy(): Promise<void> {
    if (this.destroyed) return await this.mutationTail;
    this.destroyed = true;
    await this.mutationTail;
  }

  private validateKey(key: string): string {
    if (typeof key !== "string" || key.length === 0) {
      throw new TypeError("Filesystem render cache key must be a non-empty string");
    }
    if (new TextEncoder().encode(key).length > MAX_CACHE_KEY_BYTES) {
      throw new RangeError(`Filesystem render cache key exceeds ${MAX_CACHE_KEY_BYTES} bytes`);
    }
    return key;
  }

  private validatePrefix(prefix: string): void {
    if (typeof prefix !== "string") {
      throw new TypeError("Filesystem render cache prefix must be a string");
    }
    if (new TextEncoder().encode(prefix).length > MAX_CACHE_KEY_BYTES) {
      throw new RangeError(`Filesystem render cache prefix exceeds ${MAX_CACHE_KEY_BYTES} bytes`);
    }
  }

  private async filePathForKey(key: string): Promise<{ filePath: string; normalizedKey: string }> {
    const normalizedKey = this.validateKey(key);
    return {
      filePath: await this.filePathForValidatedKey(normalizedKey),
      normalizedKey,
    };
  }

  private async filePathForValidatedKey(key: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
    const hex = [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    return join(this.baseDir, `v1-${hex}.json`);
  }

  private parseEnvelope(raw: string): FilesystemCacheEnvelope | undefined {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return undefined;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const record = parsed as Record<string, unknown>;
    if (
      record.format !== CACHE_ENTRY_FORMAT || typeof record.key !== "string" ||
      record.key.length === 0 || !Number.isSafeInteger(record.writtenAt) ||
      (record.writtenAt as number) < 0
    ) {
      return undefined;
    }
    const payload = parseCachePayload(record.payload);
    if (!payload) return undefined;
    return {
      format: CACHE_ENTRY_FORMAT,
      key: record.key,
      writtenAt: record.writtenAt as number,
      payload,
    };
  }

  private isCacheEntry(entry: { name: string; isFile: boolean; isSymlink: boolean }): boolean {
    if (!CACHE_ENTRY_FILE_PATTERN.test(entry.name)) return false;
    if (entry.isSymlink) {
      throw new TypeError("Filesystem render cache entry cannot be a symlink");
    }
    if (!entry.isFile) {
      throw new TypeError("Filesystem render cache entry is not a regular file");
    }
    return true;
  }

  private async readCacheFile(
    fs: RuntimeAdapter["fs"],
    path: string,
  ): Promise<string | null> {
    if (fs.lstat) {
      try {
        const info = await fs.lstat(path);
        if (info.isSymlink) {
          throw new TypeError("Filesystem render cache entry cannot be a symlink");
        }
        if (!info.isFile) {
          throw new TypeError("Filesystem render cache entry is not a regular file");
        }
      } catch (error) {
        if (isNotFoundError(error)) return null;
        throw error;
      }
    }
    try {
      return await fs.readFile(path);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
  }

  private async removeIfPresent(fs: RuntimeAdapter["fs"], path: string): Promise<void> {
    try {
      await fs.remove(path);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  private async enforceCapacity(
    fs: RuntimeAdapter["fs"],
    replacementPath: string,
  ): Promise<void> {
    const retained: CapacityCandidate[] = [];
    const capacityBeforeWrite = this.maxEntries - 1;
    const now = this.now();

    for await (const entry of fs.readDir(this.baseDir)) {
      if (!this.isCacheEntry(entry)) continue;
      const path = join(this.baseDir, entry.name);
      if (path === replacementPath) continue;
      const raw = await this.readCacheFile(fs, path);
      if (raw === null) continue;
      const envelope = this.parseEnvelope(raw);
      if (!envelope) {
        await this.removeIfPresent(fs, path);
        continue;
      }
      const retainUntil = envelope.payload.staleUntil ?? envelope.payload.expiresAt;
      if (retainUntil !== undefined && now >= retainUntil) {
        await this.removeIfPresent(fs, path);
        continue;
      }

      retained.push({ path, writtenAt: envelope.writtenAt });
      if (retained.length <= capacityBeforeWrite) continue;
      let oldestIndex = 0;
      for (let index = 1; index < retained.length; index++) {
        const candidate = retained[index]!;
        const oldest = retained[oldestIndex]!;
        if (
          candidate.writtenAt < oldest.writtenAt ||
          (candidate.writtenAt === oldest.writtenAt && candidate.path < oldest.path)
        ) {
          oldestIndex = index;
        }
      }
      const oldest = retained.splice(oldestIndex, 1)[0]!;
      await this.removeIfPresent(fs, oldest.path);
    }
  }

  private async ensureDir(fs: RuntimeAdapter["fs"], path: string): Promise<void> {
    try {
      await fs.mkdir(path, { recursive: true });
    } catch (error) {
      if (isAlreadyExistsError(error)) return;
      throw error;
    }
  }

  private async ensureOwnedDirectory(fs: RuntimeAdapter["fs"]): Promise<void> {
    if (this.ownershipInitialization) {
      await this.ownershipInitialization;
      return;
    }

    const initialization = this.initializeOwnedDirectory(fs);
    this.ownershipInitialization = initialization;
    try {
      await initialization;
    } finally {
      if (this.ownershipInitialization === initialization) {
        this.ownershipInitialization = undefined;
      }
    }
  }

  private async initializeOwnedDirectory(fs: RuntimeAdapter["fs"]): Promise<void> {
    try {
      const info = await fs.stat(this.baseDir);
      if (!info.isDirectory) throw new TypeError("Filesystem render cache path is not a directory");
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      await this.assertParentWithinOwnerRoot(fs);
      await this.ensureDir(fs, this.baseDir);
    }

    await this.assertPhysicalOwnership(fs);
    const markerPath = join(this.baseDir, CACHE_OWNER_MARKER);
    try {
      const marker = await fs.readFile(markerPath);
      if (marker !== CACHE_OWNER_MARKER_CONTENT) {
        throw new TypeError("Filesystem render cache owner marker is invalid");
      }
      return;
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }

    for await (const _entry of fs.readDir(this.baseDir)) {
      throw new TypeError("Refusing to claim a non-empty filesystem render cache directory");
    }
    await this.writeAtomically(fs, markerPath, CACHE_OWNER_MARKER_CONTENT);
  }

  private async assertOwnedExistingDirectory(fs: RuntimeAdapter["fs"]): Promise<boolean> {
    try {
      const info = await fs.stat(this.baseDir);
      if (!info.isDirectory) throw new TypeError("Filesystem render cache path is not a directory");
    } catch (error) {
      if (isNotFoundError(error)) return false;
      throw error;
    }

    await this.assertPhysicalOwnership(fs);
    let marker: string;
    try {
      marker = await fs.readFile(join(this.baseDir, CACHE_OWNER_MARKER));
    } catch (error) {
      if (isNotFoundError(error)) {
        throw new TypeError("Filesystem render cache directory is not owned by Veryfront");
      }
      throw error;
    }
    if (marker !== CACHE_OWNER_MARKER_CONTENT) {
      throw new TypeError("Filesystem render cache owner marker is invalid");
    }
    return true;
  }

  private async assertPhysicalOwnership(fs: RuntimeAdapter["fs"]): Promise<void> {
    if (this.ownerRoot !== undefined && (!fs.lstat || !fs.realPath)) {
      throw new TypeError(
        "Filesystem adapter must support lstat and realPath for a contained render cache",
      );
    }

    const info = await fs.lstat?.(this.baseDir);
    if (info?.isSymlink) {
      throw new TypeError("Filesystem render cache directory cannot be a symlink");
    }

    if (this.ownerRoot !== undefined && fs.realPath) {
      const [realRoot, realBase] = await Promise.all([
        fs.realPath(this.ownerRoot),
        fs.realPath(this.baseDir),
      ]);
      if (realRoot === realBase || !isWithinDirectory(realRoot, realBase)) {
        throw new TypeError("Filesystem render cache directory escapes its owner root");
      }
    }
  }

  private async assertParentWithinOwnerRoot(fs: RuntimeAdapter["fs"]): Promise<void> {
    if (this.ownerRoot === undefined) return;
    if (!fs.realPath || !fs.lstat) {
      throw new TypeError(
        "Filesystem adapter must support lstat and realPath for a contained render cache",
      );
    }

    const realRoot = await fs.realPath(this.ownerRoot);
    let ancestor = dirname(this.baseDir);
    while (true) {
      try {
        const linkInfo = await fs.lstat(ancestor);
        if (linkInfo.isSymlink) {
          throw new TypeError("Filesystem render cache parent cannot be a symlink");
        }
        const realAncestor = await fs.realPath(ancestor);
        if (realAncestor !== realRoot && !isWithinDirectory(realRoot, realAncestor)) {
          throw new TypeError("Filesystem render cache parent escapes its owner root");
        }
        return;
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }

      const parent = dirname(ancestor);
      if (parent === ancestor) {
        throw new TypeError("Unable to resolve a filesystem render cache parent");
      }
      ancestor = parent;
    }
  }

  private async writeAtomically(
    fs: RuntimeAdapter["fs"],
    destination: string,
    content: string,
  ): Promise<void> {
    if (!fs.rename) {
      throw new TypeError("Filesystem adapter does not support atomic rename");
    }
    await this.ensureDir(fs, dirname(destination));
    const temporary = join(
      dirname(destination),
      `.${basename(destination)}.${crypto.randomUUID()}.tmp`,
    );
    try {
      await fs.writeFile(temporary, content);
      await fs.rename(temporary, destination);
    } catch (operationError) {
      try {
        await fs.remove(temporary);
      } catch (cleanupError) {
        if (!isNotFoundError(cleanupError)) {
          throw new AggregateError(
            [operationError, cleanupError],
            "Filesystem cache atomic write and temporary-file cleanup both failed",
          );
        }
      }
      throw operationError;
    }
  }
}
