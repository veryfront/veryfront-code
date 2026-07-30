import { join } from "#veryfront/compat/path";
import { INVALID_ARGUMENT, UNKNOWN_ERROR } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import { agentLogger } from "#veryfront/utils";
import { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";
import {
  captureBlobBytes,
  captureBlobMetadata,
  captureBlobMimeType,
  captureExactBlobRecord,
  captureStoreBlobOptions,
  copyCapturedBlobMetadata,
  hasBlobControlCharacters,
} from "./contract.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";

const logger = agentLogger.component("local-blob-storage");
const MAX_DATE_MILLISECONDS = 8_640_000_000_000_000;
const MAX_LOCAL_ROOT_CODE_UNITS = 4_096;
const MAX_LOCAL_BASE_URL_CODE_UNITS = 2_048;
const LOCAL_STORAGE_RECORD_VERSION = 1;
const LOCAL_CONSTRUCTOR_OPTION_KEYS = new Set(["now"]);
const LOCAL_METADATA_KEYS = new Set([
  "__kind",
  "id",
  "size",
  "mimeType",
  "createdAt",
  "expiresAt",
  "url",
  "metadata",
  "storageVersion",
  "payloadFile",
]);
const dateGetTime = Date.prototype.getTime;

interface StoredBlobRecord {
  readonly ref: BlobRef;
  readonly payloadFile: string;
  readonly versioned: boolean;
}

function getDateMilliseconds(value: unknown, label: string): number {
  let milliseconds: unknown;
  try {
    milliseconds = Reflect.apply(dateGetTime, value, []);
  } catch (cause) {
    throw INVALID_ARGUMENT.create({ detail: `${label} returned an invalid date`, cause });
  }
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds)) {
    throw INVALID_ARGUMENT.create({ detail: `${label} returned an invalid date` });
  }
  return milliseconds;
}

function resolveBlobTimes(
  now: unknown,
  ttl: number | undefined,
): { createdAt: Date; expiresAt?: Date } {
  const createdAtMs = getDateMilliseconds(now, "Blob storage clock");
  const createdAt = new Date(createdAtMs);
  if (ttl === undefined || ttl === 0) return { createdAt };

  const expiresAtMs = createdAtMs + ttl * 1_000;
  if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs > MAX_DATE_MILLISECONDS) {
    throw INVALID_ARGUMENT.create({ detail: "Blob TTL exceeds the supported date range" });
  }
  return { createdAt, expiresAt: new Date(expiresAtMs) };
}

function parseStoredDate(value: unknown, label: string): Date {
  if (typeof value !== "string" || value.length > 64) {
    throw new TypeError(`${label} must be a bounded date string`);
  }
  const date = new Date(value);
  if (!Number.isFinite(Reflect.apply(dateGetTime, date, []))) {
    throw new TypeError(`${label} is invalid`);
  }
  return date;
}

function isVersionedPayloadFile(value: unknown, id: string): value is string {
  if (typeof value !== "string") return false;
  const prefix = `${id}.`;
  const suffix = ".data";
  if (!value.startsWith(prefix) || !value.endsWith(suffix)) return false;
  const token = value.slice(prefix.length, -suffix.length);
  return token.length >= 16 && token.length <= 64 && /^[A-Za-z0-9_-]+$/.test(token);
}

