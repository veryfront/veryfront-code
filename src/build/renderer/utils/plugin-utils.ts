import type { Pluggable, PluggableList } from "unified";

export function normalizePlugins(plugins: PluggableList | undefined): Pluggable[] {
  if (!plugins) return [];

  if (Array.isArray(plugins)) return plugins.flat() as Pluggable[];

  return [plugins] as Pluggable[];
}
