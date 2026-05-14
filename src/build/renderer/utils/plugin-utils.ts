import type { ContentPlugin } from "#veryfront/extensions/content/index.ts";

export function normalizePlugins(plugins: ContentPlugin[] | undefined): ContentPlugin[] {
  if (!plugins) return [];

  if (Array.isArray(plugins)) return plugins.flat() as ContentPlugin[];

  return [plugins] as ContentPlugin[];
}
