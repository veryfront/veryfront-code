import type { HTMLMetadata, MDXFrontmatter } from "#veryfront/transforms/mdx/types.ts";

const RESERVED_KEYS = new Set([
  "title",
  "description",
  "meta",
  "links",
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
    meta: Array.isArray(merged.meta) ? merged.meta : [],
    links: Array.isArray(merged.links) ? merged.links : [],
    icons: merged.icons || [],
    scripts: Array.isArray(merged.scripts) ? merged.scripts : [],
    styles: Array.isArray(merged.styles) ? merged.styles : [],
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
    if (!RESERVED_KEYS.has(key)) {
      metadata[key] = value;
    }
  }

  return metadata;
}
