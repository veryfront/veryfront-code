import { dirname, join } from "#veryfront/compat/path";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { agentLogger } from "#veryfront/utils";
import { isNotFoundError } from "#veryfront/platform/compat/fs.ts";
import { INVALID_ARGUMENT, UNKNOWN_ERROR } from "#veryfront/errors";
import { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";
import { isBlobRef } from "./guards.ts";

const logger = agentLogger.component("local-blob-storage");

export class LocalBlobStorage implements BlobStorage {
  private rootDir: string;
  private baseUrl?: string;
  private fs: FileSystem;
  private now: () => Date;

  constructor(rootDir: string, baseUrl?: string, options?: { now?: () => Date }) {
    this.rootDir = rootDir;
    this.baseUrl = baseUrl;
    this.fs = createFileSystem();
    this.now = options?.now ?? (() => new Date());
  }

  private getPath(id: string): string {
    assertSafeBlobId(id);
    // Partition by first 2 chars to avoid too many files in one dir
    const prefix = id.slice(0, 2);
    return join(this.rootDir, prefix, id);
  }

  private getMetadataPath(id: string): string {
    return `${this.getPath(id)}.meta.json`;
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const id = options.id ?? crypto.randomUUID();
    const filePath = this.getPath(id);
    const metaPath = this.getMetadataPath(id);

    await this.fs.mkdir(dirname(filePath), { recursive: true });

    const { bytes, size } = await this.normalizeToBytes(data);
    await this.fs.writeFile(filePath, bytes);

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

    await this.fs.writeTextFile(metaPath, JSON.stringify(ref));
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
      // Normalize stream to bytes for cross-runtime compatibility
      const bytes = new Uint8Array(await new Response(data).arrayBuffer());
      return { bytes, size: bytes.length };
    }

    throw INVALID_ARGUMENT.create({ detail: "Unsupported data type for LocalBlobStorage" });
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const bytes = await this.getBytes(id);
    if (!bytes) return null;

    // Create a minimal cross-runtime ReadableStream from the bytes
    return new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });
  }

  async getText(id: string): Promise<string | null> {
    const filePath = this.getPath(id);
    try {
      return await this.fs.readTextFile(filePath);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      // Genuine I/O failure (EACCES, disk error): don't mask it as "not found".
      logger.warn("Failed to read blob text", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw UNKNOWN_ERROR.create({ detail: "Failed to read blob text from local storage" });
    }
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const filePath = this.getPath(id);
    try {
      return await this.fs.readFile(filePath);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      // Genuine I/O failure (EACCES, disk error): don't mask it as "not found".
      logger.warn("Failed to read blob bytes", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw UNKNOWN_ERROR.create({ detail: "Failed to read blob bytes from local storage" });
    }
  }

  async delete(id: string): Promise<void> {
    const filePath = this.getPath(id);
    const metadataPath = this.getMetadataPath(id);
    const removeIfPresent = async (path: string): Promise<void> => {
      try {
        await this.fs.remove(path);
      } catch (error) {
        if (isNotFoundError(error)) return;
        logger.warn("Failed to delete blob from local storage", {
          errorName: error instanceof Error ? error.name : typeof error,
        });
        throw UNKNOWN_ERROR.create({ detail: "Failed to delete blob from local storage" });
      }
    };
    await Promise.all([removeIfPresent(filePath), removeIfPresent(metadataPath)]);
  }

  async exists(id: string): Promise<boolean> {
    return this.fs.exists(this.getPath(id));
  }

  async stat(id: string): Promise<BlobRef | null> {
    const metadataPath = this.getMetadataPath(id);
    let json: string;
    try {
      json = await this.fs.readTextFile(metadataPath);
    } catch (error) {
      if (isNotFoundError(error)) return null;
      logger.warn("Failed to read blob metadata", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw UNKNOWN_ERROR.create({ detail: "Failed to read blob metadata from local storage" });
    }

    try {
      const data = JSON.parse(json);
      const ref = {
        ...data,
        createdAt: new Date(data.createdAt),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      };
      return isBlobRef(ref) ? ref : null;
    } catch (_) {
      /* expected: invalid or incomplete metadata sidecar */
      return null;
    }
  }

  private async listPartitionPrefixes(): Promise<string[]> {
    const prefixes: string[] = [];
    try {
      for await (const entry of this.fs.readDir(this.rootDir)) {
        if (
          entry.isDirectory && !entry.isSymlink && entry.name.length <= 2 &&
          isSafeBlobId(entry.name)
        ) {
          prefixes.push(entry.name);
        }
      }
      return prefixes;
    } catch (error) {
      if (isNotFoundError(error)) return prefixes;
      logger.warn("Failed to list blob partitions", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw UNKNOWN_ERROR.create({ detail: "Failed to list blob partitions in local storage" });
    }
  }

  private async listMetadataIds(
    prefixDir: string,
    operation: "list" | "cleanup",
  ): Promise<string[]> {
    const ids: string[] = [];
    try {
      for await (const entry of this.fs.readDir(prefixDir)) {
        if (!entry.isFile || !entry.name.endsWith(".meta.json")) continue;
        const id = entry.name.slice(0, -".meta.json".length);
        if (isSafeBlobId(id)) ids.push(id);
      }
      return ids;
    } catch (error) {
      if (isNotFoundError(error)) return ids;
      const message = operation === "list"
        ? "Failed to list blob partition"
        : "Failed to inspect blob partition during cleanup";
      logger.warn(message, {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      throw UNKNOWN_ERROR.create({ detail: `${message} in local storage` });
    }
  }

  /**
   * Enumerate every stored (non-expired) blob, newest first. Walks the same
   * two-char-prefix partitions as {@link cleanupExpiredBlobs}, reading each
   * `.meta.json` sidecar. Used by the chat upload handler's list endpoint.
   */
  async list(): Promise<BlobRef[]> {
    const now = this.now();
    const refs: BlobRef[] = [];

    for (const prefix of await this.listPartitionPrefixes()) {
      const prefixDir = join(this.rootDir, prefix);
      for (const id of await this.listMetadataIds(prefixDir, "list")) {
        const ref = await this.stat(id);
        if (!ref) continue;
        if (ref.expiresAt && ref.expiresAt < now) continue;
        refs.push(ref);
      }
    }

    return refs.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Cleans up all expired blobs from storage.
   * This method should typically be run periodically by an external process.
   */
  async cleanupExpiredBlobs(): Promise<void> {
    const now = this.now();

    for (const prefix of await this.listPartitionPrefixes()) {
      const prefixDir = join(this.rootDir, prefix);
      for (const id of await this.listMetadataIds(prefixDir, "cleanup")) {
        const blobRef = await this.stat(id);

        if (!blobRef?.expiresAt || blobRef.expiresAt >= now) continue;

        logger.debug(`Deleting expired blob: ${id}`);
        await this.delete(id);
      }
    }
  }
}
