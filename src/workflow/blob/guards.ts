import type { BlobRef } from "./types.ts";

/**
 * Type guard verifying that an unknown value is a BlobRef.
 *
 * Checks structural shape rather than relying on `__kind` alone, so
 * user data that happens to contain `{ __kind: "blob" }` does not
 * incorrectly route through the blob resolver.
 */
export function isBlobRef(value: unknown): value is BlobRef {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.__kind === "blob"
    && typeof v.id === "string"
    && typeof v.size === "number"
    && typeof v.mimeType === "string"
    && v.createdAt instanceof Date;
}
