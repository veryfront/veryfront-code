import type { MDXFrontmatter, RenderMetadata } from "#veryfront/types";
import type { MDXFrontmatter as HTMLFrontmatter } from "#veryfront/transforms/mdx/types.ts";
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

/** Render metadata accepted by the HTML shell, including rich structured frontmatter. */
export type HTMLRenderMetadata =
  & Omit<
    RenderMetadata,
    "frontmatter" | "layoutFrontmatter"
  >
  & {
    frontmatter?: MDXFrontmatter | HTMLFrontmatter;
    layoutFrontmatter?: MDXFrontmatter | HTMLFrontmatter;
  };

export function processMetadata(
  meta: HTMLRenderMetadata,
  nonce?: string,
): ProcessedMetadata {
  const frontmatter = readOwnDataProperty(meta, "frontmatter");
  const layoutFrontmatter = readOwnDataProperty(meta, "layoutFrontmatter");
  const metadata = extractHTMLMetadata(
    frontmatter,
    layoutFrontmatter,
  );

  const frontmatterTitle = readOwnNonEmptyString(frontmatter, "title");
  const topLevelTitle = readOwnNonEmptyString(meta, "title");
  const effectiveTitle = frontmatterTitle ??
    topLevelTitle ??
    metadata.title ??
    "Veryfront App";

  const frontmatterDescription = readOwnString(frontmatter, "description");
  const topLevelDescription = readOwnNonEmptyString(meta, "description");
  if (frontmatterDescription === undefined && topLevelDescription !== undefined) {
    metadata.description = topLevelDescription;
  }

  const frontmatterLang = readOwnString(frontmatter, "lang");
  const topLevelLang = readOwnNonEmptyString(meta, "lang");
  if (frontmatterLang === undefined && topLevelLang !== undefined) {
    metadata.lang = topLevelLang;
  }

  const frontmatterBodyClass = readOwnString(frontmatter, "bodyClass");
  const topLevelBodyClass = readOwnString(meta, "bodyClass");
  if (frontmatterBodyClass === undefined && topLevelBodyClass !== undefined) {
    metadata.bodyClass = topLevelBodyClass;
  }

  const lang = typeof metadata.lang === "string" && metadata.lang.length > 0 ? metadata.lang : "en";
  const bodyClass = typeof metadata.bodyClass === "string" ? metadata.bodyClass : "";

  return {
    metadata,
    effectiveTitle,
    metaTags: generateMetaTags(metadata),
    linkTags: generateLinkTags(metadata),
    scriptTags: generateScriptTags(metadata, nonce),
    styleTags: generateStyleTags(metadata, nonce),
    lang,
    bodyClass,
  };
}

function readOwnDataProperty(value: unknown, key: string): unknown {
  if (typeof value !== "object" || value === null) return undefined;
  try {
    const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
    return descriptor?.enumerable && "value" in descriptor ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

function readOwnString(value: unknown, key: string): string | undefined {
  const property = readOwnDataProperty(value, key);
  return typeof property === "string" ? property : undefined;
}

function readOwnNonEmptyString(value: unknown, key: string): string | undefined {
  const property = readOwnString(value, key);
  return property && property.length > 0 ? property : undefined;
}
