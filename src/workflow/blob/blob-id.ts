import { INVALID_ARGUMENT } from "#veryfront/errors";

const SAFE_BLOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_BLOB_ID_LENGTH = 255;

export function isSafeBlobId(id: unknown): id is string {
  return typeof id === "string" &&
    id.length <= MAX_BLOB_ID_LENGTH &&
    SAFE_BLOB_ID_PATTERN.test(id);
}

/** Validate a primitive ID that fits within one portable filesystem component. */
export function assertSafeBlobId(id: unknown): asserts id is string {
  if (isSafeBlobId(id)) return;

  throw INVALID_ARGUMENT.create({
    detail:
      `Invalid blob id. IDs must be primitive strings of 1 to ${MAX_BLOB_ID_LENGTH} characters ` +
      "containing only alphanumeric characters, hyphens, and underscores.",
  });
}
