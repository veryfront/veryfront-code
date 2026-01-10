import type { HTMLMetadata } from "@veryfront/transforms/mdx/types.ts";
import { buildAttributes, escapeHTML } from "./html-escape.ts";

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
    const filteredAttrs = Object.fromEntries(
      Object.entries(script).filter(([key]) => key !== "content"),
    );

    if (script.src) {
      tags.push(`<script ${buildAttributes(filteredAttrs as Record<string, string>)}></script>`);
    } else if (script.content) {
      const attrsWithNonce = {
        ...Object.fromEntries(
          Object.entries(filteredAttrs).filter(([key]) => key !== "src"),
        ),
        ...(nonce ? { nonce } : {}),
      };
      tags.push(
        `<script ${
          buildAttributes(attrsWithNonce as Record<string, string>)
        }>${script.content}</script>`,
      );
    }
  }

  return tags.join("\n  ");
}

export function generateStyleTags(metadata: HTMLMetadata, nonce?: string): string {
  const tags: string[] = [];

  for (const style of metadata.styles || []) {
    const filteredAttrs = Object.fromEntries(
      Object.entries(style).filter(([key]) => key !== "content"),
    );

    if (style.href) {
      tags.push(
        `<link rel="stylesheet" ${buildAttributes(filteredAttrs as Record<string, string>)}>`,
      );
    } else if (style.content) {
      const attrsWithNonce = {
        ...Object.fromEntries(
          Object.entries(filteredAttrs).filter(([key]) => key !== "href"),
        ),
        ...(nonce ? { nonce } : {}),
      };
      tags.push(
        `<style ${
          buildAttributes(attrsWithNonce as Record<string, string>)
        }>${style.content}</style>`,
      );
    }
  }

  return tags.join("\n  ");
}
