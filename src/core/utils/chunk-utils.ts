/**
 * Chunk path utilities for build and serving
 */

/**
 * Normalize a chunk path for manifest processing.
 * Handles null/undefined values, http URLs, and relative paths.
 *
 * @param value - The chunk path value (may be null/undefined)
 * @param base - Base path prefix for relative paths
 * @returns Normalized path or null if input is invalid
 */
export function normalizeChunkPath(
  value: string | null | undefined,
  base: string,
): string | null {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return null;

  const candidate = value.replace(/^\.\//, "");

  if (candidate.startsWith("/")) {
    return candidate;
  }

  if (candidate.startsWith("_veryfront/")) {
    return `/${candidate}`;
  }

  if (candidate.startsWith("chunks/")) {
    return `/_veryfront/${candidate}`;
  }

  return `${base}/${candidate}`;
}
