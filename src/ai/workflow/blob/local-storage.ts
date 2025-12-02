/**
 * Local File System Blob Storage
 *
 * Stores blobs as files on the local disk
 */

import { join, dirname } from "https://deno.land/std@0.220.0/path/mod.ts";
import { ensureDir, readDir, remove } from "https://deno.land/std@0.220.0/fs/mod.ts";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";

export class LocalBlobStorage implements BlobStorage {
  private rootDir: string;
  private baseUrl?: string;

  constructor(rootDir: string, baseUrl?: string) {
    this.rootDir = rootDir;
    this.baseUrl = baseUrl;
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
    options: StoreBlobOptions = {}
  ): Promise<BlobRef> {
    const id = options.id || crypto.randomUUID();
    const filePath = this.getPath(id);
    const metaPath = this.getMetadataPath(id);

    await ensureDir(dirname(filePath));

    let size = 0;

    if (typeof data === "string") {
      await Deno.writeTextFile(filePath, data);
      size = new TextEncoder().encode(data).length;
    } else if (data instanceof Uint8Array) {
      await Deno.writeFile(filePath, data);
      size = data.length;
    } else if (data instanceof Blob) {
      const arr = new Uint8Array(await data.arrayBuffer());
      await Deno.writeFile(filePath, arr);
      size = data.size;
    } else if (data instanceof ReadableStream) {
      // Deno specific: write readable stream to file
      const file = await Deno.open(filePath, { write: true, create: true });
      try {
        await data.pipeTo(file.writable);
        const stat = await Deno.stat(filePath);
        size = stat.size;
      } finally {
        // file closed by pipeTo
      }
    } else {
      throw new Error("Unsupported data type for LocalBlobStorage");
    }

    const ref: BlobRef = {
      __kind: "blob",
      id,
      size,
      mimeType: options.mimeType || "application/octet-stream",
      createdAt: new Date(),
      expiresAt: options.ttl ? new Date(Date.now() + options.ttl * 1000) : undefined,
      metadata: options.metadata,
      url: this.baseUrl ? `${this.baseUrl}/${id}` : undefined,
    };

    await Deno.writeTextFile(metaPath, JSON.stringify(ref));

    return ref;
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const filePath = this.getPath(id);
    try {
      const file = await Deno.open(filePath, { read: true });
      return file.readable;
    } catch {
      return null;
    }
  }

  async getText(id: string): Promise<string | null> {
    const filePath = this.getPath(id);
    try {
      return await Deno.readTextFile(filePath);
    } catch {
      return null;
    }
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const filePath = this.getPath(id);
    try {
      return await Deno.readFile(filePath);
    } catch {
      return null;
    }
  }

  async delete(id: string): Promise<void> {
    const filePath = this.getPath(id);
    const metaPath = this.getMetadataPath(id);
    try {
      await Deno.remove(filePath);
      await Deno.remove(metaPath);
    } catch {
      // Ignore if not found
    }
  }

  async exists(id: string): Promise<boolean> {
    const filePath = this.getPath(id);
    try {
      await Deno.stat(filePath);
      return true;
    } catch {
      return false;
    }
  }

  async stat(id: string): Promise<BlobRef | null> {
    const metaPath = this.getMetadataPath(id);
    try {
      const json = await Deno.readTextFile(metaPath);
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
    // Deno.readDir does not recursively list files. We need to iterate over prefixes.
    // This implementation assumes a 2-character prefix for partitioning.
    for (let i = 0; i < 256; i++) {
      const prefix = i.toString(16).padStart(2, '0');
      const prefixDir = join(this.rootDir, prefix);
      try {
        for await (const entry of Deno.readDir(prefixDir)) {
          if (entry.isFile && entry.name.endsWith('.meta.json')) {
            const id = entry.name.replace('.meta.json', '');
            const blobRef = await this.stat(id);
            if (blobRef && blobRef.expiresAt && blobRef.expiresAt < new Date()) {
              console.log(`[LocalBlobStorage] Deleting expired blob: ${id}`);
              await this.delete(id);
            }
          }
        }
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          // Prefix directory doesn't exist, skip.
          continue;
        }
        throw e;
      }
    }
  }
}
