import { join, resolve } from "#veryfront/compat/path/index.ts";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { logger } from "#veryfront/utils";
import type { CacheBackend } from "../types.ts";
import { type CacheGlob, compileCacheGlob } from "./glob.ts";
import { DEFAULT_CACHE_TTL_SECONDS, expiresImmediately, resolveCacheTtlSeconds } from "./ttl.ts";

const CACHE_SUBDIR = "veryfront-files";
const CACHE_FILE_PATTERN = /^[0-9a-f]{64}\.json$/;
const LEGACY_CACHE_FILE_PATTERN = /^[0-9a-f]{32}\.json$/;
const TEMP_FILE_PATTERN = /^(?:[0-9a-f]{32}|[0-9a-f]{64})\.json\.tmp\.\d+\.[0-9a-f-]+$/;
const MAX_GLOB_CACHE_SIZE = 100;
const MAX_CACHE_NAMESPACE_BYTES = 240;
const MAX_CACHE_KEY_CODE_UNITS = 64 * 1024;
const READ_CHUNK_BYTES = 64 * 1024;
const STALE_TEMP_FILE_MS = 10 * 60 * 1000;
const DEFAULT_MAX_ENTRIES = 10_000;
const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;
const DEFAULT_MAX_ENTRY_BYTES = 16 * 1024 * 1024;
const DEFAULT_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_MAX_SCAN_ENTRIES = 100_000;
const DISK_CACHE_FORMAT_VERSION = 2;
const PORTABLE_NAMESPACE_CHAR = /^[a-z0-9_-]$/;
const WINDOWS_RESERVED_NAMES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const fsPromises = import("node:fs/promises");
const MAX_COORDINATOR_REFS = 1_000;

interface NamespaceCoordinator {
  generation: symbol;
  tail: Promise<void>;
}

const namespaceCoordinatorRefs = new Map<string, WeakRef<NamespaceCoordinator>>();

function getNamespaceCoordinator(directoryPath: string): NamespaceCoordinator {
  const existing = namespaceCoordinatorRefs.get(directoryPath)?.deref();
  if (existing) return existing;

  if (namespaceCoordinatorRefs.size >= MAX_COORDINATOR_REFS) {
    for (const [path, reference] of namespaceCoordinatorRefs) {
      if (!reference.deref()) namespaceCoordinatorRefs.delete(path);
    }
  }
  const coordinator: NamespaceCoordinator = {
    generation: Symbol("disk-cache-generation"),
    tail: Promise.resolve(),
  };
  namespaceCoordinatorRefs.set(directoryPath, new WeakRef(coordinator));
  return coordinator;
}

export interface DiskCacheOptions {
  /** Maximum number of live cache entries retained in this namespace. */
  maxEntries?: number;
  /** Maximum aggregate size, in bytes, of live cache entry files. */
  maxBytes?: number;
  /** Maximum serialized size, in bytes, of any one cache entry. */
  maxEntryBytes?: number;
  /** Interval between full expiry/corruption sweeps. Zero sweeps on every operation. */
  sweepIntervalMs?: number;
  /** Maximum directory entries inspected by one maintenance sweep. */
  maxScanEntries?: number;
}

interface ResolvedDiskCacheOptions {
  maxEntries: number;
  maxBytes: number;
  maxEntryBytes: number;
  sweepIntervalMs: number;
  maxScanEntries: number;
}

interface DiskCacheEnvelope {
  formatVersion: typeof DISK_CACHE_FORMAT_VERSION;
  integrity: string;
  key: string;
  value: string;
  expiresAt?: number;
}

interface CacheFileRead {
  dev: number;
  envelope: DiskCacheEnvelope | null;
  ino: number;
  mtimeMs: number;
  size: number;
}

interface CacheEntryMetadata {
  expiresAt?: number;
  fileName: string;
  mtimeMs: number;
  size: number;
}

class InvalidDiskCacheFileError extends Error {
  constructor() {
    super("Disk cache file is not a stable regular file");
    this.name = "InvalidDiskCacheFileError";
  }
}

class OversizedDiskCacheFileError extends Error {
  constructor() {
    super("Disk cache file exceeds the configured entry limit");
    this.name = "OversizedDiskCacheFileError";
  }
}

