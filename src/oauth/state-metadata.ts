import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";
import { MAX_OAUTH_STATE_METADATA_BYTES } from "./limits.ts";

const textEncoder = new TextEncoder();

export type OAuthStateMetadata = Record<string, BoundedJsonValue>;

/**
 * Snapshot optional transaction metadata into a small, data-only JSON object.
 *
 * Persistent TokenStore implementations commonly serialize this row. Keeping
 * one canonical JSON boundary prevents accessors, cycles, class instances, and
 * oversized values from changing meaning across in-memory and durable stores.
 */
export function snapshotOAuthStateMetadata(
  value: unknown,
): OAuthStateMetadata | null {
  const snapshot = snapshotBoundedJsonValue(value);
  if (
    !snapshot.success || snapshot.value === null ||
    typeof snapshot.value !== "object" || Array.isArray(snapshot.value)
  ) {
    return null;
  }

  const serialized = JSON.stringify(snapshot.value);
  if (textEncoder.encode(serialized).byteLength > MAX_OAUTH_STATE_METADATA_BYTES) {
    return null;
  }
  return snapshot.value as OAuthStateMetadata;
}
