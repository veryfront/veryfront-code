import { join } from "#veryfront/compat/path/index.ts";
import { constants as fsConstants } from "node:fs";
import { getCacheBaseDir } from "#veryfront/utils/cache-dir.ts";
import { logger } from "#veryfront/utils";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";
import type { CacheBackend } from "../types.ts";
import { assertCacheReadMaximumBytes, CacheValueTooLargeError } from "../bounded-read.ts";
import { type CacheGlob, compileCacheGlob } from "./glob.ts";

const CACHE_SUBDIR = "veryfront-files";
const CACHE_FILE_SUFFIX = ".vfcache";
const CACHE_FILE_PATTERN = /^[0-9a-f]{64}\.vfcache$/;
const MAX_GLOB_CACHE_SIZE = 100;
const MAX_CACHE_KEY_CODE_UNITS = 64 * 1024;
const KEY_DIGEST_LOG_CHARS = 12;
const MAX_CACHE_NAMESPACE_BYTES = 240;
const MAX_DIRECTORY_SCAN_ENTRIES = 100_000;
const EXPIRY_PRUNE_BATCH_SIZE = 256;
const EXPIRY_PRUNE_WRITE_INTERVAL = 32;
const DEFAULT_MAX_VALUE_BYTES = 64 * 1024 * 1024;
const MAX_CONFIGURED_VALUE_BYTES = 512 * 1024 * 1024;
const FRAME_HEADER_BYTES = 40;
const FRAME_KEY_CODE_UNITS_OFFSET = 8;
const FRAME_VALUE_CODE_UNITS_OFFSET = 16;
const FRAME_VALUE_UTF8_BYTES_OFFSET = 24;
const FRAME_EXPIRES_AT_OFFSET = 32;
const STRING_DECODE_CHUNK_CODE_UNITS = 8 * 1024;
const PORTABLE_NAMESPACE_CHAR = /^[a-z0-9_-]$/;
const WINDOWS_RESERVED_NAMES = /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;
const FRAME_MAGIC = new Uint8Array([0x56, 0x46, 0x43, 0x41, 0x43, 0x48, 0x45, 0x34]);
const fsPromises = import("node:fs/promises");

type DiskFileHandle = Awaited<ReturnType<(Awaited<typeof fsPromises>)["open"]>>;

interface DiskCacheEnvelope {
  key: string;
  value?: string;
  expiresAt?: number;
}

interface FramedHeader {
  keyCodeUnits: number;
  valueCodeUnits: number;
  valueUtf8Bytes: number;
  expiresAt?: number;
  fileBytes: number;
}

class InvalidDiskCacheFileError extends Error {
  constructor(message = "Disk cache file is not a stable framed entry") {
    super(message);
    this.name = "InvalidDiskCacheFileError";
  }
}

function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}

function encodeCacheNamespace(keyPrefix: string): string {
  let portable = keyPrefix.length <= MAX_CACHE_NAMESPACE_BYTES &&
    !WINDOWS_RESERVED_NAMES.test(keyPrefix);
  for (let index = 0; portable && index < keyPrefix.length; index++) {
    portable = PORTABLE_NAMESPACE_CHAR.test(keyPrefix[index]!);
  }
  if (portable) {
    return keyPrefix;
  }

  let encoded = "~";
  for (let index = 0; index < keyPrefix.length; index++) {
    const character = keyPrefix[index]!;
    encoded += PORTABLE_NAMESPACE_CHAR.test(character)
      ? character
      : `~${keyPrefix.charCodeAt(index).toString(16).padStart(4, "0")}`;
  }
  if (encoded.length > MAX_CACHE_NAMESPACE_BYTES) {
    throw new TypeError("Disk cache key prefix is too long for a portable directory name");
  }
  return encoded;
}

