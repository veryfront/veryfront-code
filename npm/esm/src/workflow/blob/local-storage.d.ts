import * as dntShim from "../../../_dnt.shims.js";
import type { BlobRef, BlobStorage, StoreBlobOptions } from "./types.js";
export declare class LocalBlobStorage implements BlobStorage {
    private rootDir;
    private baseUrl?;
    private fs;
    private now;
    constructor(rootDir: string, baseUrl?: string, options?: {
        now?: () => Date;
    });
    private getPath;
    private getMetadataPath;
    put(data: string | Uint8Array | dntShim.Blob | ReadableStream, options?: StoreBlobOptions): Promise<BlobRef>;
    private normalizeToBytes;
    getStream(id: string): Promise<ReadableStream | null>;
    getText(id: string): Promise<string | null>;
    getBytes(id: string): Promise<Uint8Array | null>;
    delete(id: string): Promise<void>;
    exists(id: string): Promise<boolean>;
    stat(id: string): Promise<BlobRef | null>;
    /**
     * Cleans up all expired blobs from storage.
     * This method should typically be run periodically by an external process.
     */
    cleanupExpiredBlobs(): Promise<void>;
}
//# sourceMappingURL=local-storage.d.ts.map