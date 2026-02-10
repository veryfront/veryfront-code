/**
 * Tailwind CSS candidate extraction from source files.
 *
 * Extracts class name candidates from source code for Tailwind CSS compilation.
 *
 * @module html/styles-builder/candidate-extractor
 */

/**
 * Extract potential Tailwind class name candidates from source code content.
 * Uses a comprehensive regex pattern matching Tailwind v4 utility patterns.
 */
export function extractCandidates(content: string): string[] {
  const pattern = /!?-?@?(?:[a-zA-Z0-9]|\[&?)[a-zA-Z0-9_\-:\/\.\[\]%#,()!'=<>$@{}|*+?;^~]*/g;
  return [...new Set(content.match(pattern) ?? [])];
}

export function extractCandidatesFromFiles(
  files: Array<{ path: string; content?: string }>,
): Set<string> {
  const candidates = new Set<string>();
  const sourceExtensions = [".tsx", ".jsx", ".ts", ".js", ".mdx"];

  for (const file of files) {
    if (!file.content) continue;
    if (!sourceExtensions.some((ext) => file.path.endsWith(ext))) continue;

    for (const candidate of extractCandidates(file.content)) {
      candidates.add(candidate);
    }
  }

  return candidates;
}

/**
 * Simple DJB2-style hash function.
 */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash) + str.charCodeAt(i);
    hash = hash & hash;
  }
  return hash.toString(36);
}

export function hashCSS(css: string): string {
  return hashString(css).slice(0, 8);
}

/**
 * Hash a set of candidates for cache key generation.
 * Uses sorted array to ensure consistent hash regardless of Set iteration order.
 */
export function hashCandidates(candidates: Set<string>): string {
  return hashString(Array.from(candidates).sort().join(","));
}
