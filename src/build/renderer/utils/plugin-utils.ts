import type { ContentPlugin } from "#veryfront/extensions/content/index.ts";

export function normalizePlugins(plugins: ContentPlugin[] | undefined): ContentPlugin[] {
  if (!plugins) return [];
  return [...plugins];
}
