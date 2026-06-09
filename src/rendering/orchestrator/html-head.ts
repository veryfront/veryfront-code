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

export function buildHeadElements(head?: CollectedHead): { scripts: string; other: string } {
  if (!head) return { scripts: "", other: "" };

  const scriptParts: string[] = [];
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
    if (content) {
      scriptParts.push(`<script ${attrStr}>${escapeInlineScriptContent(content)}</script>`);
    } else if (attrs.src) {
      scriptParts.push(`<script ${attrStr}></script>`);
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
