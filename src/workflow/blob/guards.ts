import type { BlobRef } from "./types.ts";
import { isSafeBlobId } from "./blob-id.ts";
import { captureBlobMetadata, captureBlobMimeType, captureExactBlobRecord } from "./contract.ts";

const BLOB_REF_KEYS = new Set([
  "__kind",
  "id",
  "size",
  "mimeType",
  "createdAt",
  "expiresAt",
  "url",
  "metadata",
]);
const dateGetTime = Date.prototype.getTime;

function isValidDate(value: unknown): boolean {
  try {
    return Number.isFinite(Reflect.apply(dateGetTime, value, []));
  } catch {
    return false;
  }
}

/**
 * Type guard verifying that an unknown value is a BlobRef.
 *
 * Checks structural shape rather than relying on `__kind` alone, so
 * user data that happens to contain `{ __kind: "blob" }` does not
 * incorrectly route through the blob resolver.
 */
export function isBlobRef(value: unknown): value is BlobRef {
  try {
    const fields = captureExactBlobRecord(value, "Blob reference", BLOB_REF_KEYS);
    const size = fields.get("size");
    const expiresAt = fields.get("expiresAt");
    const url = fields.get("url");
    return fields.get("__kind") === "blob" &&
      isSafeBlobId(fields.get("id")) &&
      typeof size === "number" && Number.isSafeInteger(size) && size >= 0 &&
      Boolean(captureBlobMimeType(fields.get("mimeType"))) &&
      isValidDate(fields.get("createdAt")) &&
      (expiresAt === undefined || isValidDate(expiresAt)) &&
      (url === undefined || typeof url === "string") &&
      Boolean(captureBlobMetadata(fields.get("metadata")) ?? true);
  } catch {
    return false;
  }
}