function parseStoredBlobRecord(value: unknown, expectedId: string): StoredBlobRecord {
  const fields = captureExactBlobRecord(value, "Local blob metadata", LOCAL_METADATA_KEYS);
  const id = fields.get("id");
  if (!isSafeBlobId(id) || id !== expectedId || fields.get("__kind") !== "blob") {
    throw new TypeError("Blob metadata has an invalid identity");
  }
  const size = fields.get("size");
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) {
    throw new TypeError("Blob metadata has an invalid size");
  }
  const mimeType = captureBlobMimeType(fields.get("mimeType"));
  const createdAt = parseStoredDate(fields.get("createdAt"), "Blob creation date");
  const rawExpiresAt = fields.get("expiresAt");
  const expiresAt = rawExpiresAt === undefined
    ? undefined
    : parseStoredDate(rawExpiresAt, "Blob expiry date");
  const rawUrl = fields.get("url");
  if (
    rawUrl !== undefined &&
    (typeof rawUrl !== "string" || rawUrl.length === 0 ||
      rawUrl.length > MAX_LOCAL_BASE_URL_CODE_UNITS || hasBlobControlCharacters(rawUrl))
  ) {
    throw new TypeError("Blob metadata has an invalid URL");
  }
  const metadata = captureBlobMetadata(fields.get("metadata"));

  const storageVersion = fields.get("storageVersion");
  const rawPayloadFile = fields.get("payloadFile");
  let payloadFile: string;
  let versioned: boolean;
  if (storageVersion === undefined && rawPayloadFile === undefined) {
    payloadFile = id;
    versioned = false;
  } else if (
    storageVersion === LOCAL_STORAGE_RECORD_VERSION && isVersionedPayloadFile(rawPayloadFile, id)
  ) {
    payloadFile = rawPayloadFile;
    versioned = true;
  } else {
    throw new TypeError("Blob metadata has an invalid storage pointer");
  }

  return {
    ref: {
      __kind: "blob",
      id,
      size,
      mimeType,
      createdAt,
      expiresAt,
      url: rawUrl as string | undefined,
      metadata: copyCapturedBlobMetadata(metadata),
    },
    payloadFile,
    versioned,
  };
}

function serializeStoredBlobRecord(ref: BlobRef, payloadFile: string): string {
  return JSON.stringify({
    ...ref,
    storageVersion: LOCAL_STORAGE_RECORD_VERSION,
    payloadFile,
  });
}

export class LocalBlobStorage implements BlobStorage {
  private readonly rootDir: string;
  private readonly baseUrl?: string;
  private fs: FileSystem;
  private readonly now: () => Date;
  private readonly mutationTails = new Map<string, Promise<void>>();

  constructor(rootDir: string, baseUrl?: string, options?: { now?: () => Date }) {
    if (
      typeof rootDir !== "string" || rootDir.length === 0 ||
      rootDir.length > MAX_LOCAL_ROOT_CODE_UNITS || rootDir.includes("\0")
    ) {
      throw INVALID_ARGUMENT.create({
        detail:
          `Local blob rootDir must not be empty or exceed ${MAX_LOCAL_ROOT_CODE_UNITS} code units`,
      });
    }
    if (
      baseUrl !== undefined &&
      (typeof baseUrl !== "string" || baseUrl.length === 0 ||
        baseUrl.length > MAX_LOCAL_BASE_URL_CODE_UNITS || hasBlobControlCharacters(baseUrl))
    ) {
      throw INVALID_ARGUMENT.create({ detail: "Local blob baseUrl is invalid" });
    }
    const optionFields = options === undefined
      ? new Map<string, unknown>()
      : captureExactBlobRecord(
        options,
        "Local blob storage options",
        LOCAL_CONSTRUCTOR_OPTION_KEYS,
      );
    const now = optionFields.get("now");
    if (
      now !== undefined && (typeof now !== "function" || isProxyWithoutHooks(now))
    ) {
      throw INVALID_ARGUMENT.create({
        detail: "Local blob storage now must be a non-Proxy function",
      });
    }

    this.rootDir = rootDir;
    this.baseUrl = baseUrl;
    this.fs = createFileSystem();
    this.now = (now as (() => Date) | undefined) ?? (() => new Date());
  }

  private getPrefixDir(id: string): string {
    assertSafeBlobId(id);
    return join(this.rootDir, id.slice(0, 2));
  }

  private getLegacyPath(id: string): string {
    return join(this.getPrefixDir(id), id);
  }

  private getPayloadPath(id: string, payloadFile: string): string {
    if (payloadFile !== id && !isVersionedPayloadFile(payloadFile, id)) {
      throw INVALID_ARGUMENT.create({ detail: "Local blob payload pointer is invalid" });
    }
    return join(this.getPrefixDir(id), payloadFile);
  }

  private getMetadataPath(id: string): string {
    return `${this.getLegacyPath(id)}.meta.json`;
  }

