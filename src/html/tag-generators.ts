import type { HTMLMetadata } from "#veryfront/transforms/mdx/types.ts";
import { buildAttributes, escapeHTML } from "./html-escape.ts";

function filterAttrs(
  obj: Record<string, unknown>,
  excludeKeys: string[],
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !excludeKeys.includes(key)),
  ) as Record<string, string>;
}

function addNonceIfPresent(
  attrs: Record<string, string>,
  nonce?: string,
): Record<string, string> {
  return nonce ? { ...attrs, nonce } : attrs;
}

export function generateMetaTags(metadata: HTMLMetadata): string {
  const tags: string[] = ['<meta charset="UTF-8">'];

  const viewport = metadata.viewport || "width=device-width, initial-scale=1.0";
  tags.push(`<meta name="viewport" content="${escapeHTML(viewport)}">`);

  if (metadata.description) {
    tags.push(`<meta name="description" content="${escapeHTML(metadata.description)}">`);
  }

  for (const meta of metadata.meta || []) {
    tags.push(`<meta ${buildAttributes(meta as Record<string, string>)}>`);
  }

  if (metadata.themeColor) {
    tags.push(`<meta name="theme-color" content="${escapeHTML(metadata.themeColor)}">`);
  }

  return tags.join("\n  ");
}

export function generateLinkTags(metadata: HTMLMetadata): string {
  const tags: string[] = [];

  for (const link of metadata.links || []) {
    const linkAttrs = { ...link } as Record<string, string>;
    // Font preloads require crossorigin="anonymous" to match fetch behavior
    // Without this, the preloaded font won't be used and will be re-fetched
    if (linkAttrs.rel === "preload" && linkAttrs.as === "font" && !linkAttrs.crossorigin) {
      linkAttrs.crossorigin = "anonymous";
    }
    tags.push(`<link ${buildAttributes(linkAttrs)}>`);
  }

  for (const icon of metadata.icons || []) {
    const rel = icon.rel || "icon";
    tags.push(`<link ${buildAttributes({ rel, ...icon } as Record<string, string>)}>`);
  }

  return tags.join("\n  ");
}

export function generateScriptTags(metadata: HTMLMetadata, nonce?: string): string {
  const tags: string[] = [];

  for (const script of metadata.scripts || []) {
    if (script.src) {
      const attrs = filterAttrs(script, ["content"]);
      tags.push(`<script ${buildAttributes(attrs)}></script>`);
    } else if (script.content) {
      const attrs = addNonceIfPresent(filterAttrs(script, ["content", "src"]), nonce);
      tags.push(`<script ${buildAttributes(attrs)}>${script.content}</script>`);
    }
  }

  return tags.join("\n  ");
}

export function generateStyleTags(metadata: HTMLMetadata, nonce?: string): string {
  const tags: string[] = [];

  for (const style of metadata.styles || []) {
    if (style.href) {
      const attrs = filterAttrs(style, ["content"]);
      tags.push(`<link rel="stylesheet" ${buildAttributes(attrs)}>`);
    } else if (style.content) {
      const attrs = addNonceIfPresent(filterAttrs(style, ["content", "href"]), nonce);
      tags.push(`<style ${buildAttributes(attrs)}>${style.content}</style>`);
    }
  }

  return tags.join("\n  ");
}
