/**
 * Blob Storage Types
 *
 * Abstraction for handling large data objects in workflows
 */

/** Metadata that identifies a stored blob. */
export interface BlobRef {
  /** Discriminator for serialized blob references. */
  __kind: "blob";
  /** Stable storage identifier. */
  id: string;
  /** Blob size in bytes. */
  size: number;
  /** Blob media type. */
  mimeType: string;
  /** Time when the blob was stored. */
  createdAt: Date;
  /** Optional expiration time. */
  expiresAt?: Date;
  /** Optional URL that can retrieve the blob. */
  url?: string;
  /** Optional application metadata. */
  metadata?: Record<string, string>;
}

/** Options for storing a blob. */
export interface StoreBlobOptions {
  /** Optional caller-provided storage identifier. */
  id?: string;
  /** Blob media type. */
  mimeType?: string;
  /** Optional application metadata. */
  metadata?: Record<string, string>;
  /** Optional lifetime in seconds. */
  ttl?: number;
}

/** Storage operations available to workflow and tool execution contexts. */
export interface BlobStorage {
  /** Store blob data and return its reference. */
  put(
    data: string | Uint8Array | Blob | ReadableStream,
    options?: StoreBlobOptions,
  ): Promise<BlobRef>;
  /** Read a blob as a stream, or return null when it does not exist. */
  getStream(id: string): Promise<ReadableStream | null>;
  /** Read a blob as text, or return null when it does not exist. */
  getText(id: string): Promise<string | null>;
  /** Read a blob as bytes, or return null when it does not exist. */
  getBytes(id: string): Promise<Uint8Array | null>;
  /** Delete a blob when it exists. */
  delete(id: string): Promise<void>;
  /** Check whether a blob exists. */
  exists(id: string): Promise<boolean>;
  /** Read blob metadata, or return null when it does not exist. */
  stat(id: string): Promise<BlobRef | null>;
  /**
   * Enumerate stored blobs, newest first. Optional, only backends that can
   * cheaply list (e.g. local disk) implement it; callers must feature-detect.
   */
  list?(): Promise<BlobRef[]>;
}
