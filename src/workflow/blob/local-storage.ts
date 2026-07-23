import { join } from "#veryfront/compat/path";
import { createFileSystem, isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { agentLogger } from "#veryfront/utils";
import { INVALID_ARGUMENT, NOT_SUPPORTED, UNKNOWN_ERROR } from "#veryfront/errors";
import { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";

const logger = agentLogger.component("local-blob-storage");
const METADATA_READ_ERROR = "Failed to read blob metadata from local storage";
const STORAGE_LAYOUT_DIRECTORY = "v2";
const COMMITS_DIRECTORY = "commits";
const STAGING_DIRECTORY = "staging";
const PAYLOAD_FILENAME = "payload";
const METADATA_FILENAME = "metadata.json";
const STORAGE_VERSION = 2;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const PARTITION_PATTERN = /^[0-9a-f]{2}$/;
const COMMIT_NAME_PATTERN = /^[0-9a-f]{12}-[0-9a-f]{8}-[0-9a-f]{32}$/;
const MAX_RESOLUTION_ATTEMPTS = 3;

interface StoredBlobCommit {
  storageVersion: typeof STORAGE_VERSION;
  kind: "blob";
  id: string;
  commitId: string;
  ref: BlobRef;
}

interface StoredDeleteCommit {
  storageVersion: typeof STORAGE_VERSION;
  kind: "deleted";
  id: string;
  commitId: string;
}

type StoredCommit = StoredBlobCommit | StoredDeleteCommit;

interface ResolvedBlobCommit extends StoredBlobCommit {
  objectDir: string;
  commitDir: string;
  payloadPath: string;
}

interface ResolvedDeleteCommit extends StoredDeleteCommit {
  objectDir: string;
  commitDir: string;
}

type ResolvedCommit = ResolvedBlobCommit | ResolvedDeleteCommit;

function parseStoredDate(value: unknown): Date | null {
  if (typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every((entry) => typeof entry === "string");
}

function parseStoredBlobRef(value: unknown, requestedId: string): BlobRef {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid blob metadata");
  }

  const data = value as Record<string, unknown>;
  const createdAt = parseStoredDate(data.createdAt);
  let expiresAt: Date | undefined;
  if (data.expiresAt !== undefined) {
    const parsedExpiresAt = parseStoredDate(data.expiresAt);
    if (!parsedExpiresAt) throw new Error("Invalid blob metadata");
    expiresAt = parsedExpiresAt;
  }
  const metadata = data.metadata;

  if (
    data.__kind !== "blob" ||
    data.id !== requestedId ||
    !Number.isSafeInteger(data.size) ||
    (data.size as number) < 0 ||
    typeof data.mimeType !== "string" ||
    data.mimeType.length === 0 ||
    !createdAt ||
    (data.url !== undefined && typeof data.url !== "string") ||
    (metadata !== undefined && !isStringRecord(metadata))
  ) {
    throw new Error("Invalid blob metadata");
  }

  return {
    __kind: "blob",
    id: requestedId,
    size: data.size as number,
    mimeType: data.mimeType,
    createdAt,
    expiresAt,
    url: data.url as string | undefined,
    metadata,
  };
}

function parseStoredCommit(json: string, expectedCommitId: string): StoredCommit {
  const value: unknown = JSON.parse(json);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid blob commit metadata");
  }

  const data = value as Record<string, unknown>;
  if (
    data.storageVersion !== STORAGE_VERSION ||
    data.commitId !== expectedCommitId ||
    !isSafeBlobId(data.id)
  ) {
    throw new Error("Invalid blob commit metadata");
  }

  if (data.kind === "deleted") {
    return {
      storageVersion: STORAGE_VERSION,
      kind: "deleted",
      id: data.id,
      commitId: expectedCommitId,
    };
  }
  if (data.kind !== "blob") throw new Error("Invalid blob commit metadata");

  return {
    storageVersion: STORAGE_VERSION,
    kind: "blob",
    id: data.id,
    commitId: expectedCommitId,
    ref: parseStoredBlobRef(data.ref, data.id),
  };
}

function encodeHex(bytes: Uint8Array): string {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}

/**
 * Local blob storage uses a versioned, content-keyed layout.
 *
 * The legacy path-derived layout is intentionally not probed as a fallback.
 * Existing deployments must migrate legacy blobs explicitly before switching
 * to this layout, otherwise fallback reads could make partial or stale data
 * authoritative again.
 */
export class LocalBlobStorage implements BlobStorage {
  private readonly rootDir: string;
  private readonly baseUrl?: string;
  private fs: FileSystem;
  private readonly now: () => Date;
  private lastCommitTimestamp = 0;
  private commitSequence = 0;

  constructor(rootDir: string, baseUrl?: string, options?: { now?: () => Date }) {
    this.rootDir = rootDir;
    this.baseUrl = baseUrl;
    this.fs = createFileSystem();
    this.now = options?.now ?? (() => new Date());
  }

  private requireAtomicRename(): NonNullable<FileSystem["rename"]> {
    if (!this.fs.rename) {
      throw NOT_SUPPORTED.create({
        detail: "Local blob storage requires atomic same-filesystem directory rename support",
      });
    }
    return this.fs.rename.bind(this.fs);
  }

  private async getObjectDir(id: string): Promise<string> {
    assertSafeBlobId(id);
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(id));
    const key = encodeHex(new Uint8Array(digest));
    return join(
      this.rootDir,
      STORAGE_LAYOUT_DIRECTORY,
      key.slice(0, 2),
      key.slice(2, 4),
      key,
    );
  }

  private createCommitId(): string {
    const timestamp = Date.now();
    if (timestamp > this.lastCommitTimestamp) {
      this.lastCommitTimestamp = timestamp;
      this.commitSequence = 0;
    } else {
      this.commitSequence++;
    }

    const timestampPart = this.lastCommitTimestamp.toString(16).padStart(12, "0");
    const sequencePart = this.commitSequence.toString(16).padStart(8, "0");
    const noncePart = crypto.randomUUID().replaceAll("-", "").toLowerCase();
    return `${timestampPart}-${sequencePart}-${noncePart}`;
  }

  private async removeIfPresent(path: string, options?: { recursive?: boolean }): Promise<void> {
    try {
      await this.fs.remove(path, options);
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  private async cleanupSupersededCommits(
    objectDir: string,
    committedId: string,
  ): Promise<void> {
    const commitsDir = join(objectDir, COMMITS_DIRECTORY);
    try {
      for await (const entry of this.fs.readDir(commitsDir)) {
        if (
          !entry.isDirectory ||
          entry.isSymlink ||
          !COMMIT_NAME_PATTERN.test(entry.name) ||
          entry.name >= committedId
        ) {
          continue;
        }
        await this.removeIfPresent(join(commitsDir, entry.name), { recursive: true });
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  private async writeCommit(
    id: string,
    commit: Omit<StoredBlobCommit, "commitId"> | Omit<StoredDeleteCommit, "commitId">,
    payload?: Uint8Array,
  ): Promise<{ objectDir: string; commitId: string }> {
    const rename = this.requireAtomicRename();
    const objectDir = await this.getObjectDir(id);
    const stagingRoot = join(objectDir, STAGING_DIRECTORY);
    const commitsDir = join(objectDir, COMMITS_DIRECTORY);
    const stageId = crypto.randomUUID().replaceAll("-", "").toLowerCase();
    const stageDir = join(stagingRoot, stageId);

    await this.fs.mkdir(stageDir, { recursive: true });

    let committed = false;
    let commitId = "";
    try {
      if (payload !== undefined) {
        await this.fs.writeFile(join(stageDir, PAYLOAD_FILENAME), payload);
      }

      commitId = this.createCommitId();
      await this.fs.writeTextFile(
        join(stageDir, METADATA_FILENAME),
        JSON.stringify({ ...commit, commitId }),
      );
      await this.fs.mkdir(commitsDir, { recursive: true });
      await rename(stageDir, join(commitsDir, commitId));
      committed = true;
    } finally {
      if (!committed) await this.removeIfPresent(stageDir, { recursive: true });
    }

    try {
      await this.cleanupSupersededCommits(objectDir, commitId);
    } catch (error) {
      logger.warn("Failed to clean superseded local blob commits", {
        errorName: errorName(error),
      });
    }

    return { objectDir, commitId };
  }

  private async getLatestCommitId(objectDir: string): Promise<string | null> {
    const commitsDir = join(objectDir, COMMITS_DIRECTORY);
    const commitIds: string[] = [];
    try {
      for await (const entry of this.fs.readDir(commitsDir)) {
        if (!COMMIT_NAME_PATTERN.test(entry.name)) continue;
        if (!entry.isDirectory || entry.isSymlink) {
          throw new Error("Invalid local blob commit entry");
        }
        commitIds.push(entry.name);
      }
    } catch (error) {
      if (isNotFoundError(error)) return null;
      throw error;
    }
    commitIds.sort();
    return commitIds.at(-1) ?? null;
  }

  private async readCommit(objectDir: string, commitId: string): Promise<ResolvedCommit> {
    const commitDir = join(objectDir, COMMITS_DIRECTORY, commitId);
    const json = await this.fs.readTextFile(join(commitDir, METADATA_FILENAME));
    const commit = parseStoredCommit(json, commitId);
    if (commit.kind === "deleted") return { ...commit, objectDir, commitDir };
    return {
      ...commit,
      objectDir,
      commitDir,
      payloadPath: join(commitDir, PAYLOAD_FILENAME),
    };
  }

  private async verifyPayload(commit: ResolvedBlobCommit): Promise<void> {
    const info = this.fs.lstat
      ? await this.fs.lstat(commit.payloadPath)
      : await this.fs.stat(commit.payloadPath);
    if (!info.isFile || info.isSymlink || info.size !== commit.ref.size) {
      throw new Error("Committed local blob payload is missing or inconsistent");
    }
  }

  private async resolveObjectDir(
    objectDir: string,
    requestedId?: string,
    verifyPayload = true,
  ): Promise<ResolvedCommit | null> {
    try {
      for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt++) {
        const commitId = await this.getLatestCommitId(objectDir);
        if (!commitId) return null;

        let commit: ResolvedCommit;
        try {
          commit = await this.readCommit(objectDir, commitId);
          if (requestedId !== undefined && commit.id !== requestedId) {
            throw new Error("Blob ID does not match its storage key");
          }
          if (requestedId === undefined && (await this.getObjectDir(commit.id)) !== objectDir) {
            throw new Error("Blob ID does not match its storage key");
          }
          if (verifyPayload && commit.kind === "blob") await this.verifyPayload(commit);
          return commit;
        } catch (error) {
          if (isNotFoundError(error)) {
            const latestAfterFailure = await this.getLatestCommitId(objectDir);
            if (latestAfterFailure !== commitId) continue;
          }
          throw error;
        }
      }
      throw new Error("Local blob commit changed too many times while resolving it");
    } catch (error) {
      logger.warn("Failed to read blob metadata", { errorName: errorName(error) });
      throw UNKNOWN_ERROR.create({ detail: METADATA_READ_ERROR });
    }
  }

  private async resolve(id: string, verifyPayload = true): Promise<ResolvedCommit | null> {
    return await this.resolveObjectDir(await this.getObjectDir(id), id, verifyPayload);
  }

  private async *getObjectDirectories(): AsyncIterable<string> {
    const layoutRoot = join(this.rootDir, STORAGE_LAYOUT_DIRECTORY);
    try {
      for await (const first of this.fs.readDir(layoutRoot)) {
        if (!first.isDirectory || first.isSymlink || !PARTITION_PATTERN.test(first.name)) continue;
        const firstDir = join(layoutRoot, first.name);
        for await (const second of this.fs.readDir(firstDir)) {
          if (!second.isDirectory || second.isSymlink || !PARTITION_PATTERN.test(second.name)) {
            continue;
          }
          const secondDir = join(firstDir, second.name);
          for await (const object of this.fs.readDir(secondDir)) {
            if (!object.isDirectory || object.isSymlink || !HASH_PATTERN.test(object.name)) {
              continue;
            }
            if (!object.name.startsWith(`${first.name}${second.name}`)) continue;
            yield join(secondDir, object.name);
          }
        }
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const id = options.id ?? crypto.randomUUID();
    assertSafeBlobId(id);
    const { bytes, size } = await this.normalizeToBytes(data);
    const createdAt = this.now();
    const expiresAt = options.ttl ? new Date(createdAt.getTime() + options.ttl * 1000) : undefined;
    const ref: BlobRef = {
      __kind: "blob",
      id,
      size,
      mimeType: options.mimeType ?? "application/octet-stream",
      createdAt,
      expiresAt,
      metadata: options.metadata,
      url: this.baseUrl ? `${this.baseUrl}/${id}` : undefined,
    };

    await this.writeCommit(
      id,
      { storageVersion: STORAGE_VERSION, kind: "blob", id, ref },
      bytes,
    );
    return ref;
  }

  private async normalizeToBytes(
    data: string | Uint8Array | Blob | ReadableStream,
  ): Promise<{ bytes: Uint8Array; size: number }> {
    if (typeof data === "string") {
      const bytes = new TextEncoder().encode(data);
      return { bytes, size: bytes.length };
    }
    if (data instanceof Uint8Array) return { bytes: data, size: data.length };
    if (data instanceof Blob) {
      const bytes = new Uint8Array(await data.arrayBuffer());
      return { bytes, size: data.size };
    }
    if (data instanceof ReadableStream) {
      const bytes = new Uint8Array(await new Response(data).arrayBuffer());
      return { bytes, size: bytes.length };
    }
    throw INVALID_ARGUMENT.create({ detail: "Unsupported data type for LocalBlobStorage" });
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

  async getText(id: string): Promise<string | null> {
    for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt++) {
      const commit = await this.resolve(id);
      if (!commit || commit.kind === "deleted") return null;
      try {
        return await this.fs.readTextFile(commit.payloadPath);
      } catch (error) {
        if (isNotFoundError(error)) {
          const latest = await this.getLatestCommitId(commit.objectDir);
          if (latest !== commit.commitId) continue;
        }
        logger.warn("Failed to read blob text", { errorName: errorName(error) });
        throw UNKNOWN_ERROR.create({ detail: "Failed to read blob text from local storage" });
      }
    }
    throw UNKNOWN_ERROR.create({ detail: "Failed to read blob text from local storage" });
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    for (let attempt = 0; attempt < MAX_RESOLUTION_ATTEMPTS; attempt++) {
      const commit = await this.resolve(id);
      if (!commit || commit.kind === "deleted") return null;
      try {
        return await this.fs.readFile(commit.payloadPath);
      } catch (error) {
        if (isNotFoundError(error)) {
          const latest = await this.getLatestCommitId(commit.objectDir);
          if (latest !== commit.commitId) continue;
        }
        logger.warn("Failed to read blob bytes", { errorName: errorName(error) });
        throw UNKNOWN_ERROR.create({ detail: "Failed to read blob bytes from local storage" });
      }
    }
    throw UNKNOWN_ERROR.create({ detail: "Failed to read blob bytes from local storage" });
  }

  async delete(id: string): Promise<void> {
    const objectDir = await this.getObjectDir(id);
    if (!await this.fs.exists(objectDir)) return;
    await this.writeCommit(id, {
      storageVersion: STORAGE_VERSION,
      kind: "deleted",
      id,
    });
  }

  async exists(id: string): Promise<boolean> {
    const commit = await this.resolve(id);
    return commit?.kind === "blob";
  }

  async stat(id: string): Promise<BlobRef | null> {
    const commit = await this.resolve(id);
    return commit?.kind === "blob" ? commit.ref : null;
  }

  async list(): Promise<BlobRef[]> {
    const now = this.now();
    const refs: BlobRef[] = [];
    for await (const objectDir of this.getObjectDirectories()) {
      const commit = await this.resolveObjectDir(objectDir);
      if (!commit || commit.kind === "deleted") continue;
      if (commit.ref.expiresAt && commit.ref.expiresAt <= now) continue;
      refs.push(commit.ref);
    }
    return refs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async cleanupExpiredBlobs(): Promise<void> {
    const now = this.now();
    for await (const objectDir of this.getObjectDirectories()) {
      const commit = await this.resolveObjectDir(objectDir, undefined, false);
      if (commit?.kind !== "blob" || !commit.ref.expiresAt || commit.ref.expiresAt > now) continue;
      logger.debug("Deleting expired local blob");
      await this.delete(commit.id);
    }
  }
}
