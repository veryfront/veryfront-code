/**
 * Resolve the release ID for manifest consumption from render options.
 *
 * Prefers an explicit `releaseId`, then derives it from a production
 * `contentSourceId` of the form `release-<id>`. Returns undefined for
 * preview/local renders so manifest consumption stays inert there.
 */
export function resolveReleaseId(
  options: { releaseId?: string; contentSourceId?: string } | undefined,
): string | undefined {
  if (options?.releaseId) return options.releaseId;
  const source = options?.contentSourceId;
  if (source?.startsWith("release-")) return source.slice("release-".length);
  return undefined;
}
