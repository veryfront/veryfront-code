import type { DiscoveryError } from "./types.ts";

const MAX_DISCOVERY_ERRORS = 10_000;

/** Append one non-fatal discovery error without allowing unbounded result growth. */
export function recordDiscoveryError(
  errors: DiscoveryError[],
  entry: DiscoveryError,
): void {
  if (errors.length >= MAX_DISCOVERY_ERRORS) {
    throw new RangeError("Discovery error limit exceeded");
  }
  errors.push(entry);
}

/** Append discovery errors in order while enforcing the generation-wide limit. */
export function recordDiscoveryErrors(
  errors: DiscoveryError[],
  entries: Iterable<DiscoveryError>,
): void {
  for (const entry of entries) recordDiscoveryError(errors, entry);
}
