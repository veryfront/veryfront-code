import { readRecord } from "veryfront/provider/shared";

const APPENDED_OBJECT_ARRAY_FIELDS = [
  "groundingChunks",
  "groundingSupports",
] as const;
const MERGED_STRING_ARRAY_FIELDS = [
  "webSearchQueries",
  "imageSearchQueries",
] as const;

type AppendedObjectArrayField = (typeof APPENDED_OBJECT_ARRAY_FIELDS)[number];
type MergedStringArrayField = (typeof MERGED_STRING_ARRAY_FIELDS)[number];

function readObjectArray(
  value: unknown,
  field: AppendedObjectArrayField,
): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    throw new TypeError(`Google grounding metadata ${field} must be an array`);
  }
  return value.map((item) => {
    const record = readRecord(item);
    if (!record) {
      throw new TypeError(`Google grounding metadata ${field} item must be an object`);
    }
    return record;
  });
}

function readStringArray(
  value: unknown,
  field: MergedStringArrayField,
): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new TypeError(`Google grounding metadata ${field} must be a string array`);
  }
  return value;
}

/**
 * Validate the stable list fields needed to preserve citation integrity while
 * retaining all other Google-owned metadata fields opaquely.
 */
export function readGoogleGroundingMetadata(
  value: unknown,
): Record<string, unknown> {
  const metadata = readRecord(value);
  if (!metadata) {
    throw new TypeError("Google grounding metadata must be an object");
  }

  const normalized = { ...metadata };
  for (const field of APPENDED_OBJECT_ARRAY_FIELDS) {
    if (metadata[field] !== undefined) {
      normalized[field] = readObjectArray(metadata[field], field);
    }
  }
  for (const field of MERGED_STRING_ARRAY_FIELDS) {
    if (metadata[field] !== undefined) {
      normalized[field] = readStringArray(metadata[field], field);
    }
  }
  return normalized;
}

/**
 * Merge one streaming GroundingMetadata delta into the aggregate result.
 *
 * Google documents groundingChunks as incremental in streaming responses and
 * defines support indices across every response. Supports are therefore
 * appended too, while query strings are accumulated without duplicates.
 * Scalar/object fields and unknown future fields use the latest value.
 */
export function mergeGoogleGroundingMetadata(
  current: Record<string, unknown> | undefined,
  incoming: unknown,
): Record<string, unknown> {
  const normalizedIncoming = readGoogleGroundingMetadata(incoming);
  const merged: Record<string, unknown> = {
    ...(current ?? {}),
    ...normalizedIncoming,
  };

  for (const field of APPENDED_OBJECT_ARRAY_FIELDS) {
    const previousItems = current?.[field];
    const incomingItems = normalizedIncoming[field];
    if (incomingItems !== undefined) {
      merged[field] = [
        ...(Array.isArray(previousItems) ? previousItems : []),
        ...(incomingItems as unknown[]),
      ];
    }
  }

  for (const field of MERGED_STRING_ARRAY_FIELDS) {
    const previousItems = current?.[field];
    const incomingItems = normalizedIncoming[field];
    if (incomingItems !== undefined) {
      merged[field] = [
        ...new Set([
          ...(Array.isArray(previousItems) ? previousItems as string[] : []),
          ...(incomingItems as string[]),
        ]),
      ];
    }
  }

  return merged;
}
