/**
 * Plugin normalization utilities for MDX processing
 */

import type { Pluggable, PluggableList } from "unified";

/**
 * Normalize plugins to a flat array of Pluggable items.
 * Handles undefined, single plugins, and arrays of plugins.
 */
export function normalizePlugins(plugins: PluggableList | undefined): Pluggable[] {
  if (plugins === undefined) return [];
  if (!Array.isArray(plugins)) return [plugins as Pluggable];
  return plugins.flat() as Pluggable[];
}
