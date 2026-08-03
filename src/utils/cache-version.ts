/**
 * Helpers for using runtime versions in filesystem cache paths.
 */

export function formatCacheVersionSegment(version: string | number): string {
  const normalized = String(version)
    .replace(/^v(?=\d)/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `v${normalized || "unknown"}`;
}

export function isCacheVersionSegment(segment: string | undefined): boolean {
  return typeof segment === "string" && /^v\d[A-Za-z0-9_-]*$/.test(segment);
}
