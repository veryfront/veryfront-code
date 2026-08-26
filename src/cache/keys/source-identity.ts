import { CACHE_INVARIANT_VIOLATION } from "#veryfront/errors";

const IntrinsicReflectApply = Reflect.apply;
const IntrinsicEncodeURIComponent = encodeURIComponent;
const ArrayPrototypeJoin = Array.prototype.join;

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

function encodeRequiredSegment(value: string | null | undefined, label: string): string {
  if (!value) {
    throw CACHE_INVARIANT_VIOLATION.create({
      detail: "Missing " + label + " for cache source identity",
    });
  }
  return IntrinsicReflectApply(IntrinsicEncodeURIComponent, globalThis, [value]) as string;
}

/** Encode an exact content source without permitting delimiter collisions. */
export function encodeCacheSourceIdentity(
  identity: CacheSourceIdentity,
): EncodedCacheSourceIdentity {
  let segments: string[];
  switch (identity.type) {
    case "branch":
      segments = [encodeRequiredSegment(identity.branch, "branch")];
      break;
    case "release":
      segments = [encodeRequiredSegment(identity.releaseId, "releaseId")];
      break;
    case "environment":
      segments = [
        encodeRequiredSegment(identity.environmentName, "environmentName"),
        encodeRequiredSegment(identity.releaseId, "releaseId"),
      ];
      break;
  }

  const qualifier = IntrinsicReflectApply(ArrayPrototypeJoin, segments, [":"]) as string;
  return {
    type: identity.type,
    qualifier,
    key: identity.type + ":" + qualifier,
  };
}
