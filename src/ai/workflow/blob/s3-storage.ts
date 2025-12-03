/**
 * S3 Blob Storage
 *
 * Stores blobs in AWS S3.
 *
 * NOTE: This module uses dynamic imports for @aws-sdk/client-s3 to avoid
 * requiring the AWS SDK as a mandatory dependency. The SDK is only loaded
 * when S3BlobStorage is instantiated.
 */

import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { agentLogger as logger } from "@veryfront/utils";

// Type definitions for AWS SDK (to avoid top-level import)
type S3ClientType = import("@aws-sdk/client-s3").S3Client;
type PutObjectCommandType = import("@aws-sdk/client-s3").PutObjectCommand;
type GetObjectCommandType = import("@aws-sdk/client-s3").GetObjectCommand;
type DeleteObjectCommandType = import("@aws-sdk/client-s3").DeleteObjectCommand;
type HeadObjectCommandType = import("@aws-sdk/client-s3").HeadObjectCommand;
type CreateBucketCommandType = import("@aws-sdk/client-s3").CreateBucketCommand;

// Cached module reference for lazy loading
let s3Module: typeof import("@aws-sdk/client-s3") | null = null;

/**
 * Dynamically import the AWS SDK (lazy loading)
 * This allows the module to be loaded without requiring @aws-sdk/client-s3 to be installed
 * unless S3BlobStorage is actually used.
 */
async function getS3Module(): Promise<typeof import("@aws-sdk/client-s3")> {
  if (s3Module) {
    return s3Module;
  }

  try {
    // Try Deno's esm.sh import first (for Deno runtime)
    if (typeof Deno !== "undefined") {
      s3Module = await import("https://esm.sh/@aws-sdk/client-s3@3.490.0");
    } else {
      // For Node.js runtime, use bare specifier
      s3Module = await import("@aws-sdk/client-s3");
    }
    return s3Module;
  } catch (error) {
    throw new Error(
      `Failed to load @aws-sdk/client-s3. Please install it: npm install @aws-sdk/client-s3\n` +
      `Original error: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

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
  private client: S3ClientType | null = null;
  private config: S3BlobStorageConfig;
  private initPromise: Promise<void> | null = null;

  constructor(config: S3BlobStorageConfig) {
    this.config = config;
    // Trigger initialization (but don't await in constructor)
    this.initPromise = this.initialize();
  }

  /**
   * Initialize the S3 client asynchronously
   */
  private async initialize(): Promise<void> {
    const { S3Client } = await getS3Module();
    this.client = new S3Client({
      region: this.config.region,
      credentials: {
        accessKeyId: this.config.accessKeyId,
        secretAccessKey: this.config.secretAccessKey,
      },
      endpoint: this.config.endpoint,
      forcePathStyle: this.config.forcePathStyle,
    });
  }

  /**
   * Ensure the S3 client is initialized before use
   */
  private async ensureInitialized(): Promise<S3ClientType> {
    if (this.initPromise) {
      await this.initPromise;
      this.initPromise = null;
    }
    if (!this.client) {
      throw new Error("S3BlobStorage: Client failed to initialize");
    }
    return this.client;
  }

  private getKey(id: string): string {
    return this.config.prefix ? `${this.config.prefix}${id}` : id;
  }

  async put(
    data: string | Uint8Array | Blob | ReadableStream,
    options: StoreBlobOptions = {},
  ): Promise<BlobRef> {
    const client = await this.ensureInitialized();
    const { PutObjectCommand, CreateBucketCommand, HeadObjectCommand } = await getS3Module();

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
    } else if (data instanceof Uint8Array) {
      body = data;
      contentLength = data.byteLength;
    } else if (data instanceof Blob) {
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
      await client.send(putCommand);
    } catch (e: any) {
      if (e.name === "NoSuchBucket" && this.config.autoCreateBucket) {
        // Bucket doesn't exist, try to create it
        try {
          await client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
          // Retry the put operation
          await client.send(putCommand);
        } catch (createError) {
          // If creation fails (e.g., race condition), throw the original error or the new one
          logger.error("Failed to auto-create bucket:", createError);
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
        const headResult = await client.send(headCommand);
        size = headResult.ContentLength || 0;
      } catch (e) {
        logger.warn(`Could not get size for S3 blob ${key} after put:`, e);
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
    const client = await this.ensureInitialized();
    const { GetObjectCommand } = await getS3Module();

    const key = this.getKey(id);
    try {
      const getCommand = new GetObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      });
      const response = await client.send(getCommand);
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
    const client = await this.ensureInitialized();
    const { DeleteObjectCommand } = await getS3Module();

    const key = this.getKey(id);
    const deleteCommand = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
    });
    try {
      await client.send(deleteCommand);
    } catch (e) {
      if (e instanceof Error && e.name === "NoSuchKey") {
        // Ignore if trying to delete a non-existent key
        return;
      }
      throw e;
    }
  }

  async exists(id: string): Promise<boolean> {
    const client = await this.ensureInitialized();
    const { HeadObjectCommand } = await getS3Module();

    const key = this.getKey(id);
    try {
      await client.send(new HeadObjectCommand({
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
    const client = await this.ensureInitialized();
    const { HeadObjectCommand } = await getS3Module();

    const key = this.getKey(id);
    try {
      const headResult = await client.send(new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: key,
      }));

      if (!headResult.LastModified) return null; // Should always be present for existing objects

      // Custom metadata is returned as all lowercase keys by S3
      const metadata: Record<string, string> = {};
      const rawMetadata = headResult.Metadata as Record<string, string> | undefined;
      for (const [k, v] of Object.entries(rawMetadata || {})) {
        if (v != null) {
          metadata[k] = v;
        }
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
