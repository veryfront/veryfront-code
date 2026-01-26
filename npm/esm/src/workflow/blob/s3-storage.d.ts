/**
 * S3 Blob Storage
 *
 * Stores blobs in AWS S3.
 *
 * NOTE: This module uses dynamic imports for @aws-sdk/client-s3 to avoid
 * requiring the AWS SDK as a mandatory dependency. The SDK is only loaded
 * when S3BlobStorage is instantiated.
 */
import * as dntShim from "../../../_dnt.shims.js";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.js";
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
export declare class S3BlobStorage implements BlobStorage {
    private config;
    private client;
    private initPromise;
    constructor(config: S3BlobStorageConfig);
    private initialize;
    private ensureInitialized;
    private getKey;
    put(data: string | Uint8Array | dntShim.Blob | ReadableStream, options?: StoreBlobOptions): Promise<BlobRef>;
    getStream(id: string): Promise<ReadableStream | null>;
    getText(id: string): Promise<string | null>;
    getBytes(id: string): Promise<Uint8Array | null>;
    delete(id: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    stat(id: string): Promise<BlobRef | null>;
}
//# sourceMappingURL=s3-storage.d.ts.map