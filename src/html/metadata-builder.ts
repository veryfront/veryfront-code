import type { RenderMetadata } from "#veryfront/types";
import { extractHTMLMetadata } from "./metadata-extraction.ts";
import {
  generateLinkTags,
  generateMetaTags,
  generateScriptTags,
  generateStyleTags,
} from "./tag-generators.ts";
import type { HTMLMetadata } from "./types.ts";
import { INPUT_VALIDATION_FAILED } from "#veryfront/errors/error-registry/general.ts";
import { getUTF8ByteLength, MAX_HTML_METADATA_TEXT_BYTES } from "./limits.ts";
import { snapshotPlainDataRecord } from "./json-snapshot.ts";

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

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function processMetadata(meta: RenderMetadata, nonce?: string): ProcessedMetadata {
  meta = snapshotPlainDataRecord(meta, "HTML render metadata") as unknown as RenderMetadata;
  const frontmatter = meta.frontmatter === undefined
    ? {}
    : snapshotPlainDataRecord(meta.frontmatter, "HTML frontmatter");
  const layoutFrontmatter = meta.layoutFrontmatter === undefined
    ? {}
    : snapshotPlainDataRecord(meta.layoutFrontmatter, "HTML layout frontmatter");
  const metadata = extractHTMLMetadata(
    frontmatter,
    layoutFrontmatter,
  );

  const effectiveTitle = nonEmptyString(frontmatter.title) ??
    nonEmptyString(meta.title) ??
    nonEmptyString(metadata.title) ??
    "Veryfront App";
  if (getUTF8ByteLength(effectiveTitle) > MAX_HTML_METADATA_TEXT_BYTES) {
    throw INPUT_VALIDATION_FAILED.create({ detail: "HTML metadata title exceeds the size limit" });
  }

  let lang = "en";
  if (typeof metadata.lang === "string") {
    if (!/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(metadata.lang)) {
      throw INPUT_VALIDATION_FAILED.create({ detail: "Invalid HTML language tag" });
    }
    lang = metadata.lang;
  }
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
