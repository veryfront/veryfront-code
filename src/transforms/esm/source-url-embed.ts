/**
 * Source URL embedding for cache resilience.
 *
 * Embeds source URLs in cached bundles as preserved comments for self-contained
 * recovery when distributed cache has orphaned references.
 *
 * @module transforms/esm/source-url-embed
 */

/** Preserved comment format that survives minification */
const VF_SOURCE_PREFIX = "/*! @vf-source: ";
const VF_SOURCE_SUFFIX = " */\n";

/**
 * Embed the source URL in bundle code as a preserved comment.
 * This enables recovery when URL mapping is missing from distributed cache.
 */
export function embedSourceUrl(code: string, sourceUrl: string): string {
  if (code.startsWith(VF_SOURCE_PREFIX)) return code;
  return `${VF_SOURCE_PREFIX}${sourceUrl}${VF_SOURCE_SUFFIX}${code}`;
}

/**
 * Extract the embedded source URL from bundle code.
 */
export function extractSourceUrl(code: string): string | null {
  if (!code.startsWith(VF_SOURCE_PREFIX)) return null;
  const endIndex = code.indexOf(VF_SOURCE_SUFFIX);
  if (endIndex === -1) return null;
  return code.slice(VF_SOURCE_PREFIX.length, endIndex).trim();
}