  private async withMutationLock<T>(id: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationTails.get(id) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.catch(() => undefined).then(() => gate);
    this.mutationTails.set(id, tail);
    await previous.catch(() => undefined);
    try {
      return await operation();
    } finally {
      release();
      if (this.mutationTails.get(id) === tail) this.mutationTails.delete(id);
    }
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options?: StoreBlobOptions,
  ): Promise<BlobRef> {
    const capturedOptions = captureStoreBlobOptions(options);
    const id = capturedOptions.id ?? crypto.randomUUID();
    assertSafeBlobId(id);
    const mimeType = capturedOptions.mimeType ?? "application/octet-stream";
    const bytes = await captureBlobBytes(data);
    const { createdAt, expiresAt } = resolveBlobTimes(this.now(), capturedOptions.ttl);
    const metadata = copyCapturedBlobMetadata(capturedOptions.metadata);
    const ref: BlobRef = {
      __kind: "blob",
      id,
      size: bytes.byteLength,
      mimeType,
      createdAt,
      expiresAt,
      metadata,
      url: this.baseUrl ? `${this.baseUrl}/${id}` : undefined,
    };

    return await this.withMutationLock(id, async () => {
      if (!this.fs.rename) {
        throw UNKNOWN_ERROR.create({
          detail: "Local blob storage requires atomic filesystem rename support",
        });
      }
      const prior = await this.readStoredBlobRecord(id);
      const token = crypto.randomUUID();
      const prefixDir = this.getPrefixDir(id);
      const payloadFile = `${id}.${token}.data`;
      const payloadPath = this.getPayloadPath(id, payloadFile);
      const temporaryPayloadPath = join(prefixDir, `.${id}.${token}.data.tmp`);
      const metadataPath = this.getMetadataPath(id);
      const temporaryMetadataPath = join(prefixDir, `.${id}.${token}.meta.tmp`);
      const metadataJson = serializeStoredBlobRecord(ref, payloadFile);

      let committed = false;
      try {
        await this.fs.mkdir(prefixDir, { recursive: true });
        await this.fs.writeFile(temporaryPayloadPath, bytes);
        await this.fs.writeTextFile(temporaryMetadataPath, metadataJson);
        await this.fs.rename(temporaryPayloadPath, payloadPath);
        await this.fs.rename(temporaryMetadataPath, metadataPath);
        committed = true;
      } catch (operationError) {
        const cleanupFailures = await this.removePathsIfPresent([
          temporaryPayloadPath,
          temporaryMetadataPath,
          payloadPath,
        ]);
        logger.warn("Failed to commit local blob transaction", {
          operationErrorName: operationError instanceof Error
            ? operationError.name
            : typeof operationError,
          cleanupFailureCount: cleanupFailures.length,
        });
        throw UNKNOWN_ERROR.create({
          detail: cleanupFailures.length === 0
            ? "Failed to commit blob to local storage"
            : "Failed to commit blob and roll back local storage transaction",
        });
      }

      if (!committed) {
        throw UNKNOWN_ERROR.create({ detail: "Failed to commit blob to local storage" });
      }

      const priorPayloadPath = prior
        ? this.getPayloadPath(id, prior.payloadFile)
        : this.getLegacyPath(id);
      if (priorPayloadPath !== payloadPath) {
        const cleanupFailures = await this.removePathsIfPresent([priorPayloadPath]);
        if (cleanupFailures.length > 0) {
          logger.warn("Committed local blob overwrite left a stale payload", {
            cleanupFailureCount: cleanupFailures.length,
          });
        }
      }
      return ref;
    });
  }

