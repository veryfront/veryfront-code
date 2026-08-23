import { INVALID_ARGUMENT } from "#veryfront/errors";

const SAFE_BLOB_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_BLOB_ID_LENGTH = 256;
const reflectApply = Reflect.apply;
const regExpTest = RegExp.prototype.test;

/** Return whether a runtime value is a framework-safe blob identifier. */
export function isSafeBlobId(id: unknown): id is string {
  return typeof id === "string" && id.length <= MAX_BLOB_ID_LENGTH &&
    reflectApply(regExpTest, SAFE_BLOB_ID_PATTERN, [id]);
}

/** Validate an identifier before any blob backend constructs a storage path. */
export function assertSafeBlobId(id: unknown): asserts id is string {
  if (isSafeBlobId(id)) return;

  throw INVALID_ARGUMENT.create({
    detail:
      `Invalid blob id. Blob IDs must contain at most ${MAX_BLOB_ID_LENGTH} alphanumeric characters, hyphens, and underscores.`,
  });
}
