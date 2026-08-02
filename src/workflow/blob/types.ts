/**
 * Blob Storage Types
 *
 * Abstraction for handling large data objects in workflows
 */

export interface BlobRef {
  /** Stable discriminant used by workflow serialization guards. */
  __kind: "blob";
  /** Portable identifier containing only ASCII letters, digits, `_`, and `-`. */
  id: string;
  /** Exact stored payload size in bytes. */
  size: number;
  /** Media type reported by the selected storage implementation. */
  mimeType: string;
  /** Provider-reported or locally recorded creation time. */
  createdAt: Date;
  /** Logical expiry time when the selected backend supports TTL metadata. */
  expiresAt?: Date;
  /** Public URL only when the backend was explicitly configured to provide one. */
  url?: string;
  /** Backend-specific user metadata, excluding provider-owned internal fields. */
  metadata?: Record<string, string>;
}

export interface StoreBlobOptions {
  /** Portable identifier containing only ASCII letters, digits, `_`, and `-`. */
  id?: string;
  /** Payload media type. */
  mimeType?: string;
  /** User metadata copied by the selected backend. */
  metadata?: Record<string, string>;
  /** Logical time-to-live in seconds; zero disables expiry. */
  ttl?: number;
}

/** Extension contract name for an explicitly selected blob-storage implementation. */
export const BlobStorageContractName = "BlobStorage" as const;

export interface BlobStorage {
  /** Store a payload and return its reference snapshot. */
  put(
    data: string | Uint8Array | Blob | ReadableStream,
    options?: StoreBlobOptions,
  ): Promise<BlobRef>;
  /** Return a streaming payload, or `null` when the object is absent. */
  getStream(id: string): Promise<ReadableStream | null>;
  /** Decode a payload as text, or return `null` when it is absent. */
  getText(id: string): Promise<string | null>;
  /** Read a payload as bytes, or return `null` when it is absent. */
  getBytes(id: string): Promise<Uint8Array | null>;
  /** Delete an object idempotently. */
  delete(id: string): Promise<void>;
  /** Test object presence. */
  exists(id: string): Promise<boolean>;
  /** Return object metadata, or `null` when the object is absent. */
  stat(id: string): Promise<BlobRef | null>;
  /**
   * Enumerate stored blobs, newest first. Optional — only backends that can
   * cheaply list (e.g. local disk) implement it; callers must feature-detect.
   */
  list?(): Promise<BlobRef[]>;
}