async function digestKey(input: string): Promise<string> {
  if (typeof input !== "string") throw new TypeError("Disk cache key must be a string");
  if (input.length > MAX_CACHE_KEY_CODE_UNITS) {
    throw new RangeError(`Disk cache key exceeds ${MAX_CACHE_KEY_CODE_UNITS} characters`);
  }
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

/**
 * A non-reversible label for a cache key, safe to put in a log payload.
 *
 * This backend serves user KV entries whose keys can embed tokens or other
 * credentials, so diagnostics carry the digest instead of key text. It is the
 * prefix of the same SHA-256 that names the entry's file, which keeps a log
 * line walkable to the entry on disk: the same key always yields the same
 * digest, and two equal digests in a collision warning mean a genuine SHA-256
 * collision rather than a file overwritten by an unrelated write.
 */
async function logKeyDigest(key: string): Promise<string> {
  try {
    return (await digestKey(key)).slice(0, KEY_DIGEST_LOG_CHARS);
  } catch {
    return "unavailable";
  }
}

function setSafeUint64(view: DataView, offset: number, value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError("Disk cache framed length must be a non-negative safe integer");
  }
  view.setBigUint64(offset, BigInt(value));
}

function getSafeUint64(view: DataView, offset: number): number {
  const encoded = view.getBigUint64(offset);
  const value = Number(encoded);
  if (!Number.isSafeInteger(value) || BigInt(value) !== encoded) {
    throw new InvalidDiskCacheFileError();
  }
  return value;
}

function framedFileBytes(keyCodeUnits: number, valueCodeUnits: number): number {
  const byteLength = FRAME_HEADER_BYTES + keyCodeUnits * 2 + valueCodeUnits * 2;
  if (!Number.isSafeInteger(byteLength)) throw new InvalidDiskCacheFileError();
  return byteLength;
}

function writeUtf16CodeUnits(target: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    target[offset++] = codeUnit >>> 8;
    target[offset++] = codeUnit & 0xff;
  }
}

function readCodeUnit(source: Uint8Array, codeUnitIndex: number): number {
  const offset = codeUnitIndex * 2;
  return source[offset]! << 8 | source[offset + 1]!;
}

function measureUtf8FromUtf16CodeUnits(source: Uint8Array): number {
  let byteLength = 0;
  const codeUnits = source.byteLength / 2;
  for (let index = 0; index < codeUnits; index++) {
    const codeUnit = readCodeUnit(source, index);
    if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff && index + 1 < codeUnits) {
      const low = readCodeUnit(source, index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        byteLength += 4;
        index++;
      } else {
        byteLength += 3;
      }
    } else {
      byteLength += 3;
    }
    if (!Number.isSafeInteger(byteLength)) throw new InvalidDiskCacheFileError();
  }
  return byteLength;
}

function decodeUtf16CodeUnits(source: Uint8Array): string {
  const codeUnitCount = source.byteLength / 2;
  if (codeUnitCount === 0) return "";
  const chunks: string[] = [];
  const values = new Array<number>(
    Math.min(codeUnitCount, STRING_DECODE_CHUNK_CODE_UNITS),
  );
  let codeUnitOffset = 0;
  while (codeUnitOffset < codeUnitCount) {
    const count = Math.min(
      STRING_DECODE_CHUNK_CODE_UNITS,
      codeUnitCount - codeUnitOffset,
    );
    for (let index = 0; index < count; index++) {
      values[index] = readCodeUnit(source, codeUnitOffset + index);
    }
    chunks.push(String.fromCharCode(...values.slice(0, count)));
    codeUnitOffset += count;
  }
  return chunks.join("");
}

function encodeEnvelope(
  key: string,
  value: string,
  valueUtf8Bytes: number,
  expiresAt: number | undefined,
): Uint8Array {
  const content = new Uint8Array(framedFileBytes(key.length, value.length));
  content.set(FRAME_MAGIC, 0);
  const header = new DataView(
    content.buffer,
    content.byteOffset,
    FRAME_HEADER_BYTES,
  );
  setSafeUint64(header, FRAME_KEY_CODE_UNITS_OFFSET, key.length);
  setSafeUint64(header, FRAME_VALUE_CODE_UNITS_OFFSET, value.length);
  setSafeUint64(header, FRAME_VALUE_UTF8_BYTES_OFFSET, valueUtf8Bytes);
  header.setFloat64(FRAME_EXPIRES_AT_OFFSET, expiresAt ?? 0);
  writeUtf16CodeUnits(content, FRAME_HEADER_BYTES, key);
  writeUtf16CodeUnits(content, FRAME_HEADER_BYTES + key.length * 2, value);
  return content;
}

