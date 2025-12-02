/**
 * Blob Storage Types
 *
 * Abstraction for handling large data objects in workflows
 */

/**
 * Reference to a stored blob
 *
 * This object is lightweight and safe to store in WorkflowContext
 */
export interface BlobRef {
  /** Discriminator for type safety */
  __kind: "blob";
  /** Unique ID of the blob */
  id: string;
  /** Size in bytes */
  size: number;
  /** MIME type */
  mimeType: string;
  /** When it was created */
  createdAt: Date;
  /** When this blob expires (if TTL was set) */
  expiresAt?: Date;
  /** Optional public URL (if supported by backend) */
  url?: string;
  /** Metadata */
  metadata?: Record<string, string>;
}

/**
 * Options for storing a blob
 */
export interface StoreBlobOptions {
  /** Explicit ID (otherwise auto-generated) */
  id?: string;
  /** MIME type */
  mimeType?: string;
  /** Metadata to attach */
  metadata?: Record<string, string>;
  /** TTL in seconds */
  ttl?: number;
}

/**
 * Blob Storage Interface
 *
 * Abstract backend for storing large data objects
 */
export interface BlobStorage {
  /**
   * Store data and return a reference
   */
  put(data: string | Uint8Array | Blob | ReadableStream, options?: StoreBlobOptions): Promise<BlobRef>;

  /**
   * Retrieve data as a ReadableStream
   */
  getStream(id: string): Promise<ReadableStream | null>;

  /**
   * Retrieve data as text
   */
  getText(id: string): Promise<string | null>;

  /**
   * Retrieve data as Uint8Array
   */
  getBytes(id: string): Promise<Uint8Array | null>;

  /**
   * Delete a blob
   */
  delete(id: string): Promise<void>;

  /**
   * Check if a blob exists
   */
  exists(id: string): Promise<boolean>;

  /**
   * Get blob metadata/ref
   */
  stat(id: string): Promise<BlobRef | null>;
}