  private async removePathsIfPresent(paths: readonly string[]): Promise<unknown[]> {
    const results = await Promise.allSettled(paths.map(async (path) => {
      try {
        await this.fs.remove(path);
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }));
    return results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
  }

  private async readStoredBlobRecord(id: string): Promise<StoredBlobRecord | null> {
    assertSafeBlobId(id);
    const metadataPath = this.getMetadataPath(id);
    let json: string;
    try {
      json = await this.fs.readTextFile(metadataPath);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      logger.warn("Failed to read local blob metadata", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw UNKNOWN_ERROR.create({ detail: "Failed to read blob metadata from local storage" });
    }

    try {
      return parseStoredBlobRecord(JSON.parse(json), id);
    } catch (error) {
      logger.warn("Invalid local blob metadata", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw UNKNOWN_ERROR.create({ detail: "Invalid blob metadata in local storage" });
    }
  }

  private async resolveReadTarget(
    id: string,
  ): Promise<{ path: string; committed: boolean; record: StoredBlobRecord | null }> {
    const record = await this.readStoredBlobRecord(id);
    return {
      path: record ? this.getPayloadPath(id, record.payloadFile) : this.getLegacyPath(id),
      committed: record !== null,
      record,
    };
  }

  private async readPayload<T>(
    id: string,
    read: (path: string) => Promise<T>,
    detail: string,
  ): Promise<T | null> {
    const target = await this.resolveReadTarget(id);
    try {
      return await read(target.path);
    } catch (error) {
      if (isNotFoundError(error) && !target.committed) return null;
      logger.warn("Failed to read local blob payload", {
        committed: target.committed,
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw UNKNOWN_ERROR.create({ detail });
    }
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const bytes = await this.getBytes(id);
    if (!bytes) return null;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  getText(id: string): Promise<string | null> {
    return this.readPayload(
      id,
      (path) => this.fs.readTextFile(path),
      "Failed to read blob text from local storage",
    );
  }

  getBytes(id: string): Promise<Uint8Array | null> {
    return this.readPayload(
      id,
      (path) => this.fs.readFile(path),
      "Failed to read blob bytes from local storage",
    );
  }

  async delete(id: string): Promise<void> {
    assertSafeBlobId(id);
    await this.withMutationLock(id, async () => {
      const record = await this.readStoredBlobRecord(id);
      const payloadPath = record
        ? this.getPayloadPath(id, record.payloadFile)
        : this.getLegacyPath(id);
      const failures = await this.removePathsIfPresent([payloadPath, this.getMetadataPath(id)]);
      if (failures.length > 0) {
        logger.warn("Failed to delete local blob", { failureCount: failures.length });
        throw UNKNOWN_ERROR.create({ detail: "Failed to delete blob from local storage" });
      }
    });
  }

  async exists(id: string): Promise<boolean> {
    const target = await this.resolveReadTarget(id);
    const exists = await this.fs.exists(target.path);
    if (!exists && target.committed) {
      throw UNKNOWN_ERROR.create({ detail: "Blob metadata references a missing local payload" });
    }
    return exists;
  }

  async stat(id: string): Promise<BlobRef | null> {
    const record = await this.readStoredBlobRecord(id);
    if (!record) return null;
    if (!await this.fs.exists(this.getPayloadPath(id, record.payloadFile))) {
      throw UNKNOWN_ERROR.create({ detail: "Blob metadata references a missing local payload" });
    }
    return record.ref;
  }

  private async getPrefixDirectories(): Promise<string[]> {
    const directories: string[] = [];
    try {
      for await (const entry of this.fs.readDir(this.rootDir)) {
        if (entry.isDirectory && !entry.isSymlink) directories.push(entry.name);
      }
    } catch (error) {
      if (isNotFoundError(error)) return [];
      throw error;
    }
    return directories.sort();
  }

  /** Enumerate every committed, non-expired blob, newest first. */
  async list(): Promise<BlobRef[]> {
    const now = new Date(getDateMilliseconds(this.now(), "Blob storage clock"));
    const refs: BlobRef[] = [];

    for (const prefix of await this.getPrefixDirectories()) {
      const prefixDir = join(this.rootDir, prefix);
      try {
        for await (const entry of this.fs.readDir(prefixDir)) {
          if (!entry.isFile || !entry.name.endsWith(".meta.json")) continue;
          const id = entry.name.slice(0, -".meta.json".length);
          if (!isSafeBlobId(id)) continue;
          const ref = await this.stat(id);
          if (!ref || (ref.expiresAt && ref.expiresAt <= now)) continue;
          refs.push(ref);
        }
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }
    return refs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /** Delete every committed blob whose logical TTL has elapsed. */
  async cleanupExpiredBlobs(): Promise<void> {
    const now = new Date(getDateMilliseconds(this.now(), "Blob storage clock"));
    for (const prefix of await this.getPrefixDirectories()) {
      const prefixDir = join(this.rootDir, prefix);
      try {
        for await (const entry of this.fs.readDir(prefixDir)) {
          if (!entry.isFile || !entry.name.endsWith(".meta.json")) continue;
          const id = entry.name.slice(0, -".meta.json".length);
          if (!isSafeBlobId(id)) continue;
          const blobRef = await this.stat(id);
          if (!blobRef?.expiresAt || blobRef.expiresAt > now) continue;
          logger.debug(`Deleting expired blob: ${id}`);
          await this.delete(id);
        }
      } catch (error) {
        if (!isNotFoundError(error)) throw error;
      }
    }
  }
}
