/**
 * Simple FNV-1a hash function for source code fingerprinting.
 * Used to detect sync between Navigator tree and source content.
 */
export function computeSourceHash(content: string): string {
  let hash = 2166136261;

  for (const char of content) {
    hash ^= char.charCodeAt(0);
    hash = (hash * 16777619) >>> 0;
  }

  return hash.toString(16);
}
