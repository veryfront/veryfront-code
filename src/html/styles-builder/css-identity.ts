import { createHash } from "node:crypto";
import { isStyleProfileHash } from "#veryfront/utils/css-artifact-identity.ts";
import { normalizeCSSCandidates } from "#veryfront/utils/css-candidate-admission.ts";

const CANDIDATE_IDENTITY_SCHEMA = "veryfront.css-candidates.v1";

/** Canonical URL shape for immutable, content-addressed runtime CSS. */
const CSS_ASSET_PATH_PATTERN = /^\/_vf\/css\/([a-f0-9]{64})\.css$/;

/** Compute a synchronous, deterministic SHA-256 digest of the exact UTF-8 string. */
export function hashString(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Compute the authoritative identity for an immutable CSS payload. */
export function hashCSS(css: string): string {
  return hashString(css);
}

/**
 * Hash a candidate set using an unambiguous, versioned serialization.
 * Sorting makes Set insertion order irrelevant; JSON preserves string boundaries.
 */
export function hashCandidates(candidates: Set<string>): string {
  const canonicalCandidates = normalizeCSSCandidates(candidates).sort();
  return hashString(JSON.stringify([CANDIDATE_IDENTITY_SCHEMA, canonicalCandidates]));
}

export function isCSSContentHash(value: unknown): value is string {
  return isStyleProfileHash(value);
}

export function extractCSSAssetHash(pathname: string): string | undefined {
  return pathname.match(CSS_ASSET_PATH_PATTERN)?.[1];
}

/** Return an isolated route matcher so consumers cannot mutate shared identity state. */
export function createCSSAssetPathPattern(): RegExp {
  return new RegExp(CSS_ASSET_PATH_PATTERN.source);
}

/** Reject a forged or stale identity before it can enter a content-addressed cache. */
export function assertCSSContentIdentity(css: string, expectedHash: string): void {
  if (!isCSSContentHash(expectedHash)) {
    throw new TypeError("CSS hash must be a full lowercase SHA-256 digest");
  }

  const actualHash = hashCSS(css);
  if (actualHash !== expectedHash) {
    throw new TypeError("CSS hash does not match the CSS content identity");
  }
}
