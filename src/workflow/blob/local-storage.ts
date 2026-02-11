import { dirname, join } from "#veryfront/compat/path";
import { createFileSystem } from "#veryfront/platform/compat/fs.ts";
import type { FileSystem } from "#veryfront/platform/compat/fs.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { agentLogger as logger } from "#veryfront/utils";

const log = logger.component("local-blob-storage");

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

    throw new Error("Unsupported data type for LocalBlobStorage");
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
    try {
      return await this.fs.readTextFile(this.getPath(id));
    } catch {
      return null;
    }
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    try {
      return await this.fs.readFile(this.getPath(id));
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      await this.fs.remove(this.getPath(id));
      await this.fs.remove(this.getMetadataPath(id));
    } catch {
      // Ignore if not found
    }
  }

  async exists(id: string): Promise<boolean> {
    return this.fs.exists(this.getPath(id));
  }

  async stat(id: string): Promise<BlobRef | null> {
    try {
      const json = await this.fs.readTextFile(this.getMetadataPath(id));
      const data = JSON.parse(json);
      return {
        ...data,
        createdAt: new Date(data.createdAt),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      };
    } catch {
      return null;
    }
  }

  /**
   * Cleans up all expired blobs from storage.
   * This method should typically be run periodically by an external process.
   */
  async cleanupExpiredBlobs(): Promise<void> {
    const now = this.now();

    for (let i = 0; i < 256; i++) {
      const prefix = i.toString(16).padStart(2, "0");
      const prefixDir = join(this.rootDir, prefix);

      try {
        for await (const entry of this.fs.readDir(prefixDir)) {
          if (!entry.isFile || !entry.name.endsWith(".meta.json")) continue;

          const id = entry.name.replace(".meta.json", "");
          const blobRef = await this.stat(id);

          if (!blobRef?.expiresAt || blobRef.expiresAt >= now) continue;

          log.debug(`Deleting expired blob: ${id}`);
          await this.delete(id);
        }
      } catch {
        // Directory not found is fine, skip
      }
    }
  }
}
