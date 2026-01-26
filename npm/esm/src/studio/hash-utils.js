/**
 * Simple FNV-1a hash function for source code fingerprinting.
 * Used to detect sync between Navigator tree and source content.
 */
export function computeSourceHash(content) {
    let hash = 2166136261;
    for (let i = 0; i < content.length; i++) {
        hash ^= content.charCodeAt(i);
        hash = (hash * 16777619) >>> 0;
    }
    return hash.toString(16);
}
