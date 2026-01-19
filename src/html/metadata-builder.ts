import type { RenderMetadata } from "#veryfront/types";
// Import directly from source files to avoid circular dependency through barrel
import { extractHTMLMetadata } from "./metadata-extraction.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";
import type { HTMLMetadata } from "./types.ts";

export interface ProcessedMetadata {
  metadata: HTMLMetadata;
  effectiveTitle: string;
  metaTags: string;
  linkTags: string;
  scriptTags: string;
  styleTags: string;
  lang: string;
  bodyClass: string;
}

export function processMetadata(meta: RenderMetadata): ProcessedMetadata {
  const metadata = extractHTMLMetadata(
    meta.frontmatter || {},
    meta.layoutFrontmatter || {},
  );

  const effectiveTitle = meta.frontmatter?.title || meta.title || metadata.title;

  const metaTags = generateMetaTags(metadata);
  const linkTags = generateLinkTags(metadata);
  const scriptTags = generateScriptTags(metadata);
  const styleTags = generateStyleTags(metadata);

  return {
    metadata,
    effectiveTitle: effectiveTitle || "Veryfront App",
    metaTags,
    linkTags,
    scriptTags,
    styleTags,
    lang: (typeof metadata.lang === "string" ? metadata.lang : "en"),
    bodyClass: (typeof metadata.bodyClass === "string" ? metadata.bodyClass : ""),
  };
}
