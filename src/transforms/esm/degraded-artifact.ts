/**
 * Degradation marking for cached HTTP module artifacts.
 *
 * A module whose lazy dependency could not be prefetched is still usable for
 * the render that produced it, but it must never be mistaken for a complete
 * artifact on a later render. The marker travels with the code, so any reader
 * of the on-disk cache can tell the two apart.
 *
 * @module transforms/esm/degraded-artifact
 */

/** Preserved comment format that survives minification */
const VF_DEGRADED_MARKER = "\n/*! @vf-degraded */\n";

/** Mark bundle code as produced from an incomplete dependency prefetch. */
export function markDegradedArtifact(code: string): string {
  if (isDegradedArtifact(code)) return code;
  return `${code}${VF_DEGRADED_MARKER}`;
}

/** Return whether bundle code was produced from an incomplete prefetch. */
export function isDegradedArtifact(code: string): boolean {
  return code.endsWith(VF_DEGRADED_MARKER);
}
