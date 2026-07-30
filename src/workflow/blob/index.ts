/**
 * Provider-neutral blob storage contracts and built-in first-party storage.
 *
 * @module workflow/blob
 * @example Store a blob with the local implementation
 * ```ts
 * import { LocalBlobStorage } from "veryfront/workflow/blob";
 *
 * const storage = new LocalBlobStorage(".veryfront/blobs");
 * const blob = await storage.put("hello", { id: "greeting" });
 * ```
 */

export {
  type BlobRef,
  type BlobStorage,
  BlobStorageContractName,
  type StoreBlobOptions,
} from "./types.ts";
export { assertSafeBlobId, isSafeBlobId, MAX_BLOB_ID_CODE_UNITS } from "./blob-id.ts";
export {
  MAX_BLOB_BUFFER_BYTES,
  MAX_BLOB_METADATA_ENTRIES,
  MAX_BLOB_METADATA_KEY_CODE_UNITS,
  MAX_BLOB_METADATA_TOTAL_CODE_UNITS,
  MAX_BLOB_METADATA_VALUE_CODE_UNITS,
  MAX_BLOB_MIME_TYPE_CODE_UNITS,
  MAX_BLOB_STREAM_CHUNKS,
} from "./contract.ts";
export { LocalBlobStorage } from "./local-storage.ts";
export {
  VeryfrontCloudBlobStorage,
  type VeryfrontCloudBlobStorageConfig,
} from "./veryfront-cloud-storage.ts";
