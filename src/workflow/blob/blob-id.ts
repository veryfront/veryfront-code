import { INVALID_ARGUMENT } from "#veryfront/errors";

const SAFE_BLOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isSafeBlobId(id: string): boolean {
  return SAFE_BLOB_ID_PATTERN.test(id);
}

/** Validate an identifier before any blob backend constructs a storage path. */
export function assertSafeBlobId(id: string): void {
  if (isSafeBlobId(id)) return;

  throw INVALID_ARGUMENT.create({
    detail:
      `Invalid blob id: "${id}". IDs must contain only alphanumeric characters, hyphens, and underscores.`,
  });
}
