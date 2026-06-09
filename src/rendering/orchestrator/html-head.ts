import type { CollectedHead } from "#veryfront/react/head-collector.ts";
import type { MdxBundle, MDXFrontmatter } from "#veryfront/types";
import { escapeHTML, neutralizeRawTextContent } from "#veryfront/html/html-escape.ts";

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

    const attrStr = attrPairs.map(([k, v]) => `${k}="${escapeHTML(v)}"`).join(" ");
    if (content) {
      scriptParts.push(
        `<script ${attrStr}>${neutralizeRawTextContent(content, "script")}</script>`,
      );
    } else if (attrs.src) {
      scriptParts.push(`<script ${attrStr}></script>`);
    }
  }

  for (const meta of head.metas) {
    if (meta.name === "description") continue;

    const attrs: string[] = [];
    if (meta.name) attrs.push(`name="${escapeHTML(meta.name)}"`);
    if (meta.property) attrs.push(`property="${escapeHTML(meta.property)}"`);
    if (meta.content) attrs.push(`content="${escapeHTML(meta.content)}"`);
    if (attrs.length) otherParts.push(`<meta ${attrs.join(" ")}>`);
  }

  for (const link of head.links) {
    const attrs = Object.entries(link)
      .filter(([, v]) => v != null)
      .map(([k, v]) => `${k}="${escapeHTML(String(v))}"`)
      .join(" ");
    if (attrs) otherParts.push(`<link ${attrs}>`);
  }

  for (const style of head.styles) {
    otherParts.push(`<style>${neutralizeRawTextContent(style, "style")}</style>`);
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
