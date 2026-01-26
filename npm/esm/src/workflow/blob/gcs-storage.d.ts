import * as dntShim from "../../../_dnt.shims.js";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.js";
export interface GCSBlobStorageConfig {
    /** Google Cloud Project ID */
    projectId: string;
    /** GCS Bucket name */
    bucket: string;
    /** Google Cloud Service Account Key (JSON string) */
    serviceAccountKey: string;
    /** Key prefix for namespacing blobs */
    prefix?: string;
    /** Base URL for constructing public URLs (if bucket is public) */
    baseUrl?: string;
    /** Default TTL for blobs in seconds */
    defaultTtl?: number;
}
export declare class GCSBlobStorage implements BlobStorage {
    private config;
    private tokenCache;
    constructor(config: GCSBlobStorageConfig);
    private getKey;
    private getAccessToken;
    put(data: string | Uint8Array | dntShim.Blob | ReadableStream, options?: StoreBlobOptions): Promise<BlobRef>;
    getStream(id: string): Promise<ReadableStream | null>;
    getText(id: string): Promise<string | null>;
    getBytes(id: string): Promise<Uint8Array | null>;
    delete(id: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    stat(id: string): Promise<BlobRef | null>;
}
//# sourceMappingURL=gcs-storage.d.ts.map