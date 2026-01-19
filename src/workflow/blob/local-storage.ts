/**
 * Local File System Blob Storage
 *
 * Stores blobs as files on the local disk
 */

import { dirname, join } from "@veryfront/platform/compat/path-helper.ts";
import { createFileSystem } from "@veryfront/platform/compat/fs.ts";
import type { FileSystem } from "@veryfront/platform/compat/fs.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { agentLogger as logger } from "@veryfront/utils";

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
    return this.getPath(id) + ".meta.json";
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const id = options.id || crypto.randomUUID();
    const filePath = this.getPath(id);
    const metaPath = this.getMetadataPath(id);

    await this.fs.mkdir(dirname(filePath), { recursive: true });

    let size = 0;

    if (typeof data === "string") {
      await this.fs.writeTextFile(filePath, data);
      size = new TextEncoder().encode(data).length;
    } else if (data instanceof Uint8Array) {
      await this.fs.writeFile(filePath, data);
      size = data.length;
    } else if (data instanceof Blob) {
      const arr = new Uint8Array(await data.arrayBuffer());
      await this.fs.writeFile(filePath, arr);
      size = data.size;
    } else if (data instanceof ReadableStream) {
      // Normalize stream to bytes for cross-runtime compatibility
      const buffer = new Uint8Array(await new Response(data).arrayBuffer());
      await this.fs.writeFile(filePath, buffer);
      size = buffer.length;
    } else {
      throw new Error("Unsupported data type for LocalBlobStorage");
    }

    const createdAt = this.now();
    const expiresAt = options.ttl ? new Date(createdAt.getTime() + options.ttl * 1000) : undefined;
    const ref: BlobRef = {
      __kind: "blob",
      id,
      size,
      mimeType: options.mimeType || "application/octet-stream",
      createdAt,
      expiresAt,
      metadata: options.metadata,
      url: this.baseUrl ? `${this.baseUrl}/${id}` : undefined,
    };

    await this.fs.writeTextFile(metaPath, JSON.stringify(ref));

    return ref;
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    try {
      const bytes = await this.getBytes(id);
      if (!bytes) return null;
      // Create a minimal cross-runtime ReadableStream from the bytes
      return new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      });
    } catch {
      return null;
    }
  }

  async getText(id: string): Promise<string | null> {
    const filePath = this.getPath(id);
    try {
      return await this.fs.readTextFile(filePath);
    } catch {
      return null;
    }
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const filePath = this.getPath(id);
    try {
      return await this.fs.readFile(filePath);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    const filePath = this.getPath(id);
    const metaPath = this.getMetadataPath(id);
    try {
      await this.fs.remove(filePath);
      await this.fs.remove(metaPath);
    } catch {
      // Ignore if not found
    }
  }

  async exists(id: string): Promise<boolean> {
    const filePath = this.getPath(id);
    return await this.fs.exists(filePath);
  }

  async stat(id: string): Promise<BlobRef | null> {
    const metaPath = this.getMetadataPath(id);
    try {
      const json = await this.fs.readTextFile(metaPath);
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
    // Iterate over prefixes (00-ff)
    for (let i = 0; i < 256; i++) {
      const prefix = i.toString(16).padStart(2, "0");
      const prefixDir = join(this.rootDir, prefix);
      try {
        for await (const entry of this.fs.readDir(prefixDir)) {
          if (entry.isFile && entry.name.endsWith(".meta.json")) {
            const id = entry.name.replace(".meta.json", "");
            const blobRef = await this.stat(id);
            if (blobRef?.expiresAt && blobRef.expiresAt < this.now()) {
              logger.debug(`[LocalBlobStorage] Deleting expired blob: ${id}`);
              await this.delete(id);
            }
          }
        }
      } catch {
        // Directory not found is fine, skip
      }
    }
  }
}
