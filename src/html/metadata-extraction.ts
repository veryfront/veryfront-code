import type { HTMLMetadata, MDXFrontmatter } from "#veryfront/transforms/mdx/types.ts";

const RESERVED_KEYS = new Set([
  "title",
  "description",
  "meta",
  "links",
  "icons",
  "scripts",
  "styles",
  "og",
  "twitter",
]);

export function extractHTMLMetadata(
  pageFrontmatter: MDXFrontmatter,
  layoutFrontmatter?: MDXFrontmatter,
): HTMLMetadata {
  const merged = { ...(layoutFrontmatter ?? {}), ...pageFrontmatter };

  if (merged.metadata && typeof merged.metadata === "object") {
    Object.assign(merged, merged.metadata);
  }

  const metadata: HTMLMetadata = {
    title: merged.title || "Veryfront App",
    description: merged.description || "",
    viewport: merged.viewport,
    themeColor: merged.themeColor,
    meta: Array.isArray(merged.meta) ? merged.meta.map((entry) => ({ ...entry })) : [],
    links: Array.isArray(merged.links) ? merged.links.map((entry) => ({ ...entry })) : [],
    icons: Array.isArray(merged.icons) ? merged.icons.map((entry) => ({ ...entry })) : [],
    scripts: Array.isArray(merged.scripts) ? merged.scripts.map((entry) => ({ ...entry })) : [],
    styles: Array.isArray(merged.styles) ? merged.styles.map((entry) => ({ ...entry })) : [],
  };

  if (merged.og && metadata.meta) {
    for (const [key, value] of Object.entries(merged.og)) {
      metadata.meta.push({ property: `og:${key}`, content: String(value) });
    }
  }

  if (merged.twitter && metadata.meta) {
    for (const [key, value] of Object.entries(merged.twitter)) {
      metadata.meta.push({ name: `twitter:${key}`, content: String(value) });
    }
  }

  for (const [key, value] of Object.entries(merged)) {
    if (RESERVED_KEYS.has(key)) continue;
    metadata[key] = Array.isArray(value)
      ? value.map((entry) =>
        entry !== null && typeof entry === "object" && !Array.isArray(entry) ? { ...entry } : entry
      )
      : value;
  }

  return metadata;
}
