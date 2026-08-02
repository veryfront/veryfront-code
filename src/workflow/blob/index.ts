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
export { assertSafeBlobId, isSafeBlobId } from "./blob-id.ts";
export { LocalBlobStorage } from "./local-storage.ts";
export {
  VeryfrontCloudBlobStorage,
  type VeryfrontCloudBlobStorageConfig,
} from "./veryfront-cloud-storage.ts";
