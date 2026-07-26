import type { ContentPlugin } from "#veryfront/extensions/content/index.ts";

/**
 * Copy a Unified plugin list without flattening `[plugin, options]` tuples.
 */
export function normalizePlugins(
  plugins: readonly ContentPlugin[] | undefined,
): ContentPlugin[] {
  return plugins === undefined ? [] : [...plugins];
}