function parseHeader(bytes: Uint8Array, configuredMaximumBytes: number): FramedHeader {
  if (bytes.byteLength !== FRAME_HEADER_BYTES) throw new InvalidDiskCacheFileError();
  for (let index = 0; index < FRAME_MAGIC.byteLength; index++) {
    if (bytes[index] !== FRAME_MAGIC[index]) throw new InvalidDiskCacheFileError();
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const keyCodeUnits = getSafeUint64(view, FRAME_KEY_CODE_UNITS_OFFSET);
  const valueCodeUnits = getSafeUint64(view, FRAME_VALUE_CODE_UNITS_OFFSET);
  const valueUtf8Bytes = getSafeUint64(view, FRAME_VALUE_UTF8_BYTES_OFFSET);
  const rawExpiresAt = view.getFloat64(FRAME_EXPIRES_AT_OFFSET);
  if (
    keyCodeUnits > MAX_CACHE_KEY_CODE_UNITS ||
    valueUtf8Bytes > configuredMaximumBytes ||
    valueCodeUnits > valueUtf8Bytes ||
    valueUtf8Bytes > valueCodeUnits * 3 ||
    !Number.isFinite(rawExpiresAt) || rawExpiresAt < 0
  ) {
    throw new InvalidDiskCacheFileError();
  }
  return {
    keyCodeUnits,
    valueCodeUnits,
    valueUtf8Bytes,
    expiresAt: rawExpiresAt === 0 ? undefined : rawExpiresAt,
    fileBytes: framedFileBytes(keyCodeUnits, valueCodeUnits),
  };
}

async function readExactly(
  handle: DiskFileHandle,
  target: Uint8Array,
  fileOffset: number,
): Promise<void> {
  let targetOffset = 0;
  while (targetOffset < target.byteLength) {
    const { bytesRead } = await handle.read(
      target,
      targetOffset,
      target.byteLength - targetOffset,
      fileOffset + targetOffset,
    );
    if (
      !Number.isSafeInteger(bytesRead) || bytesRead <= 0 ||
      bytesRead > target.byteLength - targetOffset
    ) {
      throw new InvalidDiskCacheFileError();
    }
    targetOffset += bytesRead;
  }
}

async function closeHandle<T>(
  handle: DiskFileHandle,
  operation: () => Promise<T>,
): Promise<T> {
  let result: T | undefined;
  let failed = false;
  let primaryFailure: unknown;
  try {
    result = await operation();
  } catch (error) {
    failed = true;
    primaryFailure = error;
  }
  try {
    await handle.close();
  } catch (cleanupFailure) {
    if (failed) {
      throw new AggregateError(
        [primaryFailure, cleanupFailure],
        "Disk cache read and handle cleanup both failed",
      );
    }
    throw cleanupFailure;
  }
  if (failed) throw primaryFailure;
  return result as T;
}

/**
 * Persistent local cache using the bounded VFCACHE4 binary frame.
 *
 * Keys name files by SHA-256 and are also stored inside the frame so a digest
 * mismatch remains a cache miss. Strings are stored as UTF-16 code units to
 * preserve every ECMAScript string, including lone surrogates; the frame also
 * records the logical UTF-8 byte length used by `getWithinLimit()`.
 *
 * Cache files written by the former JSON format are intentionally ignored as
 * cold misses. Cache data is disposable, so no in-place migration is required.
 */
export class DiskCacheBackend implements CacheBackend {
  readonly type = "disk" as const;
  private readonly dir: string;
  private readonly globCache = new Map<string, CacheGlob>();
  private readonly maxValueBytes: number;
  private readonly maxFileBytes: number;
  private mutationTail: Promise<void> = Promise.resolve();
  private writesUntilExpiryPrune = 1;
  private expiryPruneOffset = 0;

  constructor(
    baseDir?: string,
    keyPrefix?: string,
    maxValueBytes = DEFAULT_MAX_VALUE_BYTES,
  ) {
    const base = join(baseDir ?? getCacheBaseDir(), CACHE_SUBDIR);
    this.dir = keyPrefix ? join(base, encodeCacheNamespace(keyPrefix)) : base;
    if (
      !Number.isSafeInteger(maxValueBytes) || maxValueBytes <= 0 ||
      maxValueBytes > MAX_CONFIGURED_VALUE_BYTES
    ) {
      throw new RangeError("Disk cache maxValueBytes is outside the supported range");
    }
    this.maxValueBytes = maxValueBytes;
    this.maxFileBytes = framedFileBytes(MAX_CACHE_KEY_CODE_UNITS, maxValueBytes);
  }

  private async filePath(key: string): Promise<string> {
    return join(this.dir, `${await digestKey(key)}${CACHE_FILE_SUFFIX}`);
  }

  private async ensureDir(): Promise<void> {
    const { mkdir } = await fsPromises;
    await mkdir(this.dir, { recursive: true, mode: 0o700 });
  }

  private async withMutation<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTail;
    let release!: () => void;
    this.mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }

  private async readFramedFile(
    filePath: string,
    expectedKey: string | undefined,
    maximumValueBytes: number | undefined,
    includeValue: boolean,
  ): Promise<DiskCacheEnvelope> {
    const { open } = await fsPromises;
    let handle: DiskFileHandle;
    try {
      handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ELOOP") {
        throw new InvalidDiskCacheFileError();
      }
      throw error;
    }
    return await closeHandle(handle, async () => {
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.size > BigInt(this.maxFileBytes)) {
        throw new InvalidDiskCacheFileError();
      }

      const headerBytes = new Uint8Array(FRAME_HEADER_BYTES);
      await readExactly(handle, headerBytes, 0);
      const header = parseHeader(headerBytes, this.maxValueBytes);
      if (BigInt(header.fileBytes) !== opened.size) {
        throw new InvalidDiskCacheFileError();
      }

      const keyBytes = new Uint8Array(header.keyCodeUnits * 2);
      await readExactly(handle, keyBytes, FRAME_HEADER_BYTES);
      const key = decodeUtf16CodeUnits(keyBytes);
      const envelope: DiskCacheEnvelope = { key, expiresAt: header.expiresAt };
      const verifyStableHandle = async (): Promise<void> => {
        const after = await handle.stat({ bigint: true });
        if (
          after.dev !== opened.dev || after.ino !== opened.ino ||
          after.size !== opened.size || after.mtimeNs !== opened.mtimeNs ||
          after.ctimeNs !== opened.ctimeNs
        ) {
          throw new InvalidDiskCacheFileError();
        }
      };
      if (
        (expectedKey !== undefined && key !== expectedKey) ||
        (header.expiresAt !== undefined && Date.now() >= header.expiresAt) ||
        !includeValue
      ) {
        await verifyStableHandle();
        return envelope;
      }
      if (
        maximumValueBytes !== undefined &&
        header.valueUtf8Bytes > maximumValueBytes
      ) {
        throw new CacheValueTooLargeError(maximumValueBytes);
      }

      const valueBytes = new Uint8Array(header.valueCodeUnits * 2);
      await readExactly(
        handle,
        valueBytes,
        FRAME_HEADER_BYTES + header.keyCodeUnits * 2,
      );
      if (measureUtf8FromUtf16CodeUnits(valueBytes) !== header.valueUtf8Bytes) {
        throw new InvalidDiskCacheFileError();
      }
      await verifyStableHandle();
      envelope.value = decodeUtf16CodeUnits(valueBytes);
      return envelope;
    });
  }

  private async readEnvelopeWithinValueLimit(
    key: string,
    maximumBytes: number,
  ): Promise<DiskCacheEnvelope | null> {
    const admittedMaximum = assertCacheReadMaximumBytes(maximumBytes);
    try {
      return await this.readFramedFile(
        await this.filePath(key),
        key,
        admittedMaximum,
        true,
      );
    } catch (error) {
      if (isNotFound(error)) return null;
      if (error instanceof CacheValueTooLargeError) throw error;
      if (error instanceof InvalidDiskCacheFileError) return null;
      throw error;
    }
  }

  /**
   * Remove a cache file, but only while it still holds the expired entry.
   *
   * Dev servers and build steps share a project cache, so another process can
   * replace the pathname between the expiry check and the deletion. Deleting by
   * pathname would then remove that fresh entry. The file is claimed with an
   * atomic rename and revalidated on the claimed inode instead, and a claim
   * that turns out to hold a fresh entry is linked back under its original
   * name. Both the write-time sweep and the read-time cleanup go through this,
   * so neither can delete a write that won the race.
   */
  private async removeExpiredEntryFile(filePath: string): Promise<void> {
    const { link, rename, unlink } = await fsPromises;
    const claimPath = `${filePath}.prune.${crypto.randomUUID()}`;
    try {
      await rename(filePath, claimPath);
    } catch {
      // Another process already replaced or removed the entry.
      return;
    }

    let restoreClaim = true;
    try {
      const claimed = await this.readFramedFile(claimPath, undefined, undefined, false);
      if (claimed.expiresAt !== undefined && Date.now() >= claimed.expiresAt) {
        await unlink(claimPath);
        restoreClaim = false;
      }
    } catch {
      // An unreadable claim is restored rather than deleted: the pathname may
      // now hold a fresh entry this process never validated.
    }

    if (!restoreClaim) return;
    let discardClaim = false;
    try {
      await link(claimPath, filePath);
      discardClaim = true;
    } catch (error) {
      // A newer writer already owns the pathname, so its entry wins.
      if ((error as NodeJS.ErrnoException).code === "EEXIST") discardClaim = true;
    }
    if (discardClaim) await unlink(claimPath).catch(() => {});
  }

  /**
   * Drop an entry a read found expired.
   *
   * Queued on the mutation tail so it cannot interleave with this instance's
   * own writes, and so a caller can flush it by awaiting any later operation.
   */
  private expireEntry(key: string): Promise<void> {
    return this.withMutation(async () => {
      await this.removeExpiredEntryFile(await this.filePath(key));
    });
  }

  private async pruneExpiredEntries(): Promise<void> {
    const { opendir } = await fsPromises;
    const directory = await opendir(this.dir);
    let scanned = 0;
    let eligible = 0;
    let processed = 0;

    for await (const entry of directory) {
      scanned++;
      if (scanned > MAX_DIRECTORY_SCAN_ENTRIES) break;
      if (!entry.isFile() || !CACHE_FILE_PATTERN.test(entry.name)) continue;
      if (eligible++ < this.expiryPruneOffset) continue;
      if (processed >= EXPIRY_PRUNE_BATCH_SIZE) break;
      processed++;

      const filePath = join(this.dir, entry.name);
      try {
        const envelope = await this.readFramedFile(filePath, undefined, undefined, false);
        if (envelope.expiresAt !== undefined && Date.now() >= envelope.expiresAt) {
          await this.removeExpiredEntryFile(filePath);
        }
      } catch {
        // Cache files are disposable and may be replaced by another process.
      }
    }

    this.expiryPruneOffset = processed < EXPIRY_PRUNE_BATCH_SIZE
      ? 0
      : this.expiryPruneOffset + processed;
  }

  private async maybePruneExpiredEntries(): Promise<void> {
    if (this.writesUntilExpiryPrune > 0) {
      this.writesUntilExpiryPrune--;
      return;
    }
    this.writesUntilExpiryPrune = EXPIRY_PRUNE_WRITE_INTERVAL - 1;
    await this.pruneExpiredEntries();
  }

  async get(key: string): Promise<string | null> {
    try {
      await this.mutationTail;
      const envelope = await this.readEnvelopeWithinValueLimit(key, this.maxValueBytes);
      if (!envelope) return null;
      if (envelope.key !== key) {
        // The filename digest collided: this file belongs to a different key, so
        // a prior write for one of them silently overwrote the other's data.
        // Carry both key digests so collisions stay diagnosable in production
        // instead of reading as an ordinary miss.
        logger.warn("[DiskCache] Filename digest collision; stored key does not match", {
          requestedKeyDigest: await logKeyDigest(key),
          storedKeyDigest: await logKeyDigest(envelope.key),
        });
        return null;
      }
      if (envelope.expiresAt !== undefined && Date.now() >= envelope.expiresAt) {
        this.expireEntry(key).catch(async (cleanupError) => {
          logger.debug("[DiskCache] Expired entry cleanup failed", {
            keyDigest: await logKeyDigest(key),
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        });
        return null;
      }
      return envelope.value ?? null;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        logger.error("[DiskCache] Read error", {
          error: error instanceof Error ? error.message : String(error),
          code,
        });
      }
      return null;
    }
  }

  async getWithinLimit(key: string, maximumBytes: number): Promise<string | null> {
    const admittedMaximum = assertCacheReadMaximumBytes(maximumBytes);
    try {
      await this.mutationTail;
      const envelope = await this.readEnvelopeWithinValueLimit(key, admittedMaximum);
      if (!envelope || envelope.key !== key) return null;
      if (envelope.expiresAt !== undefined && Date.now() >= envelope.expiresAt) {
        void this.expireEntry(key);
        return null;
      }
      if (envelope.value === undefined) throw new InvalidDiskCacheFileError();
      return envelope.value;
    } catch (error) {
      if (error instanceof CacheValueTooLargeError) throw error;
      const code = (error as NodeJS.ErrnoException)?.code;
      if (code !== "ENOENT") {
        logger.error("[DiskCache] Bounded read error", {
          error: error instanceof Error ? error.message : String(error),
          code,
        });
      }
      return null;
    }
  }

  async getRemainingTtlSeconds(key: string): Promise<number | null> {
    try {
      await this.mutationTail;
      const envelope = await this.readFramedFile(await this.filePath(key), key, undefined, false);
      if (envelope.key !== key) return null;
      if (envelope.expiresAt === undefined) return Infinity;
      const remainingMs = envelope.expiresAt - Date.now();
      return remainingMs <= 0 ? null : remainingMs / 1000;
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (key.length > MAX_CACHE_KEY_CODE_UNITS) {
      throw new RangeError(`Disk cache key exceeds ${MAX_CACHE_KEY_CODE_UNITS} characters`);
    }
    const valueUtf8Bytes = utf8ByteLength(value, this.maxValueBytes);
    if (valueUtf8Bytes > this.maxValueBytes) {
      throw new CacheValueTooLargeError(this.maxValueBytes);
    }
    let expiresAt: number | undefined;
    if (ttlSeconds !== undefined) {
      if (!Number.isFinite(ttlSeconds)) {
        throw new RangeError("Disk cache TTL must be finite");
      }
      expiresAt = Date.now() + ttlSeconds * 1_000;
      if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
        throw new RangeError("Disk cache TTL is outside the supported range");
      }
    }

    const content = encodeEnvelope(key, value, valueUtf8Bytes, expiresAt);
    await this.withMutation(async () => {
      await this.ensureDir();
      const filePath = await this.filePath(key);
      const tmpPath = `${filePath}.tmp.${Date.now()}.${crypto.randomUUID()}`;
      const { writeFile, rename, unlink } = await fsPromises;
      try {
        await writeFile(tmpPath, content, { flag: "wx", mode: 0o600 });
        // This atomic replacement is also the commit point used by expiry
        // pruning. The pruner claims and revalidates whichever entry wins it.
        await rename(tmpPath, filePath);
      } catch (error) {
        await unlink(tmpPath).catch((cleanupError) => {
          logger.debug("[DiskCache] Temp file cleanup failed", {
            error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
          });
        });
        throw error;
      }
      await this.maybePruneExpiredEntries().catch((error) => {
        logger.debug("[DiskCache] Expired entry pruning failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    });
  }

  async del(key: string): Promise<void> {
    await this.withMutation(async () => {
      try {
        const { unlink } = await fsPromises;
        await unlink(await this.filePath(key));
      } catch (error) {
        const code = (error as NodeJS.ErrnoException)?.code;
        if (code !== "ENOENT") {
          logger.error("[DiskCache] Delete error", {
            error: error instanceof Error ? error.message : String(error),
            code,
          });
        }
      }
    });
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

    return await this.withMutation(async () => {
      let deleted = 0;
      let scanned = 0;
      let unreadable = 0;
      try {
        const { opendir, unlink } = await fsPromises;
        const directory = await opendir(this.dir);
        for await (const entry of directory) {
          scanned++;
          if (scanned > MAX_DIRECTORY_SCAN_ENTRIES) {
            logger.warn("[DiskCache] Stopped bounded cache directory scan", {
              maximumEntries: MAX_DIRECTORY_SCAN_ENTRIES,
            });
            break;
          }
          if (!entry.isFile() || !CACHE_FILE_PATTERN.test(entry.name)) continue;
          const filePath = join(this.dir, entry.name);
          try {
            const envelope = await this.readFramedFile(filePath, undefined, undefined, false);
            if (glob.test(envelope.key)) {
              await unlink(filePath);
              deleted++;
            }
          } catch {
            unreadable++;
          }
        }
      } catch (error) {
        if (isNotFound(error)) return deleted;
        logger.error("[DiskCache] delByPattern: directory not accessible", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (unreadable > 0) {
        logger.warn("[DiskCache] Skipped unreadable cache files during pattern deletion", {
          count: unreadable,
        });
      }
      return deleted;
    });
  }
}
