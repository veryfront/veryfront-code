import type { RenderMetadata } from "@veryfront/types";
import {
  extractHTMLMetadata,
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
  type HTMLMetadata,
} from "./index.ts";

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
