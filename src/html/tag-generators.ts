import type { HTMLMetadata } from "@veryfront/transforms/mdx/types.ts";
import { buildAttributes, escapeHTML } from "./html-escape.ts";

/**
 * Escapes content for safe inclusion within a script tag.
 * Prevents XSS by escaping sequences that could break out of the script context.
 */
function escapeScriptContent(content: string): string {
  // Escape </script> sequences that could close the script tag prematurely
  // Also escape <!-- which can cause issues in HTML
  return content
    .replace(/<\/script/gi, "<\\/script")
    .replace(/<!--/g, "<\\!--");
}

export function generateMetaTags(metadata: HTMLMetadata): string {
  const tags: string[] = [];

  tags.push('<meta charset="UTF-8">');

  if (metadata.viewport) {
    tags.push(`<meta name="viewport" content="${escapeHTML(metadata.viewport)}">`);
  } else {
    tags.push('<meta name="viewport" content="width=device-width, initial-scale=1.0">');
  }

  if (metadata.description) {
    tags.push(`<meta name="description" content="${escapeHTML(metadata.description)}">`);
  }

  if (metadata.meta) {
    metadata.meta.forEach((meta) => {
      tags.push(`<meta ${buildAttributes(meta as Record<string, string>)}>`);
    });
  }

  if (metadata.themeColor) {
    tags.push(`<meta name="theme-color" content="${escapeHTML(metadata.themeColor)}">`);
  }

  return tags.join("\n  ");
}

export function generateLinkTags(metadata: HTMLMetadata): string {
  const tags: string[] = [];

  if (metadata.links) {
    metadata.links.forEach((link) => {
      tags.push(`<link ${buildAttributes(link as Record<string, string>)}>`);
    });
  }

  if (metadata.icons) {
    metadata.icons.forEach((icon) => {
      const rel = icon.rel || "icon";
      tags.push(`<link ${buildAttributes({ rel, ...icon } as Record<string, string>)}>`);
    });
  }

  return tags.join("\n  ");
}

export function generateScriptTags(metadata: HTMLMetadata, nonce?: string): string {
  const tags: string[] = [];

  if (metadata.scripts) {
    metadata.scripts.forEach((script) => {
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
          }>${escapeScriptContent(script.content)}</script>`,
        );
      }
    });
  }

  return tags.join("\n  ");
}

export function generateStyleTags(metadata: HTMLMetadata, nonce?: string): string {
  const tags: string[] = [];

  if (metadata.styles) {
    metadata.styles.forEach((style) => {
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
    });
  }

  return tags.join("\n  ");
}
