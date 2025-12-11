
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.ts";
import { agentLogger as logger } from "@veryfront/utils";
import { isDeno } from "@veryfront/platform/compat/runtime.ts";

type S3ClientType = import("@aws-sdk/client-s3").S3Client;
type PutObjectCommandType = import("@aws-sdk/client-s3").PutObjectCommand;
type GetObjectCommandType = import("@aws-sdk/client-s3").GetObjectCommand;
type DeleteObjectCommandType = import("@aws-sdk/client-s3").DeleteObjectCommand;
type HeadObjectCommandType = import("@aws-sdk/client-s3").HeadObjectCommand;
type CreateBucketCommandType = import("@aws-sdk/client-s3").CreateBucketCommand;

let s3Module: typeof import("@aws-sdk/client-s3") | null = null;

async function getS3Module(): Promise<typeof import("@aws-sdk/client-s3")> {
  if (s3Module) {
    return s3Module;
  }

  try {
    if (isDeno) {
      s3Module = await import("https://esm.sh/@aws-sdk/client-s3@3.490.0");
    } else {
      s3Module = await import("@aws-sdk/client-s3");
    }
    return s3Module;
  } catch (error) {
    throw new Error(
      `Failed to load @aws-sdk/client-s3. Please install it: npm install @aws-sdk/client-s3\n` +
        `Original error: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export interface S3BlobStorageConfig {
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  prefix?: string;
  baseUrl?: string;
  defaultTtl?: number;
  autoCreateBucket?: boolean;
}

export class S3BlobStorage implements BlobStorage {
  private client: S3ClientType | null = null;
  private config: S3BlobStorageConfig;
  private initPromise: Promise<void> | null = null;

  constructor(config: S3BlobStorageConfig) {
    this.config = config;
    this.initPromise = this.initialize();
  }

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
      body = data;
    } else {
      throw new Error("Unsupported data type for S3BlobStorage");
    }

    const putCommand = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: body,
      ContentType: mimeType,
      ContentLength: contentLength,
      Expires: expiresAt,
      Metadata: options.metadata,
    });

    try {
      await client.send(putCommand);
    } catch (e: any) {
      if (e.name === "NoSuchBucket" && this.config.autoCreateBucket) {
        try {
          await client.send(new CreateBucketCommand({ Bucket: this.config.bucket }));
          await client.send(putCommand);
        } catch (createError) {
          logger.error("Failed to auto-create bucket:", createError);
          throw e;
        }
      } else {
        throw e;
      }
    }

    let size = contentLength || 0;
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
    const response = new Response(stream);
    return await response.text();
  }

  async getBytes(id: string): Promise<Uint8Array | null> {
    const stream = await this.getStream(id);
    if (!stream) return null;
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
      await client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );
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
      const headResult = await client.send(
        new HeadObjectCommand({
          Bucket: this.config.bucket,
          Key: key,
        }),
      );

      if (!headResult.LastModified) return null;

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
        expiresAt = new Date(headResult.Metadata["expiresat"]!);
      }


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
