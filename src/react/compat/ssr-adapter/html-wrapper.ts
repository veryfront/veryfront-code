import type { HTMLWrapOptions } from "./types.ts";

/**
 * Escapes HTML special characters to prevent XSS attacks.
 * Used for user-provided content that will be inserted into HTML attributes or text.
 */
function escapeHtml(unsafe: string): string {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * Escapes content for HTML attribute values.
 * More strict escaping for attribute context.
 */
function escapeAttribute(unsafe: string): string {
  return escapeHtml(unsafe);
}

export function wrapInHTML(content: string, options: HTMLWrapOptions): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(options.title)}</title>
  ${
    Object.entries(options.meta)
      .map(
        ([name, metaContent]) =>
          `<meta name="${escapeAttribute(name)}" content="${escapeAttribute(metaContent)}">`,
      )
      .join("\n  ")
  }
  ${
    options.links
      .map(
        (link) =>
          `<link rel="${escapeAttribute(link.rel)}" href="${escapeAttribute(link.href)}">`,
      )
      .join("\n  ")
  }
  ${
    options.scripts
      .map(
        (script) =>
          `<script src="${escapeAttribute(script.src)}"${script.type ? ` type="${escapeAttribute(script.type)}"` : ""}${
            options.nonce ? ` nonce="${escapeAttribute(options.nonce)}"` : ""
          }></script>`,
      )
      .join("\n  ")
  }
</head>
<body>
  <div id="root">${content}</div>
  ${
    options.bootstrapScripts
      .map(
        (src) =>
          `<script src="${escapeAttribute(src)}"${options.nonce ? ` nonce="${escapeAttribute(options.nonce)}"` : ""} async></script>`,
      )
      .join("\n  ")
  }
</body>
</html>`;
}
