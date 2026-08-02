import { TRIGGER_CONFIG_INVALID } from "#veryfront/errors";
import { type BoundedJsonValue, snapshotBoundedJsonValue } from "#veryfront/schemas/json-value.ts";

const MAX_TRIGGER_ID_LENGTH = 256;
const ID_SEGMENT_PATTERN = /^[a-z0-9][a-z0-9._-]*$/;

/** Return true for a bounded canonical slash-separated trigger identifier. */
export function isTriggerId(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_TRIGGER_ID_LENGTH &&
    value.split("/").every((segment) => ID_SEGMENT_PATTERN.test(segment));
}

export function validateTriggerId(id: string, label: string): void {
  if (!isTriggerId(id)) {
    throw TRIGGER_CONFIG_INVALID.create({
      detail:
        `${label} id must be at most ${MAX_TRIGGER_ID_LENGTH} characters and contain slash-separated lowercase segments that start with a letter or number and use only letters, numbers, dots, underscores, or hyphens.`,
    });
  }
}

export function assertSerializable(value: unknown, path = "value"): void {
  if (value === undefined) return;
  snapshotSerializable(value, path);
}

/**
 * Capture an immutable-by-ownership, bounded JSON representation of trigger
 * input before it crosses an asynchronous execution boundary.
 */
export function snapshotSerializable(
  value: unknown,
  path = "value",
): BoundedJsonValue {
  const snapshot = snapshotBoundedJsonValue(value);
  if (!snapshot.success) {
    throw TRIGGER_CONFIG_INVALID.create({
      detail:
        `${path} must be JSON-serializable. Values must stay within runtime size and depth limits and cannot contain accessors, sparse arrays, cycles, or unsupported data.`,
    });
  }
  return snapshot.value;
}
