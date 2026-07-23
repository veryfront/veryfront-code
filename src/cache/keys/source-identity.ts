import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";
import { containsUnsafeCacheStringCharacter } from "../validation.ts";

const MAX_CACHE_IDENTITY_SEGMENT_LENGTH = 4096;

export type CacheSourceIdentity =
  | { type: "branch"; branch: string }
  | { type: "release"; releaseId: string }
  | {
    type: "environment";
    environmentName: string;
    releaseId: string;
  };

export interface EncodedCacheSourceIdentity {
  type: CacheSourceIdentity["type"];
  /** Encoded variable segments only, safe to append to a colon-delimited key. */
  qualifier: string;
  /** Canonical source type plus encoded qualifier. */
  key: string;
}

/** Encode one bounded identity field for a colon-delimited cache key. */
export function encodeCacheIdentitySegment(
  value: string | null | undefined,
  label: string,
): string {
  if (
    !value || value.length > MAX_CACHE_IDENTITY_SEGMENT_LENGTH ||
    containsUnsafeCacheStringCharacter(value)
  ) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: `Invalid ${label} for cache identity`,
    });
  }
  return encodeURIComponent(value);
}

/** Encode an exact content source without permitting delimiter collisions. */
export function encodeCacheSourceIdentity(
  identity: CacheSourceIdentity,
): EncodedCacheSourceIdentity {
  let segments: string[];
  switch (identity.type) {
    case "branch":
      segments = [encodeCacheIdentitySegment(identity.branch, "branch")];
      break;
    case "release":
      segments = [encodeCacheIdentitySegment(identity.releaseId, "releaseId")];
      break;
    case "environment":
      segments = [
        encodeCacheIdentitySegment(identity.environmentName, "environmentName"),
        encodeCacheIdentitySegment(identity.releaseId, "releaseId"),
      ];
      break;
  }

  const qualifier = segments.join(":");
  return {
    type: identity.type,
    qualifier,
    key: identity.type + ":" + qualifier,
  };
}
