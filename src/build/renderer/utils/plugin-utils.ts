import type { Pluggable, PluggableList } from "unified";

export function normalizePlugins(plugins: PluggableList | undefined): Pluggable[] {
  if (!plugins) return [];
  return (Array.isArray(plugins) ? plugins.flat() : [plugins]) as Pluggable[];
}
