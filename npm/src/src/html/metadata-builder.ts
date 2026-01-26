import type { RenderMetadata } from "../types/index.js";
import { extractHTMLMetadata } from "./metadata-extraction.js";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.js";
import type { HTMLMetadata } from "./types.js";

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
    meta.frontmatter ?? {},
    meta.layoutFrontmatter ?? {},
  );

  const effectiveTitle = meta.frontmatter?.title ?? meta.title ?? metadata.title ?? "Veryfront App";

  return {
    metadata,
    effectiveTitle,
    metaTags: generateMetaTags(metadata),
    linkTags: generateLinkTags(metadata),
    scriptTags: generateScriptTags(metadata),
    styleTags: generateStyleTags(metadata),
    lang: typeof metadata.lang === "string" ? metadata.lang : "en",
    bodyClass: typeof metadata.bodyClass === "string" ? metadata.bodyClass : "",
  };
}