class DiskCacheKeyCollisionError extends Error {
  constructor() {
    super("Disk cache key digest collision detected");
    this.name = "DiskCacheKeyCollisionError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseDiskCacheEnvelope(value: unknown): DiskCacheEnvelope | null {
  if (!isRecord(value)) return null;
  if (value.formatVersion !== DISK_CACHE_FORMAT_VERSION) return null;
  if (typeof value.integrity !== "string" || !/^[0-9a-f]{64}$/.test(value.integrity)) {
    return null;
  }
  if (typeof value.key !== "string") return null;
  if (typeof value.value !== "string") return null;
  if (
    value.expiresAt !== undefined &&
    (typeof value.expiresAt !== "number" || !Number.isFinite(value.expiresAt))
  ) {
    return null;
  }
  return {
    formatVersion: DISK_CACHE_FORMAT_VERSION,
    integrity: value.integrity,
    key: value.key,
    value: value.value,
    expiresAt: value.expiresAt,
  };
}

function resolvePositiveSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`Disk cache ${name} must be a positive safe integer`);
  }
  return value;
}

function resolveNonNegativeSafeInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`Disk cache ${name} must be a non-negative safe integer`);
  }
  return value;
}

function resolveOptions(options: DiskCacheOptions): ResolvedDiskCacheOptions {
  const resolved = {
    maxEntries: resolvePositiveSafeInteger(
      options.maxEntries ?? DEFAULT_MAX_ENTRIES,
      "maxEntries",
    ),
    maxBytes: resolvePositiveSafeInteger(options.maxBytes ?? DEFAULT_MAX_BYTES, "maxBytes"),
    maxEntryBytes: resolvePositiveSafeInteger(
      options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES,
      "maxEntryBytes",
    ),
    sweepIntervalMs: resolveNonNegativeSafeInteger(
      options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS,
      "sweepIntervalMs",
    ),
    maxScanEntries: resolvePositiveSafeInteger(
      options.maxScanEntries ?? DEFAULT_MAX_SCAN_ENTRIES,
      "maxScanEntries",
    ),
  };
  if (resolved.maxEntryBytes > resolved.maxBytes) {
    throw new RangeError("Disk cache maxEntryBytes cannot exceed maxBytes");
  }
  if (resolved.maxEntries > resolved.maxScanEntries) {
    throw new RangeError("Disk cache maxEntries cannot exceed maxScanEntries");
  }
  if (resolved.maxScanEntries > DEFAULT_MAX_SCAN_ENTRIES) {
    throw new RangeError(
      `Disk cache maxScanEntries cannot exceed ${DEFAULT_MAX_SCAN_ENTRIES}`,
    );
  }
  return resolved;
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function compareEntries(left: CacheEntryMetadata, right: CacheEntryMetadata): number {
  const timeOrder = left.mtimeMs - right.mtimeMs;
  if (timeOrder !== 0) return timeOrder;
  if (left.fileName === right.fileName) return 0;
  return left.fileName < right.fileName ? -1 : 1;
}

function encodeCacheNamespace(keyPrefix: string): string {
  if (
    keyPrefix.length <= MAX_CACHE_NAMESPACE_BYTES &&
    [...keyPrefix].every((char) => PORTABLE_NAMESPACE_CHAR.test(char)) &&
    !WINDOWS_RESERVED_NAMES.test(keyPrefix)
  ) {
    return keyPrefix;
  }

  // Prefix encoded namespaces with a character excluded from the pass-through
  // alphabet. Escaping every other excluded UTF-16 code unit makes the mapping
  // injective while preventing separators, traversal, and reserved filenames.
  let encoded = "~";
  for (let index = 0; index < keyPrefix.length; index++) {
    const char = keyPrefix[index]!;
    encoded += PORTABLE_NAMESPACE_CHAR.test(char)
      ? char
      : `~${keyPrefix.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }

  if (encoded.length > MAX_CACHE_NAMESPACE_BYTES) {
    throw new TypeError("Disk cache key prefix is too long for a portable directory name");
  }
  return encoded;
}

async function digestKey(input: string): Promise<string> {
  if (input.length > MAX_CACHE_KEY_CODE_UNITS) {
    throw new RangeError("Disk cache key is too long");
  }

  // Hash UTF-16 code units rather than TextEncoder output. TextEncoder replaces
  // lone surrogates, which would otherwise give distinct JavaScript keys the same
  // byte representation before hashing.
  const bytes = new Uint8Array(input.length * 2);
  for (let index = 0; index < input.length; index++) {
    const codeUnit = input.charCodeAt(index);
    bytes[index * 2] = codeUnit >>> 8;
    bytes[index * 2 + 1] = codeUnit & 0xff;
  }
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  let result = "";
  for (const byte of digest) result += byte.toString(16).padStart(2, "0");
  return result;
}

async function computeEnvelopeIntegrity(
  key: string,
  value: string,
  expiresAt: number | undefined,
): Promise<string> {
  const payload = JSON.stringify([
    DISK_CACHE_FORMAT_VERSION,
    key,
    value,
    expiresAt ?? null,
  ]);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload)),
  );
  let result = "";
  for (const byte of digest) result += byte.toString(16).padStart(2, "0");
  return result;
}

async function readBoundedCacheFile(
  filePath: string,
  maxBytes: number,
): Promise<CacheFileRead> {
  const { lstat, open } = await fsPromises;
  const before = await lstat(filePath);
  if (!before.isFile()) throw new InvalidDiskCacheFileError();
  if (before.size > maxBytes) throw new OversizedDiskCacheFileError();

  const handle = await open(filePath, "r");
  try {
    const opened = await handle.stat();
    if (
      !opened.isFile() ||
      opened.dev !== before.dev ||
      opened.ino !== before.ino ||
      opened.size > maxBytes
    ) {
      throw new InvalidDiskCacheFileError();
    }

    const decoder = new TextDecoder("utf-8", { fatal: true });
    const chunk = new Uint8Array(Math.min(READ_CHUNK_BYTES, maxBytes + 1));
    let raw = "";
    let total = 0;
    while (true) {
      const bytesToRead = Math.min(chunk.byteLength, maxBytes - total + 1);
      const { bytesRead } = await handle.read(chunk, 0, bytesToRead, total);
      if (bytesRead === 0) break;
      total += bytesRead;
      if (total > maxBytes) throw new OversizedDiskCacheFileError();
      try {
        raw += decoder.decode(chunk.subarray(0, bytesRead), { stream: true });
      } catch {
        throw new InvalidDiskCacheFileError();
      }
    }
    try {
      raw += decoder.decode();
    } catch {
      throw new InvalidDiskCacheFileError();
    }

    const after = await handle.stat();
    if (
      after.dev !== opened.dev ||
      after.ino !== opened.ino ||
      after.size !== total
    ) {
      throw new InvalidDiskCacheFileError();
    }

    let envelope: DiskCacheEnvelope | null = null;
    try {
      const candidate = parseDiskCacheEnvelope(JSON.parse(raw));
      if (
        candidate &&
        candidate.integrity === await computeEnvelopeIntegrity(
            candidate.key,
            candidate.value,
            candidate.expiresAt,
          )
      ) {
        envelope = candidate;
      }
    } catch {
      // Corrupt cache data is a miss and is removed by the caller.
    }
    return {
      dev: after.dev,
      envelope,
      ino: after.ino,
      mtimeMs: after.mtimeMs,
      size: total,
    };
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directoryPath: string): Promise<void> {
  const { open } = await fsPromises;
  let handle: Awaited<ReturnType<(Awaited<typeof fsPromises>)["open"]>> | undefined;
  try {
    handle = await open(directoryPath, "r");
    await handle.sync();
  } catch {
    // Some platforms do not allow opening or fsyncing directories. The entry
    // file itself is still synced before the atomic rename on those platforms.
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

export class DiskCacheBackend implements CacheBackend {
  readonly type = "disk" as const;
  private readonly cacheRoot: string;
  private readonly coordinator: NamespaceCoordinator;
  private readonly dir: string;
  private readonly options: ResolvedDiskCacheOptions;
  private readonly globCache = new Map<string, CacheGlob>();
  private entries: Map<string, CacheEntryMetadata> | null = null;
  private indexedBytes = 0;
  private lastSweepAt = 0;
  private observedGeneration: symbol;

  constructor(baseDir?: string, keyPrefix?: string, options: DiskCacheOptions = {}) {
    this.cacheRoot = resolve(baseDir ?? getCacheBaseDir(), CACHE_SUBDIR);
    this.dir = keyPrefix ? join(this.cacheRoot, encodeCacheNamespace(keyPrefix)) : this.cacheRoot;
    this.options = resolveOptions(options);
    this.coordinator = getNamespaceCoordinator(this.dir);
    this.observedGeneration = this.coordinator.generation;
  }

  private async cacheFileName(key: string): Promise<string> {
    return `${await digestKey(key)}.json`;
  }

  private filePath(fileName: string): string {
    if (!CACHE_FILE_PATTERN.test(fileName)) {
      throw new TypeError("Invalid disk cache filename");
    }
    return join(this.dir, fileName);
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.coordinator.tail;
    let release!: () => void;
    this.coordinator.tail = new Promise<void>((resolveMutation) => {
      release = resolveMutation;
    });
    await previous;
    if (this.observedGeneration !== this.coordinator.generation) {
      this.entries = null;
      this.indexedBytes = 0;
      this.lastSweepAt = 0;
    }
    try {
      return await operation();
    } finally {
      const generation = Symbol("disk-cache-generation");
      this.coordinator.generation = generation;
      this.observedGeneration = generation;
      release();
    }
  }

  private async validateCacheDirectory(create: boolean): Promise<boolean> {
    const { lstat, mkdir } = await fsPromises;
    if (create) await mkdir(this.cacheRoot, { recursive: true });

    let rootStat;
    try {
      rootStat = await lstat(this.cacheRoot);
    } catch (error) {
      if (!create && isNotFound(error)) return false;
      throw error;
    }
    if (!rootStat.isDirectory()) throw new InvalidDiskCacheFileError();

    if (this.dir === this.cacheRoot) return true;
    if (create) await mkdir(this.dir, { recursive: true });
    try {
      const namespaceStat = await lstat(this.dir);
      if (!namespaceStat.isDirectory()) throw new InvalidDiskCacheFileError();
      return true;
    } catch (error) {
      if (!create && isNotFound(error)) return false;
      throw error;
    }
  }

  private sweepIsDue(now: number): boolean {
    return this.entries === null ||
      this.options.sweepIntervalMs === 0 ||
      now < this.lastSweepAt ||
      now - this.lastSweepAt >= this.options.sweepIntervalMs;
  }

  private async unlinkFile(filePath: string): Promise<boolean> {
    const { unlink } = await fsPromises;
    try {
      await unlink(filePath);
      return true;
    } catch (error) {
      if (isNotFound(error)) return false;
      throw error;
    }
  }

  private oldestEntry(
    entries: Map<string, CacheEntryMetadata>,
    protectedFileName?: string,
  ): CacheEntryMetadata | undefined {
    let oldest: CacheEntryMetadata | undefined;
    for (const entry of entries.values()) {
      if (entry.fileName === protectedFileName) continue;
      if (!oldest || compareEntries(entry, oldest) < 0) oldest = entry;
    }
    return oldest;
  }

  private async enforceLimits(
    entries: Map<string, CacheEntryMetadata>,
    totalBytes: number,
    protectedFileName?: string,
  ): Promise<number> {
    while (
      entries.size > this.options.maxEntries ||
      totalBytes > this.options.maxBytes
    ) {
      const victim = this.oldestEntry(entries, protectedFileName);
      if (!victim) {
        throw new RangeError("Disk cache limits cannot retain the protected entry");
      }
      await this.unlinkFile(this.filePath(victim.fileName));
      entries.delete(victim.fileName);
      totalBytes -= victim.size;
    }
    return totalBytes;
  }

  private async scanDirectory(deleteMatcher?: CacheGlob): Promise<number> {
    const directoryExists = await this.validateCacheDirectory(false);
    if (!directoryExists) {
      this.entries = new Map();
      this.indexedBytes = 0;
      this.lastSweepAt = Date.now();
      return 0;
    }

    const { lstat, opendir } = await fsPromises;
    const entries = new Map<string, CacheEntryMetadata>();
    let totalBytes = 0;
    let deletedByMatcher = 0;
    let scannedEntries = 0;
    let evictionCutoff: CacheEntryMetadata | undefined;
    const now = Date.now();
    const directory = await opendir(this.dir);

    for await (const directoryEntry of directory) {
      scannedEntries++;
      if (scannedEntries > this.options.maxScanEntries) {
        throw new RangeError("Disk cache directory scan exceeded the configured entry limit");
      }
      const fileName = directoryEntry.name;
      const candidatePath = join(this.dir, fileName);

      if (TEMP_FILE_PATTERN.test(fileName)) {
        try {
          const stat = await lstat(candidatePath);
          if (!stat.isFile() || now - stat.mtimeMs >= STALE_TEMP_FILE_MS) {
            await this.unlinkFile(candidatePath);
          }
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
        continue;
      }
      // The previous backend used a 128-bit non-cryptographic FNV construction.
      // Those entries cannot be addressed safely after the identity migration.
      if (LEGACY_CACHE_FILE_PATTERN.test(fileName)) {
        await this.unlinkFile(candidatePath);
        continue;
      }
      if (!CACHE_FILE_PATTERN.test(fileName)) continue;

      let read: CacheFileRead;
      try {
        read = await readBoundedCacheFile(candidatePath, this.options.maxEntryBytes);
      } catch (error) {
        if (isNotFound(error)) continue;
        if (
          error instanceof InvalidDiskCacheFileError ||
          error instanceof OversizedDiskCacheFileError
        ) {
          await this.unlinkFile(candidatePath);
          continue;
        }
        throw error;
      }

      const envelope = read.envelope;
      if (!envelope) {
        await this.unlinkFile(candidatePath);
        continue;
      }

      let expectedFileName: string;
      try {
        expectedFileName = await this.cacheFileName(envelope.key);
      } catch {
        await this.unlinkFile(candidatePath);
        continue;
      }
      if (expectedFileName !== fileName) {
        await this.unlinkFile(candidatePath);
        continue;
      }
      if (deleteMatcher?.test(envelope.key)) {
        if (await this.unlinkFile(candidatePath)) deletedByMatcher++;
        continue;
      }
      if (envelope.expiresAt != null && now >= envelope.expiresAt) {
        await this.unlinkFile(candidatePath);
        continue;
      }

      const metadata: CacheEntryMetadata = {
        expiresAt: envelope.expiresAt,
        fileName,
        mtimeMs: read.mtimeMs,
        size: read.size,
      };
      if (
        evictionCutoff &&
        compareEntries(metadata, evictionCutoff) <= 0
      ) {
        await this.unlinkFile(candidatePath);
        continue;
      }

      entries.set(fileName, metadata);
      totalBytes += metadata.size;
      while (entries.size > this.options.maxEntries || totalBytes > this.options.maxBytes) {
        const victim = this.oldestEntry(entries);
        if (!victim) {
          throw new RangeError("Disk cache limits cannot retain the protected entry");
        }
        await this.unlinkFile(this.filePath(victim.fileName));
        entries.delete(victim.fileName);
        totalBytes -= victim.size;
        if (!evictionCutoff || compareEntries(victim, evictionCutoff) > 0) {
          evictionCutoff = victim;
        }
      }
    }

    this.entries = entries;
    this.indexedBytes = totalBytes;
    this.lastSweepAt = now;
    return deletedByMatcher;
  }

  private async maybeSweep(): Promise<void> {
    const now = Date.now();
    if (!this.sweepIsDue(now)) return;
    await this.withMutation(async () => {
      if (this.sweepIsDue(Date.now())) await this.scanDirectory();
    });
  }

  private logSweepFailure(error: unknown): void {
    logger.debug("[DiskCache] Maintenance sweep failed", {
      errorName: error instanceof Error ? error.name : typeof error,
      code: (error as NodeJS.ErrnoException)?.code,
    });
  }

  private async removeKnownFile(fileName: string): Promise<void> {
    await this.withMutation(async () => {
      if (!await this.validateCacheDirectory(false)) return;
      await this.unlinkFile(this.filePath(fileName));
      this.removeFromIndex(fileName);
    });
  }

  private removeFromIndex(fileName: string): void {
    const existing = this.entries?.get(fileName);
    if (existing && this.entries) {
      this.entries.delete(fileName);
      this.indexedBytes -= existing.size;
    }
  }

  private async removeKeyFile(fileName: string, key: string): Promise<void> {
    await this.withMutation(async () => {
      if (!await this.validateCacheDirectory(false)) return;
      const filePath = this.filePath(fileName);
      try {
        const read = await readBoundedCacheFile(filePath, this.options.maxEntryBytes);
        if (read.envelope && read.envelope.key !== key) return;
      } catch (error) {
        if (isNotFound(error)) return;
        if (
          !(error instanceof InvalidDiskCacheFileError) &&
          !(error instanceof OversizedDiskCacheFileError)
        ) {
          throw error;
        }
      }
      await this.unlinkFile(filePath);
      this.removeFromIndex(fileName);
    });
  }

  private async removeObservedFile(fileName: string, observed: CacheFileRead): Promise<void> {
    await this.withMutation(async () => {
      if (!await this.validateCacheDirectory(false)) return;
      const filePath = this.filePath(fileName);
      const { lstat } = await fsPromises;
      let current;
      try {
        current = await lstat(filePath);
      } catch (error) {
        if (isNotFound(error)) return;
        throw error;
      }
      if (
        !current.isFile() ||
        current.dev !== observed.dev ||
        current.ino !== observed.ino ||
        current.mtimeMs !== observed.mtimeMs ||
        current.size !== observed.size
      ) {
        return;
      }
      await this.unlinkFile(filePath);
      this.removeFromIndex(fileName);
    });
  }

  private async assertTargetCanBeReplaced(filePath: string, key: string): Promise<void> {
    try {
      const existing = await readBoundedCacheFile(filePath, this.options.maxEntryBytes);
      if (existing.envelope && existing.envelope.key !== key) {
        throw new DiskCacheKeyCollisionError();
      }
    } catch (error) {
      if (isNotFound(error)) return;
      if (error instanceof OversizedDiskCacheFileError) return;
      throw error;
    }
  }

  private async atomicWrite(
    fileName: string,
    key: string,
    content: Uint8Array,
    keyHash: string,
  ): Promise<number> {
    const { lstat, open, rename } = await fsPromises;
    const filePath = this.filePath(fileName);
    await this.assertTargetCanBeReplaced(filePath, key);

    const tmpPath = `${filePath}.tmp.${Date.now()}.${crypto.randomUUID()}`;
    let handle: Awaited<ReturnType<(Awaited<typeof fsPromises>)["open"]>> | undefined;
    try {
      handle = await open(tmpPath, "wx", 0o600);
      await handle.writeFile(content);
      await handle.sync();
      await handle.close();
      handle = undefined;
      await rename(tmpPath, filePath);
      await syncDirectory(this.dir);
      const stat = await lstat(filePath);
      if (!stat.isFile()) throw new InvalidDiskCacheFileError();
      return stat.mtimeMs;
    } catch (error) {
      await handle?.close().catch(() => undefined);
      await this.unlinkFile(tmpPath).catch((cleanupError) => {
        logger.debug("[DiskCache] Temp file cleanup failed", {
          keyHash,
          errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
          code: (cleanupError as NodeJS.ErrnoException)?.code,
        });
      });
      throw error;
    }
  }

  async get(key: string): Promise<string | null> {
    let fileName: string;
    let keyHash: string;
    try {
      keyHash = await digestKey(key);
      fileName = `${keyHash}.json`;
    } catch {
      return null;
    }

    let result: string | null = null;
    try {
      if (await this.validateCacheDirectory(false)) {
        const read = await readBoundedCacheFile(
          this.filePath(fileName),
          this.options.maxEntryBytes,
        );
        const envelope = read.envelope;
        if (!envelope) {
          await this.removeKnownFile(fileName);
        } else if (envelope.key !== key) {
          logger.warn("[DiskCache] Filename digest collision; stored key does not match", {
            keyHash,
            requestedKeyLength: key.length,
            storedKeyLength: envelope.key.length,
          });
        } else if (envelope.expiresAt != null && Date.now() >= envelope.expiresAt) {
          this.removeObservedFile(fileName, read).catch((cleanupError) => {
            logger.debug("[DiskCache] Expired entry cleanup failed", {
              keyHash,
              errorName: cleanupError instanceof Error ? cleanupError.name : typeof cleanupError,
              code: (cleanupError as NodeJS.ErrnoException)?.code,
            });
          });
        } else {
          result = envelope.value;
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (
        error instanceof InvalidDiskCacheFileError ||
        error instanceof OversizedDiskCacheFileError
      ) {
        await this.removeKnownFile(fileName).catch(() => undefined);
      } else if (code !== "ENOENT") {
        logger.error("[DiskCache] Read error", {
          keyHash,
          errorName: error instanceof Error ? error.name : typeof error,
          code,
        });
      }
    }

    await this.maybeSweep().catch((error) => this.logSweepFailure(error));
    return result;
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    let fileName: string;
    try {
      fileName = await this.cacheFileName(key);
      if (!await this.validateCacheDirectory(false)) return null;
      const read = await readBoundedCacheFile(this.filePath(fileName), this.options.maxEntryBytes);
      const envelope = read.envelope;
      if (!envelope) {
        await this.removeKnownFile(fileName);
        return null;
      }
      if (envelope.key !== key) return null;
      if (envelope.expiresAt == null) return Infinity;

      const remainingMs = envelope.expiresAt - Date.now();
      if (remainingMs <= 0) {
        this.removeObservedFile(fileName, read).catch(() => undefined);
        return null;
      }
      return remainingMs / 1000;
    } catch (error) {
      if (
        fileName! &&
        (error instanceof InvalidDiskCacheFileError ||
          error instanceof OversizedDiskCacheFileError)
      ) {
        await this.removeKnownFile(fileName).catch(() => undefined);
      }
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    const ttl = resolveCacheTtlSeconds(ttlSeconds, DEFAULT_CACHE_TTL_SECONDS);
    if (expiresImmediately(ttl)) {
      await this.del(key);
      return;
    }

    const keyHash = await digestKey(key);
    const fileName = `${keyHash}.json`;
    if (key.length + value.length > this.options.maxEntryBytes) {
      throw new RangeError("Disk cache entry exceeds maxEntryBytes");
    }
    const expiresAt = ttl != null ? Date.now() + ttl * 1000 : undefined;
    const envelope: DiskCacheEnvelope = {
      formatVersion: DISK_CACHE_FORMAT_VERSION,
      integrity: await computeEnvelopeIntegrity(key, value, expiresAt),
      key,
      value,
      expiresAt,
    };
    const content = new TextEncoder().encode(JSON.stringify(envelope));
    if (
      content.byteLength > this.options.maxEntryBytes ||
      content.byteLength > this.options.maxBytes
    ) {
      throw new RangeError("Disk cache entry exceeds maxEntryBytes");
    }

    await this.withMutation(async () => {
      await this.validateCacheDirectory(true);
      if (this.sweepIsDue(Date.now())) await this.scanDirectory();
      if (!this.entries) throw new Error("Disk cache index was not initialized");

      const now = Date.now();
      for (const entry of [...this.entries.values()]) {
        if (entry.expiresAt == null || now < entry.expiresAt) continue;
        await this.unlinkFile(this.filePath(entry.fileName));
        this.entries.delete(entry.fileName);
        this.indexedBytes -= entry.size;
      }

      const previous = this.entries.get(fileName);
      const projected = new Map(this.entries);
      projected.delete(fileName);
      const victims: CacheEntryMetadata[] = [];
      let projectedBytes = this.indexedBytes - (previous?.size ?? 0) + content.byteLength;
      let projectedEntries = projected.size + 1;
      while (
        projectedEntries > this.options.maxEntries ||
        projectedBytes > this.options.maxBytes
      ) {
        const victim = this.oldestEntry(projected);
        if (!victim) throw new RangeError("Disk cache limits cannot retain the new entry");
        projected.delete(victim.fileName);
        victims.push(victim);
        projectedBytes -= victim.size;
        projectedEntries--;
      }

      const mtimeMs = await this.atomicWrite(fileName, key, content, keyHash);
      if (previous) this.indexedBytes -= previous.size;
      this.entries.set(fileName, {
        expiresAt: envelope.expiresAt,
        fileName,
        mtimeMs,
        size: content.byteLength,
      });
      this.indexedBytes += content.byteLength;
      for (const victim of victims) {
        await this.unlinkFile(this.filePath(victim.fileName));
        this.removeFromIndex(victim.fileName);
      }
      this.indexedBytes = await this.enforceLimits(this.entries, this.indexedBytes, fileName);
    });
  }

  async del(key: string): Promise<void> {
    const keyHash = await digestKey(key);
    const fileName = `${keyHash}.json`;
    try {
      await this.removeKeyFile(fileName, key);
    } catch (error) {
      logger.error("[DiskCache] Delete error", {
        keyHash,
        errorName: error instanceof Error ? error.name : typeof error,
        code: (error as NodeJS.ErrnoException)?.code,
      });
      throw error;
    }
  }

  async delByPattern(pattern: string): Promise<number> {
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

    try {
      return await this.withMutation(() => this.scanDirectory(glob));
    } catch (error) {
      logger.error("[DiskCache] delByPattern failed", {
        patternLength: pattern.length,
        errorName: error instanceof Error ? error.name : typeof error,
        code: (error as NodeJS.ErrnoException)?.code,
      });
      throw error;
    }
  }
}
