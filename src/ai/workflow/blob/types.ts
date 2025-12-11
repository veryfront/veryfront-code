
export interface BlobRef {
  __kind: "blob";
  id: string;
  size: number;
  mimeType: string;
  createdAt: Date;
  expiresAt?: Date;
  url?: string;
  metadata?: Record<string, string>;
}

export interface StoreBlobOptions {
  id?: string;
  mimeType?: string;
  metadata?: Record<string, string>;
  ttl?: number;
}

export interface BlobStorage {
  put(
    data: string | Uint8Array | Blob | ReadableStream,
    options?: StoreBlobOptions,
  ): Promise<BlobRef>;

  getStream(id: string): Promise<ReadableStream | null>;

  getText(id: string): Promise<string | null>;

  getBytes(id: string): Promise<Uint8Array | null>;

  delete(id: string): Promise<void>;

  exists(id: string): Promise<boolean>;

  stat(id: string): Promise<BlobRef | null>;
}
