import type { CollectedHead } from "#veryfront/react/head-collector.ts";
import type { MdxBundle, MDXFrontmatter } from "#veryfront/types";
import {
  buildAttributes,
  escapeInlineScriptContent,
  escapeInlineStyleContent,
} from "#veryfront/html/html-escape.ts";

interface FrontmatterContextLike {
  pageInfo: { entity: { frontmatter?: Record<string, unknown> } };
  pageBundle: Pick<MdxBundle, "frontmatter">;
  collectedMetadata?: Record<string, unknown>;
}

export const DEFAULT_DOCUMENT_TITLE = "Veryfront App";

export interface ResolvedDocumentMetadata {
  title: string;
  description: string;
  frontmatter: MDXFrontmatter;
}

export interface BuiltHeadElements {
  /** Classic blocking scripts, safe to place before the import map. */
  scripts: string;
  /** Module scripts, which must follow the import map they consume. */
  moduleScripts: string;
  other: string;
}

export function buildHeadElements(head?: CollectedHead): BuiltHeadElements {
  if (!head) return { scripts: "", moduleScripts: "", other: "" };

  const scriptParts: string[] = [];
  const moduleScriptParts: string[] = [];
  const otherParts: string[] = [];

  for (const script of head.scripts ?? []) {
    const { content, ...attrs } = script;
    const attrPairs: [string, string][] = [["data-vf-head", "true"]];

    for (const [k, v] of Object.entries(attrs)) {
      if (v != null) attrPairs.push([k, v]);
    }

    if (content && !attrs.id) {
      let sum = 0;
      for (let i = 0; i < Math.min(content.length, 200); i++) {
        sum = ((sum << 5) - sum + content.charCodeAt(i)) | 0;
      }
      attrPairs.push(["data-vf-hash", "vf" + Math.abs(sum).toString(36)]);
    }

    const attrStr = buildAttributes(Object.fromEntries(attrPairs));
    const destination = attrs.type?.trim().toLowerCase() === "module"
      ? moduleScriptParts
      : scriptParts;
    if (content) {
      destination.push(`<script ${attrStr}>${escapeInlineScriptContent(content)}</script>`);
    } else if (attrs.src) {
      destination.push(`<script ${attrStr}></script>`);
    }
  }

  for (const meta of head.metas) {
    if (meta.name === "description") continue;

    const attrs: [string, string][] = [];
    if (meta.name) attrs.push(["name", meta.name]);
    if (meta.property) attrs.push(["property", meta.property]);
    if (meta.content) attrs.push(["content", meta.content]);
    if (attrs.length) otherParts.push(`<meta ${buildAttributes(Object.fromEntries(attrs))}>`);
  }

  for (const link of head.links) {
    const attrs = Object.fromEntries(
      Object.entries(link)
        .filter(([, v]) => v != null)
        .map(([k, v]) => [k, String(v)]),
    );
    const attrStr = buildAttributes(attrs);
    if (attrStr) otherParts.push(`<link ${attrStr}>`);
  }

  for (const style of head.styles) {
    otherParts.push(`<style>${escapeInlineStyleContent(style)}</style>`);
  }

  return {
    scripts: scriptParts.join("\n  "),
    moduleScripts: moduleScriptParts.join("\n  "),
    other: otherParts.join("\n  "),
  };
}

export function mergeFrontmatter(context: FrontmatterContextLike): MDXFrontmatter {
  return {
    ...context.pageInfo.entity.frontmatter,
    ...context.pageBundle.frontmatter,
    ...(context.collectedMetadata ?? {}),
  } as MDXFrontmatter;
}

/**
 * Resolve the document fields shared by initial HTML and SPA navigation.
 * Including both fields in frontmatter lets navigation clear metadata from the
 * previous route instead of retaining stale title or description values.
 */
export function resolveDocumentMetadata(
  frontmatter: MDXFrontmatter,
  overrides?: Pick<CollectedHead, "title" | "description">,
): ResolvedDocumentMetadata {
  const frontmatterTitle = typeof frontmatter.title === "string" ? frontmatter.title : "";
  const frontmatterDescription = typeof frontmatter.description === "string"
    ? frontmatter.description
    : "";
  const title = overrides?.title || frontmatterTitle || DEFAULT_DOCUMENT_TITLE;
  const description = overrides?.description || frontmatterDescription;

  return {
    title,
    description,
    frontmatter: {
      ...frontmatter,
      title,
      description,
    },
  };
}
