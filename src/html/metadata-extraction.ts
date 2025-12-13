import type { HTMLMetadata, MDXFrontmatter } from "@veryfront/transforms/mdx/types.ts";

export function extractHTMLMetadata(
  pageFrontmatter: MDXFrontmatter,
  layoutFrontmatter?: MDXFrontmatter,
): HTMLMetadata {
  const base = { ...(layoutFrontmatter || {}) };
  const merged = { ...base, ...pageFrontmatter };

  if (merged.metadata && typeof merged.metadata === "object") {
    Object.assign(merged, merged.metadata);
  }

  const metadata: HTMLMetadata = {
    title: merged.title || "Veryfront App",
    description: merged.description || "",
    viewport: merged.viewport,
    themeColor: merged.themeColor,
    meta: [],
    links: [],
    icons: merged.icons || [],
    scripts: [],
    styles: [],
    lang: merged.lang,
    bodyClass: merged.bodyClass,
  };

  if (merged.meta && Array.isArray(merged.meta)) {
    metadata.meta = merged.meta;
  }

  if (merged.og) {
    Object.entries(merged.og).forEach(([key, value]) => {
      metadata.meta?.push({
        property: `og:${key}`,
        content: String(value),
      });
    });
  }

  if (merged.twitter) {
    Object.entries(merged.twitter).forEach(([key, value]) => {
      metadata.meta?.push({
        name: `twitter:${key}`,
        content: String(value),
      });
    });
  }

  if (merged.links && Array.isArray(merged.links)) {
    metadata.links = merged.links;
  }

  if (merged.scripts && Array.isArray(merged.scripts)) {
    metadata.scripts = merged.scripts;
  }

  if (merged.styles && Array.isArray(merged.styles)) {
    metadata.styles = merged.styles;
  }

  // Copy remaining custom properties (excluding already-processed standard keys)
  const processedKeys = new Set([
    "title",
    "description",
    "meta",
    "links",
    "scripts",
    "styles",
    "og",
    "twitter",
    "viewport",
    "themeColor",
    "icons",
    "metadata",
    "lang",
    "bodyClass",
  ]);

  Object.keys(merged).forEach((key) => {
    if (!processedKeys.has(key)) {
      metadata[key] = merged[key];
    }
  });

  return metadata;
}
