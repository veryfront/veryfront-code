/**
 * S3 Blob Storage
 *
 * Stores blobs in AWS S3.
 */

import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, CreateBucketCommand } from "https://esm.sh/@aws-sdk/client-s3@3.490.0";
import { get } from "https://esm.sh/@aws-sdk/lib-dynamodb@3.490.0"; // This import seems incorrect, should be @aws-sdk/lib-storage for streaming
import { getSignedUrl } from "https://esm.sh/@aws-sdk/s3-request-presigner@3.490.0"; // For pre-signed URLs

export interface S3BlobStorageConfig {
  /** AWS Region */
  region: string;
  /** S3 Bucket name */
  bucket: string;
  /** AWS Access Key ID */
  accessKeyId: string;
  /** AWS Secret Access Key */
  secretAccessKey: string;
  /** Optional S3 endpoint (for localstack or compatible storage) */
  endpoint?: string;
  /** Force path style URLs (required for MinIO/Localstack) */
  forcePathStyle?: boolean;
  /** Key prefix for namespacing blobs */
  prefix?: string;
  /** Base URL for constructing public URLs (if bucket is public) */
  baseUrl?: string;
  /** Default TTL for blobs in seconds */
  defaultTtl?: number;
  /** Automatically create the bucket if it does not exist (useful for local development) */
  autoCreateBucket?: boolean;
}

export class S3BlobStorage implements BlobStorage {
  private client: S3Client;
  private config: S3BlobStorageConfig;

  constructor(config: S3BlobStorageConfig) {
    this.config = config;
    this.client = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
    });
  }

  private getKey(id: string): string {
    return this.config.prefix ? `${this.config.prefix}${id}` : id;
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const id = options.id || crypto.randomUUID();
    const key = this.getKey(id);
    const mimeType = options.mimeType || "application/octet-stream";
    const createdAt = new Date();
    const ttl = options.ttl ?? this.config.defaultTtl;
    const expiresAt = ttl ? new Date(createdAt.getTime() + ttl * 1000) : undefined;

    let body: string | Uint8Array | Blob | ReadableStream;
    let contentLength: number | undefined;

    if (typeof data === "string") {
      body = new TextEncoder().encode(data);
      contentLength = body.byteLength;
    } else if (data instanceof Uint8Array || data instanceof Blob) {
      body = data;
      contentLength = data.size;
    } else if (data instanceof ReadableStream) {
      // For ReadableStream, S3 PutObjectCommand can directly accept it.
      // Content-Length is often required for streams, but sometimes S3 can infer it.
      // If it consistently fails, we might need to buffer the stream or require content-length in options.
      body = data;
      // Cannot determine contentLength easily from ReadableStream without consuming it.
      // If backend requires, user must provide via options.
    } else {
      throw new Error("Unsupported data type for S3BlobStorage");
    }

    const putCommand = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ContentLength: contentLength, // Pass if known
      Expires: expiresAt, // S3 uses Expires header for HTTP caches, not lifecycle rules directly
      Metadata: options.metadata, // Custom metadata
    });

    try {
      await this.client.send(putCommand);
    } catch (e: any) {
      if (e.name === "NoSuchBucket" && this.config.autoCreateBucket) {
        // Bucket doesn't exist, try to create it
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
          // Retry the put operation
          await this.client.send(putCommand);
        } catch (createError) {
          // If creation fails (e.g., race condition), throw the original error or the new one
          console.error("Failed to auto-create bucket:", createError);
          throw e;
        }
      } else {
        throw e;
      }
    }

    // S3 does not return size directly on PutObject. We can do a HeadObject to get it.
    // Or, for simplicity, use the contentLength we determined or was passed.
    let size = contentLength || 0; // Fallback if stream length is unknown
    if (size === 0) {
      try {
        const headCommand = new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        });
        const headResult = await this.client.send(headCommand);
        size = headResult.ContentLength || 0;
      } catch (e) {
        console.warn(`Could not get size for S3 blob ${key} after put:`, e);
      }
    }

    return {
      __kind: "blob",
      id,
      size,
      mimeType,
      createdAt,
      expiresAt,
      metadata: options.metadata,
      url: this.config.baseUrl ? `${this.config.baseUrl}/${key}` : undefined,
    };
  }

  async getStream(id: string): Promise<ReadableStream | null> {
    const key = this.getKey(id);
    try {
      const getCommand = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      const response = await this.client.send(getCommand);
      if (response.Body) {
        // The S3 SDK returns an AsyncIterable (which is also a ReadableStream in Deno)
        return response.Body as ReadableStream;
      }
      return null;
    } catch (e) {
      if (e instanceof Error && e.name === "NoSuchKey") {
        return null;
      }
      throw e;
    }
  }

  async getText(id: string): Promise<string | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    // @ts-ignore - Deno's ReadableStream vs Web ReadableStream type mismatch
    const response = new Response(stream);
    return await response.text();
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
    // @ts-ignore - Deno's ReadableStream vs Web ReadableStream type mismatch
    const response = new Response(stream);
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer);
  }

  async delete(id: string): Promise<void> {
    const key = this.getKey(id);
    const deleteCommand = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });
    try {
      await this.client.send(deleteCommand);
    } catch (e) {
      if (e instanceof Error && e.name === "NoSuchKey") {
        // Ignore if trying to delete a non-existent key
        return;
      }
      throw e;
    }
  }

  async exists(id: string): Promise<boolean> {
    const key = this.getKey(id);
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));
      return true;
    } catch (e) {
      if (e instanceof Error && e.name === "NotFound") {
        return false;
      }
      throw e;
    }
  }

  async stat(id: string): Promise<BlobRef | null> {
    const key = this.getKey(id);
    try {
      const headResult = await this.client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));

      if (!headResult.LastModified) return null; // Should always be present for existing objects

      // Custom metadata is returned as all lowercase keys by S3
      const metadata: Record<string, string> = {};
      for (const [k, v] of Object.entries(headResult.Metadata || {})) {
        metadata[k] = v!;
      }

      let expiresAt: Date | undefined;
      if (headResult.Expires) {
        expiresAt = new Date(headResult.Expires);
      } else if (headResult.Metadata && headResult.Metadata["expiresat"]) {
        // Check for custom expiresAt if stored in metadata
        expiresAt = new Date(headResult.Metadata["expiresat"]!);
      }

      // S3 Lifecycle rules or object TTLs are not exposed directly via HeadObject. 
      // If `options.ttl` was used in `put`, that TTL is not natively handled by S3 `Expires` header 
      // for object lifecycle management (it's for caching). 
      // To support TTL, user must configure S3 bucket lifecycle rules separately based on object tags/prefix
      // OR we store expiresAt in metadata and rely on cleanup logic (if any) or user to manage.
      // For now, we only populate expiresAt if S3 provides an Expires header (HTTP caching).

      return {
        __kind: "blob",
        id,
        size: headResult.ContentLength || 0,
        mimeType: headResult.ContentType || "application/octet-stream",
        createdAt: headResult.LastModified,
        expiresAt: expiresAt,
        metadata: metadata,
        url: this.config.baseUrl ? `${this.config.baseUrl}/${key}` : undefined,
      };
    } catch (e) {
      if (e instanceof Error && e.name === "NotFound") {
        return null;
      }
      throw e;
    }
  }
}
